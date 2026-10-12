import { createHash } from 'node:crypto';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Timestamp, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { admin, db } from './firebase';

export async function deliverReplenishmentPush(ref: DocumentReference, now = Date.now(), send = async (token: string, requestId: string) => {
  if (process.env.FUNCTIONS_EMULATOR === 'true') throw new Error('FCM remoto deshabilitado en emuladores.');
  await admin.messaging().send({ token, data: { kind: 'replenishment', notificationId: requestId },
    webpush: { headers: { TTL: '3600' } } });
}): Promise<void> {
  const claim = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref); const job = snapshot.data();
    if (!job || job.state !== 'pending' || Number(job.leaseUntil ?? 0) > now) return null;
    if ((job.expiresAt?.toMillis?.() ?? Infinity) <= now) {
      tx.update(ref, { state: 'cancelled', leaseUntil: 0 });
      return null;
    }
    if (Number(job.nextAttemptAt) > now) return null;
    const [device, user, request] = await tx.getAll(db.doc(`calendar_push_devices/${job.deviceId}`), db.doc(`users/${job.uid}`),
      db.doc(`tenants/${job.tenantId}/replenishment_requests/${job.requestId}`));
    const profile = user.data(); const target = device.data();
    if (!target || target.uid !== job.uid || target.tenantId !== job.tenantId || target.replenishment !== true
      || Number(target.expiresAt) <= now || profile?.active !== true || profile.tenantId !== job.tenantId
      || !(profile.role === 'admin' || (profile.role === 'pos' && profile.storeAccess === 'all'))
      || request.data()?.status !== 'pendiente') {
      tx.update(ref, { state: 'cancelled' }); return null;
    }
    const attempt = Number(job.attempts ?? 0) + 1;
    tx.update(ref, { leaseUntil: now + 60000, attempts: attempt });
    return { token: String(target.token), requestId: String(job.requestId), device: device.ref, attempt };
  });
  if (!claim) return;
  try { await send(claim.token, claim.requestId); await ref.update({ state: 'sent', sentAt: Date.now(), leaseUntil: 0 }); }
  catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    const invalid = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code);
    if (invalid) await claim.device.delete();
    await ref.update({ state: invalid || claim.attempt >= 6 ? 'failed' : 'pending', leaseUntil: 0,
      nextAttemptAt: now + Math.min(3600000, 60000 * 2 ** claim.attempt), lastError: code || 'delivery-unavailable' });
  }
}

export const notifyReplenishmentRequest = onDocumentCreated({ document: 'tenants/{tenantId}/replenishment_requests/{requestId}', retry: true }, async (event) => {
  if (!event.data || event.data.data().status !== 'pendiente') return;
  const { tenantId, requestId } = event.params;
  const query = db.collection('calendar_push_devices').where('tenantId', '==', tenantId).where('replenishment', '==', true).orderBy('__name__').limit(100);
  let cursor: QueryDocumentSnapshot | undefined;
  do {
    const devices = await (cursor ? query.startAfter(cursor) : query).get();
    for (const device of devices.docs) {
      const id = createHash('sha256').update(`${tenantId}:${requestId}:${device.id}`).digest('hex');
      const job = db.doc(`replenishment_push_jobs/${id}`);
      try { await job.create({ tenantId, requestId, deviceId: device.id, uid: String(device.data().uid), state: 'pending', attempts: 0,
        nextAttemptAt: 0, leaseUntil: 0, createdAt: Date.now(), expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000) }); }
      catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 6)) throw cause; }
      await deliverReplenishmentPush(job);
    }
    cursor = devices.size === 100 ? devices.docs.at(-1) : undefined;
  } while (cursor);
});

export async function runReplenishmentPushRetries(canStart: () => boolean = () => true): Promise<void> {
  if (!canStart()) return;
  const jobs = await db.collection('replenishment_push_jobs').where('state', '==', 'pending').where('nextAttemptAt', '<=', Date.now()).orderBy('nextAttemptAt').limit(50).get();
  for (const job of jobs.docs) {
    if (!canStart()) break;
    await deliverReplenishmentPush(job.ref).catch((cause: unknown) => console.warn('Aviso pendiente de recuperación', cause instanceof Error ? cause.message : 'error'));
  }
}
