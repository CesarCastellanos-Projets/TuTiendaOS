import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  writeBatch,
  setDoc
} from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyDh5lYWZsM1jNTEiq9mJzph1BaRkj49-tM',
  authDomain: 'denzozsaas.firebaseapp.com',
  projectId: 'denzozsaas',
});

const auth = getAuth(app);
const userCred = await signInWithEmailAndPassword(auth, 'admin@denzoz.pe', 'admin123');
console.log('✓ Logged in as:', userCred.user.email);

const db = getFirestore(app);
const tenantId = 'denzoz';
const tenantRef = doc(db, 'tenants', tenantId);

console.log('--- 1. Analizando y migrando Productos ---');
const productsSnap = await getDocs(collection(db, `tenants/${tenantId}/products`));
console.log(`Encontrados ${productsSnap.size} productos.`);

const productsMap = new Map();
const batch = writeBatch(db);
let productUpdates = 0;
let registryWrites = 0;

function registryId(code) {
  return Buffer.from(code.toLowerCase(), 'utf8').toString('base64url');
}

for (const prodDoc of productsSnap.docs) {
  const data = prodDoc.data();
  productsMap.set(prodDoc.id, data);

  const sourcePresentations = Array.isArray(data.presentations) ? data.presentations : [];
  let needsUpdate = false;

  const migratedPresentations = sourcePresentations.map((p, idx) => {
    const factor = Number(p.factor) || 1;
    const unit = String(p.unit ?? 'CJA').trim().toUpperCase();
    const id = String(p.id ?? '').trim() || `legacy-${idx + 1}`;
    if (!p.id || p.id !== id) needsUpdate = true;

    return {
      ...p,
      id,
      unit,
      description: String(p.description ?? '').trim() || `${unit} x${factor}`,
      factor,
      allowFractionalSale: p.allowFractionalSale === true,
      fractionStep: Number(p.fractionStep) > 0 && Number(p.fractionStep) < 1 ? Number(p.fractionStep) : 0.5,
      autoUnpackEnabled: p.autoUnpackEnabled === true,
      autoUnpackPriority: Number.isInteger(Number(p.autoUnpackPriority)) ? Number(p.autoUnpackPriority) : idx + 1
    };
  });

  if (needsUpdate || JSON.stringify(sourcePresentations) !== JSON.stringify(migratedPresentations)) {
    batch.update(prodDoc.ref, {
      presentations: migratedPresentations,
      updatedAt: Date.now()
    });
    productUpdates++;
    // Actualizamos localmente el map
    data.presentations = migratedPresentations;
  }

  // Registrar códigos de barras
  const barcodes = [data.barcode, ...migratedPresentations.map(p => p.barcode)]
    .map(b => String(b ?? '').trim())
    .filter(Boolean);

  for (const code of barcodes) {
    const regRef = doc(db, `tenants/${tenantId}/barcode_registry`, registryId(code));
    batch.set(regRef, {
      tenantId,
      productId: prodDoc.id,
      code,
      updatedAt: Date.now()
    }, { merge: true });
    registryWrites++;
  }
}

console.log(`Productos actualizados: ${productUpdates}, Códigos en registro: ${registryWrites}`);

console.log('--- 2. Analizando y migrando Stock de Productos ---');
const stocksSnap = await getDocs(collection(db, `tenants/${tenantId}/product_stocks`));
console.log(`Encontrados ${stocksSnap.size} registros de stock.`);

let stockUpdates = 0;

for (const stockDoc of stocksSnap.docs) {
  const stock = stockDoc.data();
  const prod = productsMap.get(stock.productId);
  const presentations = Array.isArray(prod?.presentations) ? prod.presentations : [];

  let baseQuantity = typeof stock.baseQuantity === 'number' ? stock.baseQuantity : Math.max(0, Number(stock.quantity || 0));
  let presentationQuantities = stock.presentationQuantities ? { ...stock.presentationQuantities } : {};

  // Si tiene presentaciones y no tenía stock de presentaciones inicializado
  if (presentations.length > 0 && Object.keys(presentationQuantities).length === 0) {
    const p = presentations[0];
    const presId = p.id || 'legacy-1';
    // Otorgar stock de prueba inicial de cajas para que se pueda operar y transferir
    // Si es T01 (tienda) dar 5 cajas; si es ALM01 (almacén) dar 10 cajas; otros dar 3
    const testBoxes = stock.storeId === 'ALM01' ? 10 : (stock.storeId === 'T01' ? 5 : 3);
    presentationQuantities[presId] = testBoxes;
    console.log(`-> Asignando ${testBoxes} cajas de [${p.description || p.unit}] a ${prod?.name || stock.productName} en ${stock.storeId || stock.warehouseId}`);
  }

  // Calcular cantidad total equivalente: baseQuantity + sum(cajas * factor)
  let totalEquivalent = baseQuantity;
  for (const p of presentations) {
    const qty = presentationQuantities[p.id] || 0;
    totalEquivalent += qty * (Number(p.factor) || 1);
  }

  batch.update(stockDoc.ref, {
    baseQuantity,
    presentationQuantities,
    quantity: totalEquivalent,
    stockModelVersion: 2,
    updatedAt: Date.now()
  });
  stockUpdates++;
}

// Actualizar meta/catalog para que todos los clientes invaliden caché IndexedDB
const metaCatalogRef = doc(db, `tenants/${tenantId}/meta`, 'catalog');
batch.set(metaCatalogRef, {
  tenantId,
  updatedAt: Date.now()
}, { merge: true });

console.log(`Comprometiendo batch: ${stockUpdates} stocks actualizados...`);
await batch.commit();

console.log('✓ ¡Migración completada con éxito!');
process.exit(0);
