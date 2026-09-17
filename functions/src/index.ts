import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { admin, db } from './firebase';
import { requireActiveProfile, requireAdmin } from './authz';
import { tenantCollection } from './tenant';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
const APISPERU_TOKEN = defineSecret('APISPERU_TOKEN');

export { createSaleRecord, getCompanyConfig, receiveTransfer } from './operations';
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

  const { email, password, displayName, role, storeId } = request.data as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: string;
    storeId?: string | null;
  };

  if (!email || !password || password.length < 6 || !displayName || !role) {
    throw new HttpsError('invalid-argument', 'Faltan datos del usuario.');
  }
  if (!['admin', 'pos', 'trabajador'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Rol inválido.');
  }
  if ((role === 'pos' || role === 'trabajador') && !storeId) {
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
    storeId: storeId ?? null,
    active: true,
    createdAt: Date.now()
  });
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    tenantId: profile.tenantId,
    role
  });

  return { uid: userRecord.uid };
});

/** Consulta DNI/RUC desde el servidor y cachea en Firestore. */
export const lookupClient = onCall(
  { secrets: [APISPERU_TOKEN] },
  async (request) => {
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

    const endpoint =
      type === 'dni'
        ? `https://api.apis.net.pe/v2/reniec/dni?numero=${number}`
        : `https://api.apis.net.pe/v2/sunat/ruc?numero=${number}`;

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${APISPERU_TOKEN.value()}`,
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
  }
);
