import { HttpsError } from 'firebase-functions/v2/https';

export const DAY = 86400000;
export type CalendarStatus = 'pendiente' | 'completado' | 'cancelado';
export interface CalendarInput {
  title: string;
  description: string;
  type: 'pago' | 'tarea' | 'vencimiento' | 'otro';
  dueDate: string;
  dueTime: string;
  dueAt: number;
  reminderDays: number[];
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  status: CalendarStatus;
}

export function calendarAllowed(user: Record<string, unknown>): boolean {
  return (
    user.active === true &&
    (user.role === 'admin' ||
      (user.role === 'pos' &&
        (user.canManageCalendar === true ||
          (user.canManageCalendar === undefined && user.storeAccess === 'all'))))
  );
}

export function peruDateAt(date: string, time = '09:00'): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new HttpsError('invalid-argument', 'Fecha u hora inválida.');
  const result = Date.parse(`${date}T${time}:00-05:00`);
  if (
    !Number.isFinite(result) ||
    new Date(result - 5 * 3600000).toISOString().slice(0, 10) !== date ||
    date < '2000-01-01' ||
    date > '2100-12-31'
  )
    throw new HttpsError('invalid-argument', 'Fecha fuera del rango permitido.');
  return result;
}

export function validateCalendar(value: unknown): CalendarInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpsError('invalid-argument', 'Evento inválido.');
  const input = value as Record<string, unknown>;
  const allowed = [
    'title',
    'description',
    'type',
    'dueDate',
    'dueTime',
    'reminderDays',
    'recurrence',
    'status'
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new HttpsError('invalid-argument', 'Campos del evento inválidos.');
  const text = (key: string, max: number, required = false): string => {
    const value = input[key];
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
      throw new HttpsError('invalid-argument', `Revisa ${key}.`);
    return value.trim();
  };
  const title = text('title', 120, true);
  const description = text('description', 1000);
  const dueDate = text('dueDate', 10, true);
  const dueTime = text('dueTime', 5);
  const dueAt = peruDateAt(dueDate, dueTime || '09:00');
  if (
    !['pago', 'tarea', 'vencimiento', 'otro'].includes(String(input.type)) ||
    !['none', 'daily', 'weekly', 'monthly'].includes(String(input.recurrence)) ||
    !['pendiente', 'completado', 'cancelado'].includes(String(input.status))
  )
    throw new HttpsError('invalid-argument', 'Tipo, repetición o estado inválido.');
  if (
    !Array.isArray(input.reminderDays) ||
    input.reminderDays.length > 6 ||
    !input.reminderDays.length ||
    input.reminderDays.some(
      (day: unknown) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 30
    )
  )
    throw new HttpsError('invalid-argument', 'Elige entre uno y seis avisos, hasta 30 días antes.');
  return {
    title,
    description,
    dueDate,
    dueTime,
    dueAt,
    type: input.type as CalendarInput['type'],
    recurrence: input.recurrence as CalendarInput['recurrence'],
    status: input.status as CalendarStatus,
    reminderDays: [...new Set(input.reminderDays as number[])].sort((a, b) => b - a)
  };
}

export function firstReminder(
  event: Pick<CalendarInput, 'dueAt' | 'reminderDays' | 'status'>,
  now: number
): number | null {
  if (event.status !== 'pendiente') return null;
  const times = event.reminderDays.map((day) => event.dueAt - day * DAY).sort((a, b) => a - b);
  if (times.some((time) => time <= now)) return now;
  return times[0];
}

export function nextReminder(event: Pick<CalendarInput, 'dueAt' | 'reminderDays'>, now: number): number {
  const next = event.reminderDays
    .map((day) => event.dueAt - day * DAY)
    .filter((time) => time > now)
    .sort((a, b) => a - b)[0];
  if (next !== undefined) return next;
  return event.dueAt + Math.max(1, Math.floor((now - event.dueAt) / DAY) + 1) * DAY;
}

export function nextOccurrence(
  date: string,
  recurrence: CalendarInput['recurrence'],
  anchorDay = Number(date.slice(-2))
): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (recurrence === 'monthly') {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay))).toISOString().slice(0, 10);
  }
  value.setUTCDate(value.getUTCDate() + (recurrence === 'weekly' ? 7 : 1));
  return value.toISOString().slice(0, 10);
}
