import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const projectId = 'demo-denzoz-ops';
if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST)
  || !['127.0.0.1:9099', 'localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('Solo emuladores locales.');
process.env.GCLOUD_PROJECT = projectId;
process.env.FUNCTIONS_EMULATOR = 'true';
const db = getFirestore(initializeApp({ projectId }, 'audit-regression'));
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const { reconcileSaleStatistics } = requireFunctions('./lib/statistics-processing.js');
const { applySaleStatusPatch } = requireFunctions('./lib/sale-status.js');
const { processDailySummary } = requireFunctions('./lib/tax.js');
const { deliverReplenishmentPush } = requireFunctions('./lib/replenishment-notifications.js');
after(async () => { await db.terminate(); await requireFunctions('./lib/firebase.js').db.terminate(); });
const tenantId = 'audit-regressions';
const ref = (collection, id) => db.doc(`tenants/${tenantId}/${collection}/${id}`);
let admin;
let pos;
let sessionId;

async function identity(email, role) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
  });
  assert.equal(response.ok, true);
  const result = await response.json();
  await db.doc(`users/${result.localId}`).set({ tenantId, role, active: true, displayName: role, ...(role === 'pos' ? { storeId: 'S1' } : {}) });
  return result;
}

async function call(name, input, user = admin) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.idToken}` },
    body: JSON.stringify({ data: input })
  });
  const body = await response.json();
  return { ok: response.ok && body.result !== undefined, ...body };
}

before(async () => {
  [admin, pos] = await Promise.all([identity('audit-admin@example.com', 'admin'), identity('audit-pos@example.com', 'pos')]);
  await Promise.all([
    ref('stores', 'S1').set({ tenantId, name: 'Tienda', code: 'S1', active: true }),
    ref('warehouses', 'W1').set({ tenantId, name: 'Central', code: 'W1', active: true }),
    ref('config', 'company').set({ tenantId, serieBoleta: 'B001', igvRate: 0.18, umbralConsolidacion: 5 }),
    ref('products', 'P1').set({ tenantId, name: 'Producto', category: 'Prueba', unit: 'UN', salePrice: 10, active: true, minStock: 1,
      presentations: [{ id: 'box', unit: 'CJA', factor: 12, salePrice: 100, autoUnpackEnabled: false, allowFractionalSale: false, fractionStep: 0.5, autoUnpackPriority: 1 }] })
  ]);
  const cash = await call('openCashSession', { storeId: 'S1', openingAmount: 50 }, pos);
  assert.equal(cash.ok, true, JSON.stringify(cash)); sessionId = cash.result.id;
});

test('ingreso, ajuste y transferencia recuperan el mismo resultado sin duplicar kardex', { timeout: 90000 }, async () => {
  const ingress = { requestId: crypto.randomUUID(), locationId: 'S1', locationType: 'store', items: [{ productId: 'P1', qty: 50 }, { productId: 'P1', presentationId: 'box', qty: 2 }] };
  const results = await Promise.all([call('recordStockIngress', ingress), call('recordStockIngress', ingress)]);
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  let stock = (await ref('product_stocks', 'P1_S1').get()).data();
  assert.equal(stock.quantity, 74); assert.equal(stock.baseQuantity, 50); assert.equal(stock.presentationQuantities.box, 2);
  assert.equal((await db.collection(`tenants/${tenantId}/stock_movements`).get()).size, 2);
  const changed = await call('recordStockIngress', { ...ingress, items: [{ productId: 'P1', qty: 51 }] });
  assert.equal(changed.error.status, 'ALREADY_EXISTS');
  const adjustment = { requestId: crypto.randomUUID(), productId: 'P1', locationId: 'S1', newQty: 40, type: 'ajuste', reason: 'Conteo' };
  assert.ok((await call('adjustInventory', adjustment)).ok);
  assert.ok((await call('adjustInventory', adjustment)).ok);
  assert.equal((await ref('product_stocks', 'P1_S1').get()).data().quantity, 64);
  const transfer = { requestId: crypto.randomUUID(), fromLocationId: 'S1', fromLocationType: 'store', toLocationId: 'W1', toLocationType: 'warehouse', items: [{ productId: 'P1', qtySent: 4 }] };
  const dispatches = await Promise.all([call('createInventoryTransfer', transfer), call('createInventoryTransfer', transfer)]);
  assert.ok(dispatches.every((result) => result.ok), JSON.stringify(dispatches));
  assert.equal(dispatches[0].result.id, dispatches[1].result.id);
  assert.equal((await call('receiveTransfer', { transferId: dispatches[0].result.id, quantities: { P1: 4 } })).ok, true);
  assert.equal((await ref('product_stocks', 'P1_W1').get()).data().baseQuantity, 4);
  assert.equal((await call('archiveLocation', { id: 'W1', type: 'warehouse' })).error.status, 'FAILED_PRECONDITION');
  const product = (await ref('products', 'P1').get()).data();
  const edit = await call('saveCatalogProduct', { requestId: crypto.randomUUID(), productId: 'P1', product: { ...product, presentations: [{ ...product.presentations[0], autoUnpackEnabled: true }] } });
  assert.equal(edit.error.status, 'FAILED_PRECONDITION');
});

test('cotización no reserva stock y solo se factura una vez; pago combinado devuelve efectivo', { timeout: 90000 }, async () => {
  const before = (await ref('product_stocks', 'P1_S1').get()).data().quantity;
  const request = { requestId: crypto.randomUUID(), storeId: 'S1', items: [{ productId: 'P1', qty: 3 }] };
  const quotes = await Promise.all([call('createQuotationRecord', request, pos), call('createQuotationRecord', request, pos)]);
  assert.ok(quotes.every((result) => result.ok)); assert.equal(quotes[0].result.id, quotes[1].result.id);
  assert.equal((await ref('product_stocks', 'P1_S1').get()).data().quantity, before);
  const sale = { requestId: crypto.randomUUID(), storeId: 'S1', quotationId: quotes[0].result.id, cashSessionId: sessionId,
    type: 'boleta', clientDoc: { tipo: '-', numero: '', nombre: '' }, items: [{ productId: 'P1', qty: 3, unitPrice: 10 }],
    paymentMethod: 'mixto', paidAmount: 35, payments: [{ method: 'plin', amount: 15 }, { method: 'efectivo', amount: 15, receivedAmount: 20 }] };
  const sales = await Promise.all([call('createSaleRecord', sale, pos), call('createSaleRecord', { ...sale, requestId: crypto.randomUUID() }, pos)]);
  assert.equal(sales.filter((result) => result.ok).length, 1, JSON.stringify(sales));
  const accepted = sales.find((result) => result.ok).result;
  assert.equal(accepted.sale.changeAmount, 5); assert.equal(accepted.sale.paymentTotals.cashSales, 15);
  assert.equal((await ref('product_stocks', 'P1_S1').get()).data().quantity, before - 3);
  assert.equal((await ref('quotations', request.requestId).get()).exists, false);
  assert.equal((await ref('quotations', quotes[0].result.id).get()).data().saleId, accepted.id);
  await Promise.all([reconcileSaleStatistics(tenantId, accepted.id), reconcileSaleStatistics(tenantId, accepted.id)]);
  const day = new Date(accepted.sale.createdAt - 5 * 3600000).toISOString().slice(0, 10);
  assert.equal((await ref('sales_statistics', `S1_${day.slice(0, 7)}`).get()).data().days[day].tickets, 1);
  await Promise.all([applySaleStatusPatch(tenantId, accepted.id, { status: 'anulada', voidedAt: Date.now() }), applySaleStatusPatch(tenantId, accepted.id, { status: 'anulada', voidedAt: Date.now() })]);
  const cash = (await ref('cash_sessions', sessionId).get()).data();
  assert.equal(cash.salesSummary.cashSales, 0); assert.equal(cash.cashBalanceAdjustment, 15);
  const compensation = { requestId: crypto.randomUUID(), saleId: accepted.id, returnStock: true, refund: true, method: 'efectivo', cashSessionId: sessionId, note: 'Productos devueltos y reembolso confirmado' };
  const compensated = await Promise.all([call('recordSaleCompensation', compensation), call('recordSaleCompensation', compensation)]);
  assert.ok(compensated.every((result) => result.ok), JSON.stringify(compensated));
  assert.equal((await ref('product_stocks', 'P1_S1').get()).data().quantity, before);
  assert.equal((await ref('cash_sessions', sessionId).get()).data().cashBalanceAdjustment, -15);
  await reconcileSaleStatistics(tenantId, accepted.id);
  assert.equal((await ref('sales_statistics', `S1_${day.slice(0, 7)}`).get()).data().days[day].tickets, 0);
  const closed = await call('closeCashSession', { sessionId, storeId: 'S1', closingAmount: 35 }, pos);
  assert.equal(closed.ok, true, JSON.stringify(closed)); assert.equal(closed.result.expectedAmount, 35);
  assert.equal(closed.result.difference, 0);
  assert.equal((await call('recordSaleCompensation', { ...compensation, requestId: crypto.randomUUID() })).error.status, 'ALREADY_EXISTS');
});

test('agregado de productos grande se divide sin perder contribuciones ni duplicar ventas', { timeout: 90000 }, async () => {
  const month = '2026-08', day = `${month}-15`;
  const products = {};
  let index = 0;
  while (Buffer.byteLength(JSON.stringify(products)) < 850000) {
    const id = `large-${index++}`;
    products[id] = { name: 'P'.repeat(180), unit: 'UN', days: Object.fromEntries(Array.from({ length: 31 }, (_, d) => [`2026-08-${String(d + 1).padStart(2, '0')}`, { units: 1, revenue: 10, tickets: 1 }])) };
  }
  let productId = 'added-0';
  for (let n = 0; createHash('sha256').update(productId).digest()[0] % 32 !== 0; n++) productId = `added-${n + 1}`;
  await ref('sales_statistics_products', `S1_${month}_0`).set({ tenantId, storeId: 'S1', month, bucket: 0, products, split: false });
  await ref('sales', 'large-sale').set({ tenantId, storeId: 'S1', storeName: 'Tienda', createdAt: Date.parse(`${day}T12:00:00-05:00`),
    type: 'nota', status: 'activa', total: 10, paymentMethod: 'efectivo', paidAmount: 10,
    items: [{ productId, name: 'Nuevo', qty: 1, baseUnitsSold: 1, unitPrice: 10, total: 10 }] });
  await Promise.all([reconcileSaleStatistics(tenantId, 'large-sale'), reconcileSaleStatistics(tenantId, 'large-sale')]);
  assert.equal((await ref('sales_statistics_products', `S1_${month}_0`).get()).data().split, true);
  const children = await db.collection(`tenants/${tenantId}/sales_statistics_products`).where('month', '==', month).get();
  const leaves = children.docs.filter((doc) => doc.data().split !== true);
  assert.equal(leaves.reduce((count, doc) => count + Object.keys(doc.data().products).length, 0), Object.keys(products).length + 1);
  assert.equal((await ref('sales_statistics', `S1_${month}`).get()).data().days[day].tickets, 1);
});

test('catálogo, ingreso y venta conservan fracciones de productos medibles', { timeout: 90000 }, async () => {
  const saved = await call('saveCatalogProduct', { requestId: crypto.randomUUID(), product: { name: 'Arroz medible', unit: 'KG', salePrice: 10,
    minStock: 0, active: true, presentations: [{ id: 'saco', unit: 'SACO', factor: 3, salePrice: 30,
      autoUnpackEnabled: true, allowFractionalSale: true, fractionStep: 0.25, autoUnpackPriority: 1 }] } });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const productId = saved.result.id;
  assert.equal((await call('recordStockIngress', { requestId: crypto.randomUUID(), locationId: 'S1', locationType: 'store', items: [{ productId, qty: 2 }] })).ok, true);
  const cash = await call('openCashSession', { storeId: 'S1', openingAmount: 0 }, pos);
  assert.equal(cash.ok, true, JSON.stringify(cash));
  const sale = await call('createSaleRecord', { requestId: crypto.randomUUID(), storeId: 'S1', cashSessionId: cash.result.id,
    type: 'nota', clientDoc: { tipo: '-', numero: '', nombre: '' }, items: [{ productId, presentationId: 'saco', qty: 0.25, unitPrice: 30 }],
    paymentMethod: 'yape', paidAmount: 7.5 }, pos);
  assert.equal(sale.ok, true, JSON.stringify(sale));
  assert.equal(sale.result.sale.items[0].baseUnitsSold, 0.75);
  assert.equal((await ref('product_stocks', `${productId}_S1`).get()).data().quantity, 1.25);
});

test('más de 200 boletas se reservan en lotes estables y concurrentes sin repetirse', { timeout: 90000 }, async () => {
  const date = '2026-08-01';
  const batch = db.batch();
  for (let index = 1; index <= 201; index++) batch.set(ref('sales', `summary-${index}`), { tenantId, storeId: 'S1', type: 'boleta', status: 'activa', consolidated: true,
    sunatSummaryRef: null, serie: 'B002', correlativo: index, createdAt: Date.parse(`${date}T12:00:00-05:00`), igvRate: 0.18,
    total: 1, subtotal: 0.85, igv: 0.15, items: [{ productId: 'P1', name: 'Producto', qty: 1, unitPrice: 1, total: 1 }] });
  await batch.commit();
  const sent = [];
  const send = async (_path, input) => { const payload = JSON.parse(input.body); sent.push(payload); return { ok: true, status: 'aceptado', message: 'Simulación local' }; };
  await Promise.all([processDailySummary(tenantId, date, send), processDailySummary(tenantId, date, send)]);
  await processDailySummary(tenantId, date, send);
  await processDailySummary(tenantId, date, send);
  const ids = sent.flatMap((payload) => payload.boletas.map((receipt) => receipt.ref));
  assert.equal(ids.length, 201); assert.equal(new Set(ids).size, 201); assert.ok(sent.every((payload) => payload.boletas.length <= 200));
  assert.equal((await ref('sales', 'summary-201').get()).data().sunatStatus, 'aceptado');
});

test('aprovisionamiento recuperable y protección del último administrador', { timeout: 90000 }, async () => {
  const input = { email: 'new-audit-worker@example.com', password: 'Test1234!', displayName: 'Trabajador', role: 'trabajador', storeId: 'S1' };
  const users = await Promise.all([call('createUser', input), call('createUser', input)]);
  assert.ok(users.every((result) => result.ok), JSON.stringify(users)); assert.equal(users[0].result.uid, users[1].result.uid);
  assert.equal((await call('setUserActive', { uid: admin.localId, active: false })).error.status, 'FAILED_PRECONDITION');
  assert.equal((await call('setUserActive', { uid: users[0].result.uid, active: false })).ok, true);
  assert.equal((await call('createUser', input)).error.status, 'FAILED_PRECONDITION');
});

test('push usa lease, reintenta fallos transitorios y respeta permisos revocados', { timeout: 90000 }, async () => {
  const now = Date.now();
  await db.doc('calendar_push_devices/audit-device').set({ tenantId, uid: admin.localId, replenishment: true, token: 'fake-local-token', expiresAt: now + 86400000 });
  await ref('replenishment_requests', 'push-request').set({ tenantId, status: 'pendiente' });
  const job = requireFunctions('./lib/firebase.js').db.doc('replenishment_push_jobs/audit-local-job');
  const value = { tenantId, uid: admin.localId, deviceId: 'audit-device', requestId: 'push-request', state: 'pending', nextAttemptAt: 0, leaseUntil: 0, attempts: 0, expiresAt: requireFunctions('firebase-admin/firestore').Timestamp.fromMillis(now + 86400000) };
  await job.set(value);
  let sends = 0;
  await Promise.all([deliverReplenishmentPush(job, now, async () => { sends++; }), deliverReplenishmentPush(job, now, async () => { sends++; })]);
  assert.equal(sends, 1); assert.equal((await job.get()).data().state, 'sent');
  await job.set(value);
  await deliverReplenishmentPush(job, now, async () => { throw new Error('temporary'); });
  const failed = (await job.get()).data(); assert.equal(failed.state, 'pending'); assert.ok(failed.nextAttemptAt > now);
  await deliverReplenishmentPush(job, failed.nextAttemptAt + 1, async () => { sends++; });
  assert.equal((await job.get()).data().state, 'sent');
  await job.set(value); await db.doc(`users/${admin.localId}`).update({ active: false });
  await deliverReplenishmentPush(job, now, async () => { sends++; });
  assert.equal((await job.get()).data().state, 'cancelled'); assert.equal(sends, 2);
  await db.doc(`users/${admin.localId}`).update({ active: true });
});

test('preparación de metadatos es repetible y no modifica cantidades', { timeout: 90000 }, async () => {
  const tenant = 'metadata-regression';
  const stock = db.doc(`tenants/${tenant}/product_stocks/P1_S1`);
  await db.doc(`tenants/${tenant}/products/P1`).set({ name: 'Producto', active: true, minStock: 4 });
  await stock.set({ productId: 'P1', locationId: 'S1', quantity: 1550, baseQuantity: 50, presentationQuantities: { box: 50 } });
  const script = fileURLToPath(new URL('./prepare-backend-metadata.mjs', import.meta.url));
  const run = (apply = false) => spawnSync(process.execPath, [script, '--project', projectId, '--tenant', tenant, ...(apply ? ['--apply'] : [])], { env: process.env, encoding: 'utf8', timeout: 60000 });
  const first = run(true); assert.equal(first.status, 0, first.stderr);
  const next = run(); assert.equal(next.status, 0, next.stderr);
  const result = JSON.parse(next.stdout); assert.ok(Object.values(result.counts).every((row) => row.changed === 0));
  const value = (await stock.get()).data(); assert.equal(value.quantity, 1550); assert.equal(value.baseQuantity, 50); assert.equal(value.presentationQuantities.box, 50);
  assert.equal((await db.doc(`tenants/${tenant}/meta/inventory_maintenance`).get()).data().active, false);
});
