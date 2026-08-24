import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocs, limit, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { PackageOpen } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import type { ProductStock } from '../../types';
import { money } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

interface RequestLine {
  productId: string;
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
  const { msg, flash } = useFlash();

  const storeId = profile.storeId!;

  useEffect(() => {
    void getDocs(query(collection(db, 'product_stocks'), where('locationId', '==', storeId), limit(300))).then(
      (s) => setCatalog(s.docs.map((d) => d.data() as ProductStock))
    );
    return onSnapshot(
      query(collection(db, 'product_stocks'), where('locationId', '==', storeId), limit(300)),
      (s) => setCatalog(s.docs.map((d) => d.data() as ProductStock))
    );
  }, [storeId]);

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
    return catalog.filter((p) => p.productName.toLowerCase().includes(s)).slice(0, 8);
  }, [term, catalog]);

  const add = (p: ProductStock) => {
    setTerm('');
    setLines((prev) =>
      prev.some((l) => l.productId === p.productId)
        ? prev
        : [...prev, { productId: p.productId, name: p.productName, currentQty: p.quantity, requestedQty: Math.max(p.quantity * 2, 12) }]
    );
  };

  const send = async () => {
    if (!user || lines.length === 0) return;
    setBusy(true);
    try {
      const storeName = catalog[0]?.locationName ?? 'Mi tienda';
      await setDoc(doc(collection(db, 'replenishment_requests')), {
        storeId,
        storeName,
        items: lines,
        status: 'pendiente',
        createdBy: user.uid,
        createdByName: profile.displayName,
        createdAt: Date.now(),
        note: note.trim() || null
      });
      setLines([]);
      setNote('');
      flash('Solicitud enviada al administrador');
    } catch {
      flash('Error al enviar la solicitud');
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
        placeholder="Buscar producto…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className="card divide-y divide-linea overflow-hidden">
          {results.map((p) => (
            <li key={p.productId}>
              <button onClick={() => add(p)} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-100">
                <span>{p.productName}</span>
                <span className="font-mono text-xs">{money(p.salePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((l, idx) => (
            <li key={l.productId} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
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
                onClick={() => setLines(lines.filter((x) => x.productId !== l.productId))}
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
