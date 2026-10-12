import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FieldValue } = require('firebase-admin/firestore');
let rows;
let writes;
let reads;
const db = {
  doc: (path) => ({ path }),
  async runTransaction(work) {
    return work({
      get: async (ref) => { reads++; return { ref, data: () => rows.get(ref.path) }; },
      update: (ref, fields) => { writes.push({ path: ref.path, fields }); Object.assign(rows.get(ref.path), fields); },
      set: (ref, fields) => {
        writes.push({ path: ref.path, fields });
        const row = rows.get(ref.path);
        for (const [field, value] of Object.entries(fields)) {
          if (value instanceof FieldValue && value.isEqual(FieldValue.delete())) delete row[field];
          else row[field] = value;
        }
      }
    });
  }
};
require.cache[require.resolve('../lib/firebase.js')] = { exports: { db } };
const { applySaleStatusPatch } = require('../lib/sale-status.js');
const salePath = 'tenants/perf-sale/sales/S1';
const cashPath = 'tenants/perf-sale/cash_sessions/C1';
function reset(sale, cash) { rows = new Map([[salePath, sale], [cashPath, cash]]); writes = []; reads = 0; }

test('resultados idénticos y borrado de campos ausentes omiten escrituras; cambios y transforms permanecen', async () => {
  reset({ status: 'activa', sunatStatus: 'aceptado', metadata: { code: 'ok' } });
  await applySaleStatusPatch('perf-sale', 'S1', { sunatStatus: 'aceptado', metadata: { code: 'ok' }, lease: FieldValue.delete() });
  assert.equal(reads, 1); assert.equal(writes.length, 0);
  await applySaleStatusPatch('perf-sale', 'S1', { sunatStatus: 'observado' });
  assert.equal(writes.length, 1);
  rows.get(salePath).lease = 100;
  await applySaleStatusPatch('perf-sale', 'S1', { lease: FieldValue.delete() });
  assert.equal(writes.length, 2); assert.equal(Object.hasOwn(rows.get(salePath), 'lease'), false);
  await applySaleStatusPatch('perf-sale', 'S1', { updatedAt: FieldValue.serverTimestamp() });
  await applySaleStatusPatch('perf-sale', 'S1', { count: FieldValue.increment(1) });
  assert.equal(writes.length, 4);
  await applySaleStatusPatch('perf-sale', 'missing', { status: 'anulada' });
  assert.equal(writes.length, 4);
});

test('anulación y retención se aplican una vez; 100 repeticiones no escriben ni reactivan la venta', async () => {
  reset({ status: 'activa', cashSessionId: 'C1', total: 25,
    payments: [{ method: 'efectivo', amount: 15 }, { method: 'yape', amount: 10 }] },
    { summaryVersion: 1, status: 'abierta', salesSummary: { totalSales: 25, cashSales: 15, yapeSales: 10, salesCount: 1 } });
  await applySaleStatusPatch('perf-sale', 'S1', { status: 'anulada', voidedAt: 100, creditNoteStatus: 'aceptado' });
  assert.equal(writes.length, 2);
  assert.equal(rows.get(cashPath).cashBalanceAdjustment, 15);
  for (let index = 0; index < 100; index++) {
    await applySaleStatusPatch('perf-sale', 'S1', { status: 'anulada', voidedAt: 200 + index, creditNoteStatus: 'aceptado' });
  }
  await applySaleStatusPatch('perf-sale', 'S1', { status: 'activa' });
  assert.equal(writes.length, 2); assert.equal(reads, 103);
  assert.equal(rows.get(salePath).voidedAt, 100);
  assert.equal(rows.get(salePath).status, 'anulada');
  assert.equal(rows.get(cashPath).salesSummary.cashSales, 0);
});
