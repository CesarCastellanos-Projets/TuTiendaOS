import { availableBase, baseQuantityStep } from '../../lib/stock-availability';
import { useStoreCatalog } from '../../hooks/useStoreCatalog';
import { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { PackageOpen } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import { normalizeSearch, searchScore } from '../../lib/catalog-search';
import type { ProductStock } from '../../types';
import { salePresentations } from '../../lib/sale-presentations';
import { money } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

interface RequestLine {
  productId: string;
  presentationId: string | null;
  presentationLabel: string;
  name: string;
  currentQty: number;
  requestedQty: number;
}

export function RequestRestock() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [term, setTerm] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const products = useProductsCatalog();
  const { msg, flash } = useFlash();

  const effectiveStoreId = profile.storeId!;
  const { items: catalog } = useStoreCatalog(effectiveStoreId);

  const suggestions = useMemo(
    () =>
      catalog
        .filter((p) => p.quantity <= 5 && !lines.some((l) => l.productId === p.productId))
        .slice(0, 6),
    [catalog, lines]
  );

  const results = useMemo(() => {
    const s = term.trim().toLowerCase();
    if (s.length < 2) return [];
    const productById = new Map(products.map((product) => [product.id, product]));
    return catalog.flatMap((stock) => {
      const product = productById.get(stock.productId);
      const score = searchScore(s, normalizeSearch(`${stock.productName} ${product?.brand ?? ''}`), [product?.barcode ?? '', product?.internalCode ?? '', ...(product?.presentations ?? []).map((presentation) => presentation.barcode ?? '')].filter(Boolean));
      return salePresentations(stock, product).map((choice) => ({ stock, presentationId: choice.presentationId ?? null, presentationLabel: choice.presentationLabel ?? 'Unidad base', currentQty: choice.quantity, score }));
    }).filter((choice) => choice.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
  }, [term, catalog, products]);

  const add = (p: ProductStock | { stock: ProductStock; presentationId: string | null; presentationLabel: string; currentQty: number }) => {
    const choice = 'stock' in p
      ? p
      : { stock: p, presentationId: null, presentationLabel: 'Unidad base', currentQty: availableBase(p, products.find((product) => product.id === p.productId)?.presentations) };
    setTerm('');
    setLines((prev) =>
      prev.some((l) => l.productId === choice.stock.productId && l.presentationId === choice.presentationId)
        ? prev
        : [...prev, {
            productId: choice.stock.productId,
            presentationId: choice.presentationId,
            presentationLabel: choice.presentationLabel,
            name: choice.stock.productName,
            currentQty: choice.currentQty,
            requestedQty: Math.max(Math.ceil(choice.currentQty * 2), 12)
          }]
    );
  };

  const send = async () => {
    if (!user || lines.length === 0) return;
    if (lines.some((line) => {
      const product = products.find((p) => p.id === line.productId);
      const presentation = product?.presentations?.find((p, index) => (p.id || `legacy-${index + 1}`) === line.presentationId);
      const step = presentation ? (presentation.autoUnpackEnabled ? 1 / presentation.factor : 1) : baseQuantityStep(product?.unit);
      return !Number.isFinite(line.requestedQty) || line.requestedQty <= 0 || Math.abs(line.requestedQty / step - Math.round(line.requestedQty / step)) > 0.000001;
    })) { flash('Error: las cajas cerradas deben pedirse completas y las abiertas deben equivaler a unidades completas.'); return; }
    setBusy(true);
    try {
      await httpsCallable(functions, 'createReplenishmentRecord')({
        tenantId: profile.tenantId,
        storeId: effectiveStoreId,
        items: lines.map((l) => ({
          productId: l.productId,
          presentationId: l.presentationId,
          presentationLabel: l.presentationLabel,
          name: l.name,
          currentQty: l.currentQty,
          requestedQty: l.requestedQty
        })),
        status: 'pendiente',
        createdBy: user.uid,
        createdByName: profile.displayName,
        createdAt: Date.now(),
        note: note.trim() || null
      });
      setLines([]);
      setNote('');
      flash('Solicitud enviada al administrador');
    } catch (err) {
      flash(err instanceof Error ? `Error: ${err.message}` : 'Error al enviar la solicitud');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      <h1 className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide">
        <PackageOpen size={22} /> Pedir reposición
      </h1>
      <p className="text-sm text-slate-500">Pide las unidades sueltas y las cajas cerradas en líneas separadas. Solo las presentaciones que se pueden abrir comparten el saldo en unidades.</p>

      {suggestions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase text-slate-500">Bajo stock ahora</h2>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((p) => (
              <button key={p.productId} onClick={() => add(p)} className="btn-ghost !min-h-9 !px-3 text-xs">
                {p.productName} · quedan {p.quantity}
              </button>
            ))}
          </div>
        </section>
      )}

      <input
        className="field"
        placeholder="Buscar por nombre o código de cualquier presentación…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && results.length === 1) {
            event.preventDefault();
            add(results[0]);
          }
        }}
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="card divide-y divide-linea overflow-hidden">
          {results.map((p) => (
            <li key={`${p.stock.productId}:${p.presentationId ?? 'base'}`}>
              <button onClick={() => add(p)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-100">
                <span>{p.stock.productName}<small className="block text-xs text-slate-500">{p.presentationLabel} · hay {p.currentQty}</small></span>
                <span className="font-mono text-xs">{money(p.stock.salePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((l, idx) => (
            <li key={`${l.productId}:${l.presentationId ?? 'base'}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{l.name}<small className="block text-xs text-slate-500">{l.presentationLabel}</small></span>
              <span className="text-xs text-slate-500">hay {l.currentQty}</span>
              <label className="sr-only" htmlFor={`req-${l.productId}-${l.presentationId ?? 'base'}`}>Cantidad solicitada</label>
              <input
                id={`req-${l.productId}-${l.presentationId ?? 'base'}`}
                type="number"
                min={0.001}
                step={0.001}
                value={l.requestedQty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...l, requestedQty: Number(e.target.value) };
                  setLines(next);
                }}
                className="field !min-h-0 w-20 !px-2 !py-1.5 text-center"
              />
              <button
                aria-label={`Quitar ${l.name}`}
                className="text-sm font-semibold text-critical"
                onClick={() => setLines(lines.filter((x) => !(x.productId === l.productId && x.presentationId === l.presentationId)))}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className="label">Nota (opcional)</label>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="field" placeholder="Ej.: se vende rápido por las tardes" />
      </div>

      <button className="btn-brand w-full" disabled={busy || lines.length === 0} onClick={() => void send()}>
        {busy ? 'Enviando…' : `Enviar solicitud${lines.length ? ` (${lines.length})` : ''}`}
      </button>

      <FlashBar msg={msg} />
    </div>
  );
}
