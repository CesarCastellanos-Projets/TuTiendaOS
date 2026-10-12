import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo emuladores locales.');
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'stage3-browser');
const db = getFirestore(app);
const user = await getAuth(app).getUserByEmail('stage3-browser@example.com').catch(() => getAuth(app).createUser({ email: 'stage3-browser@example.com', password: 'LocalTest123!' }));
const tenantId = 'stage3-browser';
const batch = db.batch();
batch.set(db.doc(`users/${user.uid}`), { tenantId, active: true, role: 'admin', displayName: 'Prueba local', storeId: 'S000' });
for (let index = 0; index < 51; index++) {
  const id = `S${String(index).padStart(3, '0')}`;
  batch.set(db.doc(`tenants/${tenantId}/stores/${id}`), { tenantId, name: `Tienda ${index}`, active: true });
}
for (let index = 0; index < 101; index++) {
  batch.set(db.doc(`tenants/${tenantId}/transfers/T${String(index).padStart(3, '0')}`), {
    tenantId, code: `TR-${index}`, toLocationId: 'S000', status: 'pendiente', items: [],
    fromLocationName: 'Central', createdByName: 'Administrador', createdAt: index + 1
  });
  batch.set(db.doc(`tenants/${tenantId}/stock_movements/V${index}`), { tenantId, type: 'venta', createdAt: 1000 + index });
}
for (let index = 0; index < 21; index++) {
  batch.set(db.doc(`tenants/${tenantId}/stock_movements/A${String(index).padStart(3, '0')}`), {
    tenantId, type: ['ajuste', 'merma', 'conversion'][index % 3], productName: `Ajuste ${index}`, qty: 1, createdAt: index + 1
  });
}
await batch.commit();
await db.terminate();
console.log('Fixtures locales: 101 transferencias, 51 ubicaciones, 21 ajustes y 101 ventas.');
