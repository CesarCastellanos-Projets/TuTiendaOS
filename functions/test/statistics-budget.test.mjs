import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let scenario;
let tenant = 0;
const months = Array.from({ length: 13 }, (_, index) => new Date(Date.UTC(2025, 9 + index, 1)).toISOString().slice(0, 7));
const profile = { uid: 'admin', role: 'admin', tenantId: 'test-budget' };
const doc = (id, data) => ({ id, exists: true, data: () => data });
function query(path, filters = {}, count = Infinity, after = -1) {
  return {
    path, filters, count, after,
    where: (field, operator, value) => query(path, { ...filters, [`${field}:${operator}`]: value }, count, after),
    orderBy: () => query(path, filters, count, after),
    limit: (limit) => query(path, filters, limit, after),
    startAfter: (document) => query(path, filters, count, Number(document.id))
  };
}

const db = {
  doc: (path) => ({ path }), collection: query,
  async runTransaction(callback, options) {
    if (!options?.readOnly) return callback({ get: async () => doc('quota', {}), set: () => {} });
    return callback({
      getAll: async (...refs) => {
        scenario.cost += refs.length;
        return refs.map((ref) => doc(ref.path.split('/').at(-1), { name: 'Tienda' }));
      },
      async get(request) {
        if (request.path.endsWith('/meta/statistics')) {
          scenario.cost++;
          return doc('statistics', { historicalComplete: true });
        }
        if (request.path.endsWith('/sales_statistics')) {
          const docs = scenario.counts.map((count, index) => doc(months[index], { month: months[index], days: {
            [`${months[index]}-01`]: { revenue: count * 10, units: count, tickets: count, payments: { efectivo: count * 10 }, hourly: Array(24).fill(0) }
          } }));
          scenario.cost += Math.max(1, docs.length);
          return { docs, size: docs.length };
        }
        assert.ok(request.path.endsWith('/sales_statistics_products'));
        const index = months.indexOf(request.filters['month:==']);
        const size = Math.min(request.count, Math.max(0, scenario.counts[index] - request.after - 1));
        scenario.queries.push(request.count);
        scenario.cost += Math.max(1, size);
        scenario.inFlight++;
        scenario.maxInFlight = Math.max(scenario.maxInFlight, scenario.inFlight);
        await new Promise(setImmediate);
        scenario.inFlight--;
        const docs = Array.from({ length: size }, (_, position) => doc(String(request.after + position + 1), { products: {
          P1: { name: 'Producto', unit: 'UN', days: { [`${months[index]}-01`]: { revenue: 10, units: 1, tickets: 1 } } }
        } }));
        return { docs, size };
      }
    });
  }
};
require.cache[require.resolve('../lib/firebase.js')] = { exports: { db } };
require.cache[require.resolve('../lib/authz.js')] = { exports: { requireActiveProfile: async () => profile } };
const { getSalesStatistics } = require('../lib/statistics.js');

async function run(counts, storeIds = ['S1']) {
  profile.tenantId = `test-budget-${++tenant}`;
  scenario = { counts, cost: 0, queries: [], inFlight: 0, maxInFlight: 0 };
  return getSalesStatistics.run({ data: { start: '2025-10-01', end: '2026-10-01', storeIds } });
}

test('512 particiones mensuales devuelven los mismos totales completos', async () => {
  const result = await run([512]);
  assert.equal(result.revenue, 5120);
  assert.equal(result.topProducts[0].units, 512);
  assert.equal(result.documentsRead, 515);
  assert.equal(result.documentsRead, scenario.cost);
});

test('513 particiones rechazan sin disparar los trece meses por adelantado', async () => {
  await assert.rejects(run(Array(13).fill(513)), { code: 'resource-exhausted' });
  assert.equal(scenario.queries.length, 4);
  assert.equal(scenario.maxInFlight, 4);
  assert.equal(scenario.cost, 2066);
});

test('5000 lecturas: admite prueba de fin de página y nunca entrega resultados truncados', async () => {
  const result = await run([...Array(9).fill(512), 379]);
  assert.equal(result.documentsRead, 5000);
  assert.equal(result.topProducts[0].units, 4987);
  assert.equal(scenario.cost, 5000);
  assert.ok(scenario.queries.includes(1));
  await assert.rejects(run([...Array(9).fill(512), 380]), { code: 'resource-exhausted' });
  assert.ok(scenario.cost <= 5000);
});

test('volumen de trece meses y consultas vacías respetan el presupuesto y la concurrencia', async () => {
  await assert.rejects(run(Array(13).fill(512)), { code: 'resource-exhausted' });
  assert.ok(scenario.cost <= 5000);
  assert.ok(scenario.maxInFlight <= 4);
  const result = await run([0, 0, 1], ['S1', 'S2', 'S3']);
  assert.equal(result.documentsRead, scenario.cost);
  assert.equal(result.revenue, 30);
  assert.equal(result.topProducts[0].units, 3);
  assert.ok(scenario.maxInFlight <= 4);
});
