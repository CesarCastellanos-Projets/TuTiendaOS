import { useState, Suspense } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarBell } from '../calendar/CalendarBell';
import { RouteLoading } from '../RouteLoading';
import {
  CalendarDays,
  LayoutDashboard,
  Package,
  Warehouse,
  ArrowDownToLine,
  ArrowLeftRight,
  SlidersHorizontal,
  ClipboardList,
  Users,
  FileText,
  Receipt,
  Printer,
  TriangleAlert,
  History,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Sparkles,
  Building2
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';

const NAV = [
  { to: '/admin', label: 'Panel General', icon: LayoutDashboard, end: true },
  { to: '/admin/productos', label: 'Productos y Catálogo', icon: Package },
  { to: '/admin/ubicaciones', label: 'Tiendas y Almacenes', icon: Warehouse },
  { to: '/admin/ingresos', label: 'Ingresos de Mercadería', icon: ArrowDownToLine },
  { to: '/admin/transferencias', label: 'Transferencias', icon: ArrowLeftRight },
  { to: '/admin/reposiciones', label: 'Reposiciones', icon: ClipboardList },
  { to: '/admin/ajustes', label: 'Ajustes de Inventario', icon: SlidersHorizontal },
  { to: '/admin/kardex', label: 'Kárdex de Movimientos', icon: History },
  { to: '/admin/comprobantes', label: 'Comprobantes Emitidos', icon: Receipt },
  { to: '/admin/tickets', label: 'Diseño de Tickets', icon: Printer },
  { to: '/admin/sunat', label: 'SUNAT y Facturación', icon: FileText },
  { to: '/admin/incidencias', label: 'Incidencias de Piso', icon: TriangleAlert },
  { to: '/admin/calendario', label: 'Calendario de la empresa', icon: CalendarDays },
  { to: '/admin/usuarios', label: 'Usuarios y Accesos', icon: Users }
];

export function AdminLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const company = useCompany();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-dvh bg-slate-50/70">
      {/* ─── SIDEBAR ESCRITORIO (Colapsable con 3 líneas) ────────────────────────── */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-300 ease-in-out lg:flex ${
          collapsed ? 'w-[76px]' : 'w-64'
        }`}
      >
        {/* Header del Sidebar */}
        <div className="flex h-16 items-center justify-between border-b border-slate-100 px-4">
          {!collapsed && (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
                <Sparkles size={18} />
              </div>
              <div className="truncate">
                <span className="font-display font-extrabold text-base tracking-tight text-slate-900 block leading-tight">
                  D'ENZOZ
                </span>
                <span className="text-[11px] font-medium text-slate-400 block truncate">
                  Admin Cloud SaaS
                </span>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
              <Sparkles size={18} />
            </div>
          )}

          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            title={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'}
          >
            <Menu size={18} />
          </button>
        </div>

        {/* Lista de Navegación */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {NAV.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest && rest.end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150 ${
                  isActive
                    ? 'bg-primary text-white shadow-sm shadow-primary/25'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                } ${collapsed ? 'justify-center !px-0' : ''}`
              }
            >
              <Icon size={19} className="shrink-0 transition-transform group-hover:scale-105" />
              {!collapsed && <span className="truncate">{label}</span>}
              {!collapsed && (
                <ChevronRight
                  size={14}
                  className="ml-auto opacity-0 transition-opacity group-hover:opacity-60"
                />
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer del Sidebar con usuario y botón salir */}
        <div className="border-t border-slate-100 p-3">
          {!collapsed ? (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-primary">
                  {profile.displayName?.charAt(0).toUpperCase() || 'A'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-slate-800 leading-tight">
                    {profile.displayName}
                  </p>
                  <p className="text-[10px] font-medium text-slate-400">Administrador</p>
                </div>
              </div>
              <button
                onClick={() => void handleLogout()}
                title="Cerrar sesión"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => void handleLogout()}
              title="Cerrar sesión"
              className="flex w-full items-center justify-center rounded-xl p-2.5 text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </aside>

      {/* ─── CONTENEDOR PRINCIPAL Y HEADER MÓVIL ──────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior de acento */}
        <div className="tape h-1 w-full" aria-hidden />

        <div className="fixed right-3 top-1.5 z-40 lg:right-5"><CalendarBell /></div>

        {/* Header Móvil / Tablet con botón Hamburguesa */}
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white pl-4 pr-16 lg:hidden shadow-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menú de navegación"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-display font-extrabold text-lg tracking-tight text-slate-900">
                D'ENZOZ
              </span>
              <span className="badge bg-primary/10 text-primary text-[10px] font-bold">Admin</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[120px]">
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

        {/* Topbar Escritorio */}
        <header className="hidden h-14 items-center justify-between border-b border-slate-200 bg-white pl-8 pr-20 lg:flex">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Building2 size={16} className="text-slate-400" />
            <span className="font-bold text-slate-800">{company?.razonSocial || "D'ENZOZ S.A.C."}</span>
            {company?.ruc && (
              <span className="font-mono text-xs text-slate-400">· RUC: {company.ruc}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200/80 px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium text-slate-600">Modo Administrador</span>
            </div>
            <button
              onClick={() => void handleLogout()}
              className="btn-ghost !min-h-[34px] !px-3 !py-1 text-xs font-bold"
            >
              <LogOut size={14} /> Salir
            </button>
          </div>
        </header>

        {/* Contenido de la página con carga perezosa */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-20 lg:p-8">
          <Suspense fallback={<RouteLoading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* ─── DRAWER MÓVIL / TABLET CON BACKDROP BLUR ─────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            onClick={() => setMobileOpen(false)}
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
                    D'ENZOZ
                  </span>
                  <span className="text-[11px] font-medium text-slate-400 block">Menú Principal</span>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Links de Navegación Móvil */}
            <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {NAV.map(({ to, label, icon: Icon, ...rest }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={'end' in rest && rest.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                      isActive
                        ? 'bg-primary text-white shadow-sm shadow-primary/25'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`
                  }
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </nav>

            {/* Footer del Drawer Móvil */}
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
