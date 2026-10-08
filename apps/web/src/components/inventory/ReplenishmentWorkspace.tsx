import { useEffect, useState, useMemo } from 'react';
import { limit, query, where, getDocs, startAfter } from 'firebase/firestore';
import { useReplenishments, pendingReplenishmentQuery, REPLENISHMENT_PAGE_SIZE, type PendingReplenishment } from '../../hooks/useReplenishments';
import { CheckCircle2, XCircle } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { ReplenishmentRequest } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { attendReplenishment, rejectReplenishment } from '../../lib/inventory';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function ReplenishmentWorkspace() {
  const { items, allowed, loading, error } = useReplenishments();
  const [older, setOlder] = useState<PendingReplenishment[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [more, setMore] = useState(true);
  const requests = useMemo(() => [...new Map([...older, ...items].map((item) => [item.id, item])).values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)), [items, older]);
  const [centralWhId, setCentralWhId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    getDocs(query(tenantCollection('warehouses'), where('isCentral', '==', true), limit(1))).then((s) => {
      if (active && !s.empty) setCentralWhId(s.docs[0].id);
    }).catch(() => flash('No se pudo cargar el almacén central.'));
    return () => { active = false; };
  }, [allowed, flash]);

  const attend = async (r: ReplenishmentRequest & { id: string }) => {
    if (!centralWhId) {
      flash('Error: no hay almacén central configurado');
      return;
    }
    if (!confirm(`¿Crear transferencia del almacén central a ${r.storeName} y marcar como atendida?`)) return;
    setBusyId(r.id);
    try {
      const result = await attendReplenishment({ requestId: r.id, warehouseId: centralWhId });
      setOlder((rows) => rows.filter((row) => row.id !== r.id));
      flash(`Solicitud atendida: transferencia ${result.code}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo atender'}`);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: ReplenishmentRequest & { id: string }) => {
    if (!confirm('¿Rechazar esta solicitud?')) return;
    setBusyId(r.id);
    try {
      await rejectReplenishment(r.id);
      setOlder((rows) => rows.filter((row) => row.id !== r.id));
    } catch {
      flash('Error al rechazar');
    } finally { setBusyId(null); }
  };

  const loadMore = async () => {
    const last = requests.at(-1);
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getDocs(query(pendingReplenishmentQuery(), startAfter(last.createdAt, last.id)));
      setOlder((rows) => [...rows, ...page.docs.map((doc) => ({ ...doc.data(), id: doc.id } as PendingReplenishment))]);
      setMore(page.size === REPLENISHMENT_PAGE_SIZE);
    } catch { flash('No se pudieron cargar más solicitudes.'); }
    finally { setLoadingMore(false); }
  };
  if (!allowed) return <p className="p-4 text-sm text-critical">Tu cuenta no puede aprobar reposiciones.</p>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Solicitudes de reposición</h1>

      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Cargando solicitudes…</p>}
      {!centralWhId && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
          Marca un almacén como "central" para poder atender solicitudes.
        </p>
      )}

      {requests.length === 0 ? (
        <EmptyState title="Sin solicitudes pendientes" hint="Cuando el POS pida reposición aparecerá aquí." />
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.storeName}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDateTime(r.createdAt)} · por {r.createdByName}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary !min-h-9 !px-3 !py-1.5 text-sm" disabled={busyId !== null} onClick={() => void attend(r)}>
                    <CheckCircle2 size={15} /> Crear transferencia
                  </button>
                  <button className="btn-danger !min-h-9 !px-3 !py-1.5 text-sm" disabled={busyId !== null} onClick={() => void reject(r)}>
                    <XCircle size={15} /> Rechazar
                  </button>
                </div>
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {r.items.map((i) => (
                  <li key={`${i.productId}:${i.presentationId ?? 'base'}`} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {i.name} ({i.presentationLabel ?? 'Unidad base'}) · hay <b className="text-slate-900">{i.currentQty}</b> → pide <b className="text-slate-900">{i.requestedQty}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {more && requests.length >= REPLENISHMENT_PAGE_SIZE && <button className="btn-ghost w-full" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Cargando…' : 'Cargar más solicitudes'}</button>}
      <FlashBar msg={msg} />
    </div></div>
  );
}
