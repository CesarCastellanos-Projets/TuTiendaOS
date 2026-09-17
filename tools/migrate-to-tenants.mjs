/**
 * Copia el modelo legado de colecciones raíz al espacio de una empresa.
 * Es dry-run por defecto; use --apply después de revisar el resumen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const verifyOnly = process.argv.includes('--verify');
const tenantId = process.env.TENANT_ID ?? 'denzoz';
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenantId)) {
  throw new Error('TENANT_ID inválido. Use minúsculas, números, guion o guion bajo.');
}
if (!projectId) throw new Error('Defina GOOGLE_CLOUD_PROJECT antes de ejecutar la migración.');

const serviceAccountUrl = new URL('./service-account.json', import.meta.url);
const credential = existsSync(serviceAccountUrl)
  ? cert(JSON.parse(readFileSync(serviceAccountUrl, 'utf8')))
  : applicationDefault();
const app = initializeApp({ credential, projectId });
const db = getFirestore(app);
const auth = getAuth(app);

const collections = [
  'stores', 'warehouses', 'products', 'product_stocks', 'stock_movements',
  'transfers', 'replenishment_requests', 'incidents', 'sales', 'cash_sessions',
  'clients', 'quotations', 'counters'
];
const writes = [];
const totals = {};
let catalogUpdatedAt = 0;

function timestampMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return Date.now();
}

for (const collectionName of collections) {
  const snapshot = await db.collection(collectionName).get();
  totals[collectionName] = snapshot.size;
  for (const document of snapshot.docs) {
    const data = { ...document.data(), tenantId };
    if (collectionName === 'products') {
      data.updatedAt = timestampMillis(data.updatedAt);
      catalogUpdatedAt = Math.max(catalogUpdatedAt, data.updatedAt);
    }
    writes.push({ ref: db.doc(`tenants/${tenantId}/${collectionName}/${document.id}`), data });
  }
}
if (catalogUpdatedAt > 0) {
  writes.push({
    ref: db.doc(`tenants/${tenantId}/meta/catalog`),
    data: { tenantId, updatedAt: catalogUpdatedAt }
  });
}

const company = await db.doc('company/main').get();
totals.company = company.exists ? 1 : 0;
if (company.exists) {
  const data = { ...company.data() };
  delete data.tenantId;
  writes.push({ ref: db.doc(`tenants/${tenantId}/config/company`), data });
}

const users = await db.collection('users').get();
totals.users = users.size;
for (const user of users.docs) {
  writes.push({ ref: user.ref, data: { tenantId } });
}

console.table(totals);
console.log(`${writes.length} documentos preparados para tenant ${tenantId}.`);
if (!apply && !verifyOnly) {
  console.log('Dry-run completado. Ejecute TENANT_ID=... npm run migrate:tenants -- --apply para copiar.');
  process.exit(0);
}

if (apply) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }

  for (const user of users.docs) {
    const authUser = await auth.getUser(user.id);
    await auth.setCustomUserClaims(user.id, {
      ...(authUser.customClaims ?? {}),
      tenantId,
      role: user.data().role
    });
  }

  await Promise.all([
    db.doc(`tenants/${tenantId}`).set({ tenantId, migratedAt: Date.now() }, { merge: true }),
    db.doc('system/sunatMaintenance').set({ tenantIds: FieldValue.arrayUnion(tenantId) }, { merge: true })
  ]);

  console.log('Migración copiada. Los documentos raíz no se eliminaron para permitir rollback.');
}

const verification = {};
for (const collectionName of collections) {
  const target = await db.collection(`tenants/${tenantId}/${collectionName}`).get();
  const isolated = target.docs.every((document) => document.data().tenantId === tenantId);
  verification[collectionName] = `${target.size}/${totals[collectionName]} ${isolated ? 'OK' : 'TENANT_INVALIDO'}`;
  if (target.size < totals[collectionName] || !isolated) {
    throw new Error(`Verificación fallida para ${collectionName}.`);
  }
}

const tenantRoot = await db.doc(`tenants/${tenantId}`).get();
const tenantCompany = await db.doc(`tenants/${tenantId}/config/company`).get();
const profileChecks = users.docs.map((user) => user.data().tenantId === tenantId);
const authChecks = await Promise.all(users.docs.map(async (user) => {
  const authUser = await auth.getUser(user.id);
  return authUser.customClaims?.tenantId === tenantId
    && authUser.customClaims?.role === user.data().role;
}));

verification.users = `${profileChecks.filter(Boolean).length}/${users.size} perfiles OK`;
verification.authClaims = `${authChecks.filter(Boolean).length}/${users.size} claims OK`;
verification.company = tenantCompany.exists ? 'OK' : 'FALTA';
verification.tenantRoot = tenantRoot.exists ? 'OK' : 'FALTA';
console.table(verification);

if (!profileChecks.every(Boolean) || !authChecks.every(Boolean) || !tenantCompany.exists || !tenantRoot.exists) {
  throw new Error('La verificación final de la migración falló.');
}
console.log('Verificación remota completada correctamente.');
