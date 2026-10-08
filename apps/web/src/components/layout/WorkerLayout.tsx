import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { ScanBarcode, TriangleAlert, Calculator, ArrowDownToLine } from 'lucide-react';
import { RouteLoading } from '../RouteLoading';
import { Brand } from '../Brand';
import { AccountMenu, Navigation } from './Navigation';
import { useAuth } from '../../lib/auth';
import { workerInventoryTasks } from '../../lib/worker-inventory';

export function WorkerLayout() {
  const profile = useAuth((s) => s.profile)!;
  const logout = useAuth((s) => s.logout);
  const { canIngress, canCreateProducts } = workerInventoryTasks(profile);
  const nav = [
    { to: '/w', icon: ScanBarcode, label: 'Consultar', end: true },
    { to: '/w/cotizaciones', icon: Calculator, label: 'Cotizar' },
    { to: '/w/incidencias', icon: TriangleAlert, label: 'Incidencias' },
    ...(canIngress || canCreateProducts ? [{ to: '/w/ingresos', icon: ArrowDownToLine, label: 'Ingresos' }] : [])
  ];
  return <div className="worker-shell">
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <header className="app-topbar"><Brand subtitle="En tienda" /><div className="worker-desktop-nav"><Navigation items={nav} /></div><AccountMenu name={profile.displayName} role="Trabajador" onLogout={() => void logout()} /></header>
    <main id="main-content" className="worker-content page-content"><Suspense fallback={<RouteLoading />}><Outlet /></Suspense></main>
    <div className="mobile-navigation worker-mobile-nav"><Navigation items={nav} /></div>
  </div>;
}
