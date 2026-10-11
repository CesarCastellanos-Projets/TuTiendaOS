import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { ChartColumn, RefreshCw } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { tenantCollection } from '../../lib/tenant-firestore';
import { peruToday } from '../../lib/calendar';
import { fmtDateTime, money } from '../../lib/utils';
import { getStatistics, importStatisticsHistory, statisticsRange, type SalesStatistics, type StatisticsFilter, type StatisticsPeriod } from '../../lib/statistics';
import { PAYMENT_LABELS } from '../../lib/payments';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import type { PaymentMethod, Store } from '../../types';
import { DailyChart, HourlyChart, ProductRanking } from './StatisticsCharts';

const periods: { value: StatisticsPeriod; label: string }[] = [
  { value: 'daily', label: 'Diario' }, { value: 'weekly', label: 'Semanal' }, { value: 'monthly', label: 'Mensual' }, { value: 'yearly', label: 'Anual' }
];
export function StatisticsWorkspace({ mode }: { mode: 'admin' | 'pos' }) {
  const profile = useAuth((state) => state.profile)!;
  const admin = mode === 'admin' && profile.role === 'admin';
  const [today, setToday] = useState(peruToday);
  const [anchor, setAnchor] = useState(today);
  const [period, setPeriod] = useState<StatisticsPeriod>('daily');
  const [stores, setStores] = useState<Store[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<StatisticsFilter | null>(null);
  const [showUnSold, setShowUnSold] = useState(false);
  const [stockedIds, setStockedIds] = useState<Set<string>>(new Set());
  const [data, setData] = useState<SalesStatistics | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const products = useProductsCatalog();

  useEffect(() => {
    const timer = window.setInterval(() => setToday(peruToday()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!admin) {
      setFilter(profile.storeId ? { start: today, end: today, storeIds: [profile.storeId] } : null);
      return;
    }
    let active = true;
    void getDocs(query(tenantCollection('stores'), orderBy('name'), limit(50))).then((snapshot) => {
      if (!active) return;
      const list = snapshot.docs.filter((doc) => doc.data().active !== false).map((doc) => ({ ...doc.data(), id: doc.id } as Store));
      setStores(list);
      const first = list[0]?.id;
      setSelected(first ? [first] : []);
      setFilter(first ? { start: today, end: today, storeIds: [first] } : null);
    }).catch(() => { if (active) setError('No se pudieron cargar las tiendas.'); });
    return () => { active = false; };
  }, [admin, profile.storeId, profile.tenantId, today]);

  const load = useCallback(async (current: StatisticsFilter, refresh = false) => {
    const version = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const result = await getStatistics(current, refresh);
      if (sequence.current === version) setData(result);
    } catch (cause) {
      if (sequence.current === version) {
        setData(null);
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las estadísticas.');
      }
    } finally { if (sequence.current === version) setLoading(false); }
  }, []);
  useEffect(() => {
    const counter = sequence;
    setData(null);
    if (filter) void load(filter);
    return () => { counter.current++; };
  }, [filter, load]);

  useEffect(() => {
    let active = true;
    setStockedIds(new Set());
    if (!filter || !showUnSold) return;
    void Promise.all(filter.storeIds.map((storeId) => getDocs(query(tenantCollection('product_stocks'),
      where('locationId', '==', storeId), orderBy('productId'), limit(500))))).then((pages) => {
      if (active) setStockedIds(new Set(pages.flatMap((page) => page.docs.map((doc) => String(doc.data().productId)))));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [filter, showUnSold]);
  const range = statisticsRange(period, anchor, today);
  const peak = data ? data.hourly.reduce((best, count, hour) => count > data.hourly[best] ? hour : best, 0) : 0;
  const noSales = useMemo(() => {
    if (!data) return [];
    const sold = new Set(data.soldProductIds);
    return products.filter((product) => product.active && stockedIds.has(product.id) && !sold.has(product.id)).slice(0, 3);
  }, [data, products, stockedIds]);
  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 10 ? [...current, id] : current);
  };
  const importHistory = async () => {
    if (importing) return;
    setImporting(true); setError(null);
    try {
      const result = await importStatisticsHistory();
      setNotice(`${result.scannedTotal} ventas revisadas. ${result.imported} integradas en este bloque.${result.complete ? ' Historial completo.' : ' Puedes continuar con el siguiente bloque.'}`);
      if (filter) await load(filter, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo integrar el historial.'); }
    finally { setImporting(false); }
  };
  if (mode === 'admin' && !admin) return <p className="p-4 text-sm text-critical">Solo el administrador puede consultar estos periodos.</p>;

  return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-6xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 font-display text-2xl font-bold"><ChartColumn size={24} /> Estadísticas {admin ? 'de ventas' : 'de hoy'}</h1>
        <p className="mt-1 text-sm text-slate-500">{admin ? 'Compara las ventas y el movimiento de productos entre tiendas.' : 'Resumen de la tienda activa. Cambia de tienda en el menú si tienes acceso multitiendas.'}</p>
      </div>
      <button className="btn-ghost !min-h-11" disabled={!filter || loading || importing} onClick={() => filter && void load(filter, true)}><RefreshCw size={16} /> Actualizar</button>
    </div>
    {admin && <section className="card space-y-4 p-4" aria-label="Filtros de estadísticas">
      <div className="grid gap-3 sm:grid-cols-3"><label><span className="label">Periodo</span><select aria-label="Periodo" className="field" value={period} onChange={(event) => setPeriod(event.target.value as StatisticsPeriod)}>{periods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label><span className="label">Fecha de referencia</span><input aria-label="Fecha de referencia" type="date" className="field" max={today} value={anchor} onChange={(event) => { if (event.target.value) setAnchor(event.target.value); }} /></label>
        <div className="flex items-end"><button className="btn-primary w-full" disabled={!selected.length || loading || importing || range.start > range.end} onClick={() => setFilter({ ...range, storeIds: [...selected] })}>Consultar periodo</button></div>
      </div>
      <fieldset><legend className="label">Tiendas (hasta 10 por consulta)</legend><div className="flex flex-wrap gap-2">{stores.map((store) => <label key={store.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${selected.includes(store.id) ? 'border-primary bg-brand-50 text-primary' : 'border-slate-200'}`}><input type="checkbox" checked={selected.includes(store.id)} disabled={!selected.includes(store.id) && selected.length >= 10} onChange={() => toggle(store.id)} />{store.name}</label>)}</div></fieldset>
      <p className="text-xs text-slate-500">Periodo elegido: {range.start} al {range.end}. La semana empieza el lunes.</p>
    </section>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-critical">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">{notice}</p>}
    {loading && <p role="status" className="text-sm text-slate-500">Cargando resumen…</p>}
    {!filter && !error && <p className="text-sm text-slate-500">{admin ? 'Crea o selecciona una tienda para consultar estadísticas.' : 'Selecciona una tienda para consultar las estadísticas de hoy.'}</p>}
    {data && <>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{data.start} al {data.end} · {data.stores.map((store) => store.name).join(', ')}</span><span>Actualizado: {fmtDateTime(data.generatedAt)}</span></div>
      {!data.historicalComplete && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{admin ? 'Falta integrar el historial de ventas. La integración se realiza una sola vez, en bloques de hasta 100 ventas, sin modificar el stock.' : 'El administrador debe completar la integración del historial. Las ventas anteriores aún pueden faltar en este resumen.'}</p>{admin && <button className="btn-ghost mt-2 text-xs" disabled={importing || loading} onClick={() => void importHistory()}>{importing ? 'Integrando…' : 'Integrar historial (hasta 100 ventas)'}</button>}</div>}
      <div className="statistics-kpis grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        { label: 'Ventas netas', value: money(data.revenue), hint: 'Las anulaciones aceptadas se excluyen' },
        { label: 'Ventas realizadas', value: String(data.tickets), hint: `${data.soldProductIds.length} productos distintos vendidos` },
        { label: 'Ticket promedio', value: money(data.averageTicket), hint: 'Importe promedio por venta' },
        { label: 'Hora con más ventas', value: data.tickets ? `${String(peak).padStart(2, '0')}:00 – ${String((peak + 1) % 24).padStart(2, '0')}:00` : 'Sin ventas', hint: `${data.hourly[peak]} ventas en esa franja` }
      ].map((metric) => <section key={metric.label} className="card p-4"><p className="text-xs font-semibold uppercase text-slate-500">{metric.label}</p><p className="mt-2 font-mono text-2xl font-bold text-slate-900">{metric.value}</p><p className="mt-2 text-xs text-slate-500">{metric.hint}</p></section>)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><ProductRanking title="Top 3 más vendidos" products={data.topProducts} hint="Ordenados por unidades base vendidas; desempate por importe." /><ProductRanking title="Top 3 menos vendidos" products={data.bottomProducts} hint="Entre productos con ventas en el periodo. Ordenados por menos unidades base vendidas." /></div>
      <HourlyChart hourly={data.hourly} />
      <div className="grid gap-4 lg:grid-cols-2"><DailyChart daily={data.daily} /><section className="card space-y-4 p-4"><h2 className="font-semibold">Cobros por método de pago</h2>{Object.entries(data.payments).filter(([, amount]) => amount > 0).map(([method, amount]) => <div key={method} className="flex justify-between gap-3 text-sm"><span>{PAYMENT_LABELS[method as PaymentMethod] ?? method}</span><strong className="font-mono">{money(amount)}</strong></div>)}<p className="text-xs text-slate-500">Los pagos combinados se reparten por método. El vuelto no cuenta como ingreso.</p></section></div>
      {admin && <section className="card overflow-x-auto p-4"><h2 className="mb-3 font-semibold">Ventas por tienda</h2><table className="responsive-table w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="py-2">Tienda</th><th className="py-2 text-right">Ventas</th><th className="py-2 text-right">Importe</th><th className="py-2 text-right">Promedio</th></tr></thead><tbody>{data.stores.map((store) => <tr key={store.storeId} className="border-b border-slate-100"><td data-label="Tienda" className="py-3 pr-3">{store.name}</td><td data-label="Ventas" className="text-right">{store.tickets}</td><td data-label="Importe" className="text-right font-mono">{money(store.revenue)}</td><td data-label="Promedio" className="text-right font-mono">{money(store.tickets ? store.revenue / store.tickets : 0)}</td></tr>)}</tbody></table></section>}
      {!showUnSold && <button className="btn-ghost" onClick={() => setShowUnSold(true)}>Consultar productos sin ventas</button>}
      {!!noSales.length && <section className="card p-4"><h2 className="font-semibold">Productos del catálogo sin ventas registradas</h2><p className="mt-1 text-xs text-slate-500">Productos registrados en las tiendas elegidas, entre los primeros 500 por tienda. Se muestran hasta 3; no es un inventario histórico de disponibilidad.</p><ul className="mt-3 space-y-2 text-sm">{noSales.map((product) => <li key={product.id}>{product.name}</li>)}</ul></section>}
    </>}
  </div></div>;
}
