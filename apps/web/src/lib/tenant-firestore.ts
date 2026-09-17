import { collection, doc, type CollectionReference, type DocumentReference } from 'firebase/firestore';
import { useAuth } from './auth';
import { db } from './firebase';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;

export function requireCurrentTenantId(): string {
  const tenantId = useAuth.getState().profile?.tenantId;
  if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error('El usuario no tiene una empresa válida asignada.');
  }
  return tenantId;
}

export function tenantCollection(name: string): CollectionReference {
  return tenantCollectionFor(requireCurrentTenantId(), name);
}

export function tenantCollectionFor(tenantId: string, name: string): CollectionReference {
  if (!TENANT_ID_PATTERN.test(tenantId) || !name) throw new Error('Ruta de empresa inválida.');
  return collection(db, 'tenants', tenantId, name);
}

export function tenantDoc(name: string, id: string): DocumentReference {
  return tenantDocFor(requireCurrentTenantId(), name, id);
}

export function tenantDocFor(tenantId: string, name: string, id: string): DocumentReference {
  if (!TENANT_ID_PATTERN.test(tenantId) || !name || !id) throw new Error('Ruta de empresa inválida.');
  return doc(db, 'tenants', tenantId, name, id);
}
