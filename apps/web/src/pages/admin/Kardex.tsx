import { useEffect, useMemo, useRef, useState } from 'react';
import { getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { csvCell } from '../../lib/csv';
import { onSnapshot } from '../../lib/firestore-listener';
import { Download, History, Search } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import type { MovementType, StockMovement } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const TYPE_LABELS: Record<MovementType, { label: string; tone: string }> = {
  devolucion: { label: 'Devolución', tone: 'bg-emerald-50 text-success' },
  venta: { label: 'Venta', tone: 'bg-red-50 text-critical' },
  ingreso: { label: 'Ingreso', tone: 'bg-emerald-50 text-success' },
  transferencia: { label: 'Transferencia', tone: 'bg-blue-50 text-blue-600' },
  recepcion: { label: 'Recepción', tone: 'bg-emerald-50 text-success' },
  ajuste: { label: 'Ajuste físico', tone: 'bg-amber-100 text-amber-800' },
  merma: { label: 'Merma / Baja', tone: 'bg-red-50 text-critical' },
  conversion: { label: 'Conversión de empaque', tone: 'bg-brand-50 text-primary' }
};

export function KardexPage() {
  const [movements, setMovements] = useState<(StockMovement & { id: string })[]>([]);
  const [typeFilter, setTypeFilter] = useState<MovementType | 'todos'>('todos');
  const [term, setTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData>>();
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const olderPages = useRef(false);
  const queryGeneration = useRef(0);
  const { msg, flash } = useFlash();

  const movementQuery = useMemo(() => {
    const filters = typeFilter === 'todos' ? [] : [where('type', '==', typeFilter)];
    if (fromDate) filters.push(where('createdAt', '>=', Date.parse(`${fromDate}T00:00:00-05:00`)));
    if (toDate) filters.push(where('createdAt', '<=', Date.parse(`${toDate}T23:59:59.999-05:00`)));
    return query(tenantCollection('stock_movements'), ...filters, orderBy('createdAt', 'desc'));
  }, [typeFilter, fromDate, toDate]);

  useEffect(() => {
    queryGeneration.current += 1; olderPages.current = false;
    setMovements([]); setCursor(undefined); setHasMore(false);
    return onSnapshot(query(movementQuery, limit(150)), (snapshot) => {
      const current = snapshot.docs.map((doc) => ({ ...doc.data() as StockMovement, id: doc.id }));
      setMovements((previous) => olderPages.current
        ? [...new Map([...previous, ...current].map((item) => [item.id, item])).values()].sort((a, b) => b.createdAt - a.createdAt)
        : current);
      if (!olderPages.current) { setCursor(snapshot.docs.at(-1)); setHasMore(snapshot.size === 150); }
    }, (error) => flash(`Error al consultar el kardex: ${error.message}`));
  }, [movementQuery, flash]);

  const loadMore = async () => {
    if (!cursor || busy) return;
    setBusy(true);
    const generation = queryGeneration.current;
    try {
      const page = await getDocs(query(movementQuery, startAfter(cursor), limit(150)));
      if (generation !== queryGeneration.current) return;
      olderPages.current = true;
      setMovements((previous) => [...new Map([...previous, ...page.docs.map((doc) => ({ ...doc.data() as StockMovement, id: doc.id }))].map((item) => [item.id, item])).values()]);
      setCursor(page.docs.at(-1)); setHasMore(page.size === 150);
    } catch (error) { flash(error instanceof Error ? error.message : 'Error al cargar movimientos'); }
    finally { setBusy(false); }
  };

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

  const exportCsv = async () => {
    if (busy) return;
    if (fromDate && toDate && fromDate > toDate) { flash('Error: el rango de fechas es inválido'); return; }
    setBusy(true);
    try {
      const all: StockMovement[] = [];
      let last: QueryDocumentSnapshot<DocumentData> | undefined;
      const first = await getDocs(query(movementQuery, limit(1)));
      if (first.empty) { flash('No hay movimientos para exportar'); return; }
      const cutoff = Number(first.docs[0].data().createdAt);
      do {
        const page = await getDocs(query(movementQuery, where('createdAt', '<=', cutoff), ...(last ? [startAfter(last)] : []), limit(300)));
        all.push(...page.docs.map((doc) => doc.data() as StockMovement));
        last = page.size === 300 ? page.docs.at(-1) : undefined;
      } while (last);
      const search = term.trim().toLowerCase();
      const selected = all.filter((m) => !search || [m.productName, m.userName, m.refId, m.reason].some((value) => value?.toLowerCase().includes(search)));
      if (!selected.length) { flash('No hay movimientos para exportar'); return; }
      const headers = ['Fecha', 'Tipo', 'Producto', 'Presentación', 'Cantidad base', 'Cantidad presentación', 'Pérdida tránsito (base)', 'Usuario', 'Referencia / Motivo'];
      const rows = selected.map((m) => [fmtDateTime(m.createdAt), TYPE_LABELS[m.type]?.label ?? m.type,
        m.productName, m.presentationLabel || 'Unidad base', m.qty, m.presentationQty ?? '', m.transitLossBaseQty ?? 0, m.userName,
        [m.refId, m.reason].filter(Boolean).join(' · ') || '—']);
      const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `kardex_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash(`Kardex exportado: ${selected.length} movimientos`);
    } catch (error) { flash(error instanceof Error ? error.message : 'Error al exportar'); }
    finally { setBusy(false); }
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
          <button className="btn-ghost flex items-center gap-1.5 !min-h-9 !px-3 text-xs" disabled={busy} onClick={() => void exportCsv()}>
            <Download size={14} /> Exportar Kárdex
          </button>
          <select
            className="field !min-h-9 w-44 text-xs"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MovementType | 'todos')}
          >
            <option value="todos">Todos los movimientos</option>
            <option value="venta">Ventas</option>
            <option value="devolucion">Devoluciones</option>
            <option value="ingreso">Ingresos</option>
            <option value="transferencia">Transferencias</option>
            <option value="recepcion">Recepciones</option>
            <option value="ajuste">Ajustes</option>
            <option value="merma">Mermas / Bajas</option>
            <option value="conversion">Conversiones de empaque</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs">Desde<input className="field" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label className="text-xs">Hasta<input className="field" type="date" min={fromDate} value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <p className="self-end pb-2 text-xs text-slate-500">Fechas en hora de Perú. La exportación incluye todo el rango y filtro seleccionados.</p>
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
          <table className="responsive-table w-full min-w-[760px]">
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
                    <td data-label="Fecha y hora" className="td text-xs font-mono">{fmtDateTime(m.createdAt)}</td>
                    <td data-label="Tipo" className="td">
                      <span className={`badge ${info.tone}`}>{info.label}</span>
                    </td>
                    <td data-label="Producto" className="td font-medium text-sm">
                      {m.productName}
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">
                        {m.presentationLabel || 'Unidad base'}
                        {m.presentationQty != null ? ` · ${Math.abs(m.presentationQty)} presentación(es)` : ''}
                      </span>
                    </td>
                    <td data-label="Variación" className="td text-right font-mono font-bold text-sm">
                      <span className={isPositive ? 'text-success' : 'text-critical'}>
                        {isPositive ? `+${m.qty}` : m.qty}
                        {(m.transitLossBaseQty ?? 0) > 0 && <span className="block text-xs">Tránsito: -{m.transitLossBaseQty}</span>}
                      </span>
                    </td>
                    <td data-label="Usuario" className="td text-xs text-slate-600">{m.userName}</td>
                    <td data-label="Referencia" className="td text-xs text-slate-500 max-w-[200px] truncate">
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

      {hasMore && <button className="btn-ghost" disabled={busy} onClick={() => void loadMore()}>Cargar más movimientos</button>}
      <FlashBar msg={msg} />
    </div>
  );
}
