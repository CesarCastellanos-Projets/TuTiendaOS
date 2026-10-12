import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocs, limit, query, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
let env;
const tenant = 'functional-rules';
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-denzoz-ops', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') }, storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await Promise.all(['admin', 'pos', 'trabajador'].map((role) => setDoc(doc(db, `users/rules-${role}`), { active: true, role, tenantId: tenant, storeId: 'S1', displayName: role, email: `${role}@example.com` })));
    await setDoc(doc(db, `tenants/${tenant}/products/P1`), { name: 'Producto' });
    await setDoc(doc(db, `tenants/${tenant}/product_purchase/P1`), { cost: 3, supplier: 'Privado' });
    await setDoc(doc(db, `tenants/${tenant}/price_notices/N1`), { expiresAt: Date.now() + 10000 });
  });
});
after(async () => env.cleanup());
test('costos privados: get por permiso; sin listas, escrituras ni cruce de empresas', async () => {
  const admin = env.authenticatedContext('rules-admin').firestore();
  const pos = env.authenticatedContext('rules-pos').firestore();
  const worker = env.authenticatedContext('rules-trabajador').firestore();
  const path = `tenants/${tenant}/product_purchase/P1`;
  await assertSucceeds(getDocFromServer(doc(admin, path)));
  await assertFails(getDocFromServer(doc(pos, path)));
  await assertFails(getDocFromServer(doc(worker, path)));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/rules-pos'), { canViewPurchaseCosts: true }));
  await assertSucceeds(getDocFromServer(doc(pos, path)));
  await assertFails(getDocs(query(collection(pos, `tenants/${tenant}/product_purchase`), limit(20))));
  await assertFails(updateDoc(doc(pos, path), { cost: 1 }));
  await assertFails(getDocFromServer(doc(pos, 'tenants/other-tenant/product_purchase/P1')));
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/rules-pos'), { canViewPurchaseCosts: false }));
  await assertFails(getDocFromServer(doc(pos, path)));
  await assertFails(updateDoc(doc(pos, 'users/rules-pos'), { canViewPurchaseCosts: true }));
  await assertFails(updateDoc(doc(pos, 'users/rules-pos'), { role: 'admin' }));
});
test('precios visibles a POS sin calendario y trabajador; solo listas acotadas', async () => {
  for (const role of ['pos', 'trabajador']) {
    const db = env.authenticatedContext(`rules-${role}`).firestore();
    await assertSucceeds(getDocs(query(collection(db, `tenants/${tenant}/price_notices`), limit(20))));
    await assertFails(getDocs(query(collection(db, `tenants/${tenant}/price_notices`), limit(51))));
    await assertFails(setDoc(doc(db, `tenants/${tenant}/price_notices/fake`), { expiresAt: 100 }));
  }
});
test('horario del servidor bloquea datos y Storage, permite perfil propio y no restringe admin', async () => {
  const day = new Date(Date.now() - 5 * 3600000).getUTCDay();
  const schedule = { days: [(day + 1) % 7], start: 0, end: 1439 };
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const role of ['admin', 'pos', 'trabajador']) await updateDoc(doc(ctx.firestore(), `users/rules-${role}`), { accessSchedule: schedule });
  });
  for (const role of ['pos', 'trabajador']) {
    const ctx = env.authenticatedContext(`rules-${role}`);
    await assertFails(getDocFromServer(doc(ctx.firestore(), `tenants/${tenant}/products/P1`)));
    await assertSucceeds(getDocFromServer(doc(ctx.firestore(), `users/rules-${role}`)));
    await assertFails(uploadString(ref(ctx.storage(), `tenants/${tenant}/incidents/S1/rules-${role}/photo.png`), 'small', 'raw', { contentType: 'image/png' }));
    await assertFails(updateDoc(doc(ctx.firestore(), `users/rules-${role}`), { accessSchedule: null }));
  }
  await assertSucceeds(getDocFromServer(doc(env.authenticatedContext('rules-admin').firestore(), `tenants/${tenant}/products/P1`)));
});
test('cambio de contraseña impide usar JWT antiguo incluso con rol admin', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/rules-admin'), { authValidAfter: 101 }));
  await assertFails(getDocFromServer(doc(env.authenticatedContext('rules-admin', { auth_time: 100 }).firestore(), `tenants/${tenant}/products/P1`)));
  await assertSucceeds(getDocFromServer(doc(env.authenticatedContext('rules-admin', { auth_time: 101 }).firestore(), `tenants/${tenant}/products/P1`)));
});
