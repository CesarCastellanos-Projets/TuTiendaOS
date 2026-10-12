import { useMemo, useState } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { useLocationOptions } from '../../hooks/useLocationOptions';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../lib/auth';
import { tenantCollectionFor } from '../../lib/tenant-firestore';
import { adjustStock } from '../../lib/inventory';
import { ProductLines, useProductSearch, type PickLine } from '../../components/ui/ProductPicker';
import type { StockMovement } from '../../types';
import { fmtDateTime, num, clean } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

export function AdjustmentsPage() {
  const tenantId = useAuth((state) => state.profile!.tenantId);
  const locationOptions = useLocationOptions(tenantId);
  const locations = locationOptions.rows;
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<PickLine[]>([]);
  const [type, setType] = useState<'ajuste' | 'merma' | 'reclasificar'>('ajuste');
  const [reason, setReason] = useState('');
  const source = useMemo(() => query(tenantCollectionFor(tenantId, 'stock_movements'), where('type', 'in', ['ajuste', 'merma', 'conversion']),
    orderBy('createdAt', 'desc')), [tenantId]);
  const pagination = usePagedQuery<StockMovement & { id: string }>(source, 20);
  const movements = pagination.rows;
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!locationId || lines.length !== 1 || !reason.trim()) {
      flash('Error: una ubicación, un producto y un motivo son obligatorios');
      return;
    }
    setBusy(true);
    try {
      await adjustStock({
        locationId,
        productId: lines[0].productId,
        presentationId: lines[0].presentationId,
        newQty: num(String(lines[0].qty)),
        reason,
        type
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
    <div className="adjustments-workspace space-y-5">
      <h1 className="font-display text-2xl uppercase tracking-wide">Ajustes de inventario</h1>

      <div className="card adjustment-editor space-y-5 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Ubicación *</label>
            <select className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Elegir…</option>
              {locations.map((l) => (
                <option key={`${l.source}:${l.id}`} value={l.id}>{l.name}</option>
              ))}
            </select>
            {locationOptions.error && <p className="text-xs text-critical">{locationOptions.error}</p>}
            {(locationOptions.hasNext || locationOptions.error) && <button type="button" className="btn-ghost mt-2 text-xs"
              disabled={locationOptions.loading} onClick={() => void locationOptions.next()}>Cargar más ubicaciones</button>}
          </div>
          <div>
            <label className="label">Tipo *</label>
            <select className="field" value={type} onChange={(e) => setType(e.target.value as 'ajuste' | 'merma' | 'reclasificar')}>
              <option value="ajuste">Ajuste por conteo físico</option>
              <option value="reclasificar">Reclasificar unidades como cajas cerradas (conservar total)</option>
              <option value="merma">Merma / dañado / vencido</option>
            </select>
          </div>
        </div>

        <p className="text-sm text-slate-500">
          {type === 'reclasificar' ? 'Selecciona una caja cerrada y escribe cuántas cajas completas contaste. Su contenido se separará del saldo en unidades sin cambiar el total. Para saldos antes unificados, cuenta cada presentación cerrada (incluso cero); las ventas se habilitan al completar todos los conteos.' : 'Escribe la cantidad final de la presentación elegida. Las cajas cerradas se ajustan por separado; las presentaciones que se pueden abrir ajustan solo el saldo compartido.'}
        </p>
        <ProductLines allowZero lines={lines.slice(0, 1)} setLines={setLines} searchFn={search} />

        <div>
          <label className="label">Motivo *</label>
          <input className="field" value={reason} onChange={(e) => setReason(clean(e.target.value))} placeholder="Ej.: caja aplastada, inventario físico de mayo" />
        </div>

        <button className="btn-brand w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </div>

      <section className="card adjustment-history p-5">
        <h2 className="mb-3 font-semibold">Últimos ajustes y mermas</h2>
        {pagination.error && <p className="text-sm text-critical">No se pudo cargar el historial. {pagination.error}</p>}
        {pagination.loading ? <p className="text-sm text-slate-500">Cargando movimientos…</p> : movements.length === 0 ? (
          <p className="text-sm text-slate-500">Sin movimientos aún.</p>
        ) : (
          <ul className="divide-y divide-linea">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.productName}</p>
                  <p className="text-xs text-slate-500">{m.reason ?? '—'} · {fmtDateTime(m.createdAt)}</p>
                </div>
                <span className={`badge ${m.qty < 0 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                  {m.qty > 0 ? '+' : ''}{m.qty}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Pagination {...pagination} />
      </section>

      <FlashBar msg={msg} />
    </div>
  );
}
