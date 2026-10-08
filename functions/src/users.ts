import { appCheckOptions } from './app-check';
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { admin, db } from './firebase';
import { assertCurrentProfile, requireAdmin } from './authz';
import { tenantDoc } from './tenant';
import { documentId } from './operation-receipts';

export const createUser = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const data = request.data ?? {};
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const password = data.password;
  const role = data.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 || !displayName || displayName.length > 120
    || typeof password !== 'string' || password.length < 6 || password.length > 128 || !['admin', 'pos', 'trabajador'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Revisa el correo, nombre, clave y rol.');
  }
  const multi = role === 'pos' && data.storeAccess === 'all';
  const storeId = role === 'admin' || multi ? null : documentId(data.storeId, 'Tienda');
  if (storeId) {
    const store = await tenantDoc(actor.tenantId, 'stores', storeId).get();
    if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'Selecciona una tienda activa.');
  }
  if (data.canManageCalendar !== undefined && typeof data.canManageCalendar !== 'boolean') throw new HttpsError('invalid-argument', 'Permiso inválido.');
  const uid = createHash('sha256').update(`${actor.tenantId}:${email}`).digest('hex').slice(0, 28);
  const ref = db.doc(`users/${uid}`);
  const access = { tenantId: actor.tenantId, displayName, email, role, storeId, storeAccess: multi ? 'all' : 'assigned',
    canManageCalendar: role === 'admin' || (role === 'pos' && (data.canManageCalendar ?? multi)) };
  const fingerprint = createHash('sha256').update(JSON.stringify(access)).digest('hex');
  const receipt = tenantDoc(actor.tenantId, 'user_provisioning', uid);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const saved = await tx.get(receipt);
    if (saved.exists && (saved.data()?.fingerprint !== fingerprint || saved.data()?.actor !== actor.uid)) {
      throw new HttpsError('already-exists', 'Ese correo ya tiene una operación de creación diferente.');
    }
    if (!saved.exists) tx.create(receipt, { actor: actor.uid, fingerprint, createdAt: Date.now() });
  });
  let account;
  try { account = await admin.auth().createUser({ uid, email, password, displayName, emailVerified: false, disabled: false }); }
  catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(code)) throw cause;
    try { account = await admin.auth().getUser(uid); }
    catch { throw new HttpsError('already-exists', 'El correo ya está registrado.'); }
    if (account.email?.toLowerCase() !== email) throw new HttpsError('already-exists', 'El correo ya está registrado.');
  }
  const previous = await ref.get();
  if (previous.exists && previous.data()?.active === false && (await receipt.get()).data()?.complete === true) {
    throw new HttpsError('failed-precondition', 'El usuario ya existe y está desactivado. Actívalo desde su ficha.');
  }
  await admin.auth().setCustomUserClaims(account.uid, { tenantId: actor.tenantId, role, posStoreAccess: multi ? 'all' : 'assigned', canOverridePrices: multi });
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const existing = await tx.get(ref);
    if (storeId) {
      const store = await tx.get(tenantDoc(actor.tenantId, 'stores', storeId));
      if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'La tienda dejó de estar activa.');
    }
    if (!existing.exists) tx.create(ref, { ...access, active: true, createdAt: Date.now() });
    tx.set(receipt, { complete: true, completedAt: Date.now() }, { merge: true });
  });
  return { uid };
});

export const setUserActive = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const uid = documentId(request.data?.uid, 'Usuario');
  const active = request.data?.active;
  if (typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'Estado inválido.');
  const ref = db.doc(`users/${uid}`);
  const target = await ref.get();
  if (target.data()?.tenantId !== actor.tenantId) throw new HttpsError('permission-denied', 'El usuario no pertenece a tu empresa.');
  if (active) await admin.auth().updateUser(uid, { disabled: false });
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, actor);
    const user = await tx.get(ref);
    if (user.data()?.tenantId !== actor.tenantId) throw new HttpsError('permission-denied', 'El usuario no pertenece a tu empresa.');
    if (active && user.data()?.storeId) {
      const store = await tx.get(tenantDoc(actor.tenantId, 'stores', String(user.data()?.storeId)));
      if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'La tienda del usuario ya no está activa.');
    }
    if (!active && user.data()?.role === 'admin') {
      const admins = await tx.get(db.collection('users').where('tenantId', '==', actor.tenantId).where('role', '==', 'admin').where('active', '==', true).limit(2));
      if (!admins.docs.some((adminUser) => adminUser.id !== uid)) throw new HttpsError('failed-precondition', 'Debe quedar un administrador activo.');
    }
    tx.update(ref, { active });
  });
  if (!active) await admin.auth().revokeRefreshTokens(uid);
  return { ok: true };
});
