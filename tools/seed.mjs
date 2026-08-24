/**
 * Seed D'ENZOZ.
 *
 * Requiere una cuenta de servicio con permisos de Firestore + Auth:
 *   1. Consola Firebase → Configuración → Cuentas de servicio → Generar clave privada
 *   2. Guardar como tools/service-account.json (NO subir a git)
 *   3. npm install && npm run seed
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let credential;
try {
  const sa = JSON.parse(readFileSync(new URL('./service-account.json', import.meta.url), 'utf8'));
  credential = cert(sa);
} catch {
  console.error('Falta tools/service-account.json (clave de cuenta de servicio).');
  process.exit(1);
}

const app = initializeApp({ credential });
const db = getFirestore(app);

async function upsertUser(email, password, displayName, role, storeId) {
  let user;
  try {
    user = await getAuth(app).getUserByEmail(email);
    await getAuth(app).updateUser(user.uid, { password });
  } catch {
    user = await getAuth(app).createUser({
      email,
      password,
      displayName,
      emailVerified: true
    });
  }
  await db.doc(`users/${user.uid}`).set({
    displayName,
    email,
    role,
    storeId: storeId ?? null,
    active: true,
    createdAt: Date.now()
  });
  return user.uid;
}

const stores = {
  T01: { name: "D'ENZOZ Huancayo Centro", code: 'T01', address: 'Jr. Real 123' },
  T02: { name: "D'ENZOZ El Tambo", code: 'T02', address: 'Av. Ferrocarril 456' }
};
const warehouses = {
  ALM01: { name: 'Almacén Central', code: 'ALM01', isCentral: true }
};

for (const [id, s] of Object.entries(stores)) await db.doc(`stores/${id}`).set(s);
for (const [id, w] of Object.entries(warehouses)) await db.doc(`warehouses/${id}`).set(w);

await upsertUser('admin@denzoz.pe', 'admin123', 'Administrador', 'admin', null);
await upsertUser('caja1@denzoz.pe', 'caja123', 'Rosa Cajera', 'pos', 'T01');
await upsertUser('piso1@denzoz.pe', 'piso123', 'Luis Piso', 'trabajador', 'T01');

await db.doc('company/main').set({
  ruc: '20123456789',
  razonSocial: "D'ENZOZ S.A.C.",
  direccion: 'Jr. Real 123, Huancayo',
  regimen: 'RMT',
  serieFactura: 'F001',
  serieBoleta: 'B001',
  entornoSunat: 'beta',
  igvRate: 0.18,
  minBoletaSinDni: 700,
  umbralConsolidacion: 5,
  apiFactUrl: '',
  apiFactToken: '',
  updatedAt: Date.now()
});

// Correlativos iniciales (las reglas prohíben crearlos desde el cliente)
await db.doc('counters/B001').set({ current: 0 });
await db.doc('counters/F001').set({ current: 0 });

const products = [
  ['Galleta Soda x12', 'Abarrotes', 'Fruna', 'UN', '7750000000012', 2.5],
  ['Gaseosa Cola 500ml', 'Bebidas', 'Kola Real', 'UN', '7750000000029', 3.5],
  ['Chocolatino Sublime', 'Golosinas', 'Nestlé', 'UN', '7750000000036', 1.5],
  ['Shampoo Sachet 10ml', 'Higiene', 'Head&Shoulders', 'UN', '7750000000043', 1.0],
  ['Pilas AA x4', 'Ferretería', 'Philco', 'PAQ', '7750000000050', 8.0],
  ['Cuaderno Rayado 100pg', 'Escolar', 'Torres', 'UN', '7750000000067', 4.5]
];

const batch = db.batch();
for (const [name, category, brand, unit, barcode, price] of products) {
  const ref = db.collection('products').doc();
  batch.set(ref, {
    name,
    category,
    brand,
    unit,
    barcode,
    internalCode: '',
    salePrice: price,
    minStock: 6,
    promoActive: false,
    promoLabel: '',
    active: true,
    updatedAt: Date.now()
  });
  for (const [storeId, store] of Object.entries(stores)) {
    batch.set(db.collection('product_stocks').doc(`${ref.id}_${storeId}`), {
      productId: ref.id,
      productName: name,
      barcode,
      salePrice: price,
      locationType: 'store',
      locationId: storeId,
      locationName: store.name,
      quantity: storeId === 'T01' ? 20 : 8,
      updatedAt: Date.now()
    });
  }
}
await batch.commit();

console.log('\nSeed listo.');
console.log('Usuarios:');
console.log('  admin@denzoz.pe / admin123');
console.log('  caja1@denzoz.pe / caja123   (POS tienda T01)');
console.log('  piso1@denzoz.pe / piso123   (Trabajador T01)');
process.exit(0);
