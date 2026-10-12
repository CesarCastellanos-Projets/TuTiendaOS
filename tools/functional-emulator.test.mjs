import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createRequire } from 'node:module';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo emuladores locales.');
process.env.GCLOUD_PROJECT = 'demo-denzoz-ops'; process.env.FUNCTIONS_EMULATOR = 'true';
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'functional-tests');
const db = getFirestore(app), auth = getAuth(app);
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { runTransientCleanup } = require('./lib/transient-maintenance.js');
after(async () => { await db.terminate(); await require('./lib/firebase.js').db.terminate(); });
async function identity(role, tenant, extra = {}) {
  const email = `${role}-${randomUUID()}@example.com`;
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'LocalTest123!', returnSecureToken: true }) });
  const account = await response.json(); assert.equal(response.ok, true, JSON.stringify(account));
  await db.doc(`users/${account.localId}`).set({ tenantId: tenant, role, active: true, displayName: role, email, storeId: role === 'admin' ? null : 'S1', ...extra });
  return { uid: account.localId, token: account.idToken, email };
}
async function call(name, data, user) {
  const response = await fetch(`http://127.0.0.1:5001/demo-denzoz-ops/us-central1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ data }) });
  const body = await response.json(); return { ok: response.ok && body.result !== undefined, result: body.result, error: body.error };
}
function okay(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.result; }
async function fixture() {
  const tenant = `functional-${randomUUID()}`;
  const [admin, pos, worker] = await Promise.all(['admin', 'pos', 'trabajador'].map((role) => identity(role, tenant)));
  const ref = (name, id) => db.doc(`tenants/${tenant}/${name}/${id}`);
  await Promise.all([
    ref('stores', 'S1').set({ tenantId: tenant, name: 'Tienda', active: true }),
    ref('products', 'P1').set({ tenantId: tenant, name: 'Lapicero', category: 'General', unit: 'UN', salePrice: 2, minStock: 0, active: true, presentations: [{ id: 'docena', unit: 'DOC', factor: 12, salePrice: 20, description: 'Docena', autoUnpackEnabled: false }] }),
    ref('product_stocks', 'P1_S1').set({ tenantId: tenant, productId: 'P1', productName: 'Lapicero', locationId: 'S1', locationType: 'store', locationName: 'Tienda', quantity: 120, baseQuantity: 120, presentationQuantities: {}, stockModelVersion: 4, salePrice: 2, unit: 'UN' }),
    ref('config', 'company').set({ serieBoleta: 'B001', serieFactura: 'F001', serieNota: 'NV01', igvRate: .18, minBoletaSinDni: 700, umbralConsolidacion: 5 })
  ]);
  return { tenant, admin, pos, worker, ref };
}
test('crea POS multitienda sin tienda fija, administra permisos y bloquea eliminación con caja abierta', { timeout: 90000 }, async () => {
  const f = await fixture();
  const email = `multi-${randomUUID()}@example.com`;
  const payload = { email, password: 'LocalTest123!', displayName: 'POS autorizado', role: 'pos', storeId: null, storeAccess: 'all', canViewPurchaseCosts: true };
  const { uid } = okay(await call('createUser', payload, f.admin));
  const profile = (await db.doc(`users/${uid}`).get()).data();
  assert.equal(profile.storeId, null); assert.equal(profile.canViewPurchaseCosts, true);
  assert.equal((await auth.getUser(uid)).customClaims.posStoreAccess, 'all');
  okay(await call('setUserSettings', { uid, accessSchedule: { days: [1, 2], start: 480, end: 605 }, canViewPurchaseCosts: false, canOverridePrices: false, canManageCalendar: true }, f.admin));
  assert.equal((await db.doc(`users/${uid}`).get()).data().canOverridePrices, false);
  assert.equal((await call('setUserSettings', { uid, accessSchedule: null, canViewPurchaseCosts: true, canOverridePrices: true, canManageCalendar: true }, f.worker)).ok, false);
  await f.ref('cash_sessions', 'open-user').set({ userId: uid, status: 'abierta' });
  assert.equal((await call('deleteSystemUser', { uid }, f.admin)).ok, false);
  await f.ref('cash_sessions', 'open-user').update({ status: 'cerrada' });
  okay(await call('deleteSystemUser', { uid }, f.admin));
  await assert.rejects(auth.getUser(uid));
  assert.equal((await db.doc(`users/${uid}`).get()).data().active, false);
  assert.equal((await call('createUser', payload, f.admin)).ok, false);
  assert.equal((await call('deleteSystemUser', { uid: f.admin.uid }, f.admin)).ok, false);
});
test('contraseña nueva invalida el token anterior y no almacena claves', { timeout: 60000 }, async () => {
  const f = await fixture();
  for (const user of [f.worker, f.pos]) {
    for (const uid of [user.uid, f.admin.uid]) {
      const denied = await call('changeUserPassword', { uid, password: 'Denied456!' }, user);
      assert.equal(denied.ok, false);
      assert.equal(denied.error.status, 'PERMISSION_DENIED');
    }
    assert.equal((await db.doc(`users/${user.uid}`).get()).data().authValidAfter, undefined);
  }
  okay(await call('changeUserPassword', { uid: f.worker.uid, password: 'Different456!' }, f.admin));
  assert.equal((await call('getAccessState', {}, f.worker)).ok, false);
  const profile = (await db.doc(`users/${f.worker.uid}`).get()).data();
  assert.equal(profile.password, undefined); assert.ok(profile.authValidAfter);
  const signIn = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.worker.email, password: 'Different456!', returnSecureToken: true }) });
  assert.equal(signIn.ok, true);
});
test('horario de servidor bloquea operaciones y administración privada, admin conserva acceso', { timeout: 60000 }, async () => {
  const f = await fixture();
  const today = new Date(Date.now() - 5 * 3600000).getUTCDay();
  await db.doc(`users/${f.worker.uid}`).update({ accessSchedule: { days: [(today + 1) % 7], start: 0, end: 1439 } });
  const state = okay(await call('getAccessState', {}, f.worker)); assert.equal(state.allowed, false); assert.ok(state.serverNow);
  assert.equal((await call('createQuotationRecord', { requestId: randomUUID(), storeId: 'S1', items: [{ productId: 'P1', qty: 1 }] }, f.worker)).ok, false);
  await db.doc(`users/${f.admin.uid}`).update({ accessSchedule: { days: [(today + 1) % 7], start: 0, end: 1439 } });
  assert.equal(okay(await call('getAccessState', {}, f.admin)).allowed, true);
});
test('compra privada y un único aviso por cambio de precios; reintentos y cambios no comerciales sin avisos', { timeout: 90000 }, async () => {
  const f = await fixture();
  const product = { ...(await f.ref('products', 'P1').get()).data(), salePrice: 3 };
  product.presentations[0].salePrice = 21;
  const input = { requestId: randomUUID(), productId: 'P1', product, purchase: { cost: 12, supplier: 'Proveedor secreto', presentationId: 'docena' } };
  okay(await call('saveCatalogProduct', input, f.admin)); okay(await call('saveCatalogProduct', input, f.admin));
  const notices = await db.collection(`tenants/${f.tenant}/price_notices`).get(); assert.equal(notices.size, 1);
  const notice = notices.docs[0].data(); assert.equal(notice.changes.length, 2); assert.equal(notice.expiresAt - notice.createdAt, 5 * 3600000);
  assert.equal(JSON.stringify(notice).includes('Proveedor secreto'), false);
  assert.equal((await f.ref('products', 'P1').get()).data().purchase, undefined);
  assert.equal((await call('getProductPurchase', { productId: 'P1' }, f.pos)).ok, false);
  assert.equal((await call('getProductPurchase', { productId: 'P1' }, f.worker)).ok, false);
  await db.doc(`users/${f.pos.uid}`).update({ canViewPurchaseCosts: true });
  assert.equal(okay(await call('getProductPurchase', { productId: 'P1' }, f.pos)).purchase.baseCost, 1);
  await db.doc(`users/${f.pos.uid}`).update({ canViewPurchaseCosts: false });
  assert.equal((await call('getProductPurchase', { productId: 'P1' }, f.pos)).ok, false);
  okay(await call('saveCatalogProduct', { ...input, requestId: randomUUID(), purchase: { cost: 15, supplier: 'Otro', presentationId: null } }, f.admin));
  assert.equal((await db.collection(`tenants/${f.tenant}/price_notices`).get()).size, 1);
  await notices.docs[0].ref.update({ expiresAt: Date.now() - 1 });
  await runTransientCleanup(() => true);
  assert.equal((await notices.docs[0].ref.get()).exists, false);
});
test('cotizaciones: búsqueda normalizada fuera de primera página, borrado físico y reintento sin resurrección', { timeout: 90000 }, async () => {
  const f = await fixture();
  const input = { requestId: randomUUID(), storeId: 'S1', items: [{ productId: 'P1', qty: 1 }], clientName: 'César García', clientPhone: '+51 999 123 456' };
  const quote = okay(await call('createQuotationRecord', input, f.worker));
  assert.equal(okay(await call('createQuotationRecord', input, f.worker)).id, quote.id);
  assert.equal(quote.expiresAt - quote.createdAt, 30 * 86400000);
  const edit = { ...input, requestId: randomUUID(), quotationId: quote.id, version: quote.version, note: 'Cambio sin extender fecha' };
  const edited = okay(await call('createQuotationRecord', edit, f.worker));
  assert.equal(edited.id, quote.id); assert.equal(edited.expiresAt, quote.expiresAt); assert.equal(edited.createdAt, quote.createdAt);
  assert.equal((await call('createQuotationRecord', { ...edit, requestId: randomUUID() }, f.worker)).ok, false);
  const receipt = f.ref('operation_receipts', quote.receiptId); assert.deepEqual((await receipt.get()).data().result, { id: quote.id });
  const batch = db.batch();
  for (let i = 0; i < 105; i++) batch.set(f.ref('quotations', `newer-${i}`), { ...quote, id: `newer-${i}`, code: `COT-OTHER-${i}`, clientName: 'Otro cliente', clientPhone: '', createdAt: quote.createdAt + 100 + i });
  await batch.commit();
  const first = okay(await call('searchQuotations', { storeId: 'S1', term: 'cesar garcia' }, f.pos)); assert.equal(first.items.length, 0); assert.ok(first.cursor);
  const second = okay(await call('searchQuotations', { storeId: 'S1', term: 'cesar garcia', cursor: first.cursor }, f.pos)); assert.equal(second.items[0].id, quote.id);
  const phone = okay(await call('searchQuotations', { storeId: 'S1', term: '999123456', cursor: first.cursor }, f.pos)); assert.equal(phone.items[0].id, quote.id);
  assert.equal((await call('discardQuotation', { quotationId: quote.id }, f.pos)).ok, false);
  okay(await call('discardQuotation', { quotationId: quote.id }, f.worker));
  assert.equal((await f.ref('quotations', quote.id).get()).exists, false);
  assert.equal((await receipt.get()).data().result.removed, true);
  assert.equal((await call('createQuotationRecord', input, f.worker)).ok, false);
});
test('venta de cotización atómica, nombre sin DNI y restricción RUC/umbral', { timeout: 120000 }, async () => {
  const f = await fixture();
  const quoteInput = { requestId: randomUUID(), storeId: 'S1', items: [{ productId: 'P1', qty: 1 }], clientName: 'Ana' };
  const quote = okay(await call('createQuotationRecord', quoteInput, f.worker));
  const cash = okay(await call('openCashSession', { storeId: 'S1', openingAmount: 10 }, f.pos));
  const sale = { requestId: randomUUID(), storeId: 'S1', quotationId: quote.id, cashSessionId: cash.id, items: [{ productId: 'P1', qty: 1, unitPrice: 2 }], type: 'boleta', clientDoc: { tipo: '-', numero: '', nombre: 'Ana' }, paymentMethod: 'efectivo', paidAmount: 2, consolidated: false };
  const attempts = await Promise.all([call('createSaleRecord', sale, f.pos), call('createSaleRecord', { ...sale, requestId: randomUUID() }, f.pos)]);
  assert.equal(attempts.filter((item) => item.ok).length, 1, JSON.stringify(attempts));
  const sold = attempts.find((item) => item.ok).result; assert.equal(sold.sale.clientDoc.nombre, 'Ana');
  const saved = (await f.ref('quotations', quote.id).get()).data(); assert.equal(saved.status, 'facturada'); assert.equal(saved.items, undefined); assert.equal(saved.clientName, undefined);
  assert.equal((await call('discardQuotation', { quotationId: quote.id }, f.worker)).ok, false);
  const noRuc = await call('createSaleRecord', { ...sale, requestId: randomUUID(), quotationId: '', type: 'factura' }, f.pos); assert.equal(noRuc.ok, false);
  await f.ref('product_stocks', 'P1_S1').update({ quantity: 500, baseQuantity: 500 });
  const high = await call('createSaleRecord', { ...sale, requestId: randomUUID(), quotationId: '', items: [{ productId: 'P1', qty: 350, unitPrice: 2 }], paidAmount: 700 }, f.pos); assert.equal(high.ok, false); assert.match(high.error.message, /DNI/);
  const raceQuote = okay(await call('createQuotationRecord', { ...quoteInput, requestId: randomUUID() }, f.worker));
  const race = await Promise.all([
    call('createSaleRecord', { ...sale, requestId: randomUUID(), quotationId: raceQuote.id }, f.pos),
    call('discardQuotation', { quotationId: raceQuote.id }, f.worker)
  ]);
  assert.equal(race.filter((result) => result.ok).length, 1, JSON.stringify(race));
  const afterRace = (await f.ref('quotations', raceQuote.id).get());
  assert.equal(afterRace.exists ? afterRace.data().status === 'facturada' : true, true);
  const expiredQuote = okay(await call('createQuotationRecord', { ...quoteInput, requestId: randomUUID() }, f.worker));
  await f.ref('quotations', expiredQuote.id).update({ expiresAt: Date.now() - 1 });
  assert.equal((await call('createSaleRecord', { ...sale, requestId: randomUUID(), quotationId: expiredQuote.id }, f.pos)).ok, false);
  await f.ref('quotations', quote.id).update({ expiresAt: Date.now() - 1 });
  await runTransientCleanup(() => true); assert.equal((await f.ref('quotations', quote.id).get()).exists, false);
  assert.equal((await f.ref('sales', sold.id).get()).exists, true);
});
test('retención antigua requiere revisión explícita; la limpieza conserva ventas y marcas anti-reintento', { timeout: 60000 }, async () => {
  const f = await fixture();
  const quote = okay(await call('createQuotationRecord', { requestId: randomUUID(), storeId: 'S1', items: [{ productId: 'P1', qty: 1 }] }, f.worker));
  await f.ref('quotations', quote.id).update({ createdAt: Date.now() - 31 * 86400000, expiresAt: Date.now() - 86400000 });
  const preview = okay(await call('previewQuotationCleanup', {}, f.admin)); assert.equal(preview.items[0].id, quote.id);
  assert.equal((await call('purgeExpiredQuotations', { ids: [quote.id] }, f.worker)).ok, false);
  okay(await call('purgeExpiredQuotations', { ids: [quote.id] }, f.admin)); assert.equal((await f.ref('quotations', quote.id).get()).exists, false);
});
