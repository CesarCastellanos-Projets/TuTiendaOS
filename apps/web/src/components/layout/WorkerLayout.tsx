import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ScanBarcode, TriangleAlert, LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';

export function WorkerLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="tape h-1.5 w-full" aria-hidden />
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
        <span className="price-tag rounded px-2 py-0.5 font-display bg-white text-slate-900">D'ENZOZ</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-300">{profile.displayName}</span>
          <button
            onClick={() => void logout().then(() => navigate('/login'))}
            aria-label="Salir"
            className="rounded-lg p-2 hover:bg-white/10"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-lg flex-1 p-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-2 border-t border-slate-200 bg-white">
        <TabLink to="/w" icon={<ScanBarcode size={20} />} label="Consultar" end />
        <TabLink
          to="/w/incidencias"
          icon={<TriangleAlert size={20} />}
          label="Incidencias"
        />
      </nav>
    </div>
  );
}

function TabLink({
  to,
  icon,
  label,
  end
}: {
  to: string;
  icon: ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2.5 text-xs font-semibold transition-colors ${
          isActive ? 'text-primary' : 'text-slate-500'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
