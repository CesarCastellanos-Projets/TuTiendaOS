import { Component, useEffect, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { useAuth, homeFor } from './lib/auth';
import { firebaseReady, initAnalytics } from './lib/firebase';
import { SetupScreen } from './components/SetupScreen';
import { LoginPage } from './pages/login/LoginPage';
import { RequireRole } from './components/RequireRole';
import { AdminLayout } from './components/layout/AdminLayout';
import { PosLayout } from './components/layout/PosLayout';
import { WorkerLayout } from './components/layout/WorkerLayout';

import { AdminDashboard } from './pages/admin/Dashboard';
import { ProductsPage } from './pages/admin/Products';
import { LocationsPage } from './pages/admin/Locations';
import { IngressPage } from './pages/admin/Ingress';
import { TransfersPage } from './pages/admin/Transfers';
import { AdjustmentsPage } from './pages/admin/Adjustments';
import { KardexPage } from './pages/admin/Kardex';
import { ReplenishmentAdminPage } from './pages/admin/Replenishment';
import { UsersPage } from './pages/admin/Users';
import { SunatConfigPage } from './pages/admin/SunatConfig';
import { TicketDesignerPage } from './pages/admin/TicketDesigner';
import { ReceiptsPage } from './pages/admin/Receipts';
import { IncidentsAdminPage } from './pages/admin/Incidents';

import { PosSale } from './pages/pos/Sale';
import { ReceivingPage } from './pages/pos/Receiving';
import { CashPage } from './pages/pos/Cash';
import { MySales } from './pages/pos/MySales';
import { RequestRestock } from './pages/pos/RequestRestock';

import { WorkerLookup } from './pages/worker/Lookup';
import { IncidentsWorkerPage } from './pages/worker/Incidents';
import { WorkerQuotations } from './pages/worker/Quotations';

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
          { path: 'incidencias', element: <IncidentsAdminPage /> },
          { path: 'usuarios', element: <UsersPage /> },
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
          { path: 'caja', element: <CashPage /> },
          { path: 'mis-ventas', element: <MySales /> },
          { path: 'reposicion', element: <RequestRestock /> }
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
  if (!profile) return <Navigate to="/login" replace />;
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
    init();
    void initAnalytics();
  }, [init]);

  return (
    <ErrorBoundary>
      {!firebaseReady ? <SetupScreen /> : <RouterProvider router={router} />}
    </ErrorBoundary>
  );
}
