import { useEffect, useRef, useState } from 'react';
import { PackageOpen, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useReplenishments, REPLENISHMENT_PAGE_SIZE } from '../../hooks/useReplenishments';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/utils';
import { enableCalendarPush } from '../../lib/calendar-push';
import { Modal } from '../ui/Modal';

export function ReplenishmentBell() {
  const { items, error, allowed, loading } = useReplenishments();
  const profile = useAuth((state) => state.profile);
  const uid = useAuth((state) => state.user?.uid);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const key = `${profile?.tenantId}:${uid}`;
  const seen = useRef<{ key: string; ids: Set<string>; startedAt: number }>({ key: '', ids: new Set(), startedAt: Date.now() });
  const path = profile?.role === 'admin' ? '/admin/reposiciones' : '/pos/aprobar-reposiciones';
  useEffect(() => {
    if (!allowed) return;
    if ('Notification' in window && Notification.permission === 'granted') void enableCalendarPush(false).catch(() => undefined);
    const timer = window.setInterval(() => {
      if ('Notification' in window && Notification.permission === 'granted') void enableCalendarPush(false).catch(() => undefined);
    }, 12 * 3600000);
    const handle = (event: MessageEvent) => { if (event.data?.type === 'OPEN_REPLENISHMENT') navigate(path); };
    navigator.serviceWorker?.addEventListener('message', handle);
    return () => { window.clearInterval(timer); navigator.serviceWorker?.removeEventListener('message', handle); };
  }, [allowed, path, navigate]);
  useEffect(() => {
    if (!allowed || loading) return;
    if (seen.current.key !== key) {
      seen.current = { key, ids: new Set(items.map((item) => item.id)), startedAt: Date.now() };
      setToast(null); setOpen(false);
      return;
    }
    const newest = items.find((item) => item.createdAt >= seen.current.startedAt && !seen.current.ids.has(item.id));
    items.forEach((item) => seen.current.ids.add(item.id));
    if (newest) setToast(newest.id);
  }, [allowed, items, key, loading]);
  if (!allowed) return null;
  const current = items.find((item) => item.id === toast);
  return <>
    <button type="button" className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-brand-50"
      aria-label={`Reposiciones pendientes, ${items.length}${items.length >= REPLENISHMENT_PAGE_SIZE ? ' o más' : ''}`} onClick={() => setOpen(true)}>
      <PackageOpen size={19} />
      {items.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-xs font-bold text-white">{items.length >= REPLENISHMENT_PAGE_SIZE ? `${REPLENISHMENT_PAGE_SIZE}+` : items.length}</span>}
    </button>
    {current && <div role="status" className="fixed bottom-4 left-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-brand-200 bg-white p-4 shadow-xl">
      <button className="float-right p-1" aria-label="Cerrar aviso de reposición" onClick={() => setToast(null)}><X size={16} /></button>
      <strong className="block pr-6">Nueva reposición: {current.storeName}</strong>
      <p className="mt-1 text-xs text-slate-500">Solicitada por {current.createdByName} · {current.items.length} líneas</p>
      <button className="btn-primary mt-3 text-xs" onClick={() => { setToast(null); navigate(path); }}>Revisar solicitud</button>
    </div>}
    <Modal open={open} title="Reposiciones pendientes" onClose={() => setOpen(false)}>
      <button className="btn-ghost mb-3 w-full text-xs" disabled={pushBusy} onClick={() => {
        setPushBusy(true); setPushError(null);
        void enableCalendarPush().then(() => setPushError('Avisos externos activados en este dispositivo.')).catch((cause: unknown) => setPushError(cause instanceof Error ? cause.message : 'No se pudieron activar los avisos.')).finally(() => setPushBusy(false));
      }}>{pushBusy ? 'Activando…' : 'Activar avisos con la app cerrada'}</button>
      {pushError && <p role="status" className="mb-3 text-xs text-slate-600">{pushError}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-critical">{error}</p>}
      <p className="mb-3 text-xs text-slate-500">Avisos compartidos en tiempo real. Aprobar una solicitud crea el traspaso; la tienda debe recibirlo.</p>
      {!items.length && <p className="py-4 text-sm text-slate-500">{loading ? 'Cargando…' : 'No hay solicitudes pendientes.'}</p>}
      <div className="space-y-2">{items.map((item) => <article key={item.id} className="rounded-xl border border-brand-100 p-3"><strong className="text-sm">{item.storeName}</strong><p className="mt-1 text-xs text-slate-500">{item.createdByName} · {fmtDateTime(item.createdAt)} · {item.items.length} líneas</p></article>)}</div>
      <button className="btn-primary mt-4 w-full" onClick={() => { setOpen(false); navigate(path); }}>Revisar reposiciones</button>
    </Modal>
  </>;
}
