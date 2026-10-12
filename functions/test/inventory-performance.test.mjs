import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readUnique } = require('../lib/transaction-reads.js');
const { runBounded } = require('../lib/bounded-work.js');

test('lecturas únicas conservan cada línea, referencias ausentes y aislamiento por intento', async () => {
  const refs = ['products/P1', 'stocks/P1_S1', 'products/P1', 'products/P2', 'stocks/P1_S1'].map((path) => ({ path }));
  const calls = [];
  const tx = { getAll: async (...references) => {
    calls.push(references);
    return references.map((ref) => ({ ref, exists: !ref.path.endsWith('P2'), attempt: calls.length }));
  } };
  const rows = await readUnique(tx, refs);
  assert.equal(calls[0].length, 3);
  assert.equal(rows.length, 5);
  assert.equal(rows[0], rows[2]); assert.equal(rows[1], rows[4]);
  assert.equal(rows[3].exists, false);
  const retry = await readUnique(tx, refs);
  assert.equal(retry[0].attempt, 2);
  assert.notEqual(retry[0], rows[0]);
  assert.deepEqual(await readUnique(tx, []), []);
});

test('propagación limitada a cuatro tareas y rechazo espera las operaciones ya iniciadas', async () => {
  let active = 0; let peak = 0;
  const completed = [];
  await runBounded(Array.from({ length: 101 }, (_, index) => index), 4, async (value) => {
    active++; peak = Math.max(peak, active);
    await new Promise(setImmediate);
    completed.push(value); active--;
  });
  assert.equal(peak, 4); assert.equal(completed.length, 101);
  const attempted = [];
  await assert.rejects(runBounded([0, 1, 2, 3, 4, 5], 4, async (value) => {
    attempted.push(value);
    await new Promise(setImmediate);
    if (!value) throw new Error('Firestore no disponible');
    completed.push(value);
  }), AggregateError);
  assert.deepEqual(attempted, [0, 1, 2, 3]);
});

test('metadatos usan producto y stock frescos y un reintento completa el trabajo restante', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ ref: { path: `stocks/${index}` },
    data: { quantity: index, productName: 'Anterior', minStock: 1, isLowStock: true } }));
  let reads = 0; let active = 0; let peak = 0; let fail = true; let listed = 0;
  const product = { name: 'Nombre actual', minStock: 5, active: true };
  const collection = { where() { return this; }, orderBy() { return this; }, startAfter(cursor) { this.cursor = Number(cursor.ref.path.split('/')[1]); return this; },
    limit() { return this; }, async get() {
      const start = this.cursor === undefined ? 0 : this.cursor + 1; this.cursor = undefined;
      const docs = rows.slice(start, start + 100); listed += docs.length;
      return { docs, size: docs.length };
    } };
  const firebasePath = require.resolve('../lib/firebase.js'); const tenantPath = require.resolve('../lib/tenant.js');
  const handlerPath = require.resolve('../lib/stock-metadata.js');
  const oldFirebase = require.cache[firebasePath]; const oldTenant = require.cache[tenantPath];
  require.cache[firebasePath] = { exports: { db: { runTransaction: async (work) => {
    active++; peak = Math.max(peak, active);
    try { await new Promise(setImmediate); return await work({
      getAll: async (stockRef) => {
        reads += 2;
        if (fail && stockRef.path === 'stocks/1') { fail = false; throw new Error('retry'); }
        const row = rows.find((value) => value.ref.path === stockRef.path);
        return [{ data: () => row.data }, { data: () => product }];
      }, update: (ref, patch) => Object.assign(rows.find((row) => row.ref.path === ref.path).data, patch)
    }); } finally { active--; }
  } } } };
  require.cache[tenantPath] = { exports: { tenantCollection: () => collection, tenantDoc: () => ({ path: 'products/P1' }) } };
  delete require.cache[handlerPath];
  try {
    const handler = require(handlerPath).syncProductStockMetadata;
    const event = { params: { tenantId: 'T1', productId: 'P1' }, data: { before: { data: () => ({ name: 'Anterior' }) }, after: { data: () => ({ name: 'Evento atrasado' }) } } };
    await assert.rejects(handler.run(event), AggregateError);
    await handler.run(event);
    assert.equal(peak, 4); assert.equal(active, 0); assert.ok(reads >= 202); assert.ok(listed >= 201);
    rows.forEach((row, index) => {
      assert.equal(row.data.productName, 'Nombre actual');
      assert.equal(row.data.isLowStock, index <= 5);
    });
    product.active = false;
    await handler.run(event);
    assert.equal(rows.some((row) => row.data.isLowStock), false);
  } finally {
    delete require.cache[handlerPath];
    if (oldFirebase) require.cache[firebasePath] = oldFirebase; else delete require.cache[firebasePath];
    if (oldTenant) require.cache[tenantPath] = oldTenant; else delete require.cache[tenantPath];
  }
});
