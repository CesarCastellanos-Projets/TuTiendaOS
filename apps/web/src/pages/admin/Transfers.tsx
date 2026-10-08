import { usePagedQuery } from '../../hooks/usePagedQuery';
import { Pagination } from '../../components/ui/Pagination';
import { EditableNumberInput } from '../../components/ui/EditableNumberInput';
import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { onSnapshot } from '../../lib/firestore-listener';
import { ArrowRight, Ban, Send } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { cancelTransfer, createTransfer, receiveTransferItems } from '../../lib/inventory';
import { ProductLines, useProductSearch, type PickLine } from '../../components/ui/ProductPicker';
import type { Store, Transfer, TransferStatus, Warehouse } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function TransfersPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<(Transfer & { id: string }) | null>(null);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [resolving, setResolving] = useState<(Transfer & { id: string }) | null>(null);
  const [resolution, setResolution] = useState<'devolver' | 'merma'>('devolver');
  const [reason, setReason] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [lines, setLines] = useState<PickLine[]>([]);
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'todos'>('todos');
  const transferSource = useMemo(() => query(tenantCollection('transfers'), ...(statusFilter === 'todos' ? [] : [where('status', '==', statusFilter)]), orderBy('createdAt', 'desc')), [statusFilter]);
  const pagination = usePagedQuery<Transfer & { id: string }>(transferSource);
  const transfers = pagination.rows;
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const [busy, setBusy] = useState(false);

  // Lista unificada de todas las ubicaciones (Almacenes y Tiendas)
  const allLocations = useMemo(() => {
    return [
      ...warehouses.filter((w) => w.active !== false).map((w) => ({ id: w.id, name: w.name, type: 'warehouse' as const, label: `[Almacén] ${w.name}` })),
      ...stores.filter((s) => s.active !== false).map((s) => ({ id: s.id, name: s.name, type: 'store' as const, label: `[Tienda] ${s.name}` }))
    ];
  }, [warehouses, stores]);

  useEffect(() => {
    const unStores = onSnapshot(
      query(tenantCollection('stores'), limit(50)),
      (s) => setStores(s.docs.map((d) => ({ ...(d.data() as Store), id: d.id })))
    );
    const unWarehouses = onSnapshot(
      query(tenantCollection('warehouses'), limit(50)),
      (s) => setWarehouses(s.docs.map((d) => ({ ...(d.data() as Warehouse), id: d.id })))
    );
    return () => {
      unStores();
      unWarehouses();
    };
  }, []);

  const shown = useMemo(
    () => (statusFilter === 'todos' ? transfers : transfers.filter((t) => t.status === statusFilter)),
    [transfers, statusFilter]
  );

  const create = async () => {
    if (!fromId || !toId || lines.length === 0 || fromId === toId) {
      flash('Error: selecciona origen, destino diferente y al menos un producto');
      return;
    }
    const from = allLocations.find((l) => l.id === fromId);
    const to = allLocations.find((l) => l.id === toId);
    if (!from || !to) {
      flash('Error: ubicación de origen o destino no válida');
      return;
    }

    setBusy(true);
    try {
      const result = await createTransfer({
        fromLocationId: fromId,
        fromLocationType: from.type,
        toLocationId: toId,
        toLocationType: to.type,
        items: lines.map((l) => ({ productId: l.productId, presentationId: l.presentationId, qtySent: l.qty })),
        note: null
      });
      setCreating(false);
      setLines([]);
      setFromId('');
      setToId('');
      flash(`Transferencia ${result.code} enviada de ${from.name} a ${to.name}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo crear'}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (t: Transfer & { id: string }) => {
    if (!confirm('¿Cancelar esta transferencia? El stock no recibido regresará al origen.')) return;
    try {
      await cancelTransfer(t.id);
      flash(`Transferencia ${t.code} cancelada; stock devuelto a ${t.fromLocationName}`);
    } catch {
      flash('Error al cancelar la transferencia');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Transferencias</h1>
          <p className="text-xs text-slate-500">
            Movimiento de mercadería entre cualquier almacén y tienda.
          </p>
        </div>
        <button className="btn-brand" onClick={() => setCreating(true)}>
          <Send size={16} /> Nueva transferencia
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['todos', 'pendiente', 'en_transito', 'recibido', 'cancelado'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
              statusFilter === s
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {s === 'todos' ? 'Todos los estados' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title="Sin transferencias"
          hint="Crea una transferencia para mover mercadería entre tiendas o almacenes."
          action={
            <button className="btn-primary mt-2" onClick={() => setCreating(true)}>
              Crear primera
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((t) => (
            <div key={t.id} className="card p-4 space-y-3 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-primary bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-lg">
                    {t.code}
                  </span>
                  <span
                    className={`badge text-xs font-bold capitalize ${
                      t.status === 'recibido'
                        ? 'bg-emerald-50 text-success'
                        : t.status === 'cancelado'
                        ? 'bg-red-50 text-critical'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {t.status.replace('_', ' ')}
                  </span>
                </div>
                <span className="text-xs text-slate-400 font-medium">{fmtDateTime(t.createdAt)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs">{t.fromLocationName}</span>
                <ArrowRight size={14} className="text-slate-400 shrink-0" />
                <span className="rounded-lg bg-brand-50 text-primary px-2.5 py-1 text-xs">{t.toLocationName}</span>
              </div>

              <ul className="divide-y divide-slate-100 text-xs text-slate-600 bg-slate-50/60 rounded-xl p-2.5 border border-slate-100">
                {t.items.map((i, idx) => (
                  <li key={idx} className="transfer-product flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-slate-800">{i.name}</span>
                    <span className="font-mono font-bold text-slate-700">
                      Enviado: {i.qtySent} {i.presentationLabel ?? 'unidades'} {i.qtyReceived > 0 && `(Recibido: ${i.qtyReceived})`}
                    </span>
                  </li>
                ))}
              </ul>

              {t.status === 'recibido' && t.items.some((item) => item.qtySent > item.qtyReceived) && (
                <div className="rounded-lg bg-amber-50 p-3 text-xs">
                  <p>Faltantes: {t.items.filter((item) => item.qtySent > item.qtyReceived).map((item) => `${item.name}: ${item.qtySent - item.qtyReceived} ${item.presentationLabel ?? 'unidades'}`).join(' · ')}</p>
                  {(!t.shortageStatus || t.shortageStatus === 'pendiente') ? <button className="btn-ghost mt-2" onClick={() => { setResolving(t); setReason(''); }}>Conciliar faltantes</button> : <p>Resolución: {t.shortageStatus === 'devuelto' ? 'Devuelto al origen' : 'Merma en tránsito'}</p>}
                </div>
              )}
              {(t.status === 'pendiente'  || t.status === 'en_transito') && (
                <div className="flex justify-end gap-2 pt-1">
                  {t.toLocationType === 'warehouse' && <button className="btn-primary !min-h-9 !px-3 text-xs" onClick={() => { setReceiving(t); setReceived(Object.fromEntries(t.items.map((item) => [`${item.productId}:${item.presentationId ?? 'base'}`, item.qtySent]))); }}>Recibir en almacén</button>}
                  <button className="btn-danger !min-h-9 !px-3 !py-1.5 text-xs font-bold" onClick={() => void cancel(t)}>
                    <Ban size={14} /> Cancelar y devolver stock
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!receiving} title="Recibir mercadería en almacén" onClose={() => setReceiving(null)}>
        <div className="space-y-3">{receiving?.items.map((item) => {
          const key = `${item.productId}:${item.presentationId ?? 'base'}`;
          return <label key={key} className="block"><span className="label">{item.name} · {item.presentationLabel ?? 'Unidad base'} · enviado: {item.qtySent}</span><EditableNumberInput className="field" min={0} max={item.qtySent} step="any" value={received[key] ?? 0} onChange={(event) => setReceived((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>;
        })}<button className="btn-primary w-full" disabled={busy} onClick={async () => {
          if (!receiving) return;
          setBusy(true);
          try { await receiveTransferItems({ transferId: receiving.id, quantities: received }); setReceiving(null); flash('Recepción registrada.'); }
          catch (cause) { flash(cause instanceof Error ? cause.message : 'No se pudo recibir'); }
          finally { setBusy(false); }
        }}>Confirmar recepción</button></div>
      </Modal>

      {/* ─── MODAL NUEVA TRANSFERENCIA ───────────────────────────────────────── */}
      <Modal open={creating} title="Nueva transferencia de mercadería" onClose={() => setCreating(false)} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Ubicación Origen (Sale stock) *</label>
              <select className="field text-xs font-bold" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">Seleccionar origen…</option>
                {allLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Ubicación Destino (Ingresa stock) *</label>
              <select className="field text-xs font-bold" value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">Seleccionar destino…</option>
                {allLocations
                  .filter((l) => l.id !== fromId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display">
              Productos a Transferir
            </h3>
            <ProductLines lines={lines} setLines={setLines} searchFn={search} />
          </div>

          <button className="btn-brand w-full !py-3 font-bold" disabled={busy || lines.length === 0 || !fromId || !toId} onClick={() => void create()}>
            {busy ? 'Procesando transferencia…' : 'Descontar del origen y enviar mercadería'}
          </button>
          <p className="text-xs text-slate-400 text-center">
            El stock sale del origen inmediatamente y queda pendiente hasta que la ubicación destino confirme su recepción.
          </p>
        </div>
      </Modal>

      <Modal open={resolving !== null} title="Conciliar faltantes" onClose={() => setResolving(null)}>
        <div className="space-y-3">
          <select className="field" value={resolution} onChange={(e) => setResolution(e.target.value as 'devolver' | 'merma')}>
            <option value="devolver">Devolver al origen: mercadería físicamente verificada</option>
            <option value="merma">Registrar pérdida en tránsito</option>
          </select>
          <p className="text-xs text-slate-500">La devolución incrementa el stock de origen. La pérdida registra la merma del tránsito sin volver a descontar el origen.</p>
          <textarea className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} placeholder="Motivo y verificación realizada" />
          <button className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => {
            if (!resolving) return;
            setBusy(true);
            void httpsCallable(functions, 'resolveTransferShortage')({ transferId: resolving.id, action: resolution, reason }).then(() => {
              setResolving(null); flash('Faltante conciliado');
            }).catch((err: unknown) => flash(err instanceof Error ? err.message : 'Error al conciliar')).finally(() => setBusy(false));
          }}>Guardar conciliación</button>
        </div>
      </Modal>
      <Pagination {...pagination} />
      {pagination.error && <p role="alert">{pagination.error}</p>}
      <FlashBar msg={msg} />
    </div>
  );
}
