import { useEffect, useState, type ReactNode } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from '../lib/auth';

export function AccessGate({ children }: { children: ReactNode }) {
  const { profile, logout } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState('Comprobando tu horario…');
  const scheduled = profile?.role !== 'admin' && Boolean(profile?.accessSchedule);
  useEffect(() => {
    if (!scheduled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let expiryTimer: ReturnType<typeof setTimeout>;
    let revision = 0;
    setAllowed(false);
    const check = async () => {
      const run = ++revision;
      clearTimeout(timer);
      if (!navigator.onLine) { setAllowed(false); setMessage('Conecta el equipo para verificar tu horario.'); return; }
      try {
        const started = performance.now();
        const result = await httpsCallable<unknown, { allowed: boolean; serverNow: number; validUntil: number }>(functions, 'getAccessState')({});
        if (!alive || run !== revision) return;
        const remaining = result.data.validUntil - result.data.serverNow - (performance.now() - started);
        clearTimeout(expiryTimer);
        setAllowed(result.data.allowed && remaining > 0);
        setMessage('Fuera de tu horario de acceso. Consulta con el administrador.');
        expiryTimer = setTimeout(() => setAllowed(false), Math.max(1, remaining));
        timer = setTimeout(() => void check(), remaining > 15000 ? remaining - 10000 : Math.max(100, remaining + 100));
      } catch {
        if (!alive || run !== revision) return;
        setAllowed(false); setMessage('No se pudo verificar tu horario. Revisa tu conexión.');
        timer = setTimeout(() => void check(), 15000);
      }
    };
    const invalidate = () => { setAllowed(false); void check(); };
    void check();
    window.addEventListener('online', invalidate); window.addEventListener('offline', invalidate);
    window.addEventListener('focus', invalidate);
    document.addEventListener('visibilitychange', invalidate);
    return () => { alive = false; clearTimeout(timer); clearTimeout(expiryTimer); window.removeEventListener('online', invalidate); window.removeEventListener('offline', invalidate); window.removeEventListener('focus', invalidate); document.removeEventListener('visibilitychange', invalidate); };
  }, [scheduled, profile?.accessSchedule]);
  if (!scheduled || allowed) return <>{children}</>;
  return <div className="grid min-h-screen place-items-center p-6"><div className="card max-w-md space-y-4 p-6 text-center"><h1 className="font-display text-xl">Horario de acceso</h1><p role="status">{message}</p><button className="btn-ghost" onClick={() => void logout()}>Cerrar sesión</button></div></div>;
}
