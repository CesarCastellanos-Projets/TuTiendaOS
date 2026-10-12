import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo emuladores locales.');
const app = initializeApp({ projectId: 'demo-denzoz-ops' }, 'calendar-browser');
const db = getFirestore(app);
const tenantId = 'calendar-browser';
const batch = db.batch();
for (const role of ['admin', 'pos']) {
  const email = `calendar-${role}@example.com`;
  const user = await getAuth(app).getUserByEmail(email).catch(() => getAuth(app).createUser({ email, password: 'LocalTest123!' }));
  batch.set(db.doc(`users/${user.uid}`), { tenantId, active: true, role, displayName: 'Prueba local', canManageCalendar: true, storeAccess: 'assigned' });
  for (const [id, dueDate] of [['expired', '2030-01-29'], ['today', '2030-01-30']])
    batch.set(db.doc(`tenants/${tenantId}/calendar_inboxes/${user.uid}/notifications/${id.padEnd(24, '_')}`), {
      tenantId, uid: user.uid, eventId: id.padEnd(24, '_'), eventVersion: 1, title: `Aviso ${id}`, dueDate,
      dueAt: Date.parse(`${dueDate}T09:00:00-05:00`), createdAt: Date.parse('2030-01-30T23:59:31-05:00'),
      active: true, readAt: null, snoozedUntil: null, pushState: 'sent'
    });
}
for (const [id, dueDate, recurrence] of [['expired', '2030-01-29', 'none'], ['today', '2030-01-30', 'none'], ['repeat', '2030-01-31', 'daily']])
  batch.set(db.doc(`tenants/${tenantId}/calendar_events/${id.padEnd(24, '_')}`), {
    tenantId, title: `Evento ${id}`, description: '', type: 'tarea', dueDate, dueTime: '',
    dueAt: Date.parse(`${dueDate}T09:00:00-05:00`), recurrence, reminderDays: [0],
    status: 'pendiente', version: 1, anchorDay: Number(dueDate.slice(-2)), nextReminderAt: null
  });
await batch.commit();
await db.terminate();
console.log('Calendario local: admin, POS, fechas vencida/vigente y evento repetido.');
