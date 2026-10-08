import { EditableNumberInput } from './EditableNumberInput';
import { useMemo, useState } from 'react';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import type { Product, ProductPresentation } from '../../types';

export interface PickLine {
  productId: string;
  presentationId: string | null;
  presentationLabel: string;
  factor: number;
  name: string;
  qty: number;
  salePrice: number;
  barcode?: string;
}

/** Buscador de productos del catálogo con líneas de cantidad. */
export function useProductSearch() {
  const products = useProductsCatalog();

  type ProductChoice = Pick<Product, 'name' | 'salePrice' | 'barcode'> & {
    id: string;
    presentationId: string | null;
    presentationLabel: string;
    factor: number;
  };

  const search = (term: string): ProductChoice[] => {
    const s = term.trim().toLowerCase();
    if (!s) return [];
    return products
      .filter(
        (p) =>
          p.active &&
          (
            p.name.toLowerCase().includes(s)
            || p.barcode?.toLowerCase().includes(s)
            || p.internalCode?.toLowerCase().includes(s)
            || (p.presentations ?? []).some((presentation) =>
              presentation.barcode?.toLowerCase().includes(s)
              || presentation.unit.toLowerCase().includes(s)
              || presentation.description?.toLowerCase().includes(s)
            )
          )
      )
      .flatMap((product) => {
        const base: ProductChoice = {
          id: product.id,
          name: product.name,
          salePrice: product.salePrice,
          barcode: product.barcode,
          presentationId: null,
          presentationLabel: `Unidad base (${product.unit})`,
          factor: 1
        };
        const secondary = (product.presentations ?? []).map((presentation: ProductPresentation, index): ProductChoice => ({
          id: product.id,
          name: product.name,
          salePrice: presentation.salePrice,
          barcode: presentation.barcode,
          presentationId: presentation.id || `legacy-${index + 1}`,
          presentationLabel: presentation.description || `${presentation.unit} x${presentation.factor}`,
          factor: presentation.factor
        }));
        return [base, ...secondary].filter((choice) => {
          if (!s) return true;
          return choice.name.toLowerCase().includes(s)
            || choice.barcode?.toLowerCase().includes(s)
            || choice.presentationLabel.toLowerCase().includes(s);
        });
      })
      .slice(0, 12);
  };

  return { products, search };
}

export function ProductLines({
  lines,
  setLines,
  searchFn,
  allowZero = false
}: {
  allowZero?: boolean;
  lines: PickLine[];
  setLines: (l: PickLine[]) => void;
  searchFn: (t: string) => {
    id: string; name: string; salePrice: number; barcode?: string;
    presentationId: string | null; presentationLabel: string; factor: number;
  }[];
}) {
  const [term, setTerm] = useState('');
  const results = useMemo(() => (term.length >= 2 ? searchFn(term) : []), [term, searchFn]);

  const add = (p: {
    id: string; name: string; salePrice: number; barcode?: string;
    presentationId: string | null; presentationLabel: string; factor: number;
  }) => {
    if (lines.some((l) => l.productId === p.id && l.presentationId === p.presentationId)) return;
    setTerm('');
    setLines([...lines, {
      productId: p.id, presentationId: p.presentationId, presentationLabel: p.presentationLabel,
      factor: p.factor, name: p.name, qty: 1, salePrice: p.salePrice, barcode: p.barcode
    }]);
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
        <ul className="card divide-y divide-linea overflow-hidden shadow-lg animate-in fade-in">
          {results.map((p) => (
            <li key={`${p.id}:${p.presentationId ?? 'base'}`}>
              <button
                type="button"
                onClick={() => add(p)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm hover:bg-brand-50/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-900 block">{p.name}</span>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {p.presentationId ? (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 border border-brand-200 px-1.5 py-0.5 text-xs font-extrabold text-primary">
                           {p.presentationLabel}
                        </span>
                        <span className="text-xs text-slate-500 font-medium">
                          ({p.factor} unidades por presentación)
                        </span>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600">
                        Unidad base
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-3 shrink-0 text-right font-mono">
                  <span className="text-xs font-bold text-slate-900">S/ {p.salePrice.toFixed(2)}</span>
                  <span className="block text-xs text-slate-400 font-medium">
                    {p.presentationId ? 'por presentación' : 'por unidad'}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <ul className="space-y-2">
          {lines.map((l, idx) => (
            <li
              key={`${l.productId}:${l.presentationId ?? 'base'}`}
              className="inventory-product-line flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs"
            >
              <div className="min-w-0 flex-1">
                <span className="font-bold text-slate-900 text-sm block">{l.name}</span>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {l.presentationId ? (
                    <>
                      <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 border border-brand-200 px-1.5 py-0.5 text-xs font-extrabold text-primary">
                         {l.presentationLabel}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        Total: <b className="font-mono text-slate-700">{l.qty * l.factor}</b> unidades
                      </span>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600">
                      Unidad base
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <label
                    htmlFor={`qty-${l.productId}-${l.presentationId ?? 'base'}`}
                    className="block text-xs font-bold uppercase tracking-wider text-slate-500"
                  >
                    {l.presentationId ? 'Presentaciones' : 'Unidades'}
                  </label>
                  <EditableNumberInput
                    id={`qty-${l.productId}-${l.presentationId ?? 'base'}`}
                    type="number"
                    min={allowZero ? 0 : 0.001}
                    step={0.001}
                    value={l.qty}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...l, qty: Number(e.target.value) };
                      setLines(next);
                    }}
                    className="field !min-h-0 w-24 !px-2 !py-1 text-center font-mono text-sm font-extrabold text-slate-900"
                  />
                </div>

                <button
                  type="button"
                  aria-label={`Quitar ${l.name}`}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
                  onClick={() =>
                    setLines(
                      lines.filter((x) => !(x.productId === l.productId && x.presentationId === l.presentationId))
                    )
                  }
                  title="Quitar de la lista"
                >
                  <span className="text-xs font-bold text-critical">Quitar</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
