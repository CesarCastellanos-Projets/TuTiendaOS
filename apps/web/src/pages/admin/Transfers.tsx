import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ArrowRight, Ban, Send } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { deductTransferOrigin, restockCancelledTransfer } from '../../lib/inventory';
import { ProductLines, useProductSearch } from '../../components/ui/ProductPicker';
import type { Store, Transfer, TransferStatus, Warehouse } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function TransfersPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const [stores, setStores] = useState<Store[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([]);
  const [creating, setCreating] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; qty: number; salePrice: number; barcode?: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'todos'>('todos');
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onSnapshot(query(collection(db, 'stores'), limit(50)), (s) => setStores(s.docs.map((d) => ({ ...(d.data() as Store), id: d.id }))));
    onSnapshot(query(collection(db, 'warehouses'), limit(50)), (s) => setWarehouses(s.docs.map((d) => ({ ...(d.data() as Warehouse), id: d.id }))));
    return onSnapshot(
      query(collection(db, 'transfers'), where('status', 'in', ['pendiente', 'en_transito', 'recibido', 'cancelado']), orderBy('createdAt', 'desc'), limit(50)),
      (s) => setTransfers(s.docs.map((d) => ({ ...(d.data() as Transfer), id: d.id })))
    );
  }, []);

  const shown = useMemo(
    () => (statusFilter === 'todos' ? transfers : transfers.filter((t) => t.status === statusFilter)),
    [transfers, statusFilter]
  );

  const create = async () => {
    if (!user || !fromId || !toId || lines.length === 0 || fromId === toId) {
      flash('Error: revisa origen, destino y productos');
      return;
    }
    const from = [...warehouses.map((w) => ({ ...w, kind: 'warehouse' as const })), ...stores.map((s) => ({ ...s, kind: 'store' as const }))].find((l) => l.id === fromId);
    const to = stores.find((s) => s.id === toId);
    if (!from || !to) return;

    setBusy(true);
    const code = `TR-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    try {
      await deductTransferOrigin({
        fromLocationId: fromId,
        items: lines.map((l) => ({ productId: l.productId, name: l.name, qtySent: l.qty })),
        uid: user.uid,
        userName: profile.displayName,
        transferCode: code
      });
      await setDoc(doc(collection(db, 'transfers')), {
        code,
        fromLocationId: fromId,
        fromLocationName: from.name,
        toLocationId: toId,
        toLocationName: to.name,
        status: 'pendiente',
        items: lines.map((l) => ({ productId: l.productId, name: l.name, qtySent: l.qty, qtyReceived: 0 })),
        createdBy: user.uid,
        createdByName: profile.displayName,
        createdAt: Date.now(),
        note: null
      });
      setCreating(false);
      setLines([]);
      flash(`Transferencia ${code} enviada a ${to.name}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo crear'}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (t: Transfer & { id: string }) => {
    if (!user) return;
    if (!confirm('¿Cancelar esta transferencia? El stock no recibido regresará al origen.')) return;
    try {
      await updateDoc(doc(db, 'transfers', t.id), {
        status: 'cancelado',
        receivedBy: null,
        receivedByName: null,
        receivedAt: null
      });
      await restockCancelledTransfer({
        fromLocationId: t.fromLocationId,
        items: t.items,
        uid: user.uid,
        userName: profile.displayName,
        transferCode: t.code
      });
      flash(`${t.code} cancelada y stock devuelto`);
    } catch {
      flash('Error al cancelar');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Transferencias</h1>
        <div className="flex items-center gap-2">
          <select className="field !min-h-9 w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as TransferStatus | 'todos')}>
            <option value="todos">Todos</option>
            <option value="pendiente">Pendientes</option>
            <option value="en_transito">En tránsito</option>
            <option value="recibido">Recibidas</option>
            <option value="cancelado">Canceladas</option>
          </select>
          <button className="btn-brand" onClick={() => setCreating(true)}>
            <Send size={16} /> Nueva transferencia
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Sin transferencias" hint="Envía mercadería del almacén central a tus tiendas." />
      ) : (
        <div className="space-y-3">
          {shown.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-semibold">{t.code}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    {t.fromLocationName} <ArrowRight size={14} className="text-slate-500" /> {t.toLocationName}
                  </p>
                  <p className="text-xs text-slate-500">{fmtDateTime(t.createdAt)} · por {t.createdByName}</p>
                </div>
                <TransferBadge status={t.status} />
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {t.items.map((i) => (
                  <li key={i.productId} className="truncate text-xs text-slate-500">
                    {i.name} · <b className="text-slate-900">{i.qtySent}</b>{' '}
                    {i.qtyReceived > 0 && `(recibió ${i.qtyReceived})`}
                  </li>
                ))}
              </ul>
              {(t.status === 'pendiente' || t.status === 'en_transito') && (
                <div className="mt-3 text-right">
                  <button className="btn-danger !min-h-9 !px-3 !py-1.5 text-sm" onClick={() => void cancel(t)}>
                    <Ban size={14} /> Cancelar y devolver stock
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} title="Nueva transferencia" onClose={() => setCreating(false)} wide>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Origen *</label>
              <select className="field" value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">Elegir…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>[Almacén] {w.name}</option>
                ))}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>[Tienda] {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Destino (tienda) *</label>
              <select className="field" value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">Elegir…</option>
                {stores.filter((s) => s.id !== fromId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <ProductLines
            lines={lines}
            setLines={setLines}
            searchFn={search}
          />

          <button className="btn-brand w-full" disabled={busy} onClick={() => void create()}>
            {busy ? 'Procesando…' : 'Descontar del origen y enviar'}
          </button>
          <p className="text-xs text-slate-500">
            El stock sale del origen ahora; la tienda lo suma cuando el cajero recibe la transferencia.
          </p>
        </div>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}

function TransferBadge({ status }: { status: TransferStatus }) {
  const map: Record<TransferStatus, string> = {
    pendiente: 'bg-amber-100 text-amber-800',
    en_transito: 'bg-blue-50 text-blue-600',
    recibido: 'bg-emerald-50 text-success',
    cancelado: 'bg-slate-100 text-slate-500 line-through'
  };
  return <span className={`badge ${map[status]}`}>{status.replace('_', ' ')}</span>;
}
