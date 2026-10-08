export function money(n: number): string {
  return `S/ ${n.toFixed(2)}`;
}

export function nowMs(): number {
  return Date.now();
}

export function fmtDateTime(ms: number): string {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short', timeZone: 'America/Lima'
  }).format(new Date(ms));
}

export function fmtTime(ms: number): string {
  return new Intl.DateTimeFormat('es-PE', { timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(ms));
}

export function todayStart(): number {
  const day = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  return Date.parse(`${day}T00:00:00-05:00`);
}

export function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

export const DNI_RE = /^\d{8}$/;
export const RUC_RE = /^\d{11}$/;

export function clean(v: FormDataEntryValue | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function num(v: FormDataEntryValue | null | undefined): number {
  const n = Number(clean(v));
  return Number.isFinite(n) ? n : 0;
}
