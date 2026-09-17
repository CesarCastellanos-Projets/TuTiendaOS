import { useEffect, useState } from 'react';
import { query, where } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { ArrowDownToLine, CheckCircle2, Truck } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { receiveTransferItems } from '../../lib/inventory';
import type { Transfer } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function ReceivingPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const storeId = profile.storeId!;
  const [transfers, setTransfers] = useState<(Transfer & { id: string })[]>([]);
  const [receivingTransfer, setReceivingTransfer] = useState<(Transfer & { id: string }) | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    return onSnapshot(
      query(
        tenantCollection('transfers'),
        where('toLocationId', '==', storeId),
        where('status', 'in', ['pendiente', 'en_transito'])
      ),
      (s) => setTransfers(s.docs.map((d) => ({ ...(d.data() as Transfer), id: d.id })))
    );
  }, [storeId]);

  const openReceiveModal = (t: Transfer & { id: string }) => {
    setReceivingTransfer(t);
    const initial: Record<string, number> = {};
    t.items.forEach((i) => {
      initial[i.productId] = i.qtySent;
    });
    setQuantities(initial);
  };

  const confirmReceive = async () => {
    if (!receivingTransfer || !user) return;

    for (const item of receivingTransfer.items) {
      const rec = quantities[item.productId] ?? 0;
      if (rec < 0 || rec > item.qtySent) {
        flash(`Error: La cantidad recibida de ${item.name} debe estar entre 0 y ${item.qtySent}`);
        return;
      }
    }

    setBusy(true);
    try {
      await receiveTransferItems({
        transferId: receivingTransfer.id,
        quantities
      });

      flash(`Transferencia ${receivingTransfer.code} recibida con éxito`);
      setReceivingTransfer(null);
    } catch (err) {
      flash(`Error al procesar la recepción: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide">
            <Truck size={22} /> Recepciones de mercadería
          </h1>
          <p className="text-xs text-slate-500">
            Revisa y confirma la mercadería enviada desde el almacén central u otra tienda.
          </p>
        </div>
        {transfers.length > 0 && (
          <span className="badge bg-amber-100 font-bold text-amber-800">
            {transfers.length} {transfers.length === 1 ? 'pendiente' : 'pendientes'}
          </span>
        )}
      </div>

      {transfers.length === 0 ? (
        <EmptyState
          title="Sin transferencias por recibir"
          hint="Cuando el Administrador envíe mercadería a tu tienda aparecerá aquí para que la cuentes y recibas."
        />
      ) : (
        <div className="space-y-3">
          {transfers.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-bold text-primary">{t.code}</p>
                  <p className="text-sm font-semibold">Origen: {t.fromLocationName}</p>
                  <p className="text-xs text-slate-500">
                    Enviado {fmtDateTime(t.createdAt)} por {t.createdByName}
                  </p>
                </div>
                <button
                  className="btn-brand !min-h-9 !px-3 !py-1.5 text-sm"
                  onClick={() => openReceiveModal(t)}
                >
                  <ArrowDownToLine size={15} /> Recibir mercadería
                </button>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-2">
                <p className="mb-1 text-xs font-bold uppercase text-slate-400">Productos en el envío:</p>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {t.items.map((i) => (
                    <li key={i.productId} className="flex justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                      <span className="truncate">{i.name}</span>
                      <b className="font-mono">{i.qtySent} u.</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Conteo y Confirmación */}
      <Modal
        open={receivingTransfer !== null}
        title={`Recibir: ${receivingTransfer?.code}`}
        onClose={() => setReceivingTransfer(null)}
        wide
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Confirma la cantidad física que estás recibiendo en tienda. Si algún producto llegó incompleto o dañado, ajusta el número recibido:
          </p>

          <div className="max-h-72 overflow-y-auto divide-y divide-linea rounded-lg border border-slate-200 bg-white">
            {receivingTransfer?.items.map((item) => (
              <div key={item.productId} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-slate-500">Enviado: {item.qtySent} unidades</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-slate-600">Recibido:</label>
                  <input
                    type="number"
                    min={0}
                    max={item.qtySent}
                    value={quantities[item.productId] ?? item.qtySent}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(item.qtySent, Math.trunc(Number(e.target.value) || 0)));
                      setQuantities({ ...quantities, [item.productId]: val });
                    }}
                    className="field !min-h-0 w-20 !px-2 !py-1.5 text-center font-mono font-bold"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" disabled={busy} onClick={() => setReceivingTransfer(null)}>
              Cancelar
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => void confirmReceive()}>
              <CheckCircle2 size={16} />
              {busy ? 'Sumando al stock…' : 'Confirmar e ingresar al stock'}
            </button>
          </div>
        </div>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}
