import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let retryCount = 0;
let fail = false;
let sale;
let writes = [];
let contributions = 0;
const db = { doc: (path) => ({ path }), async runTransaction(work) {
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const pending = [];
    await work({ get: async () => ({ data: () => sale }), update: (ref, data) => pending.push({ ref, data }) });
    if (attempt === retryCount && !fail) writes.push(...pending);
  }
  if (fail) throw new Error('ABORTED');
} };
require.cache[require.resolve('../lib/firebase.js')] = { exports: { db } };
require.cache[require.resolve('../lib/statistics-model.js')] = { exports: { updateSalesStatistics: async () => { contributions++; } } };
const { reconcileSaleStatistics, aggregateSaleStatistics } = require('../lib/statistics-processing.js');

test('contención emite una señal por ejecución reintentada y conserva rollback y errores', async () => {
  const logs = [];
  const previous = console.warn;
  console.warn = (...values) => logs.push(values);
  try {
    sale = { status: 'activa', statisticsApplied: false, statisticsPending: true };
    retryCount = 2;
    await reconcileSaleStatistics('contention-test', 'sale');
    assert.equal(contributions, 3); assert.equal(writes.length, 1);
    assert.equal(logs.length, 1); assert.equal(logs[0][1].attempts, 3); assert.equal(logs[0][1].completed, true);
    fail = true;
    await assert.rejects(reconcileSaleStatistics('contention-test', 'sale'), /ABORTED/);
    assert.equal(writes.length, 1); assert.equal(logs[1][1].completed, false);
    fail = false; retryCount = 0;
    sale = { status: 'activa', statisticsApplied: true, statisticsPending: false, statisticsVersion: 2 };
    await reconcileSaleStatistics('contention-test', 'sale');
    assert.equal(writes.length, 1); assert.equal(logs.length, 2);
  } finally { console.warn = previous; }
});

test('metadatos SUNAT, confirmación analítica y backoff no consultan agregados', async () => {
  const previous = contributions;
  const row = { status: 'activa', statisticsVersion: 2, statisticsApplied: false, statisticsPending: true };
  for (const [before, after] of [
    [row, { ...row, sunatStatus: 'aceptado' }],
    [row, { ...row, statisticsApplied: true, statisticsPending: false }],
    [row, { ...row, statisticsAttempts: 2, statisticsNextRetryAt: 100 }]
  ]) {
    await aggregateSaleStatistics.run({ params: { tenantId: 'contention-test', saleId: 'sale' },
      data: { before: { data: () => before }, after: { data: () => after } } });
  }
  assert.equal(contributions, previous);
});
