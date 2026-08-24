import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ShoppingCart, Vault, ReceiptText, PackageOpen, Truck, LogOut } from 'lucide-react';
import { useAuth } from '../../lib/auth';

export function PosLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="tape h-1.5 w-full" aria-hidden />
      <div className="flex items-center justify-between gap-2 bg-slate-900 px-3 py-2 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="price-tag rounded px-2 py-0.5 font-display bg-white text-slate-900">D'ENZOZ</span>
          <span className="hidden truncate text-xs text-slate-300 sm:inline">
            {profile.displayName}
          </span>
        </div>
        <nav className="-mx-1 flex flex-1 justify-center gap-1 overflow-x-auto sm:justify-end">
          <TabLink to="/pos" icon={<ShoppingCart size={16} />} label="Vender" end />
          <TabLink to="/pos/recepciones" icon={<Truck size={16} />} label="Recepciones" />
          <TabLink to="/pos/caja" icon={<Vault size={16} />} label="Caja" />
          <TabLink to="/pos/ventas" icon={<ReceiptText size={16} />} label="Mis ventas" />
          <TabLink to="/pos/reposicion" icon={<PackageOpen size={16} />} label="Reposición" />
        </nav>
        <button
          onClick={() => void logout().then(() => navigate('/login'))}
          aria-label="Salir"
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <LogOut size={18} />
        </button>
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
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
        `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
          isActive ? 'bg-primary text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
