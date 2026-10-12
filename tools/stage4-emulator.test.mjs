import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { inspectCashSession, inspectStatistics, inspectRetention } from './stage4-audit-lib.mjs';

if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Solo emuladores locales.');
process.env.GCLOUD_PROJECT = 'demo-denzoz-ops';
process.env.FUNCTIONS_EMULATOR = 'true';
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'stage4-integration');
const db = getFirestore(app);
const tenantId = 'stage4-local';
const ref = (name, id) => db.doc(`tenants/${tenantId}/${name}/${id}`);
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { applySaleStatusPatch } = require('./lib/sale-status.js');
const { reconcileSaleStatistics } = require('./lib/statistics-processing.js');
after(async () => { await db.terminate(); await deleteApp(app); await require('./lib/firebase.js').db.terminate(); });
const cash = { tenantId, storeId: 'S1', userId: 'U1', openingAmount: 50, status: 'abierta' };
const sale = { tenantId, storeId: 'S1', userId: 'U1', cashSessionId: 'legacy', type: 'nota', status: 'activa',
  createdAt: Date.parse('2026-10-01T12:00:00-05:00'), total: 25, payments: [{ method: 'efectivo', amount: 15 }, { method: 'plin', amount: 10 }],
  items: [{ productId: 'P1', name: 'Prueba', baseUnit: 'UN', baseUnitsSold: 1, qty: 1, total: 25 }] };

test('conciliación paginada real y CLI leen 251 ventas sin cambiar caja ni ventas', async () => {
  const batch = db.batch();
  batch.set(ref('cash_sessions', 'legacy'), cash);
  for (let index = 0; index < 251; index++) batch.set(ref('sales', `legacy-${String(index).padStart(3, '0')}`), sale);
  await batch.commit();
  const initial = await ref('cash_sessions', 'legacy').get();
  const report = await inspectCashSession(db, tenantId, 'legacy', 300);
  assert.equal(report.complete, true); assert.equal(report.scanned, 251); assert.equal(report.documentsRead, 252);
  assert.equal(report.computedSummary.totalSales, 6275); assert.equal(report.expectedAmount, 3815);
  assert.equal(report.issueCount, 0);
  const cli = spawnSync(process.execPath, ['tools/audit-stage4.mjs', 'cash', '--session=legacy', '--budget=251'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-denzoz-ops', TENANT_ID: tenantId }
  });
  assert.equal(cli.status, 0, cli.stderr);
  const partial = JSON.parse(cli.stdout);
  assert.equal(partial.complete, false); assert.equal(partial.scanned, 250); assert.equal(partial.documentsRead, 251);
  assert.equal((await ref('cash_sessions', 'legacy').get()).updateTime.isEqual(initial.updateTime), true);
  assert.equal((await ref('sales', 'legacy-000').get()).data().statisticsVersion, undefined);
});

test('anulaciones simultáneas conservan ajustes únicos y reintentos mantienen el documento', async () => {
  await ref('cash_sessions', 'modern').set({ ...cash, summaryVersion: 1,
    salesSummary: { totalSales: 25, cashSales: 15, yapeSales: 10, cardSales: 0, otherSales: 0, salesCount: 1 } });
  await ref('sales', 'void-test').set({ ...sale, cashSessionId: 'modern', statisticsVersion: 2,
    statisticsApplied: false, statisticsPending: true, statisticsNextRetryAt: 0 });
  await Promise.all(Array.from({ length: 4 }, (_, index) => applySaleStatusPatch(tenantId, 'void-test',
    { status: 'anulada', voidedAt: 100 + index, voidedStatus: 'aceptado' })));
  await reconcileSaleStatistics(tenantId, 'void-test');
  const first = await ref('sales', 'void-test').get();
  const firstCash = await ref('cash_sessions', 'modern').get();
  assert.equal(firstCash.data().cashBalanceAdjustment, 15); assert.equal(firstCash.data().salesSummary.cashSales, 0);
  await applySaleStatusPatch(tenantId, 'void-test', { status: 'anulada', voidedAt: 999, voidedStatus: 'aceptado' });
  const after = await ref('sales', 'void-test').get();
  assert.equal(after.data().voidedAt, first.data().voidedAt);
  assert.equal(after.updateTime.isEqual(first.updateTime), true);
  assert.equal((await ref('cash_sessions', 'modern').get()).updateTime.isEqual(firstCash.updateTime), true);
});

test('analítica concurrente concilia ventas una vez y el diagnóstico mensual conserva los totales', async () => {
  for (let index = 0; index < 3; index++) await ref('sales', `statistics-${index}`).set({ ...sale, storeId: 'statistics-store', cashSessionId: null });
  await Promise.all(Array.from({ length: 6 }, (_, index) => reconcileSaleStatistics(tenantId, `statistics-${index % 3}`)));
  const report = await inspectStatistics(db, tenantId, 'statistics-store', '2026-10');
  assert.equal(report.complete, true); assert.equal(report.tickets, 3);
  assert.equal(report.partitions.reduce((sum, row) => sum + row.productCount, 0), 1);
  await applySaleStatusPatch(tenantId, 'statistics-0', { status: 'anulada', voidedAt: Date.now() });
  await Promise.all([reconcileSaleStatistics(tenantId, 'statistics-0'), reconcileSaleStatistics(tenantId, 'statistics-0')]);
  assert.equal((await inspectStatistics(db, tenantId, 'statistics-store', '2026-10')).tickets, 2);
});

test('muestra de vencimientos conserva jobs, dispositivos y recibos de idempotencia', async () => {
  const notification = ref('calendar_inboxes', 'U1').collection('notifications').doc('expired');
  await Promise.all([
    notification.set({ tenantId, expiresAt: Timestamp.fromMillis(50), pushState: 'sent' }),
    db.doc('replenishment_push_jobs/stage4-expired').set({ tenantId, state: 'failed', expiresAt: Timestamp.fromMillis(50) }),
    db.doc('calendar_push_devices/stage4-expired').set({ tenantId, expiresAt: 50 }),
    ref('operation_receipts', 'never-delete').set({ tenantId, createdAt: 1, result: { ok: true } })
  ]);
  const report = await inspectRetention(db, tenantId, 'U1', 100, 100);
  assert.equal(report.samples.reduce((sum, row) => sum + row.expired, 0), 3);
  assert.equal(report.deletionApplied, false);
  assert.equal((await notification.get()).exists, true);
  assert.equal((await db.doc('replenishment_push_jobs/stage4-expired').get()).exists, true);
  assert.equal((await ref('operation_receipts', 'never-delete').get()).exists, true);
});
