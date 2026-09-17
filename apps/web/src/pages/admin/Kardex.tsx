import { useEffect, useMemo, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { Download, History, Search } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { MovementType, StockMovement } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const TYPE_LABELS: Record<MovementType, { label: string; tone: string }> = {
  venta: { label: 'Venta', tone: 'bg-red-50 text-critical' },
  ingreso: { label: 'Ingreso', tone: 'bg-emerald-50 text-success' },
  transferencia: { label: 'Transferencia', tone: 'bg-blue-50 text-blue-600' },
  recepcion: { label: 'Recepción', tone: 'bg-emerald-50 text-success' },
  ajuste: { label: 'Ajuste físico', tone: 'bg-amber-100 text-amber-800' },
  merma: { label: 'Merma / Baja', tone: 'bg-red-50 text-critical' }
};

export function KardexPage() {
  const [movements, setMovements] = useState<(StockMovement & { id: string })[]>([]);
  const [typeFilter, setTypeFilter] = useState<MovementType | 'todos'>('todos');
  const [term, setTerm] = useState('');
  const { msg, flash } = useFlash();

  useEffect(() => {
    const q = typeFilter === 'todos'
      ? query(tenantCollection('stock_movements'), orderBy('createdAt', 'desc'), limit(150))
      : query(
          tenantCollection('stock_movements'),
          where('type', '==', typeFilter),
          orderBy('createdAt', 'desc'),
          limit(150)
        );

    return onSnapshot(q, (s) =>
      setMovements(s.docs.map((d) => ({ ...(d.data() as StockMovement), id: d.id })))
    );
  }, [typeFilter]);

  const filtered = useMemo(() => {
    const s = term.trim().toLowerCase();
    if (!s) return movements;
    return movements.filter(
      (m) =>
        m.productName.toLowerCase().includes(s) ||
        (m.refId ?? '').toLowerCase().includes(s) ||
        (m.reason ?? '').toLowerCase().includes(s) ||
        m.userName.toLowerCase().includes(s)
    );
  }, [movements, term]);

  const exportCsv = () => {
    if (filtered.length === 0) {
      flash('No hay movimientos para exportar');
      return;
    }
    const headers = ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Usuario', 'Referencia / Motivo'];
    const rows = filtered.map((m) => [
      fmtDateTime(m.createdAt),
      TYPE_LABELS[m.type]?.label ?? m.type,
      `"${m.productName.replace(/"/g, '""')}"`,
      m.qty,
      `"${m.userName.replace(/"/g, '""')}"`,
      `"${(m.refId || m.reason || '—').replace(/"/g, '""')}"`
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kardex_inventario_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Kárdex exportado a CSV');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide">
            <History size={22} /> Kárdex de Inventario
          </h1>
          <p className="text-xs text-slate-500">Bitácora inmutable de entradas, salidas, ventas, transferencias y mermas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost flex items-center gap-1.5 !min-h-9 !px-3 text-xs" onClick={exportCsv}>
            <Download size={14} /> Exportar Kárdex
          </button>
          <select
            className="field !min-h-9 w-44 text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MovementType | 'todos')}
          >
            <option value="todos">Todos los movimientos</option>
            <option value="venta">Ventas</option>
            <option value="ingreso">Ingresos</option>
            <option value="transferencia">Transferencias</option>
            <option value="recepcion">Recepciones</option>
            <option value="ajuste">Ajustes</option>
            <option value="merma">Mermas / Bajas</option>
          </select>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="field !pl-9"
          placeholder="Filtrar por producto, usuario, referencia o motivo…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Sin movimientos registrados" hint="Cada venta, ingreso o traslado quedará registrado automáticamente aquí." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Fecha y hora</th>
                <th className="th">Tipo</th>
                <th className="th">Producto</th>
                <th className="th text-right">Variación</th>
                <th className="th">Usuario</th>
                <th className="th">Referencia / Motivo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {filtered.map((m) => {
                const info = TYPE_LABELS[m.type] ?? { label: m.type, tone: 'bg-slate-100 text-slate-700' };
                const isPositive = m.qty > 0;
                return (
                  <tr key={m.id}>
                    <td className="td text-xs font-mono">{fmtDateTime(m.createdAt)}</td>
                    <td className="td">
                      <span className={`badge ${info.tone}`}>{info.label}</span>
                    </td>
                    <td className="td font-medium text-sm">{m.productName}</td>
                    <td className="td text-right font-mono font-bold text-sm">
                      <span className={isPositive ? 'text-success' : 'text-critical'}>
                        {isPositive ? `+${m.qty}` : m.qty}
                      </span>
                    </td>
                    <td className="td text-xs text-slate-600">{m.userName}</td>
                    <td className="td text-xs text-slate-500 max-w-[200px] truncate">
                      {m.refId || m.reason || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-slate-200 px-3 py-2 text-right font-mono text-xs text-slate-500">
            Mostrando {filtered.length} movimientos de inventario
          </p>
        </div>
      )}

      <FlashBar msg={msg} />
    </div>
  );
}
