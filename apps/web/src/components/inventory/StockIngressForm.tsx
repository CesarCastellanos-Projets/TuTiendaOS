import { useRef, useState } from 'react';
import { ProductLines, useProductSearch, type PickLine } from '../ui/ProductPicker';
import { ingressStock } from '../../lib/inventory';
import { FlashBar, useFlash } from '../ui/Feedback';
import { uncertainInventoryResult } from '../../lib/worker-inventory';

export function StockIngressForm({ locationId, locationType, locationName, initialLines = [], onSaved }: {
  locationId: string; locationType: 'store' | 'warehouse'; locationName: string; initialLines?: PickLine[]; onSaved?: () => void;
}) {
  const [lines, setLines] = useState<PickLine[]>(initialLines);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<Parameters<typeof ingressStock>[0] | null>(null);
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const submit = async () => {
    if (busy) return;
    if (!pending.current && (!lines.length || lines.some((line) => !Number.isFinite(line.qty) || line.qty <= 0))) {
      flash('Error: ingresa cantidades mayores a cero.');
      return;
    }
    pending.current ??= { requestId: crypto.randomUUID(), locationId, locationType, note: note.trim(),
      items: lines.map((line) => ({ productId: line.productId, presentationId: line.presentationId, qty: line.qty })) };
    setBusy(true);
    try {
      await ingressStock(pending.current);
      pending.current = null;
      setRetry(false);
      setLines([]);
      setNote('');
      flash(`Ingreso registrado en ${locationName}.`);
      onSaved?.();
    } catch (error) {
      const uncertain = uncertainInventoryResult(error);
      setRetry(uncertain);
      if (!uncertain) pending.current = null;
      flash(`Error: ${error instanceof Error ? error.message : 'no se pudo registrar el ingreso.'}${uncertain ? ' Reintenta para confirmar el mismo ingreso sin duplicarlo.' : ''}`);
    } finally { setBusy(false); }
  };
  return <section className="card space-y-4 p-4">
    <p className="text-sm">Destino: <strong>{locationName}</strong></p>
    <fieldset disabled={busy || retry} className="space-y-4 disabled:opacity-70">
      <ProductLines lines={lines} setLines={setLines} searchFn={search} />
      <p className="text-xs text-slate-500">Las presentaciones que permiten apertura se suman al stock suelto. Las cajas cerradas conservan su saldo separado.</p>
      {lines.length > 0 && <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
        {[...new Set(lines.map((line) => line.productId))].map((id) => {
          const selected = lines.filter((line) => line.productId === id);
          return <p key={id}><strong>{selected[0].name}:</strong> {selected.reduce((sum, line) => sum + line.qty * line.factor, 0)} unidades equivalentes a ingresar</p>;
        })}
      </div>}
      <label className="block"><span className="label">Referencia o nota (opcional)</span><textarea className="field" maxLength={250} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Guía, proveedor u observación del ingreso" /></label>
    </fieldset>
    <button type="button" className="btn-brand w-full" disabled={busy || (!lines.length && !retry)} onClick={() => void submit()}>
      {busy ? 'Registrando…' : retry ? 'Reintentar el mismo ingreso' : `Registrar ingreso (${lines.length} líneas)`}
    </button>
    <FlashBar msg={msg} />
  </section>;
}
