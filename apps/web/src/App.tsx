import { Component, useEffect, lazy, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { useAuth, homeFor } from './lib/auth';
import { firebaseReady, initAnalytics } from './lib/firebase';
import { SetupScreen } from './components/SetupScreen';
import { LoginPage } from './pages/login/LoginPage';
import { RequireRole } from './components/RequireRole';
import { AdminLayout } from './components/layout/AdminLayout';
import { PosLayout } from './components/layout/PosLayout';
import { WorkerLayout } from './components/layout/WorkerLayout';

const AdminDashboard = lazy(() => import('./pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })));
const ProductsPage = lazy(() => import('./pages/admin/Products').then((m) => ({ default: m.ProductsPage })));
const LocationsPage = lazy(() => import('./pages/admin/Locations').then((m) => ({ default: m.LocationsPage })));
const IngressPage = lazy(() => import('./pages/admin/Ingress').then((m) => ({ default: m.IngressPage })));
const TransfersPage = lazy(() => import('./pages/admin/Transfers').then((m) => ({ default: m.TransfersPage })));
const AdjustmentsPage = lazy(() => import('./pages/admin/Adjustments').then((m) => ({ default: m.AdjustmentsPage })));
const KardexPage = lazy(() => import('./pages/admin/Kardex').then((m) => ({ default: m.KardexPage })));
const ReplenishmentAdminPage = lazy(() => import('./pages/admin/Replenishment').then((m) => ({ default: m.ReplenishmentAdminPage })));
const UsersPage = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const SunatConfigPage = lazy(() => import('./pages/admin/SunatConfig').then((m) => ({ default: m.SunatConfigPage })));
const TicketDesignerPage = lazy(() => import('./pages/admin/TicketDesigner').then((m) => ({ default: m.TicketDesignerPage })));
const ReceiptsPage = lazy(() => import('./pages/admin/Receipts').then((m) => ({ default: m.ReceiptsPage })));
const IncidentsAdminPage = lazy(() => import('./pages/admin/Incidents').then((m) => ({ default: m.IncidentsAdminPage })));

const AdminCalendar = lazy(() => import('./pages/admin/Calendar').then((m) => ({ default: m.AdminCalendar })));
const PosCalendar = lazy(() => import('./pages/pos/Calendar').then((m) => ({ default: m.PosCalendar })));

const PosSale = lazy(() => import('./pages/pos/Sale').then((m) => ({ default: m.PosSale })));
const ReceivingPage = lazy(() => import('./pages/pos/Receiving').then((m) => ({ default: m.ReceivingPage })));
const CashPage = lazy(() => import('./pages/pos/Cash').then((m) => ({ default: m.CashPage })));
const MySales = lazy(() => import('./pages/pos/MySales').then((m) => ({ default: m.MySales })));
const RequestRestock = lazy(() => import('./pages/pos/RequestRestock').then((m) => ({ default: m.RequestRestock })));

const WorkerLookup = lazy(() => import('./pages/worker/Lookup').then((m) => ({ default: m.WorkerLookup })));
const IncidentsWorkerPage = lazy(() => import('./pages/worker/Incidents').then((m) => ({ default: m.IncidentsWorkerPage })));
const WorkerQuotations = lazy(() => import('./pages/worker/Quotations').then((m) => ({ default: m.WorkerQuotations })));

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    element: <RequireRole roles={['admin']} />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'productos', element: <ProductsPage /> },
          { path: 'ubicaciones', element: <LocationsPage /> },
          { path: 'ingresos', element: <IngressPage /> },
          { path: 'transferencias', element: <TransfersPage /> },
          { path: 'ajustes', element: <AdjustmentsPage /> },
          { path: 'kardex', element: <KardexPage /> },
          { path: 'reposiciones', element: <ReplenishmentAdminPage /> },
          { path: 'reposicion', element: <ReplenishmentAdminPage /> },
          { path: 'incidencias', element: <IncidentsAdminPage /> },
          { path: 'usuarios', element: <UsersPage /> },
          { path: 'calendario', element: <AdminCalendar /> },
          { path: 'comprobantes', element: <ReceiptsPage /> },
          { path: 'tickets', element: <TicketDesignerPage /> },
          { path: 'sunat', element: <SunatConfigPage /> }
        ]
      }
    ]
  },
  {
    element: <RequireRole roles={['pos', 'admin']} />,
    children: [
      {
        path: '/pos',
        element: <PosLayout />,
        children: [
          { index: true, element: <PosSale /> },
          { path: 'recepcion', element: <ReceivingPage /> },
          { path: 'recepciones', element: <ReceivingPage /> },
          { path: 'caja', element: <CashPage /> },
          { path: 'calendario', element: <PosCalendar /> },
          { path: 'mis-ventas', element: <MySales /> },
          { path: 'ventas', element: <MySales /> },
          { path: 'reposicion', element: <RequestRestock /> },
          { path: 'reposiciones', element: <RequestRestock /> }
        ]
      }
    ]
  },
  {
    element: <RequireRole roles={['trabajador', 'pos', 'admin']} />,
    children: [
      {
        path: '/w',
        element: <WorkerLayout />,
        children: [
          { index: true, element: <WorkerLookup /> },
          { path: 'cotizaciones', element: <WorkerQuotations /> },
          { path: 'incidencias', element: <IncidentsWorkerPage /> }
        ]
      }
    ]
  },
  { path: '/', element: <RootRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> }
]);

function RootRedirect() {
  const profile = useAuth((s) => s.profile);
  const calendar = new URLSearchParams(window.location.search).get('calendar') === '1';
  if (!profile) return <Navigate to={calendar ? '/login?calendar=1' : '/login'} replace />;
  if (calendar && profile.canManageCalendar) return <Navigate to={profile.role === 'admin' ? '/admin/calendario' : '/pos/calendario'} replace />;
  return <Navigate to={homeFor(profile.role)} replace />;
}

interface BoundaryState {
  error: Error | null;
}

/** Última red de seguridad: ningún crash deja la pantalla en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
        <div className="card max-w-md p-6 text-center">
          <span className="price-tag mx-auto inline-block rounded px-3 py-1 font-display text-xl">
            D'ENZOZ
          </span>
          <h1 className="mt-4 font-semibold">Algo salió mal</h1>
          <p className="mt-2 break-all font-mono text-xs text-slate-500">
            {this.state.error.message}
          </p>
          <button
            className="btn-primary mt-4"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}

export function App() {
  const init = useAuth((s) => s.init);

  useEffect(() => {
    const unsubscribe = init();
    void initAnalytics();
    return unsubscribe;
  }, [init]);

  return (
    <ErrorBoundary>
      {!firebaseReady ? <SetupScreen /> : <RouterProvider router={router} />}
    </ErrorBoundary>
  );
}
