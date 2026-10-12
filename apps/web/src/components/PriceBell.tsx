import { useEffect, useMemo, useRef, useState } from 'react';
import { orderBy, query, where } from 'firebase/firestore';
import { tenantCollectionFor } from '../lib/tenant-firestore';
import { useAuth } from '../lib/auth';
import { useCalendarClock } from '../hooks/useCalendarClock';
import { usePagedQuery } from '../hooks/usePagedQuery';
import { Pagination } from './ui/Pagination';
import { CalendarBell } from './calendar/CalendarBell';

interface Notice { id: string; productName: string; changes: { label: string; previous: number; current: number }[]; expiresAt: number; createdAt: number }
export function PriceBell() {
  const { profile, user } = useAuth();
  const [toast, setToast] = useState('');
  const [toastExpires, setToastExpires] = useState(0);
  const [read, setRead] = useState<string[]>([]);
  const [expiredNow, setExpiredNow] = useState(0);
  const [cutoff] = useState(() => Date.now() - 5 * 3600000);
  const seen = useRef(new Set<string>());
  const readRef = useRef(read);
  readRef.current = read;
  const now = Math.max(useCalendarClock(), expiredNow);
  const key = `price-read:${profile?.tenantId}:${user?.uid}`;
  const permitted = profile?.role === 'pos' || profile?.role === 'trabajador';
  const tenantId = profile?.tenantId;
  const source = useMemo(() => permitted && tenantId ? query(tenantCollectionFor(tenantId, 'price_notices'), where('createdAt', '>', cutoff), orderBy('createdAt', 'desc')) : null, [permitted, tenantId, cutoff]);
  const page = usePagedQuery<Notice>(source, 20);
  useEffect(() => {
    seen.current.clear(); setToast('');
    try { const ids: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); setRead(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(-500) : []); }
    catch { setRead([]); }
  }, [key]);
  useEffect(() => {
    const fresh = page.rows.find((item) => item.expiresAt > Date.now() && !seen.current.has(item.id) && !readRef.current.includes(item.id));
    page.rows.forEach((item) => seen.current.add(item.id));
    if (fresh) { setToast(`Nuevo precio: ${fresh.productName}`); setToastExpires(fresh.expiresAt); }
    const expiry = Math.min(...page.rows.filter((item) => item.expiresAt > now).map((item) => item.expiresAt));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setExpiredNow(Date.now()), Math.max(1, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [page.rows, now]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), Math.max(1, Math.min(6000, toastExpires - Date.now()))); return () => clearTimeout(timer); }, [toast, toastExpires]);
  if (!permitted) return <CalendarBell />;
  const visible = page.rows.filter((item) => item.expiresAt > now);
  const unread = visible.filter((item) => !read.includes(item.id)).length;
  const content = <section className="mb-5 space-y-3 border-b pb-4"><h2 className="font-bold">Cambios de precios</h2>{page.error && <p role="alert">No se pudieron cargar los avisos.</p>}{page.loading ? <p>Cargando avisos…</p> : !visible.length && !page.error && <p>Sin cambios en esta página.</p>}{visible.map((item) => <article key={item.id} className="card p-3"><strong>{item.productName}</strong>{item.changes.map((change, i) => <p key={i} className="text-sm">{change.label}: S/ {change.previous.toFixed(2)} → S/ {change.current.toFixed(2)}</p>)}<button className="btn-ghost text-xs" onClick={() => {
    const ids = [...new Set([...read, item.id])].slice(-500); setRead(ids);
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* La lectura sigue marcada durante esta sesión. */ }
  }}>{read.includes(item.id) ? 'Leído' : 'Marcar leído'}</button></article>)}<Pagination {...page} /><p className="text-xs text-slate-500">Los avisos duran 5 horas desde el cambio. El contador corresponde a esta página.</p></section>;
  return <><CalendarBell priceContent={content} priceCount={unread} />{toast && <div role="status" className="notice-toast">{toast}</div>}</>;
}
