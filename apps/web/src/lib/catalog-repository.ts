import { localDb, productDefinitionKey } from './catalog-cache';
import { tenantCollectionFor } from './tenant-firestore';
import { commitCursor, liveCollection } from './live-collection';
import type { Product } from '../types';

export type ProductWithId = Product & { id: string };
const repositories = new Map<string, ReturnType<typeof createRepository>>();
function createRepository(tenantId: string) {
  return liveCollection<ProductWithId>({
    key: `products:${tenantId}`, collection: tenantCollectionFor(tenantId, 'products'), id: (row) => row.id,
    onIdle: () => repositories.delete(tenantId),
    decode: (id, data) => ({ ...data, id, committedAt: commitCursor(data) }) as ProductWithId,
    load: async () => (await localDb.productDefinitions.where('tenantId').equals(tenantId).toArray())
      .map(({ id: _id, productId, cachedAt: _cachedAt, tenantId: _tenantId, ...row }) => ({ ...row, id: productId })),
    save: async (rows, replace) => {
      await localDb.transaction('rw', localDb.productDefinitions, async () => {
        if (replace) await localDb.productDefinitions.where('tenantId').equals(tenantId).delete();
        await localDb.productDefinitions.bulkPut(rows.map(({ id, ...row }) => ({ ...row, tenantId,
          productId: id, id: productDefinitionKey(tenantId, id), cachedAt: Date.now() })));
      });
    }
  });
}
function repository(tenantId: string) {
  let value = repositories.get(tenantId);
  if (!value) { value = createRepository(tenantId); repositories.set(tenantId, value); }
  return value;
}
export const getProductsCatalog = (tenantId: string): ProductWithId[] => repository(tenantId).get().rows;
export const syncProductsCatalog = (tenantId: string): Promise<void> => repository(tenantId).refresh();
export const refreshProductsCatalog = syncProductsCatalog;
export function subscribeProductsCatalog(tenantId: string, subscriber: (rows: ProductWithId[]) => void): () => void {
  return repository(tenantId).subscribe((state) => subscriber(state.rows));
}
export function subscribeCatalogError(tenantId: string, subscriber: (error: string | null) => void): () => void {
  return repository(tenantId).subscribe((state) => subscriber(state.error));
}
