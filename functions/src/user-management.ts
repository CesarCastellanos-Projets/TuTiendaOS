import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from './app-check';
import { admin, db } from './firebase';
import { assertCurrentProfile, requireActiveProfile, requireAdmin } from './authz';
import { documentId } from './operation-receipts';
import { assertUserAccess, parseSchedule, scheduleAllows } from './access-schedule';

export const getAccessState = onCall(appCheckOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
  const user = (await db.doc(`users/${request.auth.uid}`).get()).data();
  if (!user || user.active !== true || user.deletedAt || !['admin', 'pos', 'trabajador'].includes(String(user.role))
    || typeof user.tenantId !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(user.tenantId)
    || (request.auth.token.tenantId !== undefined && request.auth.token.tenantId !== user.tenantId)
    || Number(request.auth.token.auth_time ?? 0) < Number(user.authValidAfter ?? 0))
    throw new HttpsError('permission-denied', 'Tu sesión ya no está autorizada.');
  const now = Date.now();
  const allowed = scheduleAllows(user, now);
  let validUntil = now + 60000;
  if (allowed && user.accessSchedule && user.role !== 'admin') {
    const nextMinute = Math.floor(now / 60000) * 60000 + 60000;
    if (!scheduleAllows(user, nextMinute)) validUntil = nextMinute;
  }
  return { allowed, serverNow: now, validUntil };
});

export const setUserSettings = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const ref = db.doc(`users/${documentId(request.data?.uid, 'Usuario')}`);
  const schedule = parseSchedule(request.data?.accessSchedule);
  for (const key of ['canViewPurchaseCosts', 'canOverridePrices', 'canManageCalendar'])
    if (typeof request.data?.[key] !== 'boolean') throw new HttpsError('invalid-argument', 'Permiso inválido.');
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const user = (await tx.get(ref)).data();
    if (!user || user.tenantId !== actor.tenantId || user.deletedAt) throw new HttpsError('permission-denied', 'Usuario no disponible.');
    tx.update(ref, {
      accessSchedule: user.role === 'admin' ? null : schedule,
      canViewPurchaseCosts: user.role === 'pos' && request.data.canViewPurchaseCosts,
      canOverridePrices: user.role === 'pos' && user.storeAccess === 'all' && request.data.canOverridePrices,
      canManageCalendar: user.role === 'admin' || (user.role === 'pos' && request.data.canManageCalendar)
    });
  });
  return { ok: true };
});

export const changeUserPassword = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const uid = documentId(request.data?.uid, 'Usuario');
  if (actor.uid === uid && Date.now() / 1000 - Number(request.auth?.token.auth_time ?? 0) > 300)
    throw new HttpsError('failed-precondition', 'Confirma tu contraseña actual nuevamente.');
  const password = request.data?.password;
  if (typeof password !== 'string' || password.length < 6 || password.length > 128)
    throw new HttpsError('invalid-argument', 'La contraseña debe tener entre 6 y 128 caracteres.');
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const target = (await tx.get(ref)).data();
    if (!target || target.tenantId !== actor.tenantId || target.deletedAt) throw new HttpsError('permission-denied', 'Usuario no disponible.');
    tx.update(ref, { authValidAfter: Math.floor(Date.now() / 1000) + 1 });
  });
  await admin.auth().updateUser(uid, { password });
  await admin.auth().revokeRefreshTokens(uid);
  return { ok: true };
});

export const deleteSystemUser = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const uid = documentId(request.data?.uid, 'Usuario');
  if (uid === actor.uid) throw new HttpsError('failed-precondition', 'Otra cuenta administradora debe eliminar tu cuenta.');
  const ref = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const user = (await tx.get(ref)).data();
    if (!user || user.tenantId !== actor.tenantId) throw new HttpsError('permission-denied', 'El usuario no pertenece a tu empresa.');
    if (user.deletedAt) return;
    const cash = await tx.get(db.collection(`tenants/${actor.tenantId}/cash_sessions`).where('userId', '==', uid).where('status', '==', 'abierta').limit(1));
    if (!cash.empty) throw new HttpsError('failed-precondition', 'Cierra la caja del usuario antes de eliminarlo.');
    if (user.role === 'admin') {
      const admins = await tx.get(db.collection('users').where('tenantId', '==', actor.tenantId).where('role', '==', 'admin').where('active', '==', true).limit(2));
      if (!admins.docs.some((item) => item.id !== uid)) throw new HttpsError('failed-precondition', 'Debe quedar un administrador activo.');
    }
    tx.set(ref, { tenantId: actor.tenantId, role: user.role, displayName: 'Cuenta eliminada', active: false, deletedAt: Date.now(), authValidAfter: Math.floor(Date.now() / 1000) + 1 });
  });
  await admin.auth().deleteUser(uid).catch((error: unknown) => {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found')) throw error;
  });
  return { ok: true };
});

export const getProductPurchase = onCall(appCheckOptions, async (request) => {
  const actor = await requireActiveProfile(request);
  const ref = db.doc(`tenants/${actor.tenantId}/product_purchase/${documentId(request.data?.productId, 'Producto')}`);
  return db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const user = (await tx.get(db.doc(`users/${actor.uid}`))).data() ?? {};
    assertUserAccess(user, actor.authTime);
    if (actor.role !== 'admin' && !(actor.role === 'pos' && user.canViewPurchaseCosts === true))
      throw new HttpsError('permission-denied', 'No tienes permiso para consultar costos.');
    return { purchase: (await tx.get(ref)).data() ?? null };
  });
});
