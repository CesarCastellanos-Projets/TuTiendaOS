import { useEffect, useMemo, useState } from 'react';
import { doc, limit, query, setDoc, where } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { PackageOpen } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import type { ProductStock } from '../../types';
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
  const [catalog, setCatalog] = useState<ProductStock[]>([]);
  const [lines, setLines] = useState<RequestLine[]>([]);
  const [term, setTerm] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const products = useProductsCatalog();
  const { msg, flash } = useFlash();

  const effectiveStoreId = profile.storeId || catalog[0]?.locationId || 'tienda-principal';

  useEffect(() => {
    if (!effectiveStoreId) return;
    return onSnapshot(
      query(tenantCollection('product_stocks'), where('locationId', '==', effectiveStoreId), limit(300)),
      (s) => setCatalog(s.docs.map((d) => d.data() as ProductStock))
    );
  }, [effectiveStoreId]);

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
      if (!product) return [];
      const choices = [
        { stock, presentationId: null, presentationLabel: `Unidad base (${product.unit})`, currentQty: stock.baseQuantity ?? stock.quantity },
        ...(product.presentations ?? []).map((presentation, index) => ({
          stock,
          presentationId: presentation.id || `legacy-${index + 1}`,
          presentationLabel: presentation.description || `${presentation.unit} x${presentation.factor}`,
          currentQty: stock.presentationQuantities?.[presentation.id || `legacy-${index + 1}`] ?? 0
        }))
      ];
      return choices.filter((choice) =>
        stock.productName.toLowerCase().includes(s)
        || String(choice.presentationLabel).toLowerCase().includes(s)
        || String(product.barcode ?? '').toLowerCase().includes(s)
        || String(product.internalCode ?? '').toLowerCase().includes(s)
        || (product.presentations ?? []).some((presentation) =>
          presentation.id === choice.presentationId && String(presentation.barcode ?? '').toLowerCase().includes(s)
        )
      );
    }).slice(0, 10);
  }, [term, catalog, products]);

  const add = (p: ProductStock | { stock: ProductStock; presentationId: string | null; presentationLabel: string; currentQty: number }) => {
    const choice = 'stock' in p
      ? p
      : { stock: p, presentationId: null, presentationLabel: 'Unidad base', currentQty: p.baseQuantity ?? p.quantity };
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
            requestedQty: Math.max(choice.currentQty * 2, 12)
          }]
    );
  };

  const send = async () => {
    if (!user || lines.length === 0) return;
    setBusy(true);
    try {
      const storeName = catalog[0]?.locationName ?? 'Mi tienda';
      await setDoc(doc(tenantCollection('replenishment_requests')), {
        tenantId: profile.tenantId,
        storeId: effectiveStoreId,
        storeName,
        items: lines.map((l) => ({
          productId: l.productId,
          presentationId: l.presentationId,
          presentationLabel: l.presentationLabel,
          name: l.name,
          currentQty: Math.trunc(Number(l.currentQty) || 0),
          requestedQty: Math.max(1, Math.trunc(Number(l.requestedQty) || 1))
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
              <label className="sr-only" htmlFor={`req-${l.productId}`}>Cantidad solicitada</label>
              <input
                id={`req-${l.productId}`}
                type="number"
                min={1}
                value={l.requestedQty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...l, requestedQty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) };
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
