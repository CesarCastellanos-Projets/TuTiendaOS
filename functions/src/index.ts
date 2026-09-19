import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';
import { admin, db } from './firebase';
import { requireActiveProfile, requireAdmin } from './authz';
import { tenantCollection } from './tenant';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
const APISPERU_TOKEN = defineString('APISPERU_TOKEN', { default: 'disabled' });

export { createSaleRecord, getCompanyConfig, receiveTransfer } from './operations';
export { saveCatalogProduct } from './catalog';
export {
  adjustInventory,
  attendReplenishmentRequest,
  cancelInventoryTransfer,
  createInventoryTransfer,
  recordStockIngress,
  rejectReplenishmentRequest
} from './inventory';
export {
  activateSunatDemoMode,
  saveSunatCredentials,
  sendCreditNoteToSunat,
  sendDailySummaryToSunat,
  sendNewSaleToSunat,
  sendSaleToSunat,
  sendVoidedToSunat,
  retryPendingSunatSales,
  taxHealthCheck,
  uploadSunatCertificate
} from './tax';

/** Crea usuario de Auth + perfil en Firestore. Solo Admin puede llamar. */
export const createUser = onCall(async (request) => {
  const profile = await requireAdmin(request);

  const { email, password, displayName, role, storeId, storeAccess } = request.data as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: string;
    storeId?: string | null;
    storeAccess?: string;
  };

  if (!email || !password || password.length < 6 || !displayName || !role) {
    throw new HttpsError('invalid-argument', 'Faltan datos del usuario.');
  }
  if (!['admin', 'pos', 'trabajador'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Rol inválido.');
  }
  const isMultiStorePos = role === 'pos' && storeAccess === 'all';
  if (((role === 'pos' && !isMultiStorePos) || role === 'trabajador') && !storeId) {
    throw new HttpsError('invalid-argument', 'POS y Trabajador requieren tienda.');
  }

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName,
    emailVerified: true,
    disabled: false
  });

  await db.doc(`users/${userRecord.uid}`).set({
    tenantId: profile.tenantId,
    displayName,
    email,
    role,
    storeId: isMultiStorePos ? null : storeId ?? null,
    storeAccess: isMultiStorePos ? 'all' : 'assigned',
    active: true,
    createdAt: Date.now()
  });
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    tenantId: profile.tenantId,
    role,
    posStoreAccess: isMultiStorePos ? 'all' : 'assigned',
    canOverridePrices: isMultiStorePos
  });

  return { uid: userRecord.uid };
});

/** Selecciona la tienda operativa de un POS multi-tienda. */
export const selectPosStore = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'pos' || profile.storeAccess !== 'all') {
    throw new HttpsError('permission-denied', 'Tu cuenta no puede cambiar de tienda.');
  }
  const storeId = typeof request.data?.storeId === 'string'
    ? request.data.storeId.trim().slice(0, 128)
    : '';
  if (!storeId) throw new HttpsError('invalid-argument', 'Selecciona una tienda válida.');
  const store = await db.doc(`tenants/${profile.tenantId}/stores/${storeId}`).get();
  if (!store.exists) throw new HttpsError('not-found', 'La tienda seleccionada no existe.');
  await db.doc(`users/${profile.uid}`).update({ storeId });
  return { storeId, storeName: String(store.data()?.name ?? 'Tienda') };
});

/** Consulta DNI/RUC desde el servidor y cachea en Firestore. */
export const lookupClient = onCall(async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const profile = await requireActiveProfile(request);
    const { type, number } = request.data as { type?: 'dni' | 'ruc'; number?: string };
    if ((type !== 'dni' && type !== 'ruc') || !number || !/^\d{8}$|^\d{11}$/.test(number)) {
      throw new HttpsError('invalid-argument', 'Documento inválido.');
    }
    if (type === 'dni' && number.length !== 8) throw new HttpsError('invalid-argument', 'DNI debe tener 8 dígitos.');
    if (type === 'ruc' && number.length !== 11) throw new HttpsError('invalid-argument', 'RUC debe tener 11 dígitos.');

    // Caché primero: cero costo de API
    const cacheId = `${type === 'dni' ? 'DNI' : 'RUC'}-${number}`;
    const clients = tenantCollection(profile.tenantId, 'clients');
    const cached = await clients.doc(cacheId).get();
    if (cached.exists) {
      return cached.data();
    }

    const apiToken = APISPERU_TOKEN.value().trim();
    if (!apiToken || apiToken === 'disabled') {
      throw new HttpsError(
        'failed-precondition',
        'La consulta automática de DNI/RUC aún no está configurada.'
      );
    }

    const endpoint =
      type === 'dni'
        ? `https://api.apis.net.pe/v2/reniec/dni?numero=${number}`
        : `https://api.apis.net.pe/v2/sunat/ruc?numero=${number}`;

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Referer: 'https://denzoz.pe'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new HttpsError('unavailable', 'El servicio de consulta no respondió.');
    }
    const data = (await res.json()) as Record<string, unknown>;

    let nombre: string;
    if (type === 'dni') {
      nombre = [data.nombres, data.apellidoPaterno, data.apellidoMaterno]
        .filter(Boolean)
        .join(' ');
    } else {
      nombre = String(data.razonSocial ?? data.nombre ?? '');
    }
    if (!nombre) throw new HttpsError('not-found', 'No se encontró el documento.');

    const result = {
      tipo: type === 'dni' ? 'DNI' : 'RUC',
      numero: number,
      nombre,
      direccion: data.direccion ?? null,
      updatedAt: Date.now()
    };
    await clients.doc(cacheId).set({ ...result, tenantId: profile.tenantId });
    return result;
});

interface CatalogPresentationInput {
  id?: string;
  unit?: string;
  description?: string;
  factor?: number | string;
  salePrice?: number | string;
  barcode?: string;
  allowFractionalSale?: boolean;
  fractionStep?: number | string;
  autoUnpackEnabled?: boolean;
  autoUnpackPriority?: number | string;
}

/** Migra catálogo y stocks al modelo v2 de empaques separados. Solo Admin puede llamar. */
export const migrateCatalogAndStocks = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const tenantRoot = db.collection('tenants').doc(profile.tenantId);
  const [productsSnapshot, stocksSnapshot] = await Promise.all([
    tenantRoot.collection('products').get(),
    tenantRoot.collection('product_stocks').get()
  ]);

  const batch = db.batch();
  let productUpdates = 0;
  let registryWrites = 0;
  let stockUpdates = 0;

  const productsMap = new Map<string, Record<string, unknown>>();

  function registryId(code: string): string {
    return Buffer.from(code.toLowerCase(), 'utf8').toString('base64url');
  }

  for (const doc of productsSnapshot.docs) {
    const data = doc.data();
    productsMap.set(doc.id, data);
    const sourcePresentations = Array.isArray(data.presentations)
      ? data.presentations as CatalogPresentationInput[]
      : [];
    let needsUpdate = false;

    const presentations = sourcePresentations.map((p, index) => {
      const factor = Number(p.factor) || 1;
      const unit = String(p.unit ?? 'CJA').trim().toUpperCase();
      const id = String(p.id ?? '').trim() || `legacy-${index + 1}`;
      if (!p.id || p.id !== id) needsUpdate = true;

      return {
        ...p,
        id,
        unit,
        description: String(p.description ?? '').trim() || `${unit} x${factor}`,
        factor,
        allowFractionalSale: p.allowFractionalSale !== false,
        fractionStep: Number(p.fractionStep) > 0 && Number(p.fractionStep) < 1 ? Number(p.fractionStep) : 0.5,
        autoUnpackEnabled: p.autoUnpackEnabled === true,
        autoUnpackPriority: Number.isInteger(Number(p.autoUnpackPriority)) ? Number(p.autoUnpackPriority) : index + 1
      };
    });

    if (needsUpdate || JSON.stringify(sourcePresentations) !== JSON.stringify(presentations)) {
      batch.update(doc.ref, { presentations, updatedAt: Date.now() });
      productUpdates++;
      data.presentations = presentations;
    }

    const barcodes = [data.barcode as string | undefined, ...presentations.map((p) => p.barcode)]
      .map((b) => String(b ?? '').trim())
      .filter(Boolean);

    for (const code of barcodes) {
      const regRef = tenantRoot.collection('barcode_registry').doc(registryId(code));
      batch.set(regRef, {
        tenantId: profile.tenantId,
        productId: doc.id,
        code,
        updatedAt: Date.now()
      }, { merge: true });
      registryWrites++;
    }
  }

  for (const doc of stocksSnapshot.docs) {
    const stock = doc.data();
    const prod = productsMap.get(stock.productId as string);
    const presentations = Array.isArray(prod?.presentations)
      ? prod.presentations as CatalogPresentationInput[]
      : [];

    const baseQuantity = typeof stock.baseQuantity === 'number'
      ? stock.baseQuantity
      : Math.max(0, Number(stock.quantity ?? 0));
    const presentationQuantities: Record<string, number> = stock.presentationQuantities
      ? { ...(stock.presentationQuantities as Record<string, number>) }
      : {};

    // Si tiene presentaciones y no tenía stock de presentaciones inicializado
    if (presentations.length > 0 && Object.keys(presentationQuantities).length === 0) {
      const p = presentations[0];
      const presId = p.id || 'legacy-1';
      // Inicializamos stock de cajas físicas: 10 para almacén ALM01, 5 para tienda T01, 3 para otras
      const testBoxes = stock.storeId === 'ALM01' ? 10 : (stock.storeId === 'T01' ? 5 : 3);
      presentationQuantities[presId] = testBoxes;
    }

    let totalEquivalent = baseQuantity;
    for (const p of presentations) {
      const presId = p.id || 'legacy-1';
      const qty = presentationQuantities[presId] ?? 0;
      totalEquivalent += qty * (Number(p.factor) || 1);
    }

    batch.update(doc.ref, {
      baseQuantity,
      presentationQuantities,
      quantity: totalEquivalent,
      stockModelVersion: 2,
      updatedAt: Date.now()
    });
    stockUpdates++;
  }

  const metaCatalogRef = tenantRoot.collection('meta').doc('catalog');
  batch.set(metaCatalogRef, {
    tenantId: profile.tenantId,
    updatedAt: Date.now()
  }, { merge: true });

  await batch.commit();

  return {
    success: true,
    productUpdates,
    registryWrites,
    stockUpdates,
    tenantId: profile.tenantId
  };
});

