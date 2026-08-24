import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { Product } from '../../types';

export interface PickLine {
  productId: string;
  name: string;
  qty: number;
  salePrice: number;
  barcode?: string;
}

/** Buscador de productos del catálogo con líneas de cantidad. */
export function useProductSearch() {
  const [products, setProducts] = useState<(Product & { id: string })[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'products'), limit(500));
    return onSnapshot(q, (snap) => setProducts(snap.docs.map((d) => ({ ...(d.data() as Product), id: d.id }))));
  }, []);

  const search = (term: string): (Product & { id: string })[] => {
    const s = term.trim().toLowerCase();
    if (!s) return [];
    return products
      .filter(
        (p) =>
          p.active &&
          (p.name.toLowerCase().includes(s) || p.barcode?.includes(s) || p.internalCode?.toLowerCase().includes(s))
      )
      .slice(0, 8);
  };

  return { products, search };
}

export function ProductLines({
  lines,
  setLines,
  searchFn
}: {
  lines: PickLine[];
  setLines: (l: PickLine[]) => void;
  searchFn: (t: string) => { id: string; name: string; salePrice: number; barcode?: string }[];
}) {
  const [term, setTerm] = useState('');
  const results = useMemo(() => (term.length >= 2 ? searchFn(term) : []), [term, searchFn]);

  const add = (p: { id: string; name: string; salePrice: number; barcode?: string }) => {
    if (lines.some((l) => l.productId === p.id)) return;
    setTerm('');
    setLines([...lines, { productId: p.id, name: p.name, qty: 1, salePrice: p.salePrice, barcode: p.barcode }]);
  };

  return (
    <div className="space-y-2">
      <input
        className="field"
        placeholder="Buscar producto por nombre o código…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="card divide-y divide-linea overflow-hidden">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => add(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-100"
              >
                <span>{p.name}</span>
                <span className="font-mono text-xs">S/ {p.salePrice.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((l, idx) => (
            <li key={l.productId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
              <label className="sr-only" htmlFor={`qty-${l.productId}`}>Cantidad</label>
              <input
                id={`qty-${l.productId}`}
                type="number"
                min={1}
                value={l.qty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...l, qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) };
                  setLines(next);
                }}
                className="field !min-h-0 w-20 !px-2 !py-1.5 text-center"
              />
              <button
                type="button"
                aria-label={`Quitar ${l.name}`}
                className="text-sm font-semibold text-critical hover:opacity-70"
                onClick={() => setLines(lines.filter((x) => x.productId !== l.productId))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
