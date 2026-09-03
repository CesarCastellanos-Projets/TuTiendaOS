import { useState, Suspense } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { RouteLoading } from '../RouteLoading';
import {
  ScanBarcode,
  TriangleAlert,
  LogOut,
  Sparkles,
  Menu,
  X,
  Store,
  ChevronRight,
  Calculator
} from 'lucide-react';
import { useAuth } from '../../lib/auth';

const WORKER_NAV = [
  { to: '/w', icon: ScanBarcode, label: 'Consultar Precio y Stock', shortLabel: 'Consultar', end: true },
  { to: '/w/cotizaciones', icon: Calculator, label: 'Cotizar Pedidos', shortLabel: 'Cotizar' },
  { to: '/w/incidencias', icon: TriangleAlert, label: 'Reportar Incidencia', shortLabel: 'Incidencias' }
];

export function WorkerLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      {/* ─── HEADER SUPERIOR REFINADO ────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú de navegación"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Menu size={19} />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900">
              D'ENZOZ
            </span>
            <span className="badge bg-indigo-50 text-primary text-[10px] font-bold">Piso</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 truncate max-w-[120px]">
            {profile.displayName}
          </span>
          <button
            onClick={() => void handleLogout()}
            aria-label="Cerrar sesión"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ─── CONTENIDO PRINCIPAL (Optimizado para pantalla móvil/PWA) ───────── */}
      <main className="mx-auto w-full max-w-lg flex-1 p-4 pb-28">
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </main>

      {/* ─── BOTTOM NAVIGATION BAR FLOTANTE Y ELEGANTE ────────────────────────── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur-md px-3 py-2">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-1.5">
          {WORKER_NAV.map(({ to, icon: Icon, shortLabel, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-xs font-bold transition-all duration-150 active:scale-95 ${
                  isActive
                    ? 'bg-primary/10 text-primary font-extrabold'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`
              }
            >
              <Icon size={20} className="shrink-0" />
              <span>{shortLabel}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* ─── DRAWER LATERAL DE TRABAJADOR ────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
          />

          <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white shadow-2xl transition-transform duration-300 ease-out animate-in slide-in-from-left">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
                  <Sparkles size={18} />
                </div>
                <div>
                  <span className="font-display font-extrabold text-base tracking-tight text-slate-900 block leading-tight">
                    D'ENZOZ
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 block">
                    Trabajador de Piso
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <div className="border-b border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-primary font-bold">
                  {profile.displayName?.charAt(0).toUpperCase() || 'T'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {profile.displayName}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Store size={12} /> Operaciones de Tienda
                  </p>
                </div>
              </div>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {WORKER_NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-xl px-3.5 py-3 text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-primary text-white shadow-sm shadow-primary/25 font-bold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  <div className="flex items-center gap-3">
                    <Icon size={19} className="shrink-0" />
                    <span>{label}</span>
                  </div>
                  <ChevronRight size={16} className="opacity-50" />
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-slate-100 p-4">
              <button
                onClick={() => void handleLogout()}
                className="btn-danger w-full !py-2.5 text-xs font-bold"
              >
                <LogOut size={16} /> Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
