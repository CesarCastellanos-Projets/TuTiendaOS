/**
 * Migra catálogo y stock al modelo de empaques separados.
 * Dry-run por defecto. Use --apply solo después de revisar el resumen.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const tenantId = process.env.TENANT_ID;
if (!tenantId) throw new Error('Defina TENANT_ID explícitamente.');
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
if (!projectId) throw new Error('Defina GOOGLE_CLOUD_PROJECT antes de ejecutar la migración.');
if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenantId)) throw new Error('TENANT_ID inválido.');

const serviceAccountUrl = new URL('./service-account.json', import.meta.url);
const credential = existsSync(serviceAccountUrl)
  ? cert(JSON.parse(readFileSync(serviceAccountUrl, 'utf8')))
  : applicationDefault();
const app = initializeApp({ credential, projectId });
const db = getFirestore(app);
const tenantRoot = db.collection('tenants').doc(tenantId);
async function readPages(collection) {
  const docs = [];
  let cursor;
  do {
    let query = collection.orderBy(FieldPath.documentId()).limit(250);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    docs.push(...page.docs);
    cursor = page.size === 250 ? page.docs.at(-1) : undefined;
  } while (cursor);
  return { docs, size: docs.length };
}
const [productsSnapshot, stocksSnapshot] = await Promise.all([
  readPages(tenantRoot.collection('products')),
  readPages(tenantRoot.collection('product_stocks'))
]);
const productDefinitions = new Map();

const codeOwners = new Map();
const writes = [];
let migratedProducts = 0;
let migratedStocks = 0;
let latestCatalogUpdate = 0;

function stablePresentationId(_productId, _presentation, index) {
  return `legacy-${index + 1}`;
}

function registryId(code) {
  return Buffer.from(code.toLowerCase(), 'utf8').toString('base64url');
}

for (const document of productsSnapshot.docs) {
  const data = document.data();
  const sourcePresentations = Array.isArray(data.presentations) ? data.presentations : [];
  const presentationIds = new Set();
  const presentations = sourcePresentations.map((presentation, index) => {
    const factor = Number(presentation.factor);
    const unit = String(presentation.unit ?? 'CJA').trim().toUpperCase();
    const id = String(presentation.id ?? '').trim() || stablePresentationId(document.id, presentation, index);
    if (!Number.isInteger(factor) || factor <= 1 || !unit || presentationIds.has(id)) {
      throw new Error(`Presentación inválida en producto ${document.id}, posición ${index + 1}.`);
    }
    presentationIds.add(id);
    const migrated = {
      ...presentation,
      id,
      unit,
      description: String(presentation.description ?? '').trim() || `${unit} x${factor}`,
      factor,
      allowFractionalSale: presentation.allowFractionalSale === true,
      fractionStep: Number(presentation.fractionStep) > 0 && Number(presentation.fractionStep) < 1
        ? Number(presentation.fractionStep)
        : 0.5,
      autoUnpackEnabled: presentation.autoUnpackEnabled === true,
      autoUnpackPriority: Number.isInteger(Number(presentation.autoUnpackPriority)) && Number(presentation.autoUnpackPriority) > 0
        ? Number(presentation.autoUnpackPriority)
        : index + 1
    };
    if (migrated.fractionStep < 0.001 || Math.abs(migrated.fractionStep * 1000 - Math.round(migrated.fractionStep * 1000)) > 0.000001
      || (migrated.allowFractionalSale && !Number.isInteger(Math.round(migrated.fractionStep * 1000) * factor / 1000))) {
      throw new Error(`El paso fraccionario de ${document.id}/${id} no produce unidades completas.`);
    }
    return migrated;
  });
  productDefinitions.set(document.id, { ...data, presentations });
  const updatedAt = Date.now();
  latestCatalogUpdate = Math.max(latestCatalogUpdate, updatedAt);
  if (JSON.stringify(presentations) !== JSON.stringify(sourcePresentations)) {
    writes.push({ ref: document.ref, data: { presentations, updatedAt }, updateTime: document.updateTime });
    migratedProducts += 1;
  }
  const codes = [data.barcode, ...presentations.map((presentation) => presentation.barcode)]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  for (const code of codes) {
    const normalized = code.toLowerCase();
    const owner = codeOwners.get(normalized);
    if (owner) throw new Error(`Código duplicado ${code}: ${owner} y ${document.id}.`);
    codeOwners.set(normalized, document.id);
    const registryRef = tenantRoot.collection('barcode_registry').doc(registryId(code));
    const registry = await registryRef.get();
    if (registry.exists && registry.data().productId !== document.id) throw new Error(`Reserva incompatible para código ${code}.`);
    writes.push({
      ref: registryRef,
      create: !registry.exists,
      updateTime: registry.updateTime,
      data: { tenantId, productId: document.id, code, updatedAt },
      merge: false
    });
  }
}

for (const document of stocksSnapshot.docs) {
  const data = document.data();
  const product = productDefinitions.get(data.productId);
  if (!product) throw new Error(`Stock ${document.id}: producto inexistente.`);
  if (data.requiresReconciliation === true) { console.warn(`Stock ${document.id}: reclasificación física pendiente; se conserva sin cambios.`); continue; }
  let baseQuantity;
  const presentationQuantities = {};
  if ([2, 3, 4].includes(data.stockModelVersion)) {
    if (typeof data.baseQuantity !== 'number' || !Number.isFinite(data.baseQuantity) || data.baseQuantity < 0) throw new Error(`Base inconsistente en ${document.id}.`);
    let equivalent = data.baseQuantity;
    for (const [id, quantity] of Object.entries(data.presentationQuantities ?? {})) {
      const presentation = product.presentations.find((item) => item.id === id);
      if (!presentation || !Number.isInteger(quantity) || quantity < 0) throw new Error(`Empaque inconsistente en ${document.id}/${id}.`);
      equivalent += quantity * presentation.factor;
      if (!presentation.autoUnpackEnabled && quantity > 0) presentationQuantities[id] = quantity;
    }
    if (Math.abs(equivalent - Number(data.quantity)) > 0.000001) throw new Error(`El equivalente no coincide en ${document.id}; requiere conteo físico.`);
    if (data.stockModelVersion === 3) {
      if (Object.values(data.presentationQuantities ?? {}).some((qty) => qty !== 0)) throw new Error(`Stock compartido inconsistente en ${document.id}.`);
      if (Number(data.quantity) > 0 && product.presentations.some((p) => !p.autoUnpackEnabled)) { console.warn(`Stock ${document.id}: requiere reclasificación manual de cajas cerradas; se conserva sin cambios.`); continue; }
    }
    baseQuantity = equivalent - Object.entries(presentationQuantities).reduce((sum, [id, qty]) => sum + qty * product.presentations.find((p) => p.id === id).factor, 0);
  } else {
    if (Object.keys(data.presentationQuantities ?? {}).length) throw new Error(`Stock mixto ambiguo en ${document.id}; requiere conteo físico.`);
    baseQuantity = Number(data.quantity ?? 0);
    if (!Number.isFinite(baseQuantity) || baseQuantity < 0 || Math.abs(baseQuantity * 1000 - Math.round(baseQuantity * 1000)) > 0.000001) {
      throw new Error(`El stock ${document.id} contiene ${baseQuantity} unidades base fraccionarias.`);
    }
  }
  writes.push({
    ref: document.ref,
    updateTime: document.updateTime,
    data: {
      baseQuantity,
      presentationQuantities,
      quantity: Number(data.quantity ?? 0),
      stockModelVersion: 4,
      updatedAt: Date.now()
    },
    merge: true
  });
  migratedStocks += 1;
}

if (latestCatalogUpdate > 0) {
  writes.push({
    ref: tenantRoot.collection('meta').doc('catalog'),
    data: { tenantId, updatedAt: latestCatalogUpdate },
    merge: true
  });
}

console.table({ products: productsSnapshot.size, migratedProducts, stocks: stocksSnapshot.size, migratedStocks, registryCodes: codeOwners.size, writes: writes.length });
if (!apply) {
  console.log('Dry-run completado. Repita con --apply para escribir la migración idempotente.');
  process.exit(0);
}

if (!process.argv.includes('--maintenance-confirmed')) throw new Error('Para aplicar, detén la operación y confirma con --maintenance-confirmed.');
const maintenance = tenantRoot.collection('meta').doc('inventory_maintenance');
const owner = `${process.pid}-${Date.now()}`;
await db.runTransaction(async (tx) => {
  const lock = await tx.get(maintenance);
  if (lock.exists && !process.argv.includes('--resume-maintenance')) throw new Error('La migración anterior requiere revisión. Usa --resume-maintenance solo después de revisar el respaldo.');
  tx.set(maintenance, { active: true, owner, startedAt: Date.now() });
});
const backup = `migration-backup-${projectId}-${tenantId}-${Date.now()}.json`;
writeFileSync(backup, JSON.stringify({ projectId, tenantId, createdAt: Date.now(),
  products: productsSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  stocks: stocksSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })) }, null, 2), { flag: 'wx' });
console.log(`Respaldo previo: ${backup}. Si falla la migración, conserva el bloqueo y revisa antes de continuar.`);
for (let index = 0; index < writes.length; index += 400) {
  const batch = db.batch();
  for (const write of writes.slice(index, index + 400)) {
    if (write.create) batch.create(write.ref, write.data);
    else if (write.updateTime) batch.update(write.ref, write.data, { lastUpdateTime: write.updateTime });
    else batch.set(write.ref, write.data, { merge: true });
  }
  await batch.commit();
}
await db.runTransaction(async (tx) => {
  const lock = await tx.get(maintenance);
  if (lock.data()?.owner !== owner) throw new Error('El bloqueo pertenece a otra migración.');
  tx.delete(maintenance);
});
console.log(`Migración aplicada en ${projectId}/${tenantId}.`);
