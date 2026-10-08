import { EditableNumberInput } from '../../components/ui/EditableNumberInput';
import { useEffect, useState } from 'react';
import { query, where, limit } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { ArrowDownToLine, CheckCircle2, Truck } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { receiveTransferItems } from '../../lib/inventory';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import { baseQuantityStep } from '../../lib/stock-availability';
import type { Transfer, TransferItem } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function ReceivingPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const storeId = profile.storeId!;
  const products = useProductsCatalog();
  const quantityStep = (item: TransferItem) => {
    const product = products.find((p) => p.id === item.productId);
    const presentation = product?.presentations?.find((p, index) => (p.id || `legacy-${index + 1}`) === item.presentationId);
    return item.presentationId ? (presentation?.autoUnpackEnabled ? 1 / (item.factor ?? 1) : 1) : baseQuantityStep(product?.unit);
  };
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
        where('status', 'in', ['pendiente', 'en_transito']), limit(100)
      ),
      (s) => setTransfers(s.docs.map((d) => ({ ...(d.data() as Transfer), id: d.id })))
    );
  }, [storeId]);

  const openReceiveModal = (t: Transfer & { id: string }) => {
    setReceivingTransfer(t);
    const initial: Record<string, number> = {};
    t.items.forEach((i) => {
      initial[`${i.productId}:${i.presentationId ?? 'base'}`] = i.qtySent;
    });
    setQuantities(initial);
  };

  const confirmReceive = async () => {
    if (!receivingTransfer || !user) return;

    for (const item of receivingTransfer.items) {
      const rec = quantities[`${item.productId}:${item.presentationId ?? 'base'}`] ?? 0;
      if (!Number.isFinite(rec) || rec < 0 || rec > item.qtySent || Math.abs(rec / quantityStep(item) - Math.round(rec / quantityStep(item))) > 0.000001) {
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
    <div className="mx-auto w-full max-w-4xl space-y-5">
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
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {t.items.map((i) => (
                    <li
                      key={`${i.productId}:${i.presentationId ?? 'base'}`}
                      className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="font-semibold text-slate-800 block">{i.name}</span>
                        {i.presentationId ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-primary">
                             {i.presentationLabel}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Unidad suelta</span>
                        )}
                      </div>
                      <b className="font-mono text-slate-900 shrink-0">
                        {i.qtySent} {i.presentationId ? 'presentaciones' : 'un.'}
                      </b>
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
            {receivingTransfer?.items.map((item) => {
              const quantityKey = `${item.productId}:${item.presentationId ?? 'base'}`;
              return (
                <div key={quantityKey} className="receiving-line flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.presentationId ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-md bg-brand-50 border border-brand-200 px-1.5 py-0.5 text-xs font-extrabold text-primary">
                             {item.presentationLabel}
                          </span>
                          <span className="text-xs text-slate-500">
                            Enviado: <b>{item.qtySent} presentaciones</b> ({item.qtySent * (item.factor ?? 1)} un. base)
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600">
                            Unidad suelta
                          </span>
                          <span className="text-xs text-slate-500">
                            Enviado: <b>{item.qtySent} unidades</b>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="text-xs font-bold text-slate-600">
                      {item.presentationId ? 'Presentaciones:' : 'Unidades:'}
                    </label>
                    <EditableNumberInput
                      type="number"
                      min={0}
                      max={item.qtySent}
                      step={quantityStep(item)}
                      value={quantities[quantityKey] ?? item.qtySent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setQuantities({ ...quantities, [quantityKey]: val });
                      }}
                      className="field !min-h-0 w-20 !px-2 !py-1 text-center font-mono text-sm font-extrabold"
                    />
                  </div>
                </div>
              );
            })}
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
