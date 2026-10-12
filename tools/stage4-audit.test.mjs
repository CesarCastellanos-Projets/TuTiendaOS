import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCashAudit, inspectCashSession, inspectStatistics, inspectRetention } from './stage4-audit-lib.mjs';

const tenantId = 'stage4-audit';
const sessionId = 'C1';
const session = { tenantId, storeId: 'S1', userId: 'U1', status: 'abierta', openingAmount: 50 };
const sale = { tenantId, storeId: 'S1', userId: 'U1', cashSessionId: sessionId, status: 'activa', createdAt: 10,
  total: 25, payments: [{ method: 'efectivo', amount: 15 }, { method: 'plin', amount: 10 }], clientDoc: { nombre: 'No debe aparecer' } };

function fakeDatabase(collections, documents = {}) {
  const queries = [];
  const doc = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  const query = (path, filters = {}, after = '', count = Infinity) => ({ path, filters, after, count,
    where: (key, operator, value) => { assert.equal(operator, '=='); return query(path, { ...filters, [key]: value }, after, count); },
    orderBy: (key) => { assert.equal(key, '__name__'); return query(path, filters, after, count); },
    startAfter: (row) => query(path, filters, row.id, count), limit: (size) => query(path, filters, after, size)
  });
  return { queries, doc: (path) => ({ path }), collection: query,
    async runTransaction(work, options) {
      assert.deepEqual(options, { readOnly: true });
      return work({ async get(request) {
        if (!request.filters) return doc(request.path.split('/').at(-1), documents[request.path]);
        queries.push(request);
        const rows = (collections[request.path] ?? []).filter((row) => row.id > request.after
          && Object.entries(request.filters).every(([key, value]) => row.data[key] === value)).slice(0, request.count);
        return { size: rows.length, docs: rows.map((row) => doc(row.id, row.data)) };
      } });
    }
  };
}

test('conciliación mantiene centavos, pagos mixtos y ajuste de caja sin divulgar clientes', () => {
  const audit = createCashAudit(tenantId, sessionId, { ...session, cashBalanceAdjustment: -5 });
  audit.add('S1', sale);
  audit.add('S2', { ...sale, total: 0.3, payments: [{ method: 'efectivo', amount: 0.1 }, { method: 'tarjeta', amount: 0.2 }] });
  const report = audit.finish(true, 3);
  assert.deepEqual(report.computedSummary, { totalSales: 25.3, cashSales: 15.1, yapeSales: 10, cardSales: 0.2, otherSales: 0, salesCount: 2 });
  assert.equal(report.expectedAmount, 60.1); assert.equal(report.issueCount, 0);
  assert.equal(report.storedSummaryComparison, 'absent'); assert.equal(report.migrationApplied, false);
  assert.equal(JSON.stringify(report).includes('No debe aparecer'), false);
});

test('corte de cierre incluye anulaciones posteriores y marca efectivo histórico para revisión', () => {
  const audit = createCashAudit(tenantId, sessionId, { ...session, status: 'cerrada', closingStartedAt: 100,
    closingAmount: 65, expectedAmount: 65, difference: 0 });
  audit.add('before', { ...sale, status: 'anulada', voidedAt: 90 });
  audit.add('after', { ...sale, status: 'anulada', voidedAt: 110 });
  const report = audit.finish(true, 3);
  assert.equal(report.computedSummary.totalSales, 25);
  assert.equal(report.expectedAmount, 65); assert.equal(report.difference, 0);
  assert.equal(report.issues.filter((row) => row.code === 'VOID_CASH_HISTORY_REVIEW').length, 2);
  assert.equal(report.requiresFinancialReview, true);
});

test('contextos cruzados, datos ambiguos y resúmenes distintos nunca se declaran conciliados', () => {
  const audit = createCashAudit(tenantId, sessionId, { ...session, salesSummary: { totalSales: 100 } });
  audit.add('other-tenant', { ...sale, tenantId: 'other-tenant' });
  audit.add('unknown-void', { ...sale, status: 'anulada' });
  audit.add('bad-payment', { ...sale, payments: [{ method: 'efectivo', amount: 24 }] });
  audit.add('bad-decimals', { ...sale, total: 25.001 });
  audit.add('bad-status', { ...sale, status: 'desconocida' });
  for (let index = 0; index < 25; index++) audit.add(`bad-${index}`, { ...sale, total: NaN });
  const report = audit.finish(false, 31);
  assert.equal(report.issueCount, 31); assert.equal(report.issues.length, 20);
  assert.equal(report.complete, false); assert.equal(report.storedSummaryComparison, 'not_checked_incomplete');
  assert.equal(report.expectedAmount, null); assert.equal(report.difference, null);
  assert.equal(report.migrationApplied, false);
  assert.throws(() => createCashAudit(undefined, sessionId, session), /Contexto/);
  const mismatch = createCashAudit(tenantId, sessionId, { ...session, salesSummary: { totalSales: 100 } });
  mismatch.add('valid', sale);
  assert.equal(mismatch.finish(true, 2).storedSummaryComparison, 'differs');
});

test('lecturas de caja paginadas comparten snapshot, reservan prueba de fin y respetan presupuesto', async () => {
  const sales = Array.from({ length: 251 }, (_, index) => ({ id: String(index).padStart(4, '0'), data: sale }));
  const db = fakeDatabase({ [`tenants/${tenantId}/sales`]: sales }, { [`tenants/${tenantId}/cash_sessions/${sessionId}`]: session });
  const complete = await inspectCashSession(db, tenantId, sessionId, 300);
  assert.equal(complete.scanned, 251); assert.equal(complete.complete, true); assert.equal(complete.documentsRead, 252);
  assert.deepEqual(db.queries.map((query) => query.count), [250, 49]);
  const limited = await inspectCashSession(db, tenantId, sessionId, 251);
  assert.equal(limited.scanned, 250); assert.equal(limited.complete, false); assert.equal(limited.documentsRead, 251);
  assert.equal(limited.expectedAmount, null);
  assert.ok(limited.issues.some((row) => row.code === 'READ_BUDGET_EXHAUSTED'));
  const exact = await inspectCashSession(db, tenantId, sessionId, 253);
  assert.equal(exact.complete, true); assert.equal(exact.scanned, 251);
  await assert.rejects(inspectCashSession(db, tenantId, undefined), /Contexto/);
  await assert.rejects(inspectCashSession(db, tenantId, sessionId, 5001), /Presupuesto/);
});

test('tamaño de particiones y conteos completos o parciales no se presentan como medición de contención', async () => {
  const partitions = Array.from({ length: 101 }, (_, index) => ({ id: String(index).padStart(4, '0'), data: {
    storeId: 'S1', month: '2026-10', products: { P1: { name: 'Producto', days: {} } }, split: false
  } }));
  const db = fakeDatabase({ [`tenants/${tenantId}/sales_statistics_products`]: partitions },
    { [`tenants/${tenantId}/sales_statistics/S1_2026-10`]: { days: { '2026-10-01': { tickets: 7 } } } });
  const report = await inspectStatistics(db, tenantId, 'S1', '2026-10', 105);
  assert.equal(report.complete, true); assert.equal(report.partitions.length, 101); assert.equal(report.documentsRead, 102);
  assert.equal(report.tickets, 7); assert.equal(report.contentionMeasured, false);
  assert.ok(report.partitions.every((row) => row.productCount === 1 && row.jsonBytes > 0));
  const partial = await inspectStatistics(db, tenantId, 'S1', '2026-10', 101);
  assert.equal(partial.complete, false); assert.equal(partial.partitions.length, 100);
});

test('retención muestra solo la empresa elegida y distingue trabajo vencido pendiente sin eliminarlo', async () => {
  const db = fakeDatabase({
    [`tenants/${tenantId}/calendar_inboxes/U1/notifications`]: [
      { id: 'a', data: { expiresAt: { toMillis: () => 50 }, pushState: 'sent' } },
      { id: 'b', data: { expiresAt: { toMillis: () => 50 }, pushState: 'pending', pushLeaseUntil: 200 } }
    ],
    replenishment_push_jobs: [
      { id: 'a', data: { tenantId, expiresAt: { toMillis: () => 50 }, state: 'pending' } },
      { id: 'b', data: { tenantId: 'other-tenant', expiresAt: { toMillis: () => 50 }, state: 'sent' } }
    ],
    calendar_push_devices: [{ id: 'a', data: { tenantId, expiresAt: 150 } }, { id: 'b', data: { tenantId } }]
  });
  const report = await inspectRetention(db, tenantId, 'U1', 2, 100);
  assert.equal(report.documentsRead, 5); assert.equal(report.samples[0].mayHaveMore, true);
  assert.equal(report.samples[0].expired, 2); assert.equal(report.samples[0].reviewPendingOrLeased, 1);
  assert.equal(report.samples[1].scanned, 1); assert.equal(report.samples[1].reviewPendingOrLeased, 1);
  assert.equal(report.samples[2].invalidExpiry, 1); assert.equal(report.deletionApplied, false);
  assert.equal(db.queries.some((query) => query.path.endsWith('/sales') || query.path.endsWith('/operation_receipts')), false);
});

test('CLI bloquea lecturas remotas implícitas y flags de escritura antes de abrir Firebase', () => {
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: '', GOOGLE_CLOUD_PROJECT: 'real-project', TENANT_ID: tenantId };
  const result = spawnSync(process.execPath, ['tools/audit-stage4.mjs', 'cash', '--session=C1'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Lecturas remotas deshabilitadas/);
  const apply = spawnSync(process.execPath, ['tools/audit-stage4.mjs', 'cash', '--apply'], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
  assert.notEqual(apply.status, 0); assert.match(apply.stderr, /Argumento inválido/);
});
