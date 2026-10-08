import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Transaction } from 'firebase-admin/firestore';
import { assertCurrentProfile, type ActiveProfile } from './authz';
import { db } from './firebase';
import { tenantDoc } from './tenant';

export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new HttpsError('invalid-argument', 'Falta el identificador de la operación. Actualiza la aplicación e intenta nuevamente.');
  }
  return value;
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}

export async function readOperation(tx: Transaction, profile: ActiveProfile, kind: string, id: string, input: unknown) {
  await assertCurrentProfile(tx, profile);
  const key = createHash('sha256').update(`${profile.uid}:${kind}:${id}`).digest('hex');
  const ref = tenantDoc(profile.tenantId, 'operation_receipts', key);
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
  const snapshot = await tx.get(ref);
  if (snapshot.exists && snapshot.data()?.fingerprint !== fingerprint) {
    throw new HttpsError('already-exists', 'Esta operación ya fue utilizada con otros datos.');
  }
  return { ref, fingerprint, result: snapshot.exists ? snapshot.data()!.result as Record<string, unknown> : null };
}

export function completeOperation(tx: Transaction, profile: ActiveProfile, kind: string,
  operation: Awaited<ReturnType<typeof readOperation>>, result: Record<string, unknown>): void {
  tx.create(operation.ref, { tenantId: profile.tenantId, userId: profile.uid, kind,
    fingerprint: operation.fingerprint, result, createdAt: Date.now() });
}

export function documentId(value: unknown, field = 'Identificador'): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new HttpsError('invalid-argument', `${field} inválido.`);
  return value;
}
