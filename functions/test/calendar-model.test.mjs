import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  calendarAllowed,
  validateCalendar,
  peruDateAt,
  nextOccurrence,
  firstReminder,
  nextReminder,
  calendarDeadline,
  DAY
} = require('../lib/calendar-model.js');
const draft = {
  title: 'Pagar alquiler',
  description: '',
  type: 'pago',
  dueDate: '2026-10-31',
  dueTime: '',
  recurrence: 'monthly',
  reminderDays: [7, 3, 1, 0],
  status: 'pendiente'
};
test('calendario valida fechas reales de Perú, campos y límites', () => {
  assert.equal(validateCalendar(draft).dueAt, Date.parse('2026-10-31T09:00:00-05:00'));
  for (const change of [
    { dueDate: '2026-02-30' },
    { dueTime: '24:00' },
    { title: '' },
    { reminderDays: [NaN] },
    { reminderDays: [31] },
    { reminderDays: [] },
    { role: 'admin' }
  ])
    assert.throws(() => validateCalendar({ ...draft, ...change }));
  assert.deepEqual(validateCalendar({ ...draft, reminderDays: [3, 3, 0] }).reminderDays, [3, 0]);
});
test('permisos calendario independientes, revocación explícita y perfiles antiguos', () => {
  assert.ok(calendarAllowed({ active: true, role: 'admin' }));
  assert.ok(calendarAllowed({ active: true, role: 'pos', storeAccess: 'all' }));
  assert.ok(calendarAllowed({ active: true, role: 'pos', storeAccess: 'assigned', canManageCalendar: true }));
  for (const user of [
    { active: true, role: 'trabajador', canManageCalendar: true },
    { active: false, role: 'admin' },
    { active: true, role: 'pos', storeAccess: 'all', canManageCalendar: false }
  ])
    assert.equal(calendarAllowed(user), false);
});
test('repetición mensual conserva día 31 tras febrero y meses cortos', () => {
  assert.equal(nextOccurrence('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(nextOccurrence('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(nextOccurrence('2028-01-31', 'monthly', 31), '2028-02-29');
  assert.equal(nextOccurrence('2026-12-31', 'weekly'), '2027-01-07');
});
test('recordatorios saltan atrasos y terminan al acabar la fecha en Perú', () => {
  const event = validateCalendar(draft);
  assert.equal(firstReminder(event, event.dueAt - 20 * DAY), event.dueAt - 7 * DAY);
  assert.equal(firstReminder(event, event.dueAt - 2 * DAY), event.dueAt - 2 * DAY);
  assert.equal(nextReminder(event, event.dueAt - 2 * DAY), event.dueAt - DAY);
  const deadline = Date.parse('2026-11-01T00:00:00-05:00');
  assert.equal(calendarDeadline(event.dueDate), deadline);
  assert.equal(nextReminder(event, event.dueAt + 1000), deadline);
  assert.equal(firstReminder(event, deadline - 1), deadline - 1);
  assert.equal(nextReminder(event, deadline), null);
  assert.equal(firstReminder(event, deadline), null);
  assert.equal(nextReminder(event, event.dueAt + 3 * DAY + 1000), null);
  assert.equal(firstReminder({ ...event, status: 'completado' }, Date.now()), null);
  assert.equal(peruDateAt('2026-10-01', '00:00'), Date.parse('2026-10-01T05:00:00Z'));
});
