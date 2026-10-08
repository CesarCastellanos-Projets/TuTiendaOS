import { appCheckOptions } from './app-check';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { FieldPath, type Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';
import { requireActiveProfile, type ActiveProfile } from './authz';
import { tenantCollection, tenantDoc } from './tenant';

type InventoryTask = 'canIngress' | 'canCreateProducts';

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) {
    throw new HttpsError('invalid-argument', 'El usuario o la tienda no son válidos.');
  }
  return value;
}

function assertManager(profile: ActiveProfile, data: Record<string, unknown>): void {
  if (data.active !== true || data.tenantId !== profile.tenantId || data.role !== profile.role
    || !(data.role === 'admin' || (data.role === 'pos' && data.storeAccess === 'all' && profile.storeAccess === 'all'))) {
    throw new HttpsError('permission-denied', 'Solo el administrador o un POS multitiendas puede administrar estos permisos.');
  }
}

async function requireManager(request: Parameters<typeof requireActiveProfile>[0]): Promise<ActiveProfile> {
  const profile = await requireActiveProfile(request, false);
  assertManager(profile, { ...profile, active: true });
  return profile;
}

export async function assertInventoryTask(tx: Transaction, profile: ActiveProfile, task: InventoryTask, storeId: string): Promise<void> {
  const maintenance = await tx.get(tenantDoc(profile.tenantId, 'meta', 'inventory_maintenance'));
  if (maintenance.data()?.active === true) throw new HttpsError('unavailable', 'Inventario en mantenimiento. Intenta nuevamente al terminar la migración.');
  const snapshot = await tx.get(db.doc(`users/${profile.uid}`));
  const data = snapshot.data();
  if (data?.active !== true || data.tenantId !== profile.tenantId || data.role !== profile.role) {
    throw new HttpsError('permission-denied', 'Tu acceso cambió. Vuelve a iniciar sesión.');
  }
  if (profile.role === 'admin') return;
  const access = data.inventoryAccess;
  if (profile.role !== 'trabajador' || !storeId || data.storeId !== storeId || access?.storeId !== storeId || access?.[task] !== true) {
    throw new HttpsError('permission-denied', 'Ya no tienes permiso para realizar esta operación en la tienda.');
  }
  const store = await tx.get(tenantDoc(profile.tenantId, 'stores', storeId));
  if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'La tienda autorizada ya no está activa.');
}

export const listWorkerInventoryAccess = onCall(appCheckOptions, async (request) => {
  const profile = await requireManager(request);
  const storeId = identifier(request.data?.storeId);
  const cursor = request.data?.cursor ? identifier(request.data.cursor) : '';
  const store = await tenantDoc(profile.tenantId, 'stores', storeId).get();
  if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'La tienda no está activa.');
  let workers = db.collection('users').where('tenantId', '==', profile.tenantId)
    .where('storeId', '==', storeId).where('role', '==', 'trabajador').orderBy(FieldPath.documentId()).limit(26);
  if (cursor) workers = workers.startAfter(cursor);
  const snapshot = await workers.get().catch((cause: unknown) => {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    if (code === '9' && cause instanceof Error && /index/i.test(cause.message)) {
      throw new HttpsError('failed-precondition', 'Los índices de permisos todavía no están listos. Espera a que termine su construcción en Firebase y pulsa Actualizar trabajadores.');
    }
    throw cause;
  });
  const page = snapshot.docs.slice(0, 25);
  return {
    workers: page.map((doc) => {
      const data = doc.data();
      const access = data.inventoryAccess?.storeId === storeId ? data.inventoryAccess : {};
      return { id: doc.id, displayName: String(data.displayName ?? ''), active: data.active === true,
        canIngress: access.canIngress === true, canCreateProducts: access.canCreateProducts === true,
        updatedAt: Number(access.updatedAt ?? 0), updatedByName: String(access.updatedByName ?? '') };
    }),
    nextCursor: snapshot.size > 25 ? page.at(-1)!.id : null
  };
});

export const setWorkerInventoryAccess = onCall(appCheckOptions, async (request) => {
  const profile = await requireManager(request);
  const workerId = identifier(request.data?.workerId);
  const storeId = identifier(request.data?.storeId);
  const { canIngress, canCreateProducts } = request.data ?? {};
  if (typeof canIngress !== 'boolean' || typeof canCreateProducts !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Selecciona permisos válidos.');
  }
  await db.runTransaction(async (tx) => {
    const actorRef = db.doc(`users/${profile.uid}`);
    const workerRef = db.doc(`users/${workerId}`);
    const [actor, worker, store] = await tx.getAll(actorRef, workerRef, tenantDoc(profile.tenantId, 'stores', storeId));
    assertManager(profile, actor.data() ?? {});
    const data = worker.data();
    if (!store.exists || store.data()?.active === false || data?.tenantId !== profile.tenantId || data.role !== 'trabajador' || data.storeId !== storeId) {
      throw new HttpsError('permission-denied', 'El trabajador no pertenece a esta tienda.');
    }
    if ((canIngress || canCreateProducts) && data.active !== true) {
      throw new HttpsError('failed-precondition', 'Activa al trabajador antes de conceder permisos.');
    }
    const previous = data.inventoryAccess?.storeId === storeId ? data.inventoryAccess : {};
    if ((previous.canIngress === true) === canIngress && (previous.canCreateProducts === true) === canCreateProducts) return;
    const updatedAt = Date.now();
    tx.update(workerRef, { inventoryAccess: { storeId, canIngress, canCreateProducts, updatedAt,
      updatedBy: profile.uid, updatedByName: profile.displayName } });
    tx.create(tenantCollection(profile.tenantId, 'worker_permission_events').doc(), {
      tenantId: profile.tenantId, storeId, storeName: String(store.data()?.name ?? ''), workerId,
      workerName: String(data.displayName ?? ''), userId: profile.uid, userName: profile.displayName,
      before: { canIngress: previous.canIngress === true, canCreateProducts: previous.canCreateProducts === true },
      after: { canIngress, canCreateProducts }, createdAt: updatedAt
    });
  });
  return { ok: true };
});
