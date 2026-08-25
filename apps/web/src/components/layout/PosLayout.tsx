import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  Vault,
  ReceiptText,
  PackageOpen,
  Truck,
  LogOut,
  Menu,
  X,
  Sparkles,
  Store,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../lib/auth';

const POS_NAV = [
  { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta', shortLabel: 'Vender', end: true },
  { to: '/pos/recepciones', icon: Truck, label: 'Recepciones de Traslado', shortLabel: 'Recepciones' },
  { to: '/pos/caja', icon: Vault, label: 'Control de Caja (Turno)', shortLabel: 'Caja' },
  { to: '/pos/ventas', icon: ReceiptText, label: 'Mis Ventas del Día', shortLabel: 'Ventas' },
  { to: '/pos/reposicion', icon: PackageOpen, label: 'Solicitar Reposición', shortLabel: 'Reposición' }
];

export function PosLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row bg-slate-50">
      {/* ─── SIDEBAR COMPACTO / SWITCH BAR EN DESKTOP ─────────────────────────── */}
      <aside className="sticky top-0 hidden h-dvh w-18 shrink-0 flex-col items-center justify-between border-r border-slate-200 bg-white py-4 shadow-xs lg:flex z-30">
        {/* Top Logo & Hamburguesa */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
            <Sparkles size={20} />
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            title="Abrir menú completo"
            aria-label="Abrir menú de navegación"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Navigation Switch Icons */}
        <nav className="flex flex-col items-center gap-2">
          {POS_NAV.map(({ to, icon: Icon, shortLabel, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={shortLabel}
              className={({ isActive }) =>
                `group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary text-white shadow-md shadow-primary/30 scale-105'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon size={20} className="transition-transform group-hover:scale-110" />
              {/* Tooltip flotante */}
              <span className="pointer-events-none absolute left-14 z-50 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {shortLabel}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* User Avatar & Logout */}
        <div className="flex flex-col items-center gap-2">
          <div
            title={`Cajero: ${profile.displayName}`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700 border border-slate-200"
          >
            {profile.displayName?.charAt(0).toUpperCase() || 'C'}
          </div>
          <button
            onClick={() => void handleLogout()}
            title="Cerrar sesión"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ─── HEADER SUPERIOR EN MÓVIL / TABLET ──────────────────────────────── */}
      <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden shadow-xs z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú de navegación"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900">
              D'ENZOZ
            </span>
            <span className="badge bg-emerald-50 text-success text-[10px] font-bold">POS</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 truncate max-w-[120px]">
            {profile.displayName}
          </span>
          <button
            onClick={() => void handleLogout()}
            aria-label="Cerrar sesión"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-critical"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ─── CONTENIDO PRINCIPAL ────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      {/* ─── DRAWER LATERAL EXPANDIDO (Activado por Hamburguesa) ─────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
          />

          {/* Drawer Content */}
          <div className="relative flex w-full max-w-xs flex-1 flex-col bg-white shadow-2xl transition-transform duration-300 ease-out animate-in slide-in-from-left">
            {/* Header del Drawer */}
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
                  <Sparkles size={18} />
                </div>
                <div>
                  <span className="font-display font-extrabold text-base tracking-tight text-slate-900 block leading-tight">
                    D'ENZOZ POS
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 block">
                    Caja y Mostrador
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Perfil del Cajero */}
            <div className="border-b border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  {profile.displayName?.charAt(0).toUpperCase() || 'C'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {profile.displayName}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Store size={12} /> Cajero Autorizado
                  </p>
                </div>
              </div>
            </div>

            {/* Links de Navegación */}
            <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {POS_NAV.map(({ to, label, icon: Icon, end }) => (
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

            {/* Footer con botón Salir */}
            <div className="border-t border-slate-100 p-4">
              <button
                onClick={() => void handleLogout()}
                className="btn-danger w-full !py-2.5 text-xs font-bold"
              >
                <LogOut size={16} /> Cerrar Turno / Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
