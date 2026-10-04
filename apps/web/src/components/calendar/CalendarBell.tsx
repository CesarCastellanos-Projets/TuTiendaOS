import { useEffect, useRef, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Bell, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/firebase';
import { calendarDate, calendarReminderLabel, markCalendar } from '../../lib/calendar';
import { disableCalendarPush, enableCalendarPush } from '../../lib/calendar-push';
import { canReceiveNotifications } from '../../lib/notification-permissions';
import type { CalendarNotification } from '../../types';
import { Modal } from '../ui/Modal';

export function CalendarBell() {
  const profile = useAuth((state) => state.profile);
  const uid = useAuth((state) => state.user?.uid);
  const allowed = profile?.canManageCalendar === true;
  const tenantId = profile?.tenantId;
  const receivesNotifications = canReceiveNotifications(profile);
  const navigate = useNavigate();
  const [items, setItems] = useState<CalendarNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<CalendarNotification | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now());
  const calendarPath = profile?.role === 'admin' ? '/admin/calendario' : '/pos/calendario';
  useEffect(() => {
    setItems([]);
    setToast(null);
    setOpen(false);
    setError(null);
    if (!allowed || !tenantId || !uid) {
      if (!receivesNotifications) void disableCalendarPush().catch(() => undefined);
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted')
      void enableCalendarPush(false).catch(() => undefined);
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'tenants', tenantId, 'calendar_inboxes', uid, 'notifications'),
        where('active', '==', true),
        orderBy('createdAt', 'desc'),
        limit(50)
      ),
      (snapshot) => {
        setError(null);
        const notifications = snapshot.docs.map(
          (doc) => ({ ...doc.data(), id: doc.id }) as CalendarNotification
        );
        setItems(notifications);
        const newest = notifications.find(
          (item) => !item.readAt && !item.snoozedUntil && item.createdAt >= started.current
        );
        if (newest) {
          const key = `denzoz-calendar-toast:${tenantId}:${uid}`;
          try {
            if (localStorage.getItem(key) === newest.id) return;
            localStorage.setItem(key, newest.id);
          } catch {
            /* El aviso sigue visible en la bandeja. */
          }
          setToast(newest);
        }
      },
      (cause) => {
        setItems([]);
        setToast(null);
        setError(cause.code === 'failed-precondition' ? 'Los índices del calendario todavía no están disponibles. Espera a que termine su publicación y vuelve a abrir el calendario.' : cause.code === 'permission-denied' ? 'Tu usuario no tiene acceso a los recordatorios. Revisa el permiso de calendario y las reglas publicadas.' : 'No se pudieron cargar los recordatorios. Revisa tu conexión.');
      }
    );
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const refreshPush = setInterval(() => {
      if ('Notification' in window && Notification.permission === 'granted')
        void enableCalendarPush(false).catch(() => undefined);
    }, 12 * 3600000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      clearInterval(refreshPush);
    };
  }, [allowed, tenantId, uid, receivesNotifications]);
  useEffect(() => {
    const showCalendar = () => {
      if (allowed) navigate(calendarPath);
    };
    const handle = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_CALENDAR') showCalendar();
    };
    navigator.serviceWorker?.addEventListener('message', handle);
    if (allowed && new URLSearchParams(window.location.search).get('calendar') === '1')
      navigate(calendarPath, { replace: true });
    return () => navigator.serviceWorker?.removeEventListener('message', handle);
  }, [allowed, calendarPath, navigate]);
  if (!allowed) return null;
  const pending = items.filter((item) => !item.readAt && (!item.snoozedUntil || item.snoozedUntil <= now));
  const act = async (item: CalendarNotification, action: 'read' | 'snooze') => {
    try {
      await markCalendar(item.id, action);
      if (toast?.id === item.id) setToast(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo actualizar el recordatorio.');
    }
  };
  return (
    <>
      <button
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-indigo-50"
        aria-label={`Recordatorios del calendario${pending.length ? `, ${pending.length} pendientes` : ''}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={19} />
        {pending.length > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
            {pending.length >= 50 ? '50+' : pending.length}
          </span>
        )}
      </button>
      {toast && items.some((item) => item.id === toast.id && !item.readAt) && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-indigo-200 bg-white p-4 shadow-xl"
        >
          <button className="float-right p-1" aria-label="Cerrar aviso" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
          <strong className="block pr-6">Recordatorio: {toast.title}</strong>
          <p className="mt-1 text-xs text-slate-500">
            {calendarReminderLabel(toast.dueDate)} · {calendarDate(toast.dueDate)}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-primary text-xs"
              onClick={() => {
                setToast(null);
                navigate(calendarPath);
              }}
            >
              Ver calendario
            </button>
            <button className="btn-ghost text-xs" onClick={() => void act(toast, 'snooze')}>
              Recordar en 1 hora
            </button>
          </div>
        </div>
      )}
      <Modal open={open} title="Recordatorios del calendario" onClose={() => setOpen(false)}>
        {error && (
          <p role="alert" className="mb-3 text-sm text-critical">
            {error}
          </p>
        )}
        <p className="mb-3 text-xs text-slate-500">
          Últimos 50 avisos vigentes. Leer un aviso no completa el evento para la empresa.
        </p>
        <div className="space-y-2">
          {!items.length && <p className="py-4 text-sm text-slate-500">No hay recordatorios.</p>}
          {items.map((item) => (
            <article
              key={item.id}
              className={`rounded-xl border p-3 ${item.readAt ? 'border-slate-100 text-slate-500' : 'border-indigo-100 bg-indigo-50/40'}`}
            >
              <strong className="block break-words text-sm">{item.title}</strong>
              <p className="mt-1 text-xs">
                {calendarReminderLabel(item.dueDate)} · {calendarDate(item.dueDate)}
                {item.snoozedUntil && item.snoozedUntil > now ? ' · Pospuesto' : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setOpen(false);
                    navigate(calendarPath);
                  }}
                >
                  Ver calendario
                </button>
                {!item.readAt && (
                  <>
                    <button className="btn-ghost text-xs" onClick={() => void act(item, 'read')}>
                      Marcar leído
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => void act(item, 'snooze')}>
                      En 1 hora
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </Modal>
    </>
  );
}
