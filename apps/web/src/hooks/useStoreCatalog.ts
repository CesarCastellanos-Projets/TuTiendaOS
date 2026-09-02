import { useEffect, useMemo, useState } from 'react';
import { onSnapshot, collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { stocksByLocation } from '../lib/inventory';
import { cacheCatalog, localDb } from '../lib/catalog-cache';
import type { ProductStock } from '../types';

/** Catálogo de la tienda: primero IndexedDB (offline), luego Firestore en vivo. */
export function useStoreCatalog(storeId: string | undefined): {
  items: ProductStock[];
  offline: boolean;
} {
  const [items, setItems] = useState<ProductStock[]>([]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    let alive = true;

    void localDb.products.where('locationId').equals(storeId).toArray().then((cached) => {
      if (!alive || cached.length === 0) return;
      setItems(cached.map(({ id: _id, cachedAt: _c, ...p }) => p));
      setOffline(!navigator.onLine);
    });

    const unsub = onSnapshot(
      stocksByLocation(storeId),
      (snap) => {
        if (!alive) return;
        const fresh = snap.docs.map((d) => d.data() as ProductStock);
        setItems(fresh);
        setOffline(false);
        void cacheCatalog(fresh);
      },
      () => {
        if (alive) setOffline(true);
      }
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [storeId]);

  return { items, offline };
}

export async function findInCatalog(
  _storeId: string,
  code: string,
  catalog: ProductStock[]
): Promise<ProductStock | null> {
  const c = code.trim();
  const byBarcode = catalog.find((p) => p.barcode === c || p.productId === c);
  if (byBarcode) return byBarcode;

  try {
    // Buscar si corresponde a una presentación secundaria
    const qProduct = query(collection(db, 'products'), limit(300));
    const snapProd = await getDocs(qProduct);
    for (const docP of snapProd.docs) {
      const pData = docP.data();
      const matchPres = (pData.presentations || []).find((pr: { barcode?: string }) => pr.barcode === c);
      if (matchPres || pData.barcode === c || pData.internalCode === c) {
        const foundStock = catalog.find((s) => s.productId === docP.id);
        if (foundStock) {
          if (matchPres) {
            return {
              ...foundStock,
              productName: `${foundStock.productName} (${matchPres.unit})`,
              salePrice: matchPres.salePrice,
              barcode: matchPres.barcode
            };
          }
          return foundStock;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function useCatalogSearch(items: ProductStock[]) {
  return useMemo(
    () => (term: string) => {
      const s = term.trim().toLowerCase();
      if (!s) return [];
      return items.filter((p) => p.productName.toLowerCase().includes(s)).slice(0, 12);
    },
    [items]
  );
}
