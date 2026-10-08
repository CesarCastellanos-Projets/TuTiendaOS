import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  limit,
  query,
  where
} from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { AlertTriangle, ArrowLeftRight, ReceiptText, TrendingUp } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { peruToday } from '../../lib/calendar';
import { money } from '../../lib/utils';
import type { Sale, Transfer, ProductStock } from '../../types';

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'bad' | 'good';
}

export function AdminDashboard() {
  const [days, setDays] = useState<Array<{ name: string; revenue: number; tickets: number; payments: Record<string, number> }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(peruToday);
  const [pendingTransfers, setPendingTransfers] = useState<Transfer[]>([]);
  const [criticalStock, setCriticalStock] = useState<ProductStock[]>([]);
  const [sunatIssues, setSunatIssues] = useState<Sale[]>([]);

  useEffect(() => { const timer = setInterval(() => setToday(peruToday()), 60000); return () => clearInterval(timer); }, []);

  useEffect(() => {
    const unSummary = onSnapshot(query(tenantCollection('sales_statistics'), where('month', '==', today.slice(0, 7)), limit(100)), (snapshot) => {
      setDays(snapshot.docs.map((doc) => ({ name: String(doc.data().storeName ?? doc.data().storeId), ...(doc.data().days?.[today] ?? { revenue: 0, tickets: 0, payments: {} }) })));
      setError(snapshot.size === 100 ? 'Resumen limitado a 100 tiendas. Consulta Estadísticas para filtrar.' : null);
    }, () => setError('No se pudo actualizar el resumen de ventas.'));
    const unStock = onSnapshot(query(tenantCollection('product_stocks'), where('locationType', '==', 'store'), where('isLowStock', '==', true), limit(13)), (snapshot) => setCriticalStock(snapshot.docs.map((doc) => doc.data() as ProductStock)));

    const qT = query(
      tenantCollection('transfers'),
      where('status', 'in', ['pendiente', 'en_transito']),
      limit(20)
    );
    const un1 = onSnapshot(qT, (s) => setPendingTransfers(s.docs.map((d) => d.data() as Transfer)));

    const qs = query(
      tenantCollection('sales'),
      where('sunatStatus', 'in', ['rechazado', 'observado', 'pendiente', 'error']),
      where('consolidated', '==', false),
      limit(20)
    );
    const un2 = onSnapshot(qs, (snap) => setSunatIssues(snap.docs.map((d) => d.data() as Sale)));

    return () => {
      un1();
      un2();
      unSummary();
      unStock();
    };
  }, [today]);

  const totalDay = useMemo(() => days.reduce((sum, day) => sum + day.revenue, 0), [days]);
  const ticketCount = days.reduce((sum, day) => sum + day.tickets, 0);
  const byMethod = useMemo(() => {
    const totals = new Map<string, number>();
    days.forEach((day) => Object.entries(day.payments).forEach(([method, amount]) => totals.set(method, (totals.get(method) ?? 0) + amount)));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [days]);
  const byStore = useMemo(() => days.map((day): [string, number] => [day.name, day.revenue]).sort((a, b) => b[1] - a[1]), [days]);

  return (
    <div className="space-y-6">
      <div className="dashboard-intro"><div><span className="eyebrow">Resumen de la operación</span><h1>Así va tu día.</h1></div><span className="dashboard-date">{new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' }).format(new Date())}</span></div>

      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      <p className="text-xs text-slate-500">Las ventas se actualizan al procesar sus resúmenes. Incluye ventas consolidadas y excluye anulaciones aceptadas.</p>
      <section className="dashboard-kpis">
        <Kpi icon={<TrendingUp size={18} />} label="Ventas de hoy" value={money(totalDay)} sub={`${ticketCount} tickets`} tone="good" />
        <Kpi
          icon={<ArrowLeftRight size={18} />}
          label="Transferencias por recibir"
          value={`${pendingTransfers.length}${pendingTransfers.length === 20 ? '+' : ''}`}
          sub={pendingTransfers.length ? 'Revisa con las tiendas' : 'Todo al día'}
          tone={pendingTransfers.length ? 'warn' : 'default'}
        />
        <Kpi
          icon={<AlertTriangle size={18} />}
          label="Stock crítico"
          value={criticalStock.length > 12 ? '12+' : String(criticalStock.length)}
          sub="Según el mínimo configurado del producto"
          tone={criticalStock.length ? 'bad' : 'default'}
        />
        <Kpi
          icon={<ReceiptText size={18} />}
          label="SUNAT por atender"
          value={`${sunatIssues.length}${sunatIssues.length === 20 ? '+' : ''}`}
          sub="Rechazados / observados / pendientes"
          tone={sunatIssues.some((s) => s.sunatStatus === 'rechazado') ? 'bad' : 'default'}
        />
      </section>

      <div className="dashboard-shortcuts"><Link to="/admin/ingresos">Registrar ingreso</Link><Link to="/admin/reposiciones">Revisar reposiciones</Link><Link to="/admin/comprobantes">Ver comprobantes</Link></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Ventas por tienda</h2>
          {byStore.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no hay ventas hoy.</p>
          ) : (
            <ul className="space-y-2">
              {byStore.map(([name, total]) => (
                <li key={name} className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="price-tag rounded px-2 py-0.5 font-mono text-sm font-semibold">{money(total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Por método de pago</h2>
          {byMethod.length === 0 ? (
            <p className="text-sm text-slate-500">Sin datos aún.</p>
          ) : (
            <ul className="space-y-2">
              {byMethod.map(([method, total]) => (
                <li key={method} className="flex items-center justify-between gap-2 capitalize">
                  <span className="text-sm font-medium">{method}</span>
                  <span className="font-mono text-sm">{money(total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Stock crítico en tiendas</h2>
          {criticalStock.length === 0 ? (
            <p className="text-sm text-slate-500">Ningún producto en nivel crítico.</p>
          ) : (
            <ul className="divide-y divide-linea">
              {criticalStock.slice(0, 12).map((p) => (
                <li key={`${p.productId}-${p.locationId}`} className="flex items-center justify-between py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.productName}</p>
                    <p className="text-xs text-slate-500">{p.locationName}</p>
                  </div>
                  <span className={`badge ${p.quantity === 0 ? 'bg-red-50 text-critical' : 'bg-amber-100 text-amber-800'}`}>
                    {p.quantity} u.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Estado tributario</h2>
          {sunatIssues.length === 0 ? (
            <p className="text-sm text-slate-500">Sin comprobantes rechazados ni observados.</p>
          ) : (
            <ul className="divide-y divide-linea">
              {sunatIssues.slice(0, 8).map((s) => (
                <li key={s.code} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{s.code}</p>
                    <p className="truncate text-xs text-slate-500">{s.sunatMessage ?? '—'}</p>
                  </div>
                  <StatusBadge status={s.sunatStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Sale['sunatStatus'] }) {
  const map: Record<Sale['sunatStatus'], string> = {
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

function Kpi({ icon, label, value, sub }: KpiProps) {
  return <div className="dashboard-kpi"><div className="kpi-label">{icon}{label}</div><p className="kpi-value">{value}</p>{sub && <p className="kpi-hint">{sub}</p>}</div>;
}
