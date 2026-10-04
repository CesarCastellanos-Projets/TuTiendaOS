import Dexie, { type Table } from 'dexie';
import type { Product, ProductStock } from '../types';
import type { CachedStatistics } from './statistics';

export interface CachedProduct extends ProductStock {
  id: string;
  tenantId: string;
  cachedAt: number;
}

export interface CachedProductDefinition extends Product {
  id: string;
  productId: string;
  tenantId: string;
  cachedAt: number;
}

export interface CatalogMeta {
  key: string;
  value: number;
}

class DenzozDB extends Dexie {
  products!: Table<CachedProduct, string>;
  productDefinitions!: Table<CachedProductDefinition, string>;
  catalogMeta!: Table<CatalogMeta, string>;
  statisticsQueries!: Table<CachedStatistics, string>;

  constructor() {
    super('denzoz');
    this.version(1).stores({
      products: 'id, productId, barcode, locationId, productName'
    });
    this.version(2).stores({
      products: 'id, productId, barcode, locationId, productName',
      productDefinitions: 'id, [tenantId+productId], tenantId, updatedAt, name',
      catalogMeta: 'key'
    });
    this.version(3).stores({
      products: 'id, [tenantId+locationId], tenantId, productId, barcode, locationId, productName',
      productDefinitions: 'id, [tenantId+productId], tenantId, updatedAt, name',
      catalogMeta: 'key'
    });
    this.version(4).stores({
      products: 'id, [tenantId+locationId], tenantId, productId, barcode, locationId, productName',
      productDefinitions: 'id, [tenantId+productId], tenantId, updatedAt, name',
      catalogMeta: 'key',
      statisticsQueries: 'key, expiresAt'
    });
  }
}

export const localDb = new DenzozDB();

export function cacheKey(tenantId: string, productId: string, locationId: string): string {
  return `${tenantId}:${productId}_${locationId}`;
}

/** Guarda el catálogo de la ubicación (delta por updatedAt). */
export async function cacheCatalog(tenantId: string, items: ProductStock[]): Promise<void> {
  await localDb.products.bulkPut(
    items.map((p) => ({
      ...p,
      tenantId,
      id: cacheKey(tenantId, p.productId, p.locationId),
      cachedAt: Date.now()
    }))
  );
}

export function productDefinitionKey(tenantId: string, productId: string): string {
  return `${tenantId}:${productId}`;
}
