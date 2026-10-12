import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseSchedule, scheduleAllows, assertUserAccess } = require('../lib/access-schedule.js');
const user = { role: 'pos', active: true, accessSchedule: { days: [1], start: 480, end: 605 } };
test('horario peruano incluye el último minuto, independiente de zona del proceso', () => {
  assert.equal(scheduleAllows(user, Date.parse('2026-10-12T07:59:59-05:00')), false);
  assert.equal(scheduleAllows(user, Date.parse('2026-10-12T08:00:00-05:00')), true);
  assert.equal(scheduleAllows(user, Date.parse('2026-10-12T10:05:59-05:00')), true);
  assert.equal(scheduleAllows(user, Date.parse('2026-10-12T10:06:00-05:00')), false);
  assert.equal(scheduleAllows(user, Date.parse('2026-10-13T09:00:00-05:00')), false);
  assert.equal(scheduleAllows({ ...user, role: 'admin' }, Date.parse('2026-10-13T09:00:00-05:00')), true);
});
test('turno nocturno respeta el día de inicio incluso al cambiar semana', () => {
  const night = { ...user, accessSchedule: { days: [6], start: 1320, end: 120 } };
  assert.equal(scheduleAllows(night, Date.parse('2026-10-11T02:00:59-05:00')), true);
  assert.equal(scheduleAllows(night, Date.parse('2026-10-11T02:01:00-05:00')), false);
  assert.equal(scheduleAllows(night, Date.parse('2026-10-12T01:00:00-05:00')), false);
});
test('perfiles revocados y horarios inválidos no autorizan', () => {
  for (const invalid of [undefined, {}, { days: [], start: 0, end: 1 }, { days: [7], start: 0, end: 1 }, { days: [1], start: 0.5, end: 2 }]) assert.throws(() => parseSchedule(invalid));
  assert.throws(() => assertUserAccess({ active: true, role: 'admin', authValidAfter: 101 }, 100));
  assert.throws(() => assertUserAccess({ active: false, role: 'admin' }, 101));
});
