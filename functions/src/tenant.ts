import { db } from './firebase';

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;

export function assertTenantId(value: unknown): string {
  if (typeof value !== 'string' || !TENANT_ID_PATTERN.test(value)) {
    throw new Error('Tenant inválido.');
  }
  return value;
}

export function tenantCollection(tenantId: string, name: string) {
  return db.collection(`tenants/${assertTenantId(tenantId)}/${name}`);
}

export function tenantDoc(tenantId: string, name: string, id: string) {
  if (!id) throw new Error('Documento inválido.');
  return db.doc(`tenants/${assertTenantId(tenantId)}/${name}/${id}`);
}
