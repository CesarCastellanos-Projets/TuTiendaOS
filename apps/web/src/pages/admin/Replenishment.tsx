import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where, getDocs, addDoc } from 'firebase/firestore';
import { CheckCircle2, XCircle } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import type { ReplenishmentRequest, Warehouse } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { deductTransferOrigin } from '../../lib/inventory';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function ReplenishmentAdminPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const [requests, setRequests] = useState<(ReplenishmentRequest & { id: string })[]>([]);
  const [centralWhId, setCentralWhId] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const un1 = onSnapshot(
      query(collection(db, 'replenishment_requests'), where('status', '==', 'pendiente'), orderBy('createdAt', 'desc')),
      (s) => setRequests(s.docs.map((d) => ({ ...(d.data() as ReplenishmentRequest), id: d.id })))
    );
    getDocs(query(collection(db, 'warehouses'), where('isCentral', '==', true), limit(1))).then((s) => {
      if (!s.empty) setCentralWhId(s.docs[0].id);
    });
    return () => un1();
  }, []);

  const attend = async (r: ReplenishmentRequest & { id: string }) => {
    if (!user || !centralWhId) {
      flash('Error: no hay almacén central configurado');
      return;
    }
    if (!confirm(`¿Crear transferencia del almacén central a ${r.storeName} y marcar como atendida?`)) return;
    setBusyId(r.id);
    const code = `RP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    try {
      await deductTransferOrigin({
        fromLocationId: centralWhId,
        items: r.items.map((i) => ({ productId: i.productId, name: i.name, qtySent: i.requestedQty })),
        uid: user.uid,
        userName: profile.displayName,
        transferCode: code
      });
      await addTransferDoc(code, r, user.uid, profile.displayName);
      await updateDoc(doc(db, 'replenishment_requests', r.id), { status: 'atendida' });
      flash(`Solicitud atendida: transferencia ${code}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo atender'}`);
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: ReplenishmentRequest & { id: string }) => {
    if (!confirm('¿Rechazar esta solicitud?')) return;
    try {
      await updateDoc(doc(db, 'replenishment_requests', r.id), { status: 'rechazada' });
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
                    {i.name} · hay <b className="text-slate-900">{i.currentQty}</b> → pide <b className="text-slate-900">{i.requestedQty}</b>
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

async function addTransferDoc(
  code: string,
  r: ReplenishmentRequest,
  uid: string,
  userName: string
): Promise<void> {
  const whSnap = await getDocs(query(collection(db, 'warehouses'), where('isCentral', '==', true), limit(1)));
  const central = whSnap.empty ? null : { id: whSnap.docs[0].id, name: (whSnap.docs[0].data() as Warehouse).name };
  if (!central) throw new Error('No hay almacén central configurado');
  await addDoc(collection(db, 'transfers'), {
    code,
    fromLocationId: central.id,
    fromLocationName: central.name,
    toLocationId: r.storeId,
    toLocationName: r.storeName,
    status: 'pendiente',
    items: r.items.map((i) => ({ productId: i.productId, name: i.name, qtySent: i.requestedQty, qtyReceived: 0 })),
    createdBy: uid,
    createdByName: userName,
    createdAt: Date.now(),
    note: `Reposición solicitada por ${r.createdByName}`
  });
}
