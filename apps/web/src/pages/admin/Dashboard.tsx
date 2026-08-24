import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { AlertTriangle, ArrowLeftRight, ReceiptText, TrendingUp } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { money, todayStart } from '../../lib/utils';
import type { Sale, Transfer, ProductStock } from '../../types';

interface KpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'bad' | 'good';
}

export function AdminDashboard() {
  const [salesToday, setSalesToday] = useState<Sale[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<Transfer[]>([]);
  const [criticalStock, setCriticalStock] = useState<ProductStock[]>([]);
  const [sunatIssues, setSunatIssues] = useState<Sale[]>([]);

  const uid = useAuth((s) => s.user?.uid);

  useEffect(() => {
    const since = todayStart();
    void loadToday(since);

    const qT = query(
      collection(db, 'transfers'),
      where('status', 'in', ['pendiente', 'en_transito']),
      limit(20)
    );
    const un1 = onSnapshot(qT, (s) => setPendingTransfers(s.docs.map((d) => d.data() as Transfer)));

    const qs = query(
      collection(db, 'sales'),
      where('sunatStatus', 'in', ['rechazado', 'observado', 'pendiente']),
      limit(20)
    );
    const un2 = onSnapshot(qs, (snap) => setSunatIssues(snap.docs.map((d) => d.data() as Sale)));

    return () => {
      un1();
      un2();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadToday(since: number) {
    const q = query(collection(db, 'sales'), where('createdAt', '>=', since), limit(500));
    const snap = await getDocs(q);
    setSalesToday(snap.docs.filter((d) => !d.data().consolidated).map((d) => d.data() as Sale));
    void loadCritical();
    void uid;
  }

  async function loadCritical() {
    // Stock bajo mínimo: se revisa contra el mínimo del producto en stocks de tiendas
    const q = query(collection(db, 'product_stocks'), where('locationType', '==', 'store'), limit(300));
    const snap = await getDocs(q);
    setCriticalStock(
      snap.docs
        .map((d) => d.data() as ProductStock)
        .filter((p) => p.quantity <= 5)
        .slice(0, 12)
    );
  }

  const totalDay = useMemo(() => salesToday.reduce((s, x) => s + x.total, 0), [salesToday]);
  const byMethod = useMemo(() => {
    const m = new Map<string, number>();
    salesToday.forEach((s) => m.set(s.paymentMethod, (m.get(s.paymentMethod) ?? 0) + s.total));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [salesToday]);
  const byStore = useMemo(() => {
    const m = new Map<string, number>();
    salesToday.forEach((s) => m.set(s.storeName, (m.get(s.storeName) ?? 0) + s.total));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [salesToday]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl uppercase tracking-wide">Panel del día</h1>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<TrendingUp size={18} />} label="Ventas de hoy" value={money(totalDay)} sub={`${salesToday.length} tickets`} tone="good" />
        <Kpi
          icon={<ArrowLeftRight size={18} />}
          label="Transferencias por recibir"
          value={String(pendingTransfers.length)}
          sub={pendingTransfers.length ? 'Revisa con las tiendas' : 'Todo al día'}
          tone={pendingTransfers.length ? 'warn' : 'default'}
        />
        <Kpi
          icon={<AlertTriangle size={18} />}
          label="Stock crítico"
          value={String(criticalStock.length)}
          sub="Productos ≤ 5 unidades"
          tone={criticalStock.length ? 'bad' : 'default'}
        />
        <Kpi
          icon={<ReceiptText size={18} />}
          label="SUNAT por atender"
          value={String(sunatIssues.length)}
          sub="Rechazados / observados / pendientes"
          tone={sunatIssues.some((s) => s.sunatStatus === 'rechazado') ? 'bad' : 'default'}
        />
      </section>

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
              {criticalStock.map((p) => (
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
    no_enviado: 'bg-slate-100 text-slate-500'
  };
  return <span className={`badge ${map[status]}`}>{status}</span>;
}

function Kpi({ icon, label, value, sub, tone = 'default' }: KpiProps) {
  const tones = {
    default: '',
    good: 'border-l-verde',
    warn: 'border-l-sol',
    bad: 'border-l-acento'
  } as const;
  return (
    <div className={`card border-l-4 p-3.5 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
