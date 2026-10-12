import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { UserProfile } from '../../types';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../lib/auth';
import { PasswordChange } from './PasswordChange';

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minute = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };

export function UserSettings({ user, close, saved }: { user: UserProfile & { id: string }; close: () => void; saved: (text: string) => void }) {
  const ownAccount = useAuth((state) => state.user?.uid === user.id);
  const [scheduled, setScheduled] = useState(Boolean(user.accessSchedule));
  const [days, setDays] = useState(user.accessSchedule?.days ?? [1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(time(user.accessSchedule?.start ?? 480));
  const [end, setEnd] = useState(time(user.accessSchedule?.end ?? 1080));
  const [costs, setCosts] = useState(user.canViewPurchaseCosts === true);
  const [prices, setPrices] = useState(user.canOverridePrices !== false && user.storeAccess === 'all');
  const [calendar, setCalendar] = useState(user.canManageCalendar ?? user.storeAccess === 'all');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (name: string, data: Record<string, unknown>, message: string) => {
    setBusy(true); setError('');
    try { await httpsCallable(functions, name)({ uid: user.id, ...data }); saved(message); close(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  };
  return <Modal open title={`Administrar: ${user.displayName}`} onClose={() => { if (!busy) close(); }}><div className="space-y-5">
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run('setUserSettings', { accessSchedule: scheduled && user.role !== 'admin' ? { days, start: minute(start), end: minute(end) } : null, canViewPurchaseCosts: costs, canOverridePrices: prices, canManageCalendar: calendar }, 'Permisos y horario guardados'); }}>
      {user.role === 'pos' && <><label className="flex gap-2"><input type="checkbox" checked={costs} onChange={(e) => setCosts(e.target.checked)} />Consultar costo de compra y proveedor</label>{user.storeAccess === 'all' && <label className="flex gap-2"><input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} />Ajustar el precio de la venta actual</label>}<label className="flex gap-2"><input type="checkbox" checked={calendar} onChange={(e) => setCalendar(e.target.checked)} />Administrar calendario</label></>}
      {user.role === 'admin' ? <p>El administrador conserva acceso sin restricción horaria.</p> : <><label className="flex gap-2"><input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />Restringir horario (hora de Perú)</label>{scheduled && <><div className="flex flex-wrap gap-3">{DAYS.map((day, i) => <label key={day} className="flex gap-1"><input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />{day}</label>)}</div><div className="grid grid-cols-2 gap-3"><label className="label">Desde<input type="time" required className="field" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="label">Hasta<input type="time" required className="field" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div><p className="text-sm text-slate-500">Incluye el último minuto indicado. Si el fin es anterior al inicio, el turno continúa al día siguiente.</p></>}</>}
      <button className="btn-primary" disabled={busy || (scheduled && !days.length)}>Guardar permisos y horario</button>
    </form>
    {ownAccount ? <div className="border-t pt-4"><PasswordChange /></div> : <form className="space-y-2 border-t pt-4" onSubmit={(e) => { e.preventDefault(); void run('changeUserPassword', { password }, 'Contraseña actualizada; sesiones cerradas'); }}><label className="label">Nueva contraseña<input className="field" type="password" autoComplete="new-password" required minLength={6} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="btn-ghost" disabled={busy}>Restablecer contraseña</button></form>}
    <div className="space-y-2 border-t pt-4"><p className="text-sm">Eliminar la cuenta conserva sus ventas y movimientos históricos.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Confirmo la eliminación de esta cuenta</label><button className="btn-ghost text-critical" disabled={!confirm || busy} onClick={() => void run('deleteSystemUser', {}, 'Cuenta eliminada')}>Eliminar cuenta</button></div>
    {error && <p role="alert" className="text-critical">{error}</p>}
  </div></Modal>;
}
