import { useEffect, useMemo, useState } from 'react';
import { availableBase, availablePresentation } from '../lib/stock-availability';
import { storeCatalogRepository } from '../lib/stock-repository';
import { getProductsCatalog, syncProductsCatalog, subscribeCatalogError, type ProductWithId } from '../lib/catalog-repository';
import { requireCurrentTenantId } from '../lib/tenant-firestore';
import { useAuth } from '../lib/auth';
import { useProductsCatalog } from './useProductsCatalog';
import type { ProductStock } from '../types';
import { normalizeSearch, searchScore } from '../lib/catalog-search';

export interface SearchableCatalogItem extends ProductStock {
  searchText?: string;
  internalCode?: string;
  presentationUnit?: string;
  presentationId?: string;
  presentationLabel?: string;
  factor?: number;
  autoUnpackEnabled?: boolean;
  allowFractionalSale?: boolean;
  fractionStep?: number;
  searchKey: string;
}

/** Catálogo de la tienda: primero IndexedDB (offline), luego Firestore en vivo y productos sincronizados. */
export function useStoreCatalog(storeId: string | undefined): {
  items: ProductStock[];
  products: ProductWithId[];
  offline: boolean;
  error: string | null;
} {
  const [items, setItems] = useState<ProductStock[]>([]);
  const products = useProductsCatalog();
  const tenantId = useAuth((state) => state.profile?.tenantId);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  useEffect(() => {
    setProductError(null);
    if (tenantId) return subscribeCatalogError(tenantId, setProductError);
  }, [tenantId]);

  useEffect(() => {
    setItems([]); setError(null);
    if (!storeId || !tenantId) return;
    return storeCatalogRepository(tenantId, storeId).subscribe((state) => {
      setItems(state.rows); setOffline(state.offline); setError(state.error);
    });
  }, [storeId, tenantId]);

  const currentItems = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    return items.filter((stock) => byId.get(stock.productId)?.active === true).map((stock) => {
      const product = byId.get(stock.productId)!;
      return { ...stock, productName: product.name, salePrice: product.salePrice, barcode: product.barcode, unit: product.unit };
    });
  }, [items, products]);
  return { items: currentItems, products, offline, error: error ?? productError };
}

const lastMissingRefresh = new Map<string, number>();
export async function findInCatalog(
  _storeId: string,
  code: string,
  catalog: ProductStock[],
  refreshed = false
): Promise<SearchableCatalogItem | null> {
  const c = code.trim().toLowerCase();
  if (!c) return null;

  const tenantId = requireCurrentTenantId();
  if (!getProductsCatalog(tenantId).length) await syncProductsCatalog(tenantId).catch(() => undefined);
  const products = getProductsCatalog(tenantId).filter((product) => product.active);

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
          autoUnpackEnabled: matchPres.autoUnpackEnabled === true,
          allowFractionalSale: matchPres.allowFractionalSale === true,
          fractionStep: matchPres.fractionStep ?? 0.5,
          quantity: availablePresentation(foundStock, p.presentations, matchPres),
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
        salePrice: p.salePrice,
        barcode: p.barcode ?? code.trim(),
        presentationUnit: p.unit ?? 'UN',
        factor: 1,
        quantity: availableBase(foundStock, p.presentations),
        locationId: foundStock?.locationId ?? _storeId,
        locationName: foundStock?.locationName ?? '',
        locationType: 'store',
        searchKey: `${p.id}_base`,
        searchText: `${p.name} ${p.brand ?? ''} ${p.category}`,
        internalCode: p.internalCode
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

  if (!refreshed && navigator.onLine && Date.now() - (lastMissingRefresh.get(tenantId) ?? 0) > 15000) {
    lastMissingRefresh.set(tenantId, Date.now());
    await syncProductsCatalog(tenantId).catch(() => undefined);
    return findInCatalog(_storeId, code, catalog, true);
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

    for (const p of productsList.filter((product) => product.active)) {
      const stock = stockMap.get(p.id);
      const baseStockQty = availableBase(stock, p.presentations);

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
          autoUnpackEnabled: pres.autoUnpackEnabled === true,
          allowFractionalSale: pres.allowFractionalSale === true,
          fractionStep: pres.fractionStep ?? 0.5,
          quantity: availablePresentation(stock, p.presentations, pres),
          searchKey: `${p.id}_${presentationId}`,
          searchText: `${p.name} ${p.brand ?? ''} ${p.category} ${pres.description ?? ''} ${label}`,
          internalCode: p.internalCode
        });
      }
    }

    return list;
  }, [stockMap, productsList]);

  return useMemo(() => {
    const index = allSearchable.map((item) => ({ item, name: normalizeSearch(item.searchText ?? item.productName), codes: [item.barcode ?? '', item.internalCode ?? '', item.productId].filter(Boolean) }));
    return (term: string): SearchableCatalogItem[] => index
      .map((entry) => ({ ...entry, score: searchScore(term, entry.name, entry.codes) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.item.productName.localeCompare(b.item.productName, 'es'))
      .slice(0, 40).map((entry) => entry.item);
  }, [allSearchable]);
}
