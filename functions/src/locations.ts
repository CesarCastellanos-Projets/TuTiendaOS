import { appCheckOptions } from './app-check';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { assertCurrentProfile, requireAdmin } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import { completeOperation, documentId, operationId, readOperation } from './operation-receipts';

export const saveLocation = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data ?? {};
  const requestId = operationId(data.requestId);
  if (!['store', 'warehouse'].includes(data.type)) throw new HttpsError('invalid-argument', 'Ubicación inválida.');
  const id = data.id ? documentId(data.id) : createHash('sha256').update(`${profile.uid}:${requestId}`).digest('hex').slice(0, 24);
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
  const address = typeof data.address === 'string' ? data.address.trim() : '';
  if (!name || name.length > 120 || !/^[A-Z0-9_-]{1,30}$/.test(code) || address.length > 240) {
    throw new HttpsError('invalid-argument', 'Revisa el nombre, código y dirección.');
  }
  const collection = data.type === 'store' ? 'stores' : 'warehouses';
  return db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'save-location', requestId, data);
    if (operation.result) return operation.result;
    const ref = tenantDoc(profile.tenantId, collection, id);
    const current = await tx.get(ref);
    if (data.id && !current.exists) throw new HttpsError('not-found', 'La ubicación ya no existe.');
    if (data.type === 'warehouse' && data.isCentral === true) {
      const central = await tx.get(tenantCollection(profile.tenantId, 'warehouses').where('isCentral', '==', true).limit(2));
      if (central.docs.some((doc) => doc.id !== id && doc.data().active !== false)) {
        throw new HttpsError('failed-precondition', 'Ya existe un almacén central activo.');
      }
    }
    tx.set(ref, { tenantId: profile.tenantId, name, code,
      ...(data.type === 'store' ? { address } : { isCentral: data.isCentral === true }),
      active: current.data()?.active !== false, updatedAt: Date.now(), updatedBy: profile.uid }, { merge: true });
    const result = { id };
    completeOperation(tx, profile, 'save-location', operation, result);
    return result;
  });
});

export const archiveLocation = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const id = documentId(request.data?.id);
  const type = request.data?.type;
  if (!['store', 'warehouse'].includes(type)) throw new HttpsError('invalid-argument', 'Ubicación inválida.');
  const ref = tenantDoc(profile.tenantId, type === 'store' ? 'stores' : 'warehouses', id);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const [location, stocks, incoming, outgoing, users, cash, requests, shortages] = await Promise.all([
      tx.get(ref),
      tx.get(tenantCollection(profile.tenantId, 'product_stocks').where('locationId', '==', id).where('quantity', '>', 0).limit(1)),
      tx.get(tenantCollection(profile.tenantId, 'transfers').where('toLocationId', '==', id).where('status', 'in', ['pendiente', 'en_transito']).limit(1)),
      tx.get(tenantCollection(profile.tenantId, 'transfers').where('fromLocationId', '==', id).where('status', 'in', ['pendiente', 'en_transito']).limit(1)),
      tx.get(db.collection('users').where('tenantId', '==', profile.tenantId).where('storeId', '==', id).limit(1)),
      tx.get(tenantCollection(profile.tenantId, 'cash_sessions').where('storeId', '==', id).where('status', 'in', ['abierta', 'cerrando']).limit(1)),
      tx.get(tenantCollection(profile.tenantId, 'replenishment_requests').where('storeId', '==', id).where('status', '==', 'pendiente').limit(1)),
      tx.get(tenantCollection(profile.tenantId, 'transfers').where('fromLocationId', '==', id).where('shortageStatus', '==', 'pendiente').limit(1))
    ]);
    if (!location.exists) throw new HttpsError('not-found', 'La ubicación no existe.');
    if (!stocks.empty || !incoming.empty || !outgoing.empty || !users.empty || !cash.empty || !requests.empty || !shortages.empty) {
      throw new HttpsError('failed-precondition', 'Primero resuelve el stock, las transferencias, las cajas y los usuarios asignados a esta ubicación.');
    }
    tx.update(ref, { active: false, archivedAt: Date.now(), archivedBy: profile.uid,
      ...(type === 'warehouse' ? { isCentral: false } : {}) });
  });
  return { ok: true };
});
