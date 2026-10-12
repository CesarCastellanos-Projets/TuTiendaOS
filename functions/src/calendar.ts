import { assertUserAccess } from './access-schedule';
import { assertCurrentProfile } from './authz';
import { runTransientCleanup } from './transient-maintenance';
import { appCheckOptions } from './app-check';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { runReplenishmentPushRetries } from './replenishment-notifications';
import { runNotificationMaintenance } from './notification-maintenance';
import { workBudget } from './work-budget';
import type { DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { admin, db } from './firebase';
import { requireActiveProfile, requireAdmin } from './authz';
import {
  calendarAllowed,
  calendarDeadline,
  DAY,
  firstReminder,
  nextOccurrence,
  nextReminder,
  peruDateAt,
  validateCalendar,
  type CalendarInput
} from './calendar-model';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(value))
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  return value;
}
async function requireCalendar(request: CallableRequest) {
  const profile = await requireActiveProfile(request, false);
  if (!profile.canManageCalendar)
    throw new HttpsError('permission-denied', 'Tu cuenta no tiene acceso al calendario.');
  return profile;
}

async function invalidateNotifications(tenantId: string, eventId: string, version: number) {
  while (true) {
    const page = await db
      .collectionGroup('notifications')
      .where('tenantId', '==', tenantId)
      .where('eventId', '==', eventId)
      .where('active', '==', true)
      .where('eventVersion', '<', version)
      .limit(100)
      .get();
    if (page.empty) return;
    const batch = db.batch();
    for (const notification of page.docs)
      batch.update(notification.ref, {
        active: false,
        pushState: 'cancelled',
        nextPushAt: null,
        snoozedUntil: null
      });
    await batch.commit();
  }
}

export const setCalendarPermission = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const uid = identifier(request.data?.uid);
  if (typeof request.data?.enabled !== 'boolean')
    throw new HttpsError('invalid-argument', 'Permiso inválido.');
  const target = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const user = (await tx.get(target)).data();
    if (!user || user.tenantId !== profile.tenantId || user.role !== 'pos')
      throw new HttpsError('permission-denied', 'Selecciona un POS de tu empresa.');
    tx.update(target, { canManageCalendar: request.data.enabled });
  });
  return { enabled: request.data.enabled };
});

export const saveCalendarEvent = onCall(appCheckOptions, async (request) => {
  const profile = await requireCalendar(request);
  const id = identifier(request.data?.id);
  const version = request.data?.version;
  if (!Number.isInteger(version) || version < 0)
    throw new HttpsError('invalid-argument', 'Versión inválida.');
  const event = validateCalendar(request.data?.event);
  const ref = db.doc(`tenants/${profile.tenantId}/calendar_events/${id}`);
  const fingerprint = hash(JSON.stringify(event));
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const [snapshot, user] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${profile.uid}`))]);
    assertUserAccess(user.data() ?? {}, profile.authTime);
    if (!calendarAllowed(user.data() ?? {}) || user.data()?.tenantId !== profile.tenantId)
      throw new HttpsError('permission-denied', 'Tu permiso del calendario cambió.');
    const current = snapshot.data();
    if (
      current?.version === version + 1 &&
      current?.updatedBy === profile.uid &&
      current?.fingerprint === fingerprint &&
      current?.lastAction === 'save'
    )
      return current.version as number;
    if ((current?.version ?? 0) !== version)
      throw new HttpsError('aborted', 'Otra persona cambió este evento. Vuelve a abrirlo.');
    const nextVersion = version + 1;
    tx.set(ref, {
      ...event,
      tenantId: profile.tenantId,
      timezone: 'America/Lima',
      version: nextVersion,
      fingerprint,
      lastAction: 'save',
      anchorDay: current?.dueDate === event.dueDate ? current.anchorDay : Number(event.dueDate.slice(-2)),
      nextReminderAt: firstReminder(event, now),
      dispatchLeaseUntil: 0,
      dispatchLease: null,
      createdAt: current?.createdAt ?? now,
      createdBy: current?.createdBy ?? profile.uid,
      createdByName: current?.createdByName ?? profile.displayName,
      updatedAt: now,
      updatedBy: profile.uid,
      updatedByName: profile.displayName
    });
    return nextVersion;
  });
  await invalidateNotifications(profile.tenantId, id, result);
  return { id, version: result };
});

export const completeCalendarEvent = onCall(appCheckOptions, async (request) => {
  const profile = await requireCalendar(request);
  const finishSeries = request.data?.finishSeries ?? false;
  if (typeof finishSeries !== 'boolean')
    throw new HttpsError('invalid-argument', 'Acción inválida.');
  const lastAction = finishSeries ? 'finish' : 'complete';
  if (!Number.isInteger(request.data?.version) || request.data.version < 1)
    throw new HttpsError('invalid-argument', 'Versión inválida.');
  const ref = db.doc(`tenants/${profile.tenantId}/calendar_events/${identifier(request.data?.id)}`);
  await db.runTransaction(async (tx) => {
    const [snapshot, user] = await Promise.all([tx.get(ref), tx.get(db.doc(`users/${profile.uid}`))]);
    const event = snapshot.data();
    assertUserAccess(user.data() ?? {}, profile.authTime);
    if (!calendarAllowed(user.data() ?? {}) || user.data()?.tenantId !== profile.tenantId)
      throw new HttpsError('permission-denied', 'Tu permiso del calendario cambió.');
    if (
      event &&
      event.version === request.data.version + 1 &&
      event.lastAction === lastAction &&
      event.lastCompletedBy === profile.uid
    )
      return;
    if (!event || event.version !== request.data?.version || event.status !== 'pendiente')
      throw new HttpsError('aborted', 'El evento cambió. Actualiza el calendario.');
    let dueDate = event.dueDate as string;
    const now = Date.now();
    if (event.recurrence !== 'none' && !finishSeries) {
      do {
        dueDate = nextOccurrence(dueDate, event.recurrence, event.anchorDay);
      } while (peruDateAt(dueDate, event.dueTime || '09:00') <= now && dueDate < '2100-12-31');
    }
    const dueAt = peruDateAt(dueDate, event.dueTime || '09:00');
    const status = event.recurrence === 'none' || finishSeries ? 'completado' : 'pendiente';
    tx.update(ref, {
      status,
      dueDate,
      dueAt,
      version: event.version + 1,
      lastAction,
      nextReminderAt: firstReminder({ dueDate, dueAt, status, reminderDays: event.reminderDays }, now),
      dispatchLeaseUntil: 0,
      dispatchLease: null,
      lastCompletedAt: now,
      lastCompletedBy: profile.uid,
      updatedAt: now,
      updatedBy: profile.uid,
      updatedByName: profile.displayName
    });
  });
  await invalidateNotifications(profile.tenantId, ref.id, request.data.version + 1);
  return { ok: true };
});

export const markCalendarNotification = onCall(appCheckOptions, async (request) => {
  const profile = await requireCalendar(request);
  const ref = db.doc(
    `tenants/${profile.tenantId}/calendar_inboxes/${profile.uid}/notifications/${identifier(request.data?.id)}`
  );
  const action = request.data?.action;
  if (!['read', 'snooze'].includes(action)) throw new HttpsError('invalid-argument', 'Acción inválida.');
  await db.runTransaction(async (tx) => {
    const item = (await tx.get(ref)).data();
    if (!item) throw new HttpsError('not-found', 'El recordatorio ya no existe.');
    const [event, user] = await Promise.all([
      tx.get(db.doc(`tenants/${profile.tenantId}/calendar_events/${identifier(item.eventId)}`)),
      tx.get(db.doc(`users/${profile.uid}`))
    ]);
    assertUserAccess(user.data() ?? {}, profile.authTime);
    if (!calendarAllowed(user.data() ?? {}) || user.data()?.tenantId !== profile.tenantId)
      throw new HttpsError('permission-denied', 'Tu permiso del calendario cambió.');
    const now = Date.now();
    const deadline = calendarDeadline(item.dueDate);
    if (
      !item.active ||
      event.data()?.status !== 'pendiente' ||
      event.data()?.version !== item.eventVersion ||
      deadline <= now
    ) {
      tx.update(ref, { active: false, pushState: 'cancelled', nextPushAt: null, snoozedUntil: null });
      return;
    }
    const snoozedUntil = Math.min(now + 3600000, deadline);
    tx.update(
      ref,
      action === 'read'
        ? { readAt: now, snoozedUntil: null, pushState: 'cancelled', nextPushAt: null }
        : { snoozedUntil, pushState: 'pending', nextPushAt: snoozedUntil }
    );
  });
  return { ok: true };
});

export const registerCalendarDevice = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request, false);
  const replenishment = profile.role === 'admin' || (profile.role === 'pos' && profile.storeAccess === 'all');
  if (!profile.canManageCalendar && !replenishment) throw new HttpsError('permission-denied', 'Tu cuenta no puede recibir estas notificaciones.');
  const token = request.data?.token;
  if (
    typeof token !== 'string' ||
    token.length < 30 ||
    token.length > 4096 ||
    !/^[A-Za-z0-9:_-]+$/.test(token)
  )
    throw new HttpsError('invalid-argument', 'Registro de notificaciones inválido.');
  const now = Date.now();
  const ref = db.doc(`calendar_push_devices/${hash(token)}`);
  await db.runTransaction(async (tx) => {
    const user = await tx.get(db.doc(`users/${profile.uid}`));
    const current = user.data() ?? {};
    assertUserAccess(current, profile.authTime);
    const currentApprover = current.role === 'admin' || (current.role === 'pos' && current.storeAccess === 'all' && profile.storeAccess === 'all');
    if (current.active !== true || (!calendarAllowed(current) && !currentApprover) || current.tenantId !== profile.tenantId)
      throw new HttpsError('permission-denied', 'Tus permisos de notificaciones cambiaron.');
    const devices = await tx.get(
      db
        .collection('calendar_push_devices')
        .where('uid', '==', profile.uid)
        .orderBy('updatedAt', 'asc')
        .limit(10)
    );
    tx.set(ref, {
      token,
      uid: profile.uid,
      tenantId: profile.tenantId,
      replenishment: currentApprover,
      updatedAt: now,
      expiresAt: now + 180 * DAY
    });
    const others = devices.docs.filter((device) => device.id !== ref.id);
    for (const device of others.slice(0, Math.max(0, others.length - 4))) tx.delete(device.ref);
  });
  return { ok: true };
});

export const unregisterCalendarDevice = onCall(appCheckOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  const token = request.data?.token;
  if (typeof token !== 'string' || token.length > 4096)
    throw new HttpsError('invalid-argument', 'Registro inválido.');
  const ref = db.doc(`calendar_push_devices/${hash(token)}`);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).data()?.uid === request.auth!.uid) tx.delete(ref);
  });
  return { ok: true };
});

export async function dispatchCalendarEvent(ref: DocumentReference, now = Date.now()): Promise<void> {
  const parts = ref.path.split('/');
  if (parts.length !== 4 || parts[0] !== 'tenants' || parts[2] !== 'calendar_events') return;
  const lease = randomUUID();
  const claim = await db.runTransaction(async (tx) => {
    const value = (await tx.get(ref)).data();
    if (
      !value ||
      value.tenantId !== parts[1] ||
      value.status !== 'pendiente' ||
      !value.nextReminderAt ||
      value.nextReminderAt > now ||
      value.dispatchLeaseUntil > now
    )
      return null;
    tx.update(ref, { dispatchLease: lease, dispatchLeaseUntil: now + 10 * 60000 });
    return { value, expired: calendarDeadline(value.dueDate) <= now };
  });
  if (!claim) return;
  const event = claim.value;
  const tenantId = ref.parent.parent!.id;
  if (claim.expired) {
    await invalidateNotifications(tenantId, ref.id, event.version + 1);
    await db.runTransaction(async (tx) => {
      const latest = (await tx.get(ref)).data();
      if (latest && latest.version === event.version && latest.dispatchLease === lease)
        tx.update(ref, { nextReminderAt: null, dispatchLease: null, dispatchLeaseUntil: 0 });
    });
    return;
  }
  const notificationId = hash(`${ref.id}:${event.version}:${event.nextReminderAt}`);
  let cursor: DocumentSnapshot | undefined;
  while (true) {
    let users = db
      .collection('users')
      .where('tenantId', '==', tenantId)
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor) users = users.startAfter(cursor);
    const page = await users.get();
    for (const user of page.docs) {
      if (!calendarAllowed(user.data())) continue;
      const notification = db.doc(
        `tenants/${tenantId}/calendar_inboxes/${user.id}/notifications/${notificationId}`
      );
      await db.runTransaction(async (tx) => {
        const [freshUser, freshEvent, existing] = await Promise.all([
          tx.get(user.ref),
          tx.get(ref),
          tx.get(notification)
        ]);
        if (
          existing.exists ||
          !calendarAllowed(freshUser.data() ?? {}) ||
          freshUser.data()?.tenantId !== tenantId ||
          freshEvent.data()?.version !== event.version ||
          freshEvent.data()?.status !== 'pendiente' ||
          calendarDeadline(event.dueDate) <= Math.max(now, Date.now())
        )
          return;
        tx.create(notification, {
          tenantId,
          uid: user.id,
          eventId: ref.id,
          eventVersion: event.version,
          title: event.title,
          dueAt: event.dueAt,
          dueDate: event.dueDate,
          createdAt: now,
          readAt: null,
          snoozedUntil: null,
          active: true,
          pushState: 'pending',
          nextPushAt: now,
          pushAttempts: 0,
          expiresAt: Timestamp.fromMillis(now + 90 * DAY)
        });
      });
    }
    if (page.size < 100) break;
    cursor = page.docs[page.docs.length - 1];
  }
  await db.runTransaction(async (tx) => {
    const latest = (await tx.get(ref)).data();
    if (latest && latest.version === event.version && latest.dispatchLease === lease)
      tx.update(ref, {
        nextReminderAt: nextReminder(event as CalendarInput, now),
        dispatchLease: null,
        dispatchLeaseUntil: 0
      });
  });
}

export async function deliverCalendarNotification(ref: DocumentReference, now = Date.now()): Promise<void> {
  const parts = ref.path.split('/');
  if (
    parts.length !== 6 ||
    parts[0] !== 'tenants' ||
    parts[2] !== 'calendar_inboxes' ||
    parts[4] !== 'notifications'
  )
    return;
  const tenantId = parts[1];
  const uid = parts[3];
  const lease = randomUUID();
  const item = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const notification = snapshot.data();
    if (
      !notification ||
      notification.pushState !== 'pending' ||
      notification.nextPushAt > now ||
      notification.pushLeaseUntil > now
    )
      return null;
    const [user, event] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)),
      tx.get(db.doc(`tenants/${tenantId}/calendar_events/${notification.eventId}`))
    ]);
    if (
      notification.active !== true ||
      calendarDeadline(notification.dueDate) <= now ||
      !calendarAllowed(user.data() ?? {}) ||
      user.data()?.tenantId !== tenantId ||
      notification.readAt ||
      event.data()?.status !== 'pendiente' ||
      event.data()?.version !== notification.eventVersion
    ) {
      tx.update(ref, { active: false, pushState: 'cancelled', nextPushAt: null, snoozedUntil: null });
      return null;
    }
    tx.update(ref, { pushLease: lease, pushLeaseUntil: now + 5 * 60000 });
    return notification;
  });
  if (!item) return;
  const devices = await db.collection('calendar_push_devices').where('uid', '==', uid).limit(10).get();
  const valid = devices.docs.filter(
    (device) => device.data().tenantId === tenantId && device.data().expiresAt > now
  );
  let transientFailure = false;
  for (const device of valid) {
    const remaining = calendarDeadline(item.dueDate) - Math.max(now, Date.now());
    if (remaining <= 0) break;
    try {
      if (!process.env.FIRESTORE_EMULATOR_HOST)
        await admin.messaging().send({
          token: device.data().token,
          data: { kind: 'calendar', notificationId: ref.id, deadlineAt: String(calendarDeadline(item.dueDate)) },
          webpush: { headers: { TTL: String(Math.min(3600, Math.ceil(remaining / 1000))), Urgency: 'normal' } }
        });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(
          code ?? ''
        )
      )
        await device.ref.delete();
      else transientFailure = true;
    }
  }
  await db.runTransaction(async (tx) => {
    const latest = (await tx.get(ref)).data();
    if (latest?.pushLease !== lease || latest?.pushState !== 'pending') return;
    const attempts = Number(item.pushAttempts ?? 0) + 1;
    tx.update(ref, {
      pushLease: null,
      pushLeaseUntil: 0,
      pushAttempts: attempts,
      pushState: transientFailure && attempts < 6 ? 'pending' : transientFailure ? 'failed' : 'sent',
      nextPushAt: transientFailure && attempts < 6 ? now + Math.min(3600000, 60000 * 2 ** attempts) : null
    });
  });
}

export async function runCalendarReminders(now = Date.now(), canStart: () => boolean = () => true): Promise<void> {
  if (!canStart()) return;
  const due = await db
    .collectionGroup('calendar_events')
    .where('status', '==', 'pendiente')
    .where('nextReminderAt', '<=', now)
    .orderBy('nextReminderAt')
    .limit(100)
    .get();
  for (const event of due.docs) {
    if (!canStart()) break;
    try {
      await dispatchCalendarEvent(event.ref, now);
    } catch (error) {
      console.error('calendar-dispatch', event.id, error);
    }
  }
  if (!canStart()) return;
  const pending = await db
    .collectionGroup('notifications')
    .where('pushState', '==', 'pending')
    .where('nextPushAt', '<=', now)
    .orderBy('nextPushAt')
    .limit(100)
    .get();
  for (const notification of pending.docs) {
    if (!canStart()) break;
    try {
      await deliverCalendarNotification(notification.ref, now);
    } catch (error) {
      console.error('calendar-push', notification.id, error);
    }
  }
}

export const sendCalendarReminders = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'America/Lima', timeoutSeconds: 240, maxInstances: 1, concurrency: 1 },
  async () => {
    await runNotificationMaintenance(
      () => runCalendarReminders(Date.now(), workBudget(240000).canStart),
      () => runReplenishmentPushRetries(workBudget(240000).canStart),
      () => runTransientCleanup(workBudget(240000).canStart)
    );
  }
);
