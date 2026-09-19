import { useEffect, useState } from 'react';
import { limit, orderBy, query, where, getDocs } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { CheckCircle2, XCircle } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { ReplenishmentRequest } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { attendReplenishment, rejectReplenishment } from '../../lib/inventory';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function ReplenishmentAdminPage() {
  const [requests, setRequests] = useState<(ReplenishmentRequest & { id: string })[]>([]);
  const [centralWhId, setCentralWhId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const un1 = onSnapshot(
      query(tenantCollection('replenishment_requests'), orderBy('createdAt', 'desc'), limit(100)),
      (s) => {
        const list = s.docs
          .map((d) => ({ ...(d.data() as ReplenishmentRequest), id: d.id }))
          .filter((r) => r.status === 'pendiente');
        setRequests(list);
      }
    );
    getDocs(query(tenantCollection('warehouses'), where('isCentral', '==', true), limit(1))).then((s) => {
      if (!s.empty) setCentralWhId(s.docs[0].id);
    });
    return () => un1();
  }, []);

  const attend = async (r: ReplenishmentRequest & { id: string }) => {
    if (!centralWhId) {
      flash('Error: no hay almacén central configurado');
      return;
    }
    if (!confirm(`¿Crear transferencia del almacén central a ${r.storeName} y marcar como atendida?`)) return;
    setBusyId(r.id);
    try {
      const result = await attendReplenishment({ requestId: r.id, warehouseId: centralWhId });
      flash(`Solicitud atendida: transferencia ${result.code}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo atender'}`);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: ReplenishmentRequest & { id: string }) => {
    if (!confirm('¿Rechazar esta solicitud?')) return;
    try {
      await rejectReplenishment(r.id);
    } catch {
      flash('Error al rechazar');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Solicitudes de reposición</h1>

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
                <div className="flex gap-2">
                  <button className="btn-primary !min-h-9 !px-3 !py-1.5 text-sm" disabled={busyId === r.id} onClick={() => void attend(r)}>
                    <CheckCircle2 size={15} /> Atender con transferencia
                  </button>
                  <button className="btn-danger !min-h-9 !px-3 !py-1.5 text-sm" onClick={() => void reject(r)}>
                    <XCircle size={15} /> Rechazar
                  </button>
                </div>
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {r.items.map((i) => (
                  <li key={i.productId} className="truncate text-xs text-slate-500">
                    {i.name} ({i.presentationLabel ?? 'Unidad base'}) · hay <b className="text-slate-900">{i.currentQty}</b> → pide <b className="text-slate-900">{i.requestedQty}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <FlashBar msg={msg} />
    </div>
  );
}
