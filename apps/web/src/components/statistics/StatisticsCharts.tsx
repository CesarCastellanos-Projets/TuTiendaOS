import { money } from '../../lib/utils';
import type { SalesStatistics, StatisticsProduct } from '../../lib/statistics';

export function ProductRanking({ title, products, hint }: { title: string; products: StatisticsProduct[]; hint: string }) {
  return <section className="card p-4"><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{hint}</p>
    {!products.length ? <p className="py-5 text-sm text-slate-500">Sin datos para este periodo.</p> : <ol className="mt-4 space-y-4">{products.map((product, index) => <li key={product.productId} className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-primary">{index + 1}</span>
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{product.name}</p><p className="mt-1 text-xs text-slate-500">{product.tickets} ventas · {product.units} {product.unit} · {money(product.revenue)}</p></div>
    </li>)}</ol>}
  </section>;
}

export function HourlyChart({ hourly }: { hourly: number[] }) {
  const max = Math.max(1, ...hourly);
  return <section className="card p-4"><h2 className="font-semibold">Ventas por hora</h2><p className="mt-1 text-xs text-slate-500">Hora de Perú. Cada comprobante cuenta como una venta.</p>
    <div className="mt-4 overflow-x-auto"><div className="flex h-44 min-w-[480px] items-end gap-1" role="img" aria-label={hourly.map((count, hour) => `${hour}:00, ${count} ventas`).join('; ')}>
      {hourly.map((count, hour) => <div key={hour} className="flex h-full flex-1 flex-col justify-end text-center"><span className="mb-1 text-xs text-slate-500">{count || ''}</span><div title={`${hour}:00 · ${count} ventas`} className="min-h-0 rounded-t bg-primary/80" style={{ height: `${count / max * 115}px` }} /><span className="mt-2 text-xs text-slate-500">{String(hour).padStart(2, '0')}</span></div>)}
    </div></div>
  </section>;
}

export function DailyChart({ daily }: { daily: SalesStatistics['daily'] }) {
  const grouped = new Map<string, { revenue: number; tickets: number }>();
  const monthly = daily.length > 45;
  for (const day of daily) {
    const key = monthly ? day.date.slice(0, 7) : day.date;
    const value = grouped.get(key) ?? { revenue: 0, tickets: 0 };
    value.revenue += day.revenue; value.tickets += day.tickets;
    grouped.set(key, value);
  }
  const max = Math.max(1, ...[...grouped.values()].map((value) => value.revenue));
  return <section className="card p-4"><h2 className="font-semibold">Evolución de ventas {monthly ? 'por mes' : 'por día'}</h2>
    {!grouped.size ? <p className="py-5 text-sm text-slate-500">Sin ventas registradas.</p> : <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">{[...grouped].map(([date, value]) => <div key={date} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs"><span className="pt-1 text-slate-500">{date}</span><div><div className="flex justify-between gap-2"><span>{value.tickets} ventas</span><strong>{money(value.revenue)}</strong></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary" style={{ width: `${value.revenue / max * 100}%` }} /></div></div></div>)}</div>}
  </section>;
}
