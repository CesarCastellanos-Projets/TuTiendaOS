import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { CalendarEvent } from '../types';

export type CalendarDraft = Pick<
  CalendarEvent,
  'title' | 'description' | 'type' | 'dueDate' | 'dueTime' | 'reminderDays' | 'recurrence' | 'status'
>;
export async function saveCalendar(id: string, version: number, event: CalendarDraft) {
  return (
    await httpsCallable<
      { id: string; version: number; event: CalendarDraft },
      { id: string; version: number }
    >(
      functions,
      'saveCalendarEvent'
    )({ id, version, event })
  ).data;
}
export async function completeCalendar(id: string, version: number) {
  await httpsCallable(functions, 'completeCalendarEvent')({ id, version });
}
export async function markCalendar(id: string, action: 'read' | 'snooze') {
  await httpsCallable(functions, 'markCalendarNotification')({ id, action });
}
export function peruToday(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
}
export function calendarDate(date: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima'
  }).format(new Date(`${date}T12:00:00-05:00`));
}

export function calendarReminderLabel(date: string): string {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${peruToday()}T00:00:00Z`)) / 86400000
  );
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  if (days > 1) return `Vence en ${days} días`;
  return `Venció hace ${-days} día${days === -1 ? '' : 's'}`;
}

export function calendarError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['functions/unavailable', 'functions/internal', 'functions/not-found'].includes(code)) return 'No se pudo contactar al servicio del calendario. Revisa tu conexión y que las Functions estén publicadas en el proyecto configurado.';
  return error instanceof Error ? error.message : 'No se pudo guardar el evento.';
}
