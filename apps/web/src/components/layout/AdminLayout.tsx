import { useState, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { CalendarDays, ChartColumn, LayoutDashboard, Package, Warehouse, ArrowDownToLine, ArrowLeftRight, SlidersHorizontal, ClipboardList, Users, FileText, Receipt, Printer, TriangleAlert, History, PanelLeftClose, PanelLeftOpen, Menu } from 'lucide-react';
import { CalendarBell } from '../calendar/CalendarBell';
import { ReplenishmentBell } from '../inventory/ReplenishmentBell';
import { RouteLoading } from '../RouteLoading';
import { Brand } from '../Brand';
import { Modal } from '../ui/Modal';
import { AccountMenu, Navigation, type NavigationItem } from './Navigation';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';

const NAV: NavigationItem[] = [
  { to: '/admin', label: 'Inicio', icon: LayoutDashboard, end: true, group: 'Resumen' },
  { to: '/admin/estadisticas', label: 'Estadísticas', icon: ChartColumn, group: 'Resumen' },
  { to: '/admin/productos', label: 'Productos', icon: Package, group: 'Mercadería' },
  { to: '/admin/ingresos', label: 'Ingresos', icon: ArrowDownToLine, group: 'Mercadería' },
  { to: '/admin/transferencias', label: 'Transferencias', icon: ArrowLeftRight, group: 'Mercadería' },
  { to: '/admin/reposiciones', label: 'Reposiciones', icon: ClipboardList, group: 'Mercadería' },
  { to: '/admin/ajustes', label: 'Ajustes', icon: SlidersHorizontal, group: 'Mercadería' },
  { to: '/admin/kardex', label: 'Kárdex', icon: History, group: 'Mercadería' },
  { to: '/admin/ubicaciones', label: 'Tiendas y almacenes', icon: Warehouse, group: 'Mercadería' },
  { to: '/admin/comprobantes', label: 'Comprobantes', icon: Receipt, group: 'Operación' },
  { to: '/admin/incidencias', label: 'Incidencias', icon: TriangleAlert, group: 'Operación' },
  { to: '/admin/calendario', label: 'Calendario', icon: CalendarDays, group: 'Operación' },
  { to: '/admin/cotizaciones', label: 'Cotizaciones', icon: FileText, group: 'OPERACION' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users, group: 'Equipo' },
  { to: '/admin/permisos-trabajadores', label: 'Permisos', icon: Users, group: 'Equipo' },
  { to: '/admin/tickets', label: 'Diseño de tickets', icon: Printer, group: 'Configuración' },
  { to: '/admin/sunat', label: 'SUNAT', icon: FileText, group: 'Configuración' }
];

export function AdminLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const company = useCompany();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className={`app-shell admin-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="admin-sidebar">
      <div className="sidebar-brand"><Brand compact={collapsed} subtitle="Administración" /></div>
      <Navigation items={NAV} compact={collapsed} />
      <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}>
        {collapsed ? <PanelLeftOpen size={18} /> : <><PanelLeftClose size={18} /><span>Contraer menú</span></>}
      </button>
    </aside>
    <div className="app-shell-body">
      <header className="app-topbar">
        <button className="icon-button lg:hidden" aria-label="Abrir menú" onClick={() => setMobileOpen(true)}><Menu size={21} /></button>
        <div className="topbar-context"><span className="eyebrow">Administración</span><strong>{company?.razonSocial || 'D’ENZOZ'}</strong></div>
        <div className="topbar-actions"><ReplenishmentBell /><CalendarBell /><AccountMenu name={profile.displayName} role="Administrador" onLogout={() => void logout()} /></div>
      </header>
      <main id="main-content" className="admin-content page-content"><Suspense fallback={<RouteLoading />}><Outlet /></Suspense></main>
    </div>
    <Modal open={mobileOpen} title="Administración" onClose={() => setMobileOpen(false)} drawer><Brand subtitle="Administración" /><Navigation items={NAV} onNavigate={() => setMobileOpen(false)} /></Modal>
  </div>;
}
