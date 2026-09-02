import { useEffect, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { adjustStock } from '../../lib/inventory';
import { ProductLines, useProductSearch } from '../../components/ui/ProductPicker';
import type { StockMovement, Store, Warehouse } from '../../types';
import { fmtDateTime, num, clean } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

export function AdjustmentsPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number; salePrice: number; barcode?: string }[]>([]);
  const [type, setType] = useState<'ajuste' | 'merma'>('ajuste');
  const [reason, setReason] = useState('');
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const [st, wh] = await Promise.all([
        getDocs(query(collection(db, 'stores'), limit(50))),
        getDocs(query(collection(db, 'warehouses'), limit(50)))
      ]);
      const locs: { id: string; name: string }[] = [];
      st.forEach((d) => locs.push({ id: d.id, name: (d.data() as Store).name }));
      wh.forEach((d) => locs.push({ id: d.id, name: (d.data() as Warehouse).name }));
      setLocations(locs);
    }
    void load();
    return onSnapshot(
      query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc'), limit(100)),
      (s) => {
        const list = s.docs
          .map((d) => d.data() as StockMovement)
          .filter((m) => m.type === 'ajuste' || m.type === 'merma');
        setMovements(list.slice(0, 20));
      }
    );
  }, []);

  const submit = async () => {
    if (!user || !locationId || lines.length !== 1 || !reason.trim()) {
      flash('Error: una ubicación, un producto y un motivo son obligatorios');
      return;
    }
    setBusy(true);
    try {
      await adjustStock({
        locationId,
        productId: lines[0].productId,
        productName: lines[0].name,
        newQty: Math.max(0, Math.trunc(num(String(lines[0].qty)))),
        reason,
        type,
        uid: user.uid,
        userName: profile.displayName
      });
      flash(`${type === 'merma' ? 'Merma' : 'Ajuste'} registrado`);
      setLines([]);
      setReason('');
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo ajustar'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Ajustes de inventario</h1>

      <div className="card max-w-2xl space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Ubicación *</label>
            <select className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Elegir…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Tipo *</label>
            <select className="field" value={type} onChange={(e) => setType(e.target.value as 'ajuste' | 'merma')}>
              <option value="ajuste">Ajuste por conteo físico</option>
              <option value="merma">Merma / dañado / vencido</option>
            </select>
          </div>
        </div>

        <p className="text-sm text-slate-500">
          Busca el producto y escribe la <b>cantidad final</b> contada en la ubicación.
        </p>
        <ProductLines lines={lines.slice(0, 1)} setLines={setLines} searchFn={search} />

        <div>
          <label className="label">Motivo *</label>
          <input className="field" value={reason} onChange={(e) => setReason(clean(e.target.value))} placeholder="Ej.: caja aplastada, inventario físico de mayo" />
        </div>

        <button className="btn-brand w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Últimos ajustes y mermas</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-slate-500">Sin movimientos aún.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {movements.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.productName}</p>
                  <p className="truncate text-xs text-slate-500">{m.reason ?? '—'} · {fmtDateTime(m.createdAt)}</p>
                </div>
                <span className={`badge ${m.qty < 0 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                  {m.qty > 0 ? '+' : ''}{m.qty}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FlashBar msg={msg} />
    </div>
  );
}
