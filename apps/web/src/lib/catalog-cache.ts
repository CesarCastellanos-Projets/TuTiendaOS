import Dexie, { type Table } from 'dexie';
import type { ProductStock } from '../types';

export interface CachedProduct extends ProductStock {
  id: string;
  cachedAt: number;
}

class DenzozDB extends Dexie {
  products!: Table<CachedProduct, string>;

  constructor() {
    super('denzoz');
    this.version(1).stores({
      products: 'id, productId, barcode, locationId, productName'
    });
  }
}

export const localDb = new DenzozDB();

export function cacheKey(productId: string, locationId: string): string {
  return `${productId}_${locationId}`;
}

/** Guarda el catálogo de la ubicación (delta por updatedAt). */
export async function cacheCatalog(items: ProductStock[]): Promise<void> {
  await localDb.products.bulkPut(
    items.map((p) => ({ ...p, id: cacheKey(p.productId, p.locationId), cachedAt: Date.now() }))
  );
}
