import { useState } from 'react';
import { saveCalendar, calendarError, type CalendarDraft } from '../../lib/calendar';
import type { CalendarEvent } from '../../types';

const REMINDERS = [30, 14, 7, 3, 1, 0];
export function CalendarEditor({
  event,
  date,
  onSaved
}: {
  event: CalendarEvent | null;
  date: string;
  onSaved: () => void;
}) {
  const [id] = useState(() => event?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState<CalendarDraft>(() =>
    event
      ? {
          title: event.title,
          description: event.description,
          type: event.type,
          dueDate: event.dueDate,
          dueTime: event.dueTime,
          reminderDays: event.reminderDays,
          recurrence: event.recurrence,
          status: event.status
        }
      : {
          title: '',
          description: '',
          type: 'tarea',
          dueDate: date,
          dueTime: '',
          reminderDays: [7, 3, 1, 0],
          recurrence: 'none',
          status: 'pendiente'
        }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof CalendarDraft>(key: K, value: CalendarDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <form
      className="space-y-3"
      onSubmit={async (submit) => {
        submit.preventDefault();
        if (busy) return;
        if (!draft.reminderDays.length) {
          setError('Selecciona al menos un aviso.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await saveCalendar(id, event?.version ?? 0, draft);
          onSaved();
        } catch (error) {
          setError(calendarError(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="label">
        Título *
        <input
          className="field mt-1"
          value={draft.title}
          onChange={(e) => update('title', e.target.value)}
          maxLength={120}
          required
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="label">
          Tipo
          <select
            className="field mt-1"
            value={draft.type}
            onChange={(e) => update('type', e.target.value as CalendarDraft['type'])}
          >
            <option value="pago">Pago</option>
            <option value="tarea">Tarea</option>
            <option value="vencimiento">Vencimiento</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="label">
          Estado
          <select
            className="field mt-1"
            value={draft.status}
            onChange={(e) => update('status', e.target.value as CalendarDraft['status'])}
          >
            <option value="pendiente">Pendiente</option>
            <option value="completado">Completado</option>
            <option value="cancelado">Cancelado</option>
          </select>
        </label>
        <label className="label">
          Fecha *
          <input
            className="field mt-1"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            value={draft.dueDate}
            required
            onChange={(e) => update('dueDate', e.target.value)}
          />
        </label>
        <label className="label">
          Hora opcional
          <input
            className="field mt-1"
            type="time"
            value={draft.dueTime}
            onChange={(e) => update('dueTime', e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        Horario de Perú. Sin hora indicada, los avisos llegan desde las 9:00 a. m.
      </p>
      <label className="label">
        Descripción
        <textarea
          className="field mt-1"
          rows={3}
          maxLength={1000}
          value={draft.description}
          onChange={(e) => update('description', e.target.value)}
        />
      </label>
      <label className="label">
        Repetición
        <select
          className="field mt-1"
          value={draft.recurrence}
          onChange={(e) => update('recurrence', e.target.value as CalendarDraft['recurrence'])}
        >
          <option value="none">No repetir</option>
          <option value="daily">Cada día</option>
          <option value="weekly">Cada semana</option>
          <option value="monthly">Cada mes</option>
        </select>
      </label>
      <fieldset>
        <legend className="label">Avisar antes de la fecha</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {REMINDERS.map((day) => (
            <label key={day} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.reminderDays.includes(day)}
                onChange={(e) =>
                  update(
                    'reminderDays',
                    e.target.checked
                      ? [...draft.reminderDays, day]
                      : draft.reminderDays.filter((value) => value !== day)
                  )
                }
              />
              {day === 0 ? 'El mismo día' : `${day} día${day === 1 ? '' : 's'}`}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-slate-500">
        Los avisos terminan al acabar la fecha indicada, en horario de Perú. Los vencidos se conservan en
        «Mostrar finalizados». Completar una fecha repetida programa la siguiente; «Finalizar repetición» detiene el evento.
      </p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? 'Guardando…' : 'Guardar evento'}
      </button>
    </form>
  );
}
