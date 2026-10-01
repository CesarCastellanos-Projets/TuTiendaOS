import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo se permite preparar los emuladores locales.');
const app = initializeApp({ projectId: 'demo-denzoz-ops' });
const db = getFirestore(app);
await db.recursiveDelete(db.doc('tenants/tenant-ui'));
for (const [email, role] of [['pos-ui@example.com', 'pos'], ['admin-ui@example.com', 'admin'], ['worker-ui@example.com', 'trabajador']]) {
  let user;
  try { user = await getAuth(app).getUserByEmail(email); }
  catch { user = await getAuth(app).createUser({ email, password: 'UiTest123!' }); }
  await db.doc(`users/${user.uid}`).set({ tenantId: 'tenant-ui', role, storeId: 'S1', displayName: role, active: true, email, storeAccess: 'assigned', canManageCalendar: role === 'admin' || role === 'pos' });
}
await db.doc('tenants/tenant-ui/stores/S1').set({ tenantId: 'tenant-ui', name: 'Tienda UI', code: 'S1', address: '' });
await db.doc('tenants/tenant-ui/config/company').set({ razonSocial: 'Demo UI', ruc: '20123456789', serieBoleta: 'B001', serieFactura: 'F001', serieNota: 'NV01', igvRate: 0.18, minBoletaSinDni: 700, umbralConsolidacion: 5, ticketWidth: '80mm', entornoSunat: 'beta', isDemoMode: true, updatedAt: Date.now() });
for (let start = 1; start <= 305; start += 150) {
  const batch = db.batch();
  for (let i = start; i <= Math.min(305, start + 149); i++) {
    const id = `P${String(i).padStart(4, '0')}`;
    const name = `Producto ${String(i).padStart(4, '0')}`;
    batch.set(db.doc(`tenants/tenant-ui/products/${id}`), { tenantId: 'tenant-ui', name, unit: 'UN', salePrice: 7, minStock: 1, active: true, category: 'Demo', barcode: `CODE${i}`, presentations: [], updatedAt: Date.now() });
    batch.set(db.doc(`tenants/tenant-ui/product_stocks/${id}_S1`), { tenantId: 'tenant-ui', productId: id, productName: name, locationId: 'S1', locationName: 'Tienda UI', locationType: 'store', salePrice: 3, quantity: 10, baseQuantity: 10, presentationQuantities: {}, stockModelVersion: 2, updatedAt: Date.now() });
  }
  await batch.commit();
}
await db.doc('tenants/tenant-ui/products/BOND').set({ tenantId: 'tenant-ui', name: 'Hojas bond', unit: 'UN', salePrice: 0.2, active: true, category: 'Papelería', barcode: 'BOND-UN', minStock: 1, updatedAt: Date.now(), presentations: [
  { id: 'millar', unit: 'MIL', description: 'Millar', factor: 1000, salePrice: 100, barcode: 'BOND-MIL', allowFractionalSale: true, fractionStep: 0.5, autoUnpackEnabled: true },
  { autoUnpackEnabled: true, id: 'ciento', unit: 'CTO', description: 'Ciento', factor: 100, salePrice: 12, barcode: 'BOND-CTO', allowFractionalSale: false }
] });
await db.doc('tenants/tenant-ui/product_stocks/BOND_S1').set({ tenantId: 'tenant-ui', productId: 'BOND', productName: 'Hojas bond', locationId: 'S1', locationName: 'Tienda UI', locationType: 'store', salePrice: 0.2, quantity: 1050, baseQuantity: 50, presentationQuantities: { millar: 1 }, stockModelVersion: 2, updatedAt: Date.now() });
console.log('Fixture UI lista: 305 productos en demo-denzoz-ops.');

await db.doc('tenants/tenant-ui/products/MARKERS').set({ tenantId: 'tenant-ui', name: 'Plumones cerrados', unit: 'UN', salePrice: 2, active: true, category: 'Papelería', barcode: 'MARK-UN', minStock: 1, updatedAt: Date.now(), presentations: [
  { id: 'caja12', unit: 'CJA', description: 'Caja sellada de 12', factor: 12, salePrice: 20, barcode: 'MARK-BOX', allowFractionalSale: false, fractionStep: 0.5, autoUnpackEnabled: false }
] });
await db.doc('tenants/tenant-ui/product_stocks/MARKERS_S1').set({ tenantId: 'tenant-ui', productId: 'MARKERS', productName: 'Plumones cerrados', locationId: 'S1', locationName: 'Tienda UI', locationType: 'store', salePrice: 2, quantity: 34, baseQuantity: 10, presentationQuantities: { caja12: 2 }, stockModelVersion: 4, updatedAt: Date.now() });
