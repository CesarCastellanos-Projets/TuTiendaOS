import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { assertTenantId } from './tenant';
import { calendarAllowed } from './calendar-model';
import type { Transaction } from 'firebase-admin/firestore';
import { assertUserAccess } from './access-schedule';

export type AppRole = 'admin' | 'pos' | 'trabajador';

export interface ActiveProfile {
  uid: string;
  displayName: string;
  role: AppRole;
  tenantId: string;
  storeId: string | null;
  storeAccess: 'assigned' | 'all';
  canOverridePrices: boolean;
  canManageCalendar: boolean;
  authTime?: number;
}

export async function requireActiveProfile(request: CallableRequest, checkInventory = true, resolveStore = true): Promise<ActiveProfile> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const snapshot = await db.doc(`users/${request.auth.uid}`).get();
  const data = snapshot.data();
  if (!snapshot.exists || data?.active !== true) {
    throw new HttpsError('permission-denied', 'Tu usuario no está activo.');
  }
  if (!['admin', 'pos', 'trabajador'].includes(String(data.role))) {
    throw new HttpsError('permission-denied', 'Tu usuario no tiene un rol válido.');
  }
  const authTime = Number(request.auth.token.auth_time ?? 0);
  assertUserAccess(data, authTime);
  let tenantId: string;
  try {
    tenantId = assertTenantId(data.tenantId);
  } catch {
    throw new HttpsError('permission-denied', 'Tu usuario no tiene una empresa válida asignada.');
  }
  if (checkInventory) {
    const maintenance = await db.doc(`tenants/${tenantId}/meta/inventory_maintenance`).get();
    if (maintenance.data()?.active === true) throw new HttpsError('unavailable', 'Inventario en mantenimiento. Intenta nuevamente al terminar la migración.');
  }
  const claimedTenantId = request.auth.token.tenantId;
  if (claimedTenantId !== undefined && claimedTenantId !== tenantId) {
    throw new HttpsError('permission-denied', 'La sesión no corresponde a la empresa asignada.');
  }

  const storeAccess = data.role === 'pos' && data.storeAccess === 'all' && request.auth.token.posStoreAccess === 'all'
    ? 'all'
    : 'assigned';
  const requestedStore = resolveStore ? request.data?.storeId : undefined;
  const assignedStore = typeof data.storeId === 'string' ? data.storeId : null;
  if (requestedStore !== undefined && (typeof requestedStore !== 'string' || !/^[\w-]{1,128}$/.test(requestedStore))) {
    throw new HttpsError('invalid-argument', 'Tienda inválida.');
  }
  if (requestedStore && data.role !== 'admin' && storeAccess !== 'all' && requestedStore !== assignedStore) {
    throw new HttpsError('permission-denied', 'Tu usuario no tiene acceso a esa tienda.');
  }

  return {
    uid: request.auth.uid,
    displayName: String(data.displayName ?? ''),
    role: data.role as AppRole,
    tenantId,
    storeId: requestedStore ?? assignedStore,
    storeAccess,
    canOverridePrices: storeAccess === 'all' && request.auth.token.canOverridePrices === true && data.canOverridePrices !== false,
    authTime,
    canManageCalendar: calendarAllowed(data)
  };
}

export async function requireAdmin(request: CallableRequest): Promise<ActiveProfile> {
  const profile = await requireActiveProfile(request, true, false);
  if (profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador puede realizar esta acción.');
  }
  return profile;
}

export async function assertCurrentProfile(tx: Transaction, profile: ActiveProfile): Promise<void> {
  const maintenance = await tx.get(db.doc(`tenants/${profile.tenantId}/meta/inventory_maintenance`));
  if (maintenance.data()?.active === true) throw new HttpsError('unavailable', 'Inventario en mantenimiento. Intenta nuevamente al terminar la migración.');
  const data = (await tx.get(db.doc(`users/${profile.uid}`))).data();
  assertUserAccess(data ?? {}, profile.authTime);
  if (data?.active !== true || data.tenantId !== profile.tenantId || data.role !== profile.role
    || (profile.canOverridePrices && data.canOverridePrices === false)
    || (profile.storeAccess === 'all' && data.storeAccess !== 'all')
    || (profile.role !== 'admin' && profile.storeAccess !== 'all' && data.storeId !== profile.storeId)) {
    throw new HttpsError('permission-denied', 'Tu acceso cambió. Vuelve a iniciar sesión.');
  }
}

export async function requireReplenishmentApprover(request: CallableRequest): Promise<ActiveProfile> {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'admin' && !(profile.role === 'pos' && profile.storeAccess === 'all')) {
    throw new HttpsError('permission-denied', 'Solo el administrador o un POS multitiendas puede aprobar reposiciones.');
  }
  return profile;
}
