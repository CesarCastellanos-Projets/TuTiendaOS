import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from '../lib/firestore-listener';
import { stocksByLocation } from '../lib/inventory';
import { cacheCatalog, localDb } from '../lib/catalog-cache';
import { getProductsCatalog, syncProductsCatalog, type ProductWithId } from '../lib/catalog-repository';
import { requireCurrentTenantId } from '../lib/tenant-firestore';
import { useAuth } from '../lib/auth';
import { useProductsCatalog } from './useProductsCatalog';
import type { ProductStock } from '../types';

export interface SearchableCatalogItem extends ProductStock {
  presentationUnit?: string;
  presentationId?: string;
  presentationLabel?: string;
  factor?: number;
  allowFractionalSale?: boolean;
  fractionStep?: number;
  searchKey: string;
}

/** Catálogo de la tienda: primero IndexedDB (offline), luego Firestore en vivo y productos sincronizados. */
export function useStoreCatalog(storeId: string | undefined): {
  items: ProductStock[];
  products: ProductWithId[];
  offline: boolean;
} {
  const [items, setItems] = useState<ProductStock[]>([]);
  const products = useProductsCatalog();
  const tenantId = useAuth((state) => state.profile?.tenantId);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!storeId || !tenantId) return;
    let alive = true;

    void localDb.products.where('[tenantId+locationId]').equals([tenantId, storeId]).toArray().then((cached) => {
      if (!alive || cached.length === 0) return;
      setItems(cached.map(({ id: _id, cachedAt: _c, ...p }) => p));
      setOffline(!navigator.onLine);
    });

    const unsubStocks = onSnapshot(
      stocksByLocation(storeId),
      (snap) => {
        if (!alive) return;
        const fresh = snap.docs.map((d) => d.data() as ProductStock);
        setItems(fresh);
        setOffline(false);
        void cacheCatalog(tenantId, fresh);
      },
      () => {
        if (alive) setOffline(true);
      }
    );

    return () => {
      alive = false;
      unsubStocks();
    };
  }, [storeId, tenantId]);

  return { items, products, offline };
}

export async function findInCatalog(
  _storeId: string,
  code: string,
  catalog: ProductStock[]
): Promise<SearchableCatalogItem | null> {
  const c = code.trim().toLowerCase();
  if (!c) return null;

  const tenantId = requireCurrentTenantId();
  await syncProductsCatalog(tenantId).catch(() => undefined);
  const products = getProductsCatalog(tenantId);

  // Vercel Best Practice (js-index-maps): Map para resolución O(1) de stocks por productId
  const stockMap = new Map<string, ProductStock>();
  for (const s of catalog) {
    stockMap.set(s.productId, s);
  }

  // Helper para buscar presentación secundaria en una lista de productos
  const findPresentationMatch = (prods: ProductWithId[]): SearchableCatalogItem | null => {
    for (const p of prods) {
      const matchIndex = (p.presentations || []).findIndex((pr) => {
        const b = String(pr.barcode ?? '').trim().toLowerCase();
        return b !== '' && b === c;
      });
      const matchPres = matchIndex >= 0 ? (p.presentations || [])[matchIndex] : undefined;

      if (matchPres) {
        const presentationId = matchPres.id || `legacy-${matchIndex + 1}`;
        const foundStock = stockMap.get(p.id);
        const label = matchPres.factor && matchPres.factor > 1 ? `${matchPres.unit} x${matchPres.factor}` : matchPres.unit;
        return {
          productId: p.id,
          productName: `${foundStock?.productName ?? p.name} (${label})`,
          salePrice: matchPres.salePrice,
          barcode: String(matchPres.barcode ?? code.trim()),
          presentationUnit: matchPres.unit,
          presentationId,
          presentationLabel: matchPres.description || label,
          factor: matchPres.factor || 1,
          allowFractionalSale: matchPres.allowFractionalSale !== false,
          fractionStep: matchPres.fractionStep ?? 0.5,
          quantity: foundStock?.presentationQuantities?.[presentationId] ?? 0,
          locationId: foundStock?.locationId ?? _storeId,
          locationName: foundStock?.locationName ?? '',
          locationType: 'store',
          searchKey: `${p.id}_${presentationId}`
        };
      }
    }
    return null;
  };

  // 1. PRIMERO: Comprobar en la memoria de productos
  const presMatch = findPresentationMatch(products);
  if (presMatch) return presMatch;

  // 2. SEGUNDO: Comprobar si coincide con el código base o código interno de un producto
  for (const p of products) {
    const baseBarcode = String(p.barcode ?? '').trim().toLowerCase();
    const internalCode = String(p.internalCode ?? '').trim().toLowerCase();
    if ((baseBarcode !== '' && baseBarcode === c) || (internalCode !== '' && internalCode === c) || p.id.toLowerCase() === c) {
      const foundStock = stockMap.get(p.id);
      return {
        productId: p.id,
        productName: foundStock?.productName ?? p.name,
        salePrice: foundStock?.salePrice ?? p.salePrice,
        barcode: p.barcode ?? code.trim(),
        presentationUnit: p.unit ?? 'UN',
        factor: 1,
        quantity: foundStock?.baseQuantity ?? foundStock?.quantity ?? 0,
        locationId: foundStock?.locationId ?? _storeId,
        locationName: foundStock?.locationName ?? '',
        locationType: 'store',
        searchKey: `${p.id}_base`
      };
    }
  }

  // 3. TERCERO: Búsqueda directa en catalog (product_stocks)
  const byBarcode = catalog.find((s) => {
    const b = String(s.barcode ?? '').trim().toLowerCase();
    return (b !== '' && b === c) || s.productId.toLowerCase() === c;
  });
  if (byBarcode) {
    return {
      ...byBarcode,
      factor: 1,
      searchKey: `${byBarcode.productId}_base`
    };
  }

  return null;
}

export function useCatalogSearch(items: ProductStock[]) {
  const productsList = useProductsCatalog();

  // Vercel Best Practice: js-index-maps - Construir Map para lookup O(1) de stocks
  const stockMap = useMemo(() => {
    const map = new Map<string, ProductStock>();
    for (const s of items) {
      map.set(s.productId, s);
    }
    return map;
  }, [items]);

  const allSearchable = useMemo(() => {
    const list: SearchableCatalogItem[] = [];

    for (const p of productsList) {
      const stock = stockMap.get(p.id);
      const looseQuantity = stock?.baseQuantity ?? stock?.quantity ?? 0;
      const baseStockQty = (p.presentations ?? []).reduce(
        (total, presentation) => presentation.autoUnpackEnabled
          ? total + (stock?.presentationQuantities?.[presentation.id] ?? 0) * presentation.factor
          : total,
        looseQuantity
      );

      // Presentación base
      list.push({
        productId: p.id,
        productName: `${p.name} (${p.unit || 'UN'})`,
        salePrice: p.salePrice,
        barcode: p.barcode,
        quantity: baseStockQty,
        locationId: stock?.locationId ?? '',
        locationName: stock?.locationName ?? '',
        locationType: 'store',
        presentationUnit: p.unit ?? 'UN',
        presentationLabel: `Unidad base (${p.unit ?? 'UN'})`,
        factor: 1,
        searchKey: `${p.id}_base`
      });

      // Presentaciones secundarias
      for (const [index, pres] of (p.presentations || []).entries()) {
        if (!pres.salePrice) continue;
        const presentationId = pres.id || `legacy-${index + 1}`;
        const label = pres.factor && pres.factor > 1 ? `${pres.unit} x${pres.factor}` : pres.unit;
        list.push({
          productId: p.id,
          productName: `${p.name} (${label})`,
          salePrice: pres.salePrice,
          barcode: pres.barcode,
          locationId: stock?.locationId ?? '',
          locationName: stock?.locationName ?? '',
          locationType: 'store',
          presentationUnit: pres.unit,
          presentationId,
          presentationLabel: pres.description || label,
          factor: pres.factor || 1,
          allowFractionalSale: pres.allowFractionalSale === true,
          fractionStep: pres.fractionStep ?? 0.5,
          quantity: stock?.presentationQuantities?.[presentationId] ?? 0,
          searchKey: `${p.id}_${presentationId}`
        });
      }
    }

    return list;
  }, [stockMap, productsList]);

  return useMemo(
    () => (term: string): SearchableCatalogItem[] => {
      const s = term.trim().toLowerCase();
      if (!s) return [];
      return allSearchable
        .filter((p) => {
          const nameMatch = p.productName.toLowerCase().includes(s);
          const barcodeMatch = String(p.barcode ?? '').toLowerCase().includes(s);
          return nameMatch || barcodeMatch;
        })
        .slice(0, 20);
    },
    [allSearchable]
  );
}
