import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronDown, LogOut, type LucideIcon } from 'lucide-react';

export interface NavigationItem { to: string; label: string; icon: LucideIcon; end?: boolean; group?: string }

export function Navigation({ items, compact = false, onNavigate, label = 'Navegación principal' }: {
  items: NavigationItem[]; compact?: boolean; onNavigate?: () => void; label?: string;
}) {
  return <nav className={`app-navigation ${compact ? 'nav-compact' : ''}`} aria-label={label}>
    {items.map(({ to, label: name, icon: Icon, end, group }, index) => <div key={to}>
      {group && group !== items[index - 1]?.group && <p className="nav-group">{compact ? <span className="sr-only">{group}</span> : group}</p>}
      <NavLink to={to} end={end} title={compact ? name : undefined} onClick={onNavigate}
        className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
        <Icon size={19} strokeWidth={1.7} /><span>{name}</span>
      </NavLink>
    </div>)}
  </nav>;
}

export function AccountMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) ref.current?.removeAttribute('open'); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <details className="account-menu" ref={ref}>
    <summary aria-label={`Cuenta de ${name}`}><span className="account-avatar">{name.charAt(0).toUpperCase()}</span><span className="account-name">{name}<small>{role}</small></span><ChevronDown size={14} /></summary>
    <div className="account-popover"><strong>{name}</strong><span>{role}</span><button onClick={onLogout}><LogOut size={16} /> Cerrar sesión</button></div>
  </details>;
}
