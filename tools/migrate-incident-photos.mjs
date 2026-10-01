import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const tenantId = process.env.TENANT_ID;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
if (!projectId || !tenantId || !storageBucket || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenantId)) {
  throw new Error('Define GOOGLE_CLOUD_PROJECT, TENANT_ID y FIREBASE_STORAGE_BUCKET explícitamente.');
}
const account = new URL('./service-account.json', import.meta.url);
const app = initializeApp({ projectId, storageBucket, credential: existsSync(account) ? cert(JSON.parse(readFileSync(account, 'utf8'))) : applicationDefault() });
const db = getFirestore(app);
const bucket = getStorage(app).bucket();
const apply = process.argv.includes('--apply');
let cursor;
let migrated = 0;
do {
  let query = db.collection(`tenants/${tenantId}/incidents`).orderBy('__name__').limit(100);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  for (const document of page.docs) {
    const data = document.data();
    if (!data.photoUrl) continue;
    const url = new URL(data.photoUrl);
    const segments = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (url.hostname !== 'firebasestorage.googleapis.com' || !segments || decodeURIComponent(segments[1]) !== storageBucket) {
      throw new Error(`Foto de ${document.id}: bucket o URL inesperada; revisa manualmente.`);
    }
    const path = decodeURIComponent(segments[2]);
    const legacyPrefix = `tenants/${tenantId}/incidents/${data.createdBy}/`;
    const privatePrefix = `tenants/${tenantId}/incidents/${data.storeId}/${data.createdBy}/`;
    if ((!path.startsWith(legacyPrefix) && !path.startsWith(privatePrefix))
      || !/^[\w-]{1,128}$/.test(data.storeId ?? '') || !/^[\w-]{1,128}$/.test(data.createdBy ?? '')) {
      throw new Error(`Foto de ${document.id}: propietario o tienda inconsistentes.`);
    }
    const target = `${privatePrefix}${document.id}`;
    if (apply) {
      const source = bucket.file(path);
      const destination = bucket.file(target);
      const [metadata] = await source.getMetadata();
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(metadata.contentType) || Number(metadata.size) > 5 * 1024 * 1024) {
        throw new Error(`Foto de ${document.id}: formato o tamaño inválidos.`);
      }
      if (path !== target) await source.copy(destination);
      await destination.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
      if (path !== target) await source.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
      await document.ref.update({ photoPath: target, photoUrl: null }, { lastUpdateTime: document.updateTime });
    }
    migrated++;
  }
  cursor = page.size === 100 ? page.docs.at(-1) : undefined;
} while (cursor);
console.log(`${apply ? 'Migradas y tokens revocados' : 'Dry-run: fotos pendientes'}: ${migrated}.`);
