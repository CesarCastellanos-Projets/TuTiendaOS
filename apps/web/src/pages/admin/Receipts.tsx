import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Download, RefreshCw, Send, Layers } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import type { Sale, SunatStatus } from '../../types';
import { fmtDateTime, money } from '../../lib/utils';
import { sendToSunat, sendCreditNote, sendDailySummary } from '../../services/sunat';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

type Filter = SunatStatus | 'todos' | 'anulaciones';

export function ReceiptsPage() {
  const profile = useAuth((s) => s.profile)!;
  const [filter, setFilter] = useState<Filter>('rechazado');
  const [sales, setSales] = useState<(Sale & { id: string })[]>([]);
  const [busyBatch, setBusyBatch] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const q = query(
      collection(db, 'sales'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    return onSnapshot(q, (s) => {
      const all = s.docs.map((d) => ({ ...(d.data() as Sale), id: d.id }));
      if (filter === 'anulaciones') {
        setSales(all.filter((x) => x.status === 'activa' && x.anulationRequest));
      } else if (filter === 'todos') {
        setSales(all);
      } else {
        setSales(all.filter((x) => x.sunatStatus === filter));
      }
    });
  }, [filter]);

  const authorizeAnulation = async (sale: Sale & { id: string }) => {
    const req = sale.anulationRequest;
    if (!req) return;
    if (!confirm(`¿Autorizar anulación de ${sale.code}? Se emitirá nota de crédito vía Greenter.`)) return;
    try {
      await updateDoc(doc(db, 'sales', sale.id), {
        status: 'anulada',
        sunatStatus: 'pendiente',
        sunatMessage: 'Nota de crédito en proceso',
        anulationAuthorizedBy: profile.displayName
      });
      void sendCreditNote(sale.id, sale);
      flash(`${sale.code} anulada; nota de crédito en proceso`);
    } catch {
      flash('Error al autorizar');
    }
  };

  const retrySunat = async (sale: Sale & { id: string }) => {
    flash(`Reenviando ${sale.code} a SUNAT…`);
    await sendToSunat(sale.id, sale);
  };

  const retryAllPending = async () => {
    const pendingSales = sales.filter((s) => s.status === 'activa' && (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado'));
    if (pendingSales.length === 0) {
      flash('No hay comprobantes pendientes para reenviar');
      return;
    }
    setBusyBatch(true);
    flash(`Reenviando lote de ${pendingSales.length} comprobantes…`);
    try {
      for (const s of pendingSales) {
        await sendToSunat(s.id, s);
      }
      flash(`Lote de ${pendingSales.length} comprobantes procesado`);
    } catch {
      flash('Error durante el reenvío masivo');
    } finally {
      setBusyBatch(false);
    }
  };

  const createDailySummary = async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const boletasToday = sales.filter(
      (s) => s.type === 'boleta' && s.status === 'activa' && new Date(s.createdAt).toISOString().startsWith(todayStr)
    );
    if (boletasToday.length === 0) {
      flash('No hay boletas registradas hoy para consolidar');
      return;
    }
    if (!confirm(`¿Generar y enviar Resumen Diario a SUNAT con ${boletasToday.length} boletas de hoy (${todayStr})?`)) return;

    setBusyBatch(true);
    try {
      const res = await sendDailySummary(
        todayStr,
        boletasToday.map((b) => ({ serie: b.serie, correlativo: b.correlativo, total: b.total }))
      );
      flash(res.message);
    } finally {
      setBusyBatch(false);
    }
  };

  const exportCsv = () => {
    if (sales.length === 0) {
      flash('No hay comprobantes para exportar');
      return;
    }
    const headers = ['Tipo', 'Comprobante', 'Fecha', 'Documento Cliente', 'Nombre Cliente', 'Subtotal', 'IGV', 'Total', 'Metodo Pago', 'Estado SUNAT', 'Mensaje SUNAT', 'Estado'];
    const rows = sales.map((s) => [
      s.type.toUpperCase(),
      s.code,
      fmtDateTime(s.createdAt),
      `${s.clientDoc.tipo}: ${s.clientDoc.numero || '-'}`,
      `"${(s.clientDoc.nombre || 'Consumidor final').replace(/"/g, '""')}"`,
      s.subtotal.toFixed(2),
      s.igv.toFixed(2),
      s.total.toFixed(2),
      s.paymentMethod,
      s.sunatStatus,
      `"${(s.sunatMessage || '').replace(/"/g, '""')}"`,
      s.status
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
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
    () => sales.filter((s) => s.status === 'activa' && (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado')).length,
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
            <Download size={14} /> Exportar CSV
          </button>
          <select className="field !min-h-9 w-52" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="rechazado">Rechazados por SUNAT</option>
            <option value="observado">Observados</option>
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
          <table className="w-full min-w-[760px]">
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
                  <td className="td font-mono text-xs font-semibold">
                    {s.code}
                    {s.consolidated && <span className="ml-1 text-slate-500 font-normal">(Consolidado)</span>}
                  </td>
                  <td className="td text-xs">{fmtDateTime(s.createdAt)}</td>
                  <td className="td max-w-[180px] truncate text-xs">{s.clientDoc.nombre || 'Consumidor final'}</td>
                  <td className="td text-right font-mono">{money(s.total)}</td>
                  <td className="td">
                    <StatusBadge sale={s} />
                    {s.sunatMessage && (
                      <p className="max-w-[200px] truncate text-[11px] text-slate-500" title={s.sunatMessage}>
                        {s.sunatMessage}
                      </p>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-right">
                    {s.anulationRequest && s.status === 'activa' ? (
                      <button className="btn-danger !min-h-8 !px-2 !py-1 text-xs" onClick={() => void authorizeAnulation(s)}>
                        Autorizar anulación ({s.anulationRequest.reason})
                      </button>
                    ) : (s.sunatStatus === 'pendiente' || s.sunatStatus === 'no_enviado' || s.sunatStatus === 'rechazado') && s.status === 'activa' ? (
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
            {sales.length} comprobantes · Total: {money(totals)}
          </p>
        </div>
      )}

      <FlashBar msg={msg} />
    </div>
  );
}

function StatusBadge({ sale }: { sale: Sale }) {
  if (sale.status === 'anulada') return <span className="badge bg-slate-100 text-slate-500">anulada</span>;
  const map: Record<SunatStatus, string> = {
    aceptado: 'bg-emerald-50 text-success',
    rechazado: 'bg-red-50 text-critical',
    observado: 'bg-amber-100 text-amber-800',
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

