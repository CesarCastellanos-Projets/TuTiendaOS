import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { calendarDate, completeCalendar, peruToday } from '../../lib/calendar';
import { enableCalendarPush } from '../../lib/calendar-push';
import { useCalendarEvents } from '../../hooks/useCalendarEvents';
import { Modal } from '../ui/Modal';
import { CalendarEditor } from './CalendarEditor';
import type { CalendarEvent } from '../../types';

const LABELS = { pago: 'Pago', tarea: 'Tarea', vencimiento: 'Vencimiento', otro: 'Otro' };
export function CalendarWorkspace() {
  const allowed = useAuth((state) => state.profile?.canManageCalendar);
  const [month, setMonth] = useState(() => peruToday().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [showFinished, setShowFinished] = useState(false);
  const { events, error, loading, more, paging, loadMore } = useCalendarEvents(month);
  if (!allowed)
    return (
      <div className="p-6 text-sm">
        Tu cuenta no tiene acceso al calendario. Solicita el permiso al administrador.
      </div>
    );
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const today = peruToday();
  const visible = events.filter(
    (event) =>
      (showFinished || event.status === 'pendiente') && (!selectedDate || event.dueDate === selectedDate)
  );
  const move = (direction: number) => {
    setMonth(
      new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + direction, 1)).toISOString().slice(0, 7)
    );
    setSelectedDate(null);
  };
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl">
            <CalendarDays />
            Calendario
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Compartido entre el admin y los POS autorizados de la empresa.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus size={18} />
          Nuevo evento
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
        <p className="text-sm">Recibe recordatorios también con la app cerrada en este dispositivo.</p>
        <button
          className="btn-ghost"
          disabled={pushBusy}
          onClick={async () => {
            setPushBusy(true);
            try {
              await enableCalendarPush();
              setMessage('Notificaciones activadas en este dispositivo.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'No se pudieron activar.');
            } finally {
              setPushBusy(false);
            }
          }}
        >
          {pushBusy ? 'Activando…' : 'Activar notificaciones'}
        </button>
      </div>
      {(message || error) && (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          {error ?? message}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="card overflow-x-auto p-2 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button className="btn-ghost !px-2" aria-label="Mes anterior" onClick={() => move(-1)}>
              <ChevronLeft />
            </button>
            <h2 className="font-bold capitalize">
              {new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
                first
              )}
            </h2>
            <button className="btn-ghost !px-2" aria-label="Mes siguiente" onClick={() => move(1)}>
              <ChevronRight />
            </button>
          </div>
          <div className="grid min-w-[308px] grid-cols-7 gap-0 text-center sm:gap-1">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => (
              <span key={day} className="py-2 text-xs font-semibold text-slate-500">
                {day}
              </span>
            ))}
            {Array.from({ length: start }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {Array.from({ length: days }, (_, index) => {
              const date = `${month}-${String(index + 1).padStart(2, '0')}`;
              const count = events.filter(
                (event) => event.dueDate === date && event.status === 'pendiente'
              ).length;
              return (
                <button
                  key={date}
                  aria-label={`${calendarDate(date)}${count ? `, ${count} pendientes` : ''}`}
                  aria-pressed={selectedDate === date}
                  onClick={() => setSelectedDate((current) => (current === date ? null : date))}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm sm:min-h-20 ${selectedDate === date ? 'border-primary bg-indigo-50 text-primary' : date === today ? 'border-primary text-primary' : 'border-slate-100 hover:bg-slate-50'}`}
                >
                  <strong>{index + 1}</strong>
                  {count > 0 && (
                    <span className="mt-1 text-[10px] font-semibold text-primary">
                      {count} <span className="hidden sm:inline">pend.</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            className="btn-ghost mt-3 w-full"
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelectedDate(today);
            }}
          >
            Ir a hoy
          </button>
        </section>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold">{selectedDate ? calendarDate(selectedDate) : 'Eventos del mes'}</h2>
            <label className="flex min-h-11 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={showFinished}
                onChange={(e) => setShowFinished(e.target.checked)}
              />
              Mostrar finalizados
            </label>
          </div>
          {selectedDate && (
            <button className="text-sm text-primary" onClick={() => setSelectedDate(null)}>
              Ver todo el mes
            </button>
          )}
          {loading ? (
            <p className="text-sm text-slate-500">Cargando calendario…</p>
          ) : (
            !visible.length && (
              <p className="card p-5 text-sm text-slate-500">No hay eventos para esta selección.</p>
            )
          )}
          {visible.map((event) => (
            <article key={event.id} className="card space-y-2 p-4">
              <div className="flex justify-between gap-2">
                <h3 className="break-words font-bold">{event.title}</h3>
                <span
                  className={`badge shrink-0 ${event.status === 'pendiente' && event.dueDate < today ? 'bg-red-50 text-critical' : 'bg-indigo-50 text-primary'}`}
                >
                  {event.status === 'pendiente' && event.dueDate < today ? 'Vencido' : event.status}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {LABELS[event.type]} · {calendarDate(event.dueDate)}
                {event.dueTime && ` · ${event.dueTime}`}
                {event.recurrence !== 'none' && ' · Se repite'}
              </p>
              {event.description && (
                <p className="whitespace-pre-wrap break-words text-sm">{event.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setEditing(event);
                    setOpen(true);
                  }}
                >
                  Editar
                </button>
                {event.status === 'pendiente' && (
                  <button
                    className="btn-primary text-xs"
                    disabled={Boolean(busyId)}
                    onClick={async () => {
                      setBusyId(event.id);
                      try {
                        await completeCalendar(event.id, event.version);
                        setMessage(
                          event.recurrence === 'none'
                            ? 'Evento completado.'
                            : 'Evento completado. Próxima fecha programada.'
                        );
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : 'No se pudo completar.');
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    {busyId === event.id ? 'Guardando…' : 'Completar'}
                  </button>
                )}
              </div>
              {event.updatedByName && (
                <p className="text-[10px] text-slate-400">Último cambio: {event.updatedByName}</p>
              )}
            </article>
          ))}
          {more && (
            <button className="btn-ghost w-full" disabled={paging} onClick={() => void loadMore()}>
              {paging ? 'Cargando…' : 'Cargar más eventos del mes'}
            </button>
          )}
        </section>
      </div>
      <Modal
        open={open}
        title={editing ? 'Editar evento' : 'Nuevo evento'}
        onClose={() => setOpen(false)}
        wide
      >
        {open && (
          <CalendarEditor
            key={editing ? `${editing.id}:${editing.version}` : 'new'}
            event={editing}
            date={selectedDate ?? (month === today.slice(0, 7) ? today : `${month}-01`)}
            onSaved={() => {
              setOpen(false);
              setMessage('Evento guardado.');
            }}
          />
        )}
      </Modal>
    </div>
  );
}
