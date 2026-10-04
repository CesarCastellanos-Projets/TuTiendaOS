import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { assertTenantId } from './tenant';
import { calendarAllowed } from './calendar-model';

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
}

export async function requireActiveProfile(request: CallableRequest, checkInventory = true): Promise<ActiveProfile> {
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

  return {
    uid: request.auth.uid,
    displayName: String(data.displayName ?? ''),
    role: data.role as AppRole,
    tenantId,
    storeId: typeof data.storeId === 'string' ? data.storeId : null,
    storeAccess,
    canOverridePrices: storeAccess === 'all' && request.auth.token.canOverridePrices === true,
    canManageCalendar: calendarAllowed(data)
  };
}

export async function requireAdmin(request: CallableRequest): Promise<ActiveProfile> {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador puede realizar esta acción.');
  }
  return profile;
}

export async function requireReplenishmentApprover(request: CallableRequest): Promise<ActiveProfile> {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'admin' && !(profile.role === 'pos' && profile.storeAccess === 'all')) {
    throw new HttpsError('permission-denied', 'Solo el administrador o un POS multitiendas puede aprobar reposiciones.');
  }
  return profile;
}
