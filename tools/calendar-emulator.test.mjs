import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo se permiten emuladores locales.');
process.env.GCLOUD_PROJECT = 'demo-denzoz-ops';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { db } = require('./lib/firebase.js');
const { dispatchCalendarEvent, deliverCalendarNotification } = require('./lib/calendar.js');
const tenant = 'tenant-calendar';
async function identity(role, canManageCalendar, company = tenant) {
  const email = `${randomUUID()}@example.com`;
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true }) });
  const user = await response.json();
  await db.doc(`users/${user.localId}`).set({ tenantId: company, role, active: true, displayName: role, email, storeAccess: 'assigned', canManageCalendar });
  return { uid: user.localId, token: user.idToken };
}
async function call(name, data, user) {
  const response = await fetch(`http://127.0.0.1:5001/demo-denzoz-ops/us-central1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ data }) });
  const body = await response.json();
  return { ok: response.ok && Boolean(body.result), result: body.result, error: body.error };
}
const draft = { title: 'Pagar alquiler', description: 'Compartido en toda la empresa', type: 'pago', dueDate: '2030-01-31', dueTime: '', recurrence: 'monthly', reminderDays: [7, 3, 1, 0], status: 'pendiente' };

test('calendario: permisos, concurrencia, recordatorios sin duplicados, cambios y revocación', { timeout: 120000 }, async () => {
  const [admin, privileged, normal, worker, foreign] = await Promise.all([identity('admin', true), identity('pos', true), identity('pos', false), identity('trabajador', true), identity('admin', true, 'tenant-foreign-calendar')]);
  const id = randomUUID();
  const payload = { id, version: 0, event: draft };
  for (const user of [normal, worker]) assert.equal((await call('saveCalendarEvent', payload, user)).ok, false);
  assert.equal((await call('saveCalendarEvent', { ...payload, event: { ...draft, role: 'admin' } }, admin)).ok, false);
  const created = await call('saveCalendarEvent', payload, admin); assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal((await call('saveCalendarEvent', payload, admin)).result.version, 1);
  assert.equal((await call('setCalendarPermission', { uid: normal.uid, enabled: true }, privileged)).ok, false);
  assert.equal((await call('setCalendarPermission', { uid: normal.uid, enabled: true }, foreign)).ok, false);
  assert.equal((await call('setCalendarPermission', { uid: normal.uid, enabled: true }, admin)).ok, true);
  assert.equal((await call('saveCalendarEvent', { id: randomUUID(), version: 0, event: draft }, normal)).ok, true);
  const ref = db.doc(`tenants/${tenant}/calendar_events/${id}`);
  const now = Date.now();
  await ref.update({ nextReminderAt: now - 1 });
  await Promise.all([dispatchCalendarEvent(ref, now), dispatchCalendarEvent(ref, now)]);
  const inbox = (uid) => db.collection(`tenants/${tenant}/calendar_inboxes/${uid}/notifications`);
  for (const user of [admin, privileged, normal]) assert.equal((await inbox(user.uid).get()).size, 1);
  for (const user of [worker, foreign]) assert.equal((await inbox(user.uid).get()).size, 0);
  await dispatchCalendarEvent(ref, now); assert.equal((await inbox(admin.uid).get()).size, 1);
  const notification = (await inbox(privileged.uid).get()).docs[0];
  assert.equal((await call('registerCalendarDevice', { token: 'test_token_'.repeat(5) }, privileged)).ok, true);
  await Promise.all([deliverCalendarNotification(notification.ref, now), deliverCalendarNotification(notification.ref, now)]);
  assert.equal((await notification.ref.get()).data().pushAttempts, 1);
  assert.equal((await call('markCalendarNotification', { id: notification.id, action: 'snooze' }, privileged)).ok, true);
  assert.ok((await notification.ref.get()).data().snoozedUntil > now);
  const beforeEdit = (await ref.get()).data();
  const edited = await call('saveCalendarEvent', { id, version: beforeEdit.version, event: { ...draft, title: 'Pago modificado' } }, admin);
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal((await notification.ref.get()).data().active, false);
  await deliverCalendarNotification(notification.ref, now + 3600001);
  assert.equal((await notification.ref.get()).data().pushState, 'cancelled');
  assert.equal((await call('saveCalendarEvent', { id, version: 1, event: { ...draft, title: 'Conflicto' } }, privileged)).ok, false);
  const completion = { id, version: edited.result.version };
  assert.equal((await call('completeCalendarEvent', completion, admin)).ok, true);
  assert.equal((await call('completeCalendarEvent', completion, admin)).ok, true);
  assert.equal((await ref.get()).data().dueDate, '2030-02-28');
  assert.equal((await ref.get()).data().version, completion.version + 1);
  assert.equal((await call('setCalendarPermission', { uid: privileged.uid, enabled: false }, admin)).ok, true);
  assert.equal((await call('saveCalendarEvent', { id: randomUUID(), version: 0, event: draft }, privileged)).ok, false);
  await notification.ref.update({ active: true, pushState: 'pending', nextPushAt: now, eventVersion: (await ref.get()).data().version });
  await deliverCalendarNotification(notification.ref, now);
  assert.equal((await notification.ref.get()).data().pushState, 'cancelled');
});
