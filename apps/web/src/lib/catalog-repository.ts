import { getDocs, limit, orderBy, query, startAfter, where, type QueryConstraint, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import { localDb, productDefinitionKey, type CachedProductDefinition } from './catalog-cache';
import { onSnapshot } from './firestore-listener';
import { tenantCollectionFor, tenantDocFor } from './tenant-firestore';
import type { Product } from '../types';

export type ProductWithId = Product & { id: string };

interface CatalogState {
  products: ProductWithId[];
  loaded: boolean;
  syncing: Promise<void> | null;
  subscribers: Set<(products: ProductWithId[]) => void>;
  versionUnsubscribe: Unsubscribe | null;
}

const states = new Map<string, CatalogState>();
let onlineListenerInstalled = false;

function stateFor(tenantId: string): CatalogState {
  const existing = states.get(tenantId);
  if (existing) return existing;
  const state: CatalogState = {
    products: [], loaded: false, syncing: null, subscribers: new Set(), versionUnsubscribe: null
  };
  states.set(tenantId, state);
  return state;
}

function publish(state: CatalogState): void {
  const snapshot = state.products;
  state.subscribers.forEach((subscriber) => subscriber(snapshot));
}

async function loadCached(tenantId: string, state: CatalogState): Promise<void> {
  if (state.loaded) return;
  const cached = await localDb.productDefinitions.where('tenantId').equals(tenantId).toArray();
  state.products = cached.map(({ id: _cacheId, productId, cachedAt: _cachedAt, tenantId: _tenantId, ...product }) => ({
    ...product,
    id: productId
  }));
  state.loaded = true;
  publish(state);
}

export async function syncProductsCatalog(tenantId: string): Promise<void> {
  const state = stateFor(tenantId);
  await loadCached(tenantId, state);
  if (state.syncing) return state.syncing;

  state.syncing = (async () => {
    const metaKey = `products:${tenantId}:updatedAt`;
    const meta = await localDb.catalogMeta.get(metaKey);
    const lastUpdatedAt = meta?.value ?? 0;
    let newestUpdatedAt = lastUpdatedAt;
    let cursor: QueryDocumentSnapshot | null = null;
    let received = 0;

    do {
      const constraints: QueryConstraint[] = [
        where('updatedAt', '>=', lastUpdatedAt),
        orderBy('updatedAt', 'asc'),
        limit(500)
      ];
      if (cursor) constraints.push(startAfter(cursor));
      const snapshot = await getDocs(query(tenantCollectionFor(tenantId, 'products'), ...constraints));
      received = snapshot.size;
      if (received === 0) break;

      const updates: CachedProductDefinition[] = snapshot.docs.map((document) => {
        const product = document.data() as Product;
        return {
          ...product,
          id: productDefinitionKey(tenantId, document.id),
          productId: document.id,
          tenantId,
          cachedAt: Date.now()
        };
      });
      await localDb.productDefinitions.bulkPut(updates);
      newestUpdatedAt = updates.reduce(
        (max, product) => Math.max(max, Number(product.updatedAt ?? 0)),
        newestUpdatedAt
      );
      cursor = snapshot.docs.at(-1) ?? null;
    } while (received === 500 && cursor);

    if (newestUpdatedAt > lastUpdatedAt) {
      await localDb.catalogMeta.put({ key: metaKey, value: newestUpdatedAt });
    }

    const cached = await localDb.productDefinitions.where('tenantId').equals(tenantId).toArray();
    state.products = cached.map(({ id: _cacheId, productId, cachedAt: _cachedAt, tenantId: _tenantId, ...product }) => ({
      ...product,
      id: productId
    }));
    publish(state);
  })().finally(() => {
    state.syncing = null;
  });

  return state.syncing;
}

export function subscribeProductsCatalog(
  tenantId: string,
  subscriber: (products: ProductWithId[]) => void
): () => void {
  const state = stateFor(tenantId);
  state.subscribers.add(subscriber);
  subscriber(state.products);
  void loadCached(tenantId, state).then(() => syncProductsCatalog(tenantId)).catch(() => undefined);

  if (!state.versionUnsubscribe) {
    state.versionUnsubscribe = onSnapshot(
      tenantDocFor(tenantId, 'meta', 'catalog'),
      () => void syncProductsCatalog(tenantId),
      () => undefined
    );
  }

  if (!onlineListenerInstalled && typeof window !== 'undefined') {
    onlineListenerInstalled = true;
    window.addEventListener('online', () => {
      states.forEach((_value, activeTenantId) => void syncProductsCatalog(activeTenantId));
    }, { passive: true });
  }

  return () => {
    state.subscribers.delete(subscriber);
    if (state.subscribers.size === 0) {
      state.versionUnsubscribe?.();
      state.versionUnsubscribe = null;
    }
  };
}

export async function refreshProductsCatalog(tenantId: string): Promise<void> {
  await syncProductsCatalog(tenantId);
}

export function getProductsCatalog(tenantId: string): ProductWithId[] {
  return stateFor(tenantId).products;
}
