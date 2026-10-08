import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const argument = (key) => args[args.indexOf(key) + 1];
const projectId = args.includes('--project') ? argument('--project') : '';
const tenantId = args.includes('--tenant') ? argument('--tenant') : '';
const apply = args.includes('--apply');
const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST);
if (!projectId || !/^[\w-]{1,128}$/.test(tenantId)) throw new Error('Uso: --project PROYECTO --tenant EMPRESA [--apply --backup-uri gs://RESPALDO]');
if (apply && !emulator && (!args.includes('--backup-uri') || !/^gs:\/\/[^/]+\/.+/.test(argument('--backup-uri')))) {
  throw new Error('Antes de aplicar, exporta y comprueba el respaldo; indica su --backup-uri.');
}
if (emulator && !projectId.startsWith('demo-')) throw new Error('Usa un proyecto demo para los emuladores.');
const db = getFirestore(initializeApp({ projectId }, 'backend-metadata'));
const maintenance = db.doc(`tenants/${tenantId}/meta/inventory_maintenance`);
const counts = {};
const summaryDays = new Set();
const products = new Map();
const product = async (id) => {
  if (!products.has(id)) products.set(id, (await db.doc(`tenants/${tenantId}/products/${id}`).get()).data());
  return products.get(id);
};
async function scan(collection, patch) {
  counts[collection] = { scanned: 0, changed: 0 };
  let cursor;
  do {
    const base = db.collection(`tenants/${tenantId}/${collection}`).orderBy('__name__');
    const page = await (cursor ? base.startAfter(cursor) : base).limit(200).get();
    for (const document of page.docs) {
      counts[collection].scanned++;
      const changes = await patch(document.data());
      if (!Object.keys(changes).length) continue;
      counts[collection].changed++;
      if (apply) await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(document.ref)).data();
        if (!fresh) return;
        const currentChanges = await patch(fresh);
        if (Object.keys(currentChanges).length) tx.update(document.ref, currentChanges);
      });
    }
    cursor = page.size === 200 ? page.docs.at(-1) : undefined;
  } while (cursor);
}
const owner = crypto.randomUUID();
if (apply) await db.runTransaction(async (tx) => {
  const state = (await tx.get(maintenance)).data();
  if (state?.active === true) throw new Error('Ya hay mantenimiento activo. Resuélvelo antes de continuar.');
  tx.set(maintenance, { active: true, owner, startedAt: Date.now(), reason: 'Preparación de metadatos backend; no modifica cantidades.' });
});
try {
  await scan('products', async (value) => value.committedAt ? {} : { committedAt: FieldValue.serverTimestamp() });
  await scan('product_stocks', async (value) => {
    const definition = await product(value.productId);
    const minimum = Number(definition?.minStock ?? 0);
    const low = definition?.active === true && Number(value.quantity) <= minimum;
    return { ...(!value.committedAt ? { committedAt: FieldValue.serverTimestamp() } : {}),
      ...(value.minStock !== minimum ? { minStock: minimum } : {}), ...(value.isLowStock !== low ? { isLowStock: low } : {}),
      ...(definition?.name && value.productName !== definition.name ? { productName: definition.name } : {}) };
  });
  await scan('sales', async (value) => {
    if (value.type === 'boleta' && value.consolidated === true && value.status === 'activa'
      && !value.sunatSummaryRef && ['no_enviado', 'pendiente'].includes(value.sunatStatus) && Number.isFinite(value.createdAt)) {
      summaryDays.add(new Date(value.createdAt - 5 * 3600000).toISOString().slice(0, 10));
    }
    return ({
    ...(value.statisticsPending === true && value.statisticsNextRetryAt === undefined ? { statisticsNextRetryAt: 0 } : {}),
    ...(value.consolidated !== true && ['no_enviado', 'pendiente'].includes(value.sunatStatus) && value.sunatNextRetryAt === undefined ? { sunatNextRetryAt: 0 } : {}),
    ...(value.consolidated === true && value.sunatSummaryRef === undefined && ['no_enviado', 'pendiente'].includes(value.sunatStatus) ? { sunatSummaryRef: null } : {}),
    ...(value.creditNoteStatus === 'pendiente' && value.creditNoteNextRetryAt === undefined ? { creditNoteNextRetryAt: 0 } : {}),
  }); });
  if (apply) for (const day of summaryDays) {
    await db.doc(`tenants/${tenantId}/sunat_summary_days/${day}`).set({ tenantId, day, pending: true }, { merge: true });
  }
  await scan('transfers', async (value) => Array.isArray(value.productIds) ? {} : { productIds: [...new Set((value.items ?? []).map((item) => item.productId))] });
  console.log(JSON.stringify({ projectId, tenantId, mode: apply ? 'applied' : 'diagnostic', counts, summaryDays: [...summaryDays], quantitiesChanged: false }, null, 2));
} finally {
  if (apply) await db.runTransaction(async (tx) => {
    if ((await tx.get(maintenance)).data()?.owner === owner) tx.update(maintenance, { active: false, finishedAt: Date.now() });
  });
}
