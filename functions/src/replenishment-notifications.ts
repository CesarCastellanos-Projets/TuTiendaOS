import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { admin, db } from './firebase';

export const notifyReplenishmentRequest = onDocumentCreated('tenants/{tenantId}/replenishment_requests/{requestId}', async (event) => {
  if (!event.data || event.data.data().status !== 'pendiente') return;
  const { tenantId, requestId } = event.params;
  const query = db.collection('calendar_push_devices').where('tenantId', '==', tenantId).where('replenishment', '==', true).limit(100);
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    const devices = await (cursor ? query.startAfter(cursor) : query).get();
    if (devices.empty) break;
    const ids = [...new Set(devices.docs.map((device) => String(device.data().uid)))];
    const users = await db.getAll(...ids.map((uid) => db.doc(`users/${uid}`)));
    const allowed = new Set(users.filter((user) => {
      const profile = user.data();
      return profile?.active === true && profile.tenantId === tenantId
        && (profile.role === 'admin' || (profile.role === 'pos' && profile.storeAccess === 'all'));
    }).map((user) => user.id));
    const targets = devices.docs.filter((device) => allowed.has(String(device.data().uid)) && Number(device.data().expiresAt) > Date.now());
    await Promise.all(targets.map(async (device) => {
      try {
        await admin.messaging().send({ token: String(device.data().token),
          data: { kind: 'replenishment', notificationId: requestId },
          webpush: { headers: { TTL: '3600' } } });
      } catch (cause) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) await device.ref.delete();
        else console.warn('No se pudo enviar un aviso de reposición', code);
      }
    }));
    if (devices.size < 100) break;
    cursor = devices.docs.at(-1);
  }
});
