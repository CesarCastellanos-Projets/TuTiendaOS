import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { UserProfile } from '../types';

export interface InventoryWorker {
  id: string;
  displayName: string;
  active: boolean;
  canIngress: boolean;
  canCreateProducts: boolean;
  updatedAt: number;
  updatedByName: string;
}

export function workerInventoryTasks(profile: UserProfile | null) {
  const access = profile?.role === 'trabajador' && profile.active
    && profile.storeId && profile.inventoryAccess?.storeId === profile.storeId ? profile.inventoryAccess : undefined;
  return { canIngress: access?.canIngress === true, canCreateProducts: access?.canCreateProducts === true };
}

export async function listInventoryWorkers(storeId: string, cursor?: string) {
  const call = httpsCallable<{ storeId: string; cursor?: string }, { workers: InventoryWorker[]; nextCursor: string | null }>(functions, 'listWorkerInventoryAccess');
  return (await call({ storeId, ...(cursor ? { cursor } : {}) })).data;
}

export async function setInventoryWorkerAccess(storeId: string, worker: InventoryWorker, canIngress: boolean, canCreateProducts: boolean) {
  await httpsCallable(functions, 'setWorkerInventoryAccess')({ storeId, workerId: worker.id, canIngress, canCreateProducts });
}

export function uncertainInventoryResult(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return !code || ['functions/internal', 'functions/unavailable', 'functions/unknown', 'functions/deadline-exceeded', 'functions/cancelled'].includes(code);
}
