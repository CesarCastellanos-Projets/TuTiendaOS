import { useState } from 'react';
import { createPortal } from 'react-dom';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { Modal } from '../ui/Modal';

export function PasswordChange() {
  const { user, profile, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (profile?.role !== 'admin') return null;
  return <><button onClick={() => setOpen(true)}>Cambiar contraseña</button>{createPortal(<Modal open={open} title="Cambiar contraseña" onClose={() => { if (!busy) { setOpen(false); setCurrent(''); setPassword(''); } }}><form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); if (!user?.email) return; setBusy(true); setError('');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await user.getIdToken(true);
      await httpsCallable(functions, 'changeUserPassword')({ uid: user.uid, password });
      await logout();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo cambiar la contraseña.'); }
    finally { setBusy(false); }
  }}><label className="label">Contraseña actual<input className="field" type="password" autoComplete="current-password" value={current} required onChange={(e) => setCurrent(e.target.value)} /></label><label className="label">Nueva contraseña<input className="field" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={password} required onChange={(e) => setPassword(e.target.value)} /></label><p className="text-sm text-slate-500">Se cerrarán las sesiones abiertas. Ingresa nuevamente con la nueva contraseña.</p>{error && <p role="alert" className="text-critical">{error}</p>}<button className="btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button></form></Modal>, document.body)}</>;
}
