import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc, where, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import type { Sale, SunatStatus } from '../../types';
import { fmtDateTime, money } from '../../lib/utils';
import { printTicket, ticketHtml } from '../../lib/print';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function MySales() {
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const company = useCompany();
  const [sales, setSales] = useState<(Sale & { id: string })[]>([]);
  const [requesting, setRequesting] = useState<(Sale & { id: string }) | null>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(
        collection(db, 'sales'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(30)
      ),
      (snap) => setSales(snap.docs.map((d) => ({ ...(d.data() as Sale), id: d.id })))
    );
  }, [user]);

  const requestAnulation = async (reason: string) => {
    if (!user || !profile || !requesting || !reason.trim()) return;
    try {
      await updateDoc(doc(db, 'sales', requesting.id), {
        anulationRequest: {
          reason: reason.trim(),
          byUserId: user.uid,
          byUserName: profile.displayName,
          requestedAt: Date.now()
        }
      });
      flash(`Anulación de ${requesting.code} enviada al administrador`);
      setRequesting(null);
    } catch {
      flash('Error al solicitar la anulación');
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Mis ventas</h1>

      {sales.length === 0 ? (
        <EmptyState title="Aún no vendes nada" hint="Tus comprobantes aparecerán aquí." />
      ) : (
        <div className="space-y-2">
          {sales.map((s) => (
            <div key={s.id} className={`card flex flex-wrap items-center gap-3 p-3.5 ${s.status === 'anulada' ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold">
                  {s.code}
                  {s.consolidated ? ' · consolidado' : ''}
                  {s.status === 'anulada' ? ' · ANULADA' : ''}
                </p>
                <p className="text-xs text-slate-500">
                  {fmtDateTime(s.createdAt)} · {s.items.length} ítems · {s.paymentMethod}
                </p>
              </div>
              <SunatBadge status={s.sunatStatus} />
              <span className="font-mono font-semibold">{money(s.total)}</span>
              <div className="flex gap-1.5">
                <button
                  className="btn-ghost !min-h-8 !px-2 !py-1 text-xs"
                  onClick={() => printTicket(ticketHtml(s, company ?? undefined))}
                >
                  Reimprimir
                </button>
                {s.status === 'activa' && !s.anulationRequest && s.total >= (company?.umbralConsolidacion ?? 5) && (
                  <button
                    className="btn-danger !min-h-8 !px-2 !py-1 text-xs"
                    onClick={() => setRequesting(s)}
                  >
                    Anular
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {sales.some((s) => s.anulationRequest) && (
        <p className="text-center text-xs text-slate-500">
          Hay solicitudes de anulación esperando autorización del administrador.
        </p>
      )}

      <ModalReason
        open={requesting !== null}
        code={requesting?.code ?? ''}
        onCancel={() => setRequesting(null)}
        onSubmit={requestAnulation}
      />

      <FlashBar msg={msg} />
    </div>
  );
}

function ModalReason({
  open,
  code,
  onCancel,
  onSubmit
}: {
  open: boolean;
  code: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (!open) setReason('');
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-slate-900/50 sm:place-items-center">
      <div className="card w-full rounded-b-none p-4 sm:max-w-sm sm:rounded-xl">
        <p className="font-semibold">Solicitar anulación de {code}</p>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (el admin lo revisará)"
          className="field mt-2"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className="btn-brand" disabled={!reason.trim()} onClick={() => onSubmit(reason)}>
            Enviar solicitud
          </button>
        </div>
      </div>
    </div>
  );
}

function SunatBadge({ status }: { status: SunatStatus }) {
  const map: Record<SunatStatus, string> = {
    aceptado: 'bg-emerald-50 text-success',
    rechazado: 'bg-red-50 text-critical',
    observado: 'bg-amber-100 text-amber-800',
    pendiente: 'bg-blue-50 text-blue-600',
    no_enviado: 'bg-slate-100 text-slate-500'
  };
  return <span className={`badge ${map[status]}`}>{status}</span>;
}
