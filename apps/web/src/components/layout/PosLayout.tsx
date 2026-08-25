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
  { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta (Vender)', shortLabel: 'Vender', desc: 'Emisión de boletas y facturas', end: true },
  { to: '/pos/recepciones', icon: Truck, label: 'Recepciones de Traslado', shortLabel: 'Recepciones', desc: 'Ingreso de mercadería desde almacén' },
  { to: '/pos/caja', icon: Vault, label: 'Control de Caja (Turno)', shortLabel: 'Caja', desc: 'Apertura, arqueo y cierre Z' },
  { to: '/pos/ventas', icon: ReceiptText, label: 'Mis Ventas del Día', shortLabel: 'Mis Ventas', desc: 'Historial de comprobantes emitidos' },
  { to: '/pos/reposicion', icon: PackageOpen, label: 'Solicitar Reposición', shortLabel: 'Reposición', desc: 'Pedir stock a almacén central' }
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
    <div className="flex min-h-dvh flex-col bg-slate-100/60">
      {/* ─── BARRA SUPERIOR INTEGRADA (Header limpio sin barras laterales raras) ─ */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-xs">
        {/* Lado Izquierdo: Botón Hamburguesa 3 Líneas + Logo */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú de navegación"
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-all active:scale-95 shadow-xs"
          >
            <Menu size={18} className="text-slate-600" />
            <span className="text-xs font-display font-bold hidden sm:inline">Menú</span>
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
              <Sparkles size={16} />
            </div>
            <div>
              <span className="font-display font-extrabold text-base tracking-tight text-slate-900 block leading-tight">
                D'ENZOZ POS
              </span>
            </div>
          </div>
        </div>

        {/* Centro: Switch Rápido de Pestañas en Pantallas Medianas/Grandes */}
        <nav className="hidden md:flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 border border-slate-200/80">
          {POS_NAV.map(({ to, icon: Icon, shortLabel, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-primary text-white shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`
              }
            >
              <Icon size={14} />
              <span>{shortLabel}</span>
            </NavLink>
          ))}
        </nav>

        {/* Lado Derecho: Info del Cajero & Botón Salir */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-slate-700 truncate max-w-[140px]">
              {profile.displayName}
            </span>
          </div>

          <button
            onClick={() => void handleLogout()}
            title="Cerrar turno y salir"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 hover:bg-red-50 hover:text-critical hover:border-red-200 transition-colors"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ─── CONTENIDO PRINCIPAL (Ocupa el 100% de la pantalla sin barras que estorben) ─── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>

      {/* ─── DRAWER LATERAL FLUIDO (Se abre al presionar las 3 líneas) ───────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in duration-200">
          {/* Backdrop Blur */}
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs transition-opacity"
          />

          {/* Drawer Panel */}
          <div className="relative flex w-full max-w-sm flex-1 flex-col bg-white shadow-2xl transition-transform duration-300 ease-out animate-in slide-in-from-left">
            {/* Header del Drawer */}
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-white shadow-md shadow-primary/30">
                  <Sparkles size={20} />
                </div>
                <div>
                  <span className="font-display font-extrabold text-lg tracking-tight text-slate-900 block leading-tight">
                    D'ENZOZ POS
                  </span>
                  <span className="text-xs text-slate-400 font-medium block">
                    Menú de Operaciones
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
            <div className="border-b border-slate-100 bg-slate-50/80 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100 text-primary font-display font-extrabold text-sm border border-indigo-200">
                  {profile.displayName?.charAt(0).toUpperCase() || 'C'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900 leading-tight">
                    {profile.displayName}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                    <Store size={13} className="text-slate-400" /> Cajero Autorizado
                  </p>
                </div>
              </div>
            </div>

            {/* Links de Navegación Completos */}
            <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
              {POS_NAV.map(({ to, label, desc, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-2xl p-3 text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-primary text-white shadow-md shadow-primary/25 font-bold'
                        : 'text-slate-800 hover:bg-slate-100/80'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <Icon size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold leading-tight">{label}</p>
                          <p
                            className={`truncate text-xs ${
                              isActive ? 'text-indigo-100' : 'text-slate-400'
                            }`}
                          >
                            {desc}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={18} className={`shrink-0 ${isActive ? 'opacity-90' : 'opacity-40'}`} />
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            {/* Footer con botón Cerrar Turno */}
            <div className="border-t border-slate-100 p-4">
              <button
                onClick={() => void handleLogout()}
                className="btn-danger w-full !py-3 text-xs font-bold"
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
