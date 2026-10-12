import { AccessGate } from './AccessGate';
import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth';
import type { Role } from '../types';

export function RequireRole({ roles }: { roles: Role[] }): ReactElement {
  const { user, profile, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  if (
    (profile.role === 'trabajador' && !profile.storeId)
    || (profile.role === 'pos' && !profile.storeId && profile.storeAccess !== 'all')
  ) {
    return (
      <Notice
        title="Sin tienda asignada"
        text="Pide al administrador que asigne tu usuario a una tienda."
      />
    );
  }
  return <AccessGate><Outlet /></AccessGate>;
}

export function FullPageLoader(): ReactElement {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <span className="price-tag rounded-lg px-4 py-2 font-display text-2xl tracking-wide">
          D'ENZOZ
        </span>
        <span className="text-sm text-slate-500">Cargando…</span>
      </div>
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }): ReactElement {
  const logout = useAuth((s) => s.logout);
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="card max-w-sm p-6 text-center">
        <h1 className="font-display text-xl">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">{text}</p>
        <button className="btn-primary mt-4" onClick={() => void logout()}>
          Salir
        </button>
      </div>
    </div>
  );
}
