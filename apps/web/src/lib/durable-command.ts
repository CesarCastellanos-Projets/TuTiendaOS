import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { useAuth } from './auth';

interface PendingCommand { requestId: string; input: Record<string, unknown>; fingerprint: string }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => key !== 'requestId' && item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

const inFlight = new Set<string>();

function readPending(saved: string): PendingCommand {
  try {
    const value: unknown = JSON.parse(saved);
    if (value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string'
      && /^[a-zA-Z0-9_-]{8,80}$/.test(value.requestId) && 'fingerprint' in value && typeof value.fingerprint === 'string'
      && 'input' in value && value.input && typeof value.input === 'object' && !Array.isArray(value.input)) {
      return { requestId: value.requestId, fingerprint: value.fingerprint, input: value.input as Record<string, unknown> };
    }
  } catch { /* Un comando ilegible no se reemplaza: podría haber llegado al servidor. */ }
  throw new Error('No se pudo recuperar una operación pendiente de este equipo. Revisa el historial antes de borrar los datos locales.');
}

export async function durableCommand<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const { user, profile } = useAuth.getState();
  if (!user || !profile) throw new Error('Vuelve a iniciar sesión.');
  const key = `denzoz_operation_v1:${profile.tenantId}:${user.uid}:${name}`;
  if (inFlight.has(key)) throw new Error('La operación ya está en proceso.');
  const fingerprint = JSON.stringify(canonical(input));
  const saved = localStorage.getItem(key);
  const pending: PendingCommand = saved ? readPending(saved)
    : { requestId: typeof input.requestId === 'string' ? input.requestId : crypto.randomUUID(), input, fingerprint };
  localStorage.setItem(key, JSON.stringify(pending));
  inFlight.add(key);
  try {
    const response = await httpsCallable<Record<string, unknown>, T>(functions, name)(
      { ...pending.input, requestId: pending.requestId });
    localStorage.removeItem(key);
    if (pending.fingerprint !== fingerprint) throw new Error('Se recuperó la operación anterior. Revisa el resultado antes de registrar otra.');
    return response.data;
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    if (['functions/invalid-argument', 'functions/failed-precondition', 'functions/permission-denied', 'functions/not-found', 'functions/already-exists'].includes(code)) {
      localStorage.removeItem(key);
    }
    throw cause;
  } finally { inFlight.delete(key); }
}
