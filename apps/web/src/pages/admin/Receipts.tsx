import { SaleCompensation } from '../../components/inventory/SaleCompensation';
import { useEffect, useMemo, useState } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { Pagination } from '../../components/ui/Pagination';
import { peruToday } from '../../lib/calendar';
import { csvCell } from '../../lib/csv';
import { CheckCircle2, Download, RefreshCw, Send, Layers } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { Sale, SunatStatus } from '../../types';
import { fmtDateTime, money } from '../../lib/utils';
import { PAYMENT_LABELS, salePayments } from '../../lib/payments';
import { sendToSunat, sendCreditNote, sendDailySummary } from '../../services/sunat';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

type Filter = SunatStatus | 'todos' | 'anulaciones';

export function ReceiptsPage() {
  const [filter, setFilter] = useState<Filter>('rechazado');
  const source = useMemo(() => query(tenantCollection('sales'),
    ...(filter === 'anulaciones' ? [where('anulationStatus', 'in', ['solicitada', 'nc_pendiente', 'error'])]
      : filter === 'todos' ? [] : [where('sunatStatus', '==', filter)]), orderBy('createdAt', 'desc')), [filter]);
  const pagination = usePagedQuery<Sale & { id: string }>(source);
  const sales = pagination.rows;
  const [compensating, setCompensating] = useState<(Sale & { id: string }) | null>(null);
  const [busyBatch, setBusyBatch] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => { if (pagination.error) flash(pagination.error); }, [pagination.error, flash]);

  const authorizeAnulation = async (sale: Sale & { id: string }) => {
    const req = sale.anulationRequest;
    if (!req) return;
    if (!confirm(`¿Autorizar anulación de ${sale.code}? Se emitirá nota de crédito vía Greenter.`)) return;
    try {
      const result = await sendCreditNote(sale.id);
      flash(result.status === 'aceptado'
        ? `${sale.code} anulada; nota de crédito aceptada`
        : `${sale.code}: ${result.message || 'la nota de crédito quedó pendiente'}`);
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : 'Error al autorizar');
    }
  };

  const retrySunat = async (sale: Sale & { id: string }) => {
    flash(`Reenviando ${sale.code} a SUNAT…`);
    try { await sendToSunat(sale.id); } catch (cause) { flash(cause instanceof Error ? cause.message : 'No se pudo enviar'); }
  };

  const retryAllPending = async () => {
    const pendingSales = sales.filter(
      (s) => !s.consolidated && s.status === 'activa' && (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado')
    );
    if (pendingSales.length === 0) {
      flash('No hay comprobantes pendientes para reenviar');
      return;
    }
    setBusyBatch(true);
    flash(`Reenviando lote de ${pendingSales.length} comprobantes…`);
    try {
      for (const s of pendingSales) {
        await sendToSunat(s.id);
      }
      flash(`Lote de ${pendingSales.length} comprobantes procesado`);
    } catch {
      flash('Error durante el reenvío masivo');
    } finally {
      setBusyBatch(false);
    }
  };

  const createDailySummary = async () => {
    const todayStr = peruToday();
    if (!confirm(`¿Preparar el siguiente lote de hasta 200 boletas del ${todayStr}? Los lotes pendientes continuarán automáticamente.`)) return;

    setBusyBatch(true);
    try {
      const res = await sendDailySummary(todayStr);
      flash(res.message);
    } catch (cause) {
      flash(cause instanceof Error ? cause.message : 'No se pudo preparar el resumen.');
    } finally {
      setBusyBatch(false);
    }
  };

  const exportCsv = () => {
    if (sales.length === 0) {
      flash('No hay comprobantes para exportar');
      return;
    }
    const headers = ['Tipo', 'Comprobante', 'Fecha', 'Documento Cliente', 'Nombre Cliente', 'Subtotal', 'IGV', 'Total', 'Metodo Pago', 'Desglose Pagos', 'Estado SUNAT', 'Mensaje SUNAT', 'Estado'];
    const rows = sales.map((s) => [
      s.type.toUpperCase(),
      s.code,
      fmtDateTime(s.createdAt),
      `${s.clientDoc.tipo}: ${s.clientDoc.numero || '-'}`,
      s.clientDoc.nombre || 'Consumidor final',
      s.subtotal.toFixed(2),
      s.igv.toFixed(2),
      s.total.toFixed(2),
      PAYMENT_LABELS[s.paymentMethod],
      salePayments(s).map((part) => `${PAYMENT_LABELS[part.method]}: ${part.amount.toFixed(2)}`).join(' / '),
      s.sunatStatus,
      s.sunatMessage || '',
      s.status
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobantes_${filter}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Reporte CSV descargado');
  };

  const totals = useMemo(() => sales.reduce((s, x) => s + x.total, 0), [sales]);
  const pendingCount = useMemo(
    () => sales.filter(
      (s) => !s.consolidated && s.status === 'activa' && (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado')
    ).length,
    [sales]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Comprobantes y SUNAT</h1>
          <p className="text-xs text-slate-500">Gestión de boletas, facturas, notas de crédito y estados de envío.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <button
              className="btn-sol flex items-center gap-1.5 !min-h-9 !px-3 text-xs"
              disabled={busyBatch}
              onClick={() => void retryAllPending()}
            >
              <RefreshCw size={14} className={busyBatch ? 'animate-spin' : ''} />
              Reenviar {pendingCount} pendientes
            </button>
          )}
          <button
            className="btn-ghost flex items-center gap-1.5 !min-h-9 !px-3 text-xs"
            disabled={busyBatch}
            onClick={() => void createDailySummary()}
            title="Consolidar boletas del día para SUNAT"
          >
            <Layers size={14} />
            Resumen diario
          </button>
          <button
            className="btn-ghost flex items-center gap-1.5 !min-h-9 !px-3 text-xs"
            onClick={exportCsv}
          >
            <Download size={14} /> Exportar página CSV
          </button>
          <select className="field !min-h-9 w-52" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="rechazado">Rechazados por SUNAT</option>
            <option value="observado">Observados</option>
            <option value="error">Errores de integridad</option>
            <option value="pendiente">Pendientes de envío</option>
            <option value="todos">Todos los estados</option>
            <option value="anulaciones">Solicitudes de anulación</option>
          </select>
        </div>
      </div>

      {sales.length === 0 ? (
        <p className="card p-6 text-center text-sm text-slate-500">Sin comprobantes para el filtro seleccionado.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="responsive-table w-full min-w-[760px]">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Comprobante</th>
                <th className="th">Fecha</th>
                <th className="th">Cliente</th>
                <th className="th text-right">Total</th>
                <th className="th">SUNAT</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {sales.map((s) => (
                <tr key={s.id} className={s.status === 'anulada' ? 'opacity-50 line-through' : ''}>
                  <td data-label="Comprobante" className="td font-mono text-xs font-semibold">
                    {s.code}
                    {s.consolidated && <span className="ml-1 text-slate-500 font-normal">(Consolidado)</span>}
                  </td>
                  <td data-label="Fecha" className="td text-xs">{fmtDateTime(s.createdAt)}</td>
                  <td data-label="Cliente" className="td max-w-[180px] truncate text-xs">{s.clientDoc.nombre || 'Consumidor final'}</td>
                  <td data-label="Total" className="td text-right font-mono">{money(s.total)}</td>
                  <td data-label="SUNAT" className="td">
                    <StatusBadge sale={s} />
                    {s.sunatMessage && (
                      <p className="max-w-[200px] truncate text-xs text-slate-500" title={s.sunatMessage}>
                        {s.sunatMessage}
                      </p>
                    )}
                  </td>
                  <td data-label="Acciones" className="td whitespace-nowrap text-right">
                    {s.status === 'anulada' && (!s.stockReturnedAt || !s.refundedAt) && <button className="btn-ghost !min-h-8 !px-2 text-xs" onClick={() => setCompensating(s)}>Registrar devolución</button>}
                    {s.anulationRequest && s.status === 'activa' ? (
                      <button className="btn-danger !min-h-8 !px-2 !py-1 text-xs" onClick={() => void authorizeAnulation(s)}>
                        {s.anulationStatus === 'solicitada' ? 'Autorizar anulación' : 'Reintentar nota'} ({s.anulationRequest.reason})
                      </button>
                    ) : !s.consolidated && (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado' || s.sunatStatus === 'rechazado') && s.status === 'activa' ? (
                      <button className="btn-ghost !min-h-8 !px-2 !py-1 text-xs" onClick={() => void retrySunat(s)}>
                        <Send size={12} className="inline mr-1" /> Reenviar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-200 px-3 py-2 text-right font-mono text-sm">
            {sales.length} comprobantes en esta página · Total: {money(totals)}
          </p>
        </div>
      )}

      <Pagination {...pagination} />
      <SaleCompensation sale={compensating} onClose={() => setCompensating(null)} onSaved={() => flash('Devolución registrada.')} />
      <FlashBar msg={msg} />
    </div>
  );
}

function StatusBadge({ sale }: { sale: Sale }) {
  if (sale.status === 'anulada') return <span className="badge bg-slate-100 text-slate-500">anulada</span>;
  if (sale.consolidated) return <span className="badge bg-violet-50 text-violet-700">para resumen</span>;
  const map: Record<SunatStatus, string> = {
    aceptado: 'bg-emerald-50 text-success',
    rechazado: 'bg-red-50 text-critical',
    observado: 'bg-amber-100 text-amber-800',
    error: 'bg-red-50 text-critical',
    pendiente: 'bg-blue-50 text-blue-600',
    no_enviado: 'bg-slate-100 text-slate-500',
    no_aplica: 'bg-slate-100 text-slate-600'
  };
  return (
    <span className={`badge ${map[sale.sunatStatus]}`} title={sale.sunatMessage ?? ''}>
      {sale.sunatStatus === 'aceptado' && <CheckCircle2 size={12} />}
      {sale.sunatStatus}
    </span>
  );
}
