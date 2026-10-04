import { useEffect, useState } from 'react';
import { query, updateDoc, where, limit } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { Printer, X, Calendar, CreditCard, ChevronRight } from 'lucide-react';
import { tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import type { Sale, SunatStatus } from '../../types';
import { fmtDateTime, money } from '../../lib/utils';
import { printTicket, ticketHtml } from '../../lib/print';
import { PAYMENT_LABELS, salePayments } from '../../lib/payments';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

export function MySales() {
  const user = useAuth((s) => s.user);
  const profile = useAuth((s) => s.profile);
  const company = useCompany();
  const [sales, setSales] = useState<(Sale & { id: string })[]>([]);
  const [requesting, setRequesting] = useState<(Sale & { id: string }) | null>(null);
  const [viewingSale, setViewingSale] = useState<(Sale & { id: string }) | null>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    if (!user || !profile?.storeId) return;
    return onSnapshot(
      query(
        tenantCollection('sales'),
        where('userId', '==', user.uid),
        where('storeId', '==', profile.storeId),
        limit(50)
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as Sale), id: d.id }));
        list.sort((a, b) => b.createdAt - a.createdAt);
        setSales(list.slice(0, 30));
      },
      (err) => {
        console.error('Error al escuchar ventas de caja:', err);
      }
    );
  }, [profile?.storeId, user]);

  const requestAnulation = async (reason: string) => {
    if (!user || !profile || !requesting || !reason.trim()) return;
    try {
      await updateDoc(tenantDoc('sales', requesting.id), {
        anulationRequest: {
          reason: reason.trim(),
          byUserId: user.uid,
          byUserName: profile.displayName,
          requestedAt: Date.now()
        },
        anulationStatus: 'solicitada'
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
            <div
              key={s.id}
              onClick={() => setViewingSale(s)}
              className={`card flex flex-wrap items-center gap-3 p-3.5 hover:border-primary/40 hover:bg-indigo-50/20 transition-all cursor-pointer group shadow-xs ${s.status === 'anulada' ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold group-hover:text-primary transition-colors">
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
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn-ghost !min-h-8 !px-2.5 !py-1 text-xs font-semibold"
                  onClick={() => { void printTicket(ticketHtml(s, company ?? undefined)).catch(() => flash('No se pudo abrir la impresión. Inténtalo de nuevo.')); }}
                  title="Reimprimir ticket térmico"
                >
                  <Printer size={13} className="mr-1 inline" />
                  Reimprimir
                </button>
                {s.status === 'activa' && !s.anulationRequest && s.total >= (company?.umbralConsolidacion ?? 5) && (
                  <button
                    className="btn-danger !min-h-8 !px-2.5 !py-1 text-xs"
                    onClick={() => setRequesting(s)}
                  >
                    Anular
                  </button>
                )}
                <ChevronRight size={16} className="text-slate-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-1" />
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

      {/* Modal Detalle de Venta */}
      {viewingSale && (
        <SaleDetailModal
          sale={viewingSale}
          company={company}
          onPrintError={() => flash('No se pudo abrir la impresión. Inténtalo de nuevo.')}
          onClose={() => setViewingSale(null)}
          onRequestAnulation={() => setRequesting(viewingSale)}
        />
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
    error: 'bg-red-50 text-critical',
    no_enviado: 'bg-slate-100 text-slate-500',
    no_aplica: 'bg-slate-100 text-slate-600'
  };
  return <span className={`badge ${map[status]}`}>{status}</span>;
}

function SaleDetailModal({
  sale,
  company,
  onPrintError,
  onClose,
  onRequestAnulation
}: {
  sale: Sale & { id: string };
  company: ReturnType<typeof useCompany>;
  onPrintError: () => void;
  onClose: () => void;
  onRequestAnulation: () => void;
}) {
  const isAnulada = sale.status === 'anulada';
  const typeLabel =
    sale.type === 'factura'
      ? 'Factura Electrónica'
      : sale.type === 'nota'
      ? 'Nota de Venta'
      : 'Boleta de Venta';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <article className="w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
        {/* Barra superior decorativa */}
        <div className={`h-1.5 w-full ${isAnulada ? 'bg-red-500' : 'bg-linear-to-r from-primary to-indigo-500'}`} />

        {/* Cabecera */}
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/60">
          <div>
            <div className="flex items-center gap-2">
              <span className="badge bg-indigo-50 text-primary font-extrabold text-[11px]">
                {typeLabel}
              </span>
              {isAnulada && (
                <span className="badge bg-red-100 text-red-700 font-extrabold text-[11px]">
                  ANULADA
                </span>
              )}
              {sale.consolidated && (
                <span className="badge bg-slate-100 text-slate-600 text-[10px]">
                  Consolidada
                </span>
              )}
            </div>
            <h2 className="text-xl font-display font-extrabold font-mono text-slate-900 mt-1">
              {sale.code}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <Calendar size={13} className="text-slate-400" />
              {fmtDateTime(sale.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0 shadow-xs"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Tarjeta de Datos de Emisión */}
          <div className="grid grid-cols-2 gap-2 text-xs rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3.5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Cajero / Turno
              </span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {sale.userName}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Tienda
              </span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {sale.storeName}
              </span>
            </div>
            <div className="col-span-2 pt-2 border-t border-slate-200/60 mt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Cliente
              </span>
              <span className="font-semibold text-slate-800 block mt-0.5">
                {sale.clientDoc?.numero ? (
                  <>
                    <span className="font-mono font-bold text-primary mr-1">
                      [{sale.clientDoc.tipo || 'DOC'} {sale.clientDoc.numero}]
                    </span>
                    {sale.clientDoc.nombre || 'Cliente'}
                  </>
                ) : (
                  'Venta al paso (Clientes Varios)'
                )}
              </span>
            </div>
          </div>

          {/* Método de Pago y SUNAT */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Método de Pago
              </span>
              <p className="font-bold text-sm text-slate-800 uppercase mt-0.5 flex items-center gap-1.5">
                <CreditCard size={14} className="text-primary" />
                {PAYMENT_LABELS[sale.paymentMethod]}
              </p>
              {salePayments(sale).map((part) => <p key={part.method} className="mt-1 text-xs text-slate-600">{PAYMENT_LABELS[part.method]}: {money(part.amount)}{part.operationNumber ? ` · Op. ${part.operationNumber}` : ''}</p>)}
              {sale.bankName && (
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Banco: {sale.bankName}
                </span>
              )}
              {sale.paidAmount > 0 && (
                <div className="text-[11px] text-slate-500 mt-1 pt-1 border-t border-slate-100 flex justify-between">
                  <span>Pagó: {money(sale.paidAmount)}</span>
                  {sale.changeAmount > 0 && <span>Vuelto: {money(sale.changeAmount)}</span>}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Estado SUNAT
                </span>
                <div className="mt-1">
                  <SunatBadge status={sale.sunatStatus} />
                </div>
              </div>
              {sale.sunatMessage && (
                <p className="text-[10px] text-slate-500 truncate mt-1" title={sale.sunatMessage}>
                  {sale.sunatMessage}
                </p>
              )}
            </div>
          </div>

          {/* Lista de Productos */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Productos Comprados ({sale.items.length})
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 text-[10px] font-bold uppercase">
                  <tr>
                    <th className="py-2.5 px-3 text-left">Ítem</th>
                    <th className="py-2.5 px-2 text-center">Cant.</th>
                    <th className="py-2.5 px-2 text-right">P. Unit.</th>
                    <th className="py-2.5 px-3 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {sale.items.map((it, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3">
                        <span className="font-bold text-slate-800 block">{it.name}</span>
                        {it.presentationUnit && (
                          <span className="text-[10px] text-slate-400 block">
                            Presentación: {it.presentationUnit}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center font-bold text-slate-700">
                        {it.qty}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-slate-600">
                        {money(it.unitPrice)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {money(it.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Desglose de Totales */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-500">
              <span>Op. Gravada (Subtotal)</span>
              <span className="font-mono font-semibold">{money(sale.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>IGV (18%)</span>
              <span className="font-mono font-semibold">{money(sale.igv)}</span>
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-slate-200 text-slate-900">
              <span className="font-bold text-sm uppercase">Total Pagado</span>
              <span className="price-tag font-mono text-2xl font-extrabold text-primary">
                {money(sale.total)}
              </span>
            </div>
          </div>

          {/* Mensaje de anulación si aplica */}
          {sale.anulationRequest && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <span className="font-bold block">
                {sale.anulationStatus === 'anulada'
                  ? 'Venta anulada mediante nota de crédito'
                  : sale.anulationStatus === 'nc_pendiente'
                    ? 'Nota de crédito en proceso'
                    : sale.anulationStatus === 'error'
                      ? 'La nota de crédito requiere revisión'
                      : 'Solicitud de anulación pendiente'}
              </span>
              <p className="text-[11px] mt-0.5 text-amber-800">
                Motivo: “{sale.anulationRequest.reason}”
              </p>
            </div>
          )}
        </div>

        {/* Acciones del Modal */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
          <button
            className="btn-primary !py-2.5 !px-4 text-xs font-bold flex items-center gap-1.5"
            onClick={() => { void printTicket(ticketHtml(sale, company ?? undefined)).catch(onPrintError); }}
          >
            <Printer size={15} /> Reimprimir Ticket
          </button>

          <div className="flex items-center gap-2">
            {!isAnulada && !sale.anulationRequest && sale.total >= (company?.umbralConsolidacion ?? 5) && (
              <button
                className="btn-danger !py-2.5 !px-3 text-xs font-bold"
                onClick={() => {
                  onClose();
                  onRequestAnulation();
                }}
              >
                Anular
              </button>
            )}
            <button
              className="btn-ghost !py-2.5 !px-4 text-xs font-bold"
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}
