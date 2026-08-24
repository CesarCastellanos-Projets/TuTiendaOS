import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
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
  TriangleAlert,
  History,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';

const NAV = [
  { to: '/admin', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/admin/productos', label: 'Productos', icon: Package },
  { to: '/admin/ubicaciones', label: 'Tiendas y almacenes', icon: Warehouse },
  { to: '/admin/ingresos', label: 'Ingresos de mercadería', icon: ArrowDownToLine },
  { to: '/admin/transferencias', label: 'Transferencias', icon: ArrowLeftRight },
  { to: '/admin/reposicion', label: 'Reposiciones', icon: ClipboardList },
  { to: '/admin/ajustes', label: 'Ajustes de inventario', icon: SlidersHorizontal },
  { to: '/admin/kardex', label: 'Kárdex', icon: History },
  { to: '/admin/comprobantes', label: 'Comprobantes', icon: Receipt },
  { to: '/admin/sunat', label: 'SUNAT', icon: FileText },
  { to: '/admin/incidencias', label: 'Incidencias', icon: TriangleAlert },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users }
];

export function AdminLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const company = useCompany();

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-slate-900 lg:flex">
        <div className="px-5 py-5">
          <span className="price-tag inline-block rounded px-2.5 py-1 font-display text-xl tracking-wide">
            D'ENZOZ
          </span>
          <p className="mt-1.5 text-xs text-slate-500">Panel administrativo</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest && rest.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon size={16} aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-slate-50/50">
        <header className="tape h-1.5 w-full" aria-hidden />
        <header className="flex items-center justify-between gap-3 bg-white px-4 py-2.5 lg:hidden border-b border-slate-200">
          <span className="price-tag rounded px-2 py-0.5 font-display">D'ENZOZ</span>
          <MobileNav />
        </header>
        <div className="hidden items-center justify-between border-b border-slate-200 bg-white px-6 py-2.5 lg:flex">
          <p className="text-sm font-semibold">{company?.razonSocial ?? "D'ENZOZ"}</p>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{profile.displayName}</span>
            <button
              onClick={() => void logout().then(() => navigate('/login'))}
              className="btn-ghost !min-h-9 !px-3 !py-1.5 text-sm"
            >
              <LogOut size={15} /> Salir
            </button>
          </div>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 pb-24 lg:p-6 lg:pb-6">
          <Outlet />
        </main>

        <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-3 py-2 lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-slate-600">{profile.displayName}</span>
            <button onClick={() => void logout().then(() => navigate('/login'))} className="text-xs font-semibold text-primary">
              Salir
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function MobileNav(): ReactNode {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-0.5">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/admin'}
          className={({ isActive }) =>
            `flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
              isActive ? 'bg-primary text-white' : 'bg-slate-100 text-slate-900'
            }`
          }
        >
          <Icon size={14} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
