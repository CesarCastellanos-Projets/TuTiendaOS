import { HttpsError } from 'firebase-functions/v2/https';

export interface AccessSchedule { days: number[]; start: number; end: number }
export function parseSchedule(value: unknown): AccessSchedule | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new HttpsError('invalid-argument', 'Horario inválido.');
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.days) || !item.days.length || item.days.length > 7 ||
      item.days.some((day: unknown) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) ||
      typeof item.start !== 'number' || !Number.isInteger(item.start) || item.start < 0 || item.start > 1439 ||
      typeof item.end !== 'number' || !Number.isInteger(item.end) || item.end < 0 || item.end > 1439)
    throw new HttpsError('invalid-argument', 'Revisa días y horas.');
  return { days: [...new Set(item.days as number[])], start: item.start, end: item.end };
}
export function scheduleAllows(user: Record<string, unknown>, now: number): boolean {
  if (user.role === 'admin' || user.accessSchedule === null || user.accessSchedule === undefined) return true;
  const schedule = parseSchedule(user.accessSchedule);
  if (!schedule) return true;
  const peru = new Date(now - 5 * 3600000);
  const day = peru.getUTCDay();
  const minute = peru.getUTCHours() * 60 + peru.getUTCMinutes();
  return schedule.start <= schedule.end
    ? schedule.days.includes(day) && minute >= schedule.start && minute <= schedule.end
    : (schedule.days.includes(day) && minute >= schedule.start) || (schedule.days.includes((day + 6) % 7) && minute <= schedule.end);
}
export function assertUserAccess(user: Record<string, unknown>, authTime?: number): void {
  if (user.deletedAt || user.active !== true ||
      (authTime !== undefined && authTime < Number(user.authValidAfter ?? 0)))
    throw new HttpsError('permission-denied', 'Tu sesión ya no está autorizada. Inicia sesión nuevamente.');
  if (!scheduleAllows(user, Date.now())) throw new HttpsError('permission-denied', 'Fuera de tu horario de acceso.');
}
