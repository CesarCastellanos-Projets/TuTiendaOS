/**
 * Migra catálogo y stock al modelo de empaques separados.
 * Dry-run por defecto. Use --apply solo después de revisar el resumen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const tenantId = process.env.TENANT_ID ?? 'denzoz';
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
const [productsSnapshot, stocksSnapshot] = await Promise.all([
  tenantRoot.collection('products').get(),
  tenantRoot.collection('product_stocks').get()
]);

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
    if (migrated.allowFractionalSale && !Number.isInteger(Math.round(migrated.fractionStep * 1000) * factor / 1000)) {
      throw new Error(`El paso fraccionario de ${document.id}/${id} no produce unidades completas.`);
    }
    return migrated;
  });
  const updatedAt = Date.now();
  latestCatalogUpdate = Math.max(latestCatalogUpdate, updatedAt);
  if (JSON.stringify(presentations) !== JSON.stringify(sourcePresentations)) {
    writes.push({ ref: document.ref, data: { presentations, updatedAt }, merge: true });
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
    writes.push({
      ref: tenantRoot.collection('barcode_registry').doc(registryId(code)),
      data: { tenantId, productId: document.id, code, updatedAt },
      merge: false
    });
  }
}

for (const document of stocksSnapshot.docs) {
  const data = document.data();
  if (data.stockModelVersion === 2 && Number.isFinite(Number(data.baseQuantity))) continue;
  const baseQuantity = Math.max(0, Number(data.quantity ?? 0));
  if (!Number.isInteger(baseQuantity)) {
    throw new Error(`El stock ${document.id} contiene ${baseQuantity} unidades base fraccionarias.`);
  }
  writes.push({
    ref: document.ref,
    data: {
      baseQuantity,
      presentationQuantities: {},
      quantity: baseQuantity,
      stockModelVersion: 2,
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

for (let index = 0; index < writes.length; index += 400) {
  const batch = db.batch();
  for (const write of writes.slice(index, index + 400)) {
    if (write.merge) batch.set(write.ref, write.data, { merge: true });
    else batch.set(write.ref, write.data);
  }
  await batch.commit();
}
console.log(`Migración aplicada en ${projectId}/${tenantId}.`);
