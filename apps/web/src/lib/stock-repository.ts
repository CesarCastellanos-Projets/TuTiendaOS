import { where } from 'firebase/firestore';
import { localDb, cacheCatalog } from './catalog-cache';
import { tenantCollectionFor } from './tenant-firestore';
import { commitCursor, liveCollection } from './live-collection';
import type { ProductStock } from '../types';

const repositories = new Map<string, ReturnType<typeof createRepository>>();
function createRepository(tenantId: string, storeId: string) {
  return liveCollection<ProductStock>({
    key: `stocks:${tenantId}:${storeId}`, collection: tenantCollectionFor(tenantId, 'product_stocks'),
    onIdle: () => repositories.delete(`${tenantId}:${storeId}`),
    filters: [where('locationId', '==', storeId)], id: (row) => row.productId,
    decode: (_id, data) => ({ ...data, committedAt: commitCursor(data) }) as ProductStock,
    load: async () => (await localDb.products.where('[tenantId+locationId]').equals([tenantId, storeId]).toArray())
      .map(({ id: _id, cachedAt: _cachedAt, ...row }) => row),
    save: async (rows, replace) => {
      await localDb.transaction('rw', localDb.products, async () => {
        if (replace) await localDb.products.where('[tenantId+locationId]').equals([tenantId, storeId]).delete();
        await cacheCatalog(tenantId, rows);
      });
    }
  });
}
export function storeCatalogRepository(tenantId: string, storeId: string) {
  const key = `${tenantId}:${storeId}`;
  let value = repositories.get(key);
  if (!value) { value = createRepository(tenantId, storeId); repositories.set(key, value); }
  return value;
}
