import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo emuladores locales.');
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'cache-fixture');
const db = getFirestore(app);
const tenantId = 'cache-browser';
const [action, store = 'S500', quantity = '99'] = process.argv.slice(2);
if (!/^S(50|500|5000)$/.test(store)) throw new Error('Tienda de prueba inválida.');
if (action === 'seed') {
  const auth = getAuth(app);
  const user = await auth.getUserByEmail('cache-browser@example.com').catch(() => auth.createUser({ email: 'cache-browser@example.com', password: 'LocalTest123!' }));
  await db.doc(`users/${user.uid}`).set({ tenantId, role: 'admin', active: true, displayName: 'Prueba local' });
  const count = Number(store.slice(1));
  for (let start = 0; start < count; start += 400) {
    const batch = db.batch();
    for (let n = start; n < Math.min(count, start + 400); n++) {
      const productId = `P${String(n).padStart(5, '0')}`;
      batch.set(db.doc(`tenants/${tenantId}/product_stocks/${productId}_${store}`), {
        tenantId, productId, productName: `Producto ${n}`, locationId: store, locationType: 'store',
        baseQuantity: 100, quantity: 100, presentationQuantities: {}, stockModelVersion: 4, committedAt: FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
  }
  console.log(JSON.stringify({ store, count }));
} else if (action === 'burst') {
  const batch = db.batch();
  for (let n = 0; n < Math.min(Number(store.slice(1)), 500); n++) {
    const productId = `P${String(n).padStart(5, '0')}`;
    batch.update(db.doc(`tenants/${tenantId}/product_stocks/${productId}_${store}`), {
      quantity: Number(quantity), baseQuantity: Number(quantity), updatedAt: 1, committedAt: FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  console.log(JSON.stringify({ store, quantity: Number(quantity) }));
} else throw new Error('Acción inválida.');
await db.terminate();
