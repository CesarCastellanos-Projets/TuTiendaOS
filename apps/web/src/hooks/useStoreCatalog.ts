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

let cachedProducts: any[] | null = null;
let lastProductFetch = 0;

async function getProductsCatalog() {
  if (cachedProducts && Date.now() - lastProductFetch < 60000) {
    return cachedProducts;
  }
  const snap = await getDocs(query(collection(db, 'products'), limit(500)));
  cachedProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  lastProductFetch = Date.now();
  return cachedProducts;
}

export async function findInCatalog(
  _storeId: string,
  code: string,
  catalog: ProductStock[]
): Promise<(ProductStock & { presentationUnit?: string; factor?: number }) | null> {
  const c = code.trim();
  const byBarcode = catalog.find((p) => p.barcode === c || p.productId === c);
  if (byBarcode) return { ...byBarcode, factor: 1 };

  try {
    const prods = await getProductsCatalog();
    for (const pData of prods) {
      const matchPres = (pData.presentations || []).find((pr: any) => pr.barcode && pr.barcode.trim() === c);
      if (matchPres || pData.barcode === c || pData.internalCode === c) {
        const foundStock = catalog.find((s) => s.productId === pData.id);
        if (foundStock) {
          if (matchPres) {
            const label = matchPres.factor && matchPres.factor > 1 ? `${matchPres.unit} x${matchPres.factor}` : matchPres.unit;
            return {
              ...foundStock,
              productName: `${foundStock.productName} (${label})`,
              salePrice: matchPres.salePrice,
              barcode: matchPres.barcode,
              presentationUnit: matchPres.unit,
              factor: matchPres.factor || 1
            };
          }
          return { ...foundStock, factor: 1 };
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function useCatalogSearch(items: ProductStock[]) {
  const [extraItems, setExtraItems] = useState<(ProductStock & { presentationUnit?: string; factor?: number })[]>([]);

  useEffect(() => {
    void getProductsCatalog().then((prods) => {
      const list: (ProductStock & { presentationUnit?: string; factor?: number })[] = [];
      for (const p of prods) {
        const inStock = items.find((s) => s.productId === p.id);
        if (!inStock) continue;
        for (const pres of (p.presentations || [])) {
          if (!pres.salePrice) continue;
          const label = pres.factor && pres.factor > 1 ? `${pres.unit} x${pres.factor}` : pres.unit;
          list.push({
            ...inStock,
            productName: `${inStock.productName} (${label})`,
            salePrice: pres.salePrice,
            barcode: pres.barcode || inStock.barcode,
            presentationUnit: pres.unit,
            factor: pres.factor || 1
          });
        }
      }
      setExtraItems(list);
    });
  }, [items]);

  const allSearchable = useMemo(() => [...items, ...extraItems], [items, extraItems]);

  return useMemo(
    () => (term: string) => {
      const s = term.trim().toLowerCase();
      if (!s) return [];
      return allSearchable
        .filter((p) => p.productName.toLowerCase().includes(s) || (p.barcode ?? '').includes(s))
        .slice(0, 16);
    },
    [allSearchable]
  );
}
