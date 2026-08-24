import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
admin.initializeApp();

const db = admin.firestore();
const APISPERU_TOKEN = defineSecret('APISPERU_TOKEN');

/** Crea usuario de Auth + perfil en Firestore. Solo Admin puede llamar. */
export const createUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  const caller = await db.doc(`users/${request.auth.uid}`).get();
  if (caller.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador crea usuarios.');
  }

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
    displayName,
    email,
    role,
    storeId: storeId ?? null,
    active: true,
    createdAt: Date.now()
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
    const { type, number } = request.data as { type?: 'dni' | 'ruc'; number?: string };
    if ((type !== 'dni' && type !== 'ruc') || !number || !/^\d{8}$|^\d{11}$/.test(number)) {
      throw new HttpsError('invalid-argument', 'Documento inválido.');
    }
    if (type === 'dni' && number.length !== 8) throw new HttpsError('invalid-argument', 'DNI debe tener 8 dígitos.');
    if (type === 'ruc' && number.length !== 11) throw new HttpsError('invalid-argument', 'RUC debe tener 11 dígitos.');

    // Caché primero: cero costo de API
    const cacheId = `${type === 'dni' ? 'DNI' : 'RUC'}-${number}`;
    const cached = await db.collection('clients').doc(cacheId).get();
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
    await db.collection('clients').doc(cacheId).set(result);
    return result;
  }
);
