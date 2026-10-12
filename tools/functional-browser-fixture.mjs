import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo emuladores locales.');
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'functional-browser');
const db = getFirestore(app), auth = getAuth(app);
const tenantId = 'functional-browser';
const role = process.argv[2] ?? 'seed';
const ref = (collection, id) => db.doc(`tenants/${tenantId}/${collection}/${id}`);
for (const role of ['admin', 'pos', 'trabajador']) {
  const email = `functional-${role}@example.com`;
  const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, password: 'LocalTest123!' }));
  await db.doc(`users/${user.uid}`).set({ tenantId, active: true, role, displayName: role, email, storeId: role === 'admin' ? null : 'S1', storeAccess: 'assigned', canManageCalendar: false, canViewPurchaseCosts: role === 'pos' });
  if (process.argv[2] === 'block' && role === 'pos') {
    const day = new Date(Date.now() - 5 * 3600000).getUTCDay();
    await db.doc(`users/${user.uid}`).update({ accessSchedule: { days: [(day + 1) % 7], start: 0, end: 1439 } });
  }
}
if (role !== 'block') {
  const product = { tenantId, name: 'Lapicero de prueba', category: 'General', unit: 'UN', active: true, minStock: 0, salePrice: 2, presentations: [{ id: 'docena', unit: 'DOC', factor: 12, salePrice: 20, description: 'Docena cerrada', autoUnpackEnabled: false }], updatedAt: Date.now(), committedAt: FieldValue.serverTimestamp() };
  const stock = { tenantId, productId: 'P1', productName: product.name, unit: 'UN', quantity: 0, baseQuantity: 0, presentationQuantities: {}, stockModelVersion: 4, salePrice: 2, locationType: 'store', locationId: 'S1', locationName: 'Tienda', updatedAt: Date.now(), committedAt: FieldValue.serverTimestamp() };
  await Promise.all([
    ref('config', 'company').set({ nombreComercial: "D'ENZOZ", razonSocial: 'Prueba SAC', ruc: '20123456789', address: 'Huancayo', serieBoleta: 'B001', serieFactura: 'F001', serieNota: 'NV01', igvRate: .18, minBoletaSinDni: 700, umbralConsolidacion: 5 }),
    ref('stores', 'S1').set({ tenantId, name: 'Tienda', active: true, code: 'S1' }),
    ref('warehouses', 'W1').set({ tenantId, name: 'Central', active: true, code: 'W1' }),
    ref('products', 'P1').set(product), ref('meta', 'catalog').set({ updatedAt: Date.now(), committedAt: FieldValue.serverTimestamp() }),
    ref('product_stocks', 'P1_S1').set(stock),
    ref('product_stocks', 'P1_W1').set({ ...stock, locationType: 'warehouse', locationId: 'W1', locationName: 'Central', quantity: 24, presentationQuantities: { docena: 2 } }),
    ref('product_purchase', 'P1').set({ tenantId, productId: 'P1', cost: 10, supplier: 'Proveedor privado', presentationLabel: 'Docena', presentationId: 'docena' }),
    ref('price_notices', 'notice').set({ tenantId, productName: product.name, changes: [{ label: 'UN', previous: 1.5, current: 2 }], createdAt: Date.now(), expiresAt: Date.now() + 5 * 3600000 })
  ]);
  const worker = await auth.getUserByEmail('functional-trabajador@example.com');
  await ref('quotations', 'quote').set({ tenantId, id: 'quote', code: 'COT-PRUEBA', clientName: 'César Cliente', clientPhone: '999123456', storeId: 'S1', storeName: 'Tienda', items: [{ productId: 'P1', name: product.name, qty: 1, unitPrice: 2, total: 2, availableQty: 0, isAvailable: false }], totalAll: 2, totalAvailable: 0, createdBy: worker.uid, createdByName: 'trabajador', status: 'pendiente', createdAt: Date.now(), expiresAt: Date.now() + 30 * 86400000 });
}
await db.terminate();
console.log('Fixture funcional local lista.');
