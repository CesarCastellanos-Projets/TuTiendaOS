import { PriceBell } from '../PriceBell';
import { useEffect, useState, Suspense } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getDocs, limit, query } from 'firebase/firestore';
import { ReplenishmentBell } from '../inventory/ReplenishmentBell';
import { RouteLoading } from '../RouteLoading';
import { Brand } from '../Brand';
import { Modal } from '../ui/Modal';
import { Navigation, AccountMenu } from './Navigation';
import {
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Users,
  ShoppingCart,
  Vault,
  ReceiptText,
  PackageOpen,
  Truck,
  Store,
  MoreHorizontal
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { tenantCollection } from '../../lib/tenant-firestore';
import { selectActivePosStore } from '../../lib/admin-users';
import type { Store as StoreType } from '../../types';

const POS_NAV = [
  { to: '/pos', icon: ShoppingCart, label: 'Punto de Venta (Vender)', shortLabel: 'Vender', desc: 'Emisión de boletas y facturas', end: true },
  { to: '/pos/recepciones', icon: Truck, label: 'Recepciones de Traslado', shortLabel: 'Recepciones', desc: 'Ingreso de mercadería desde almacén' },
  { to: '/pos/caja', icon: Vault, label: 'Control de Caja (Turno)', shortLabel: 'Caja', desc: 'Apertura, arqueo y cierre Z' },
  { to: '/pos/ventas', icon: ReceiptText, label: 'Mis Ventas del Día', shortLabel: 'Mis Ventas', desc: 'Historial de comprobantes emitidos' },
  { to: '/pos/estadisticas', icon: ChartColumn, label: 'Estadísticas de Hoy', shortLabel: 'Estadísticas', desc: 'Ventas y productos de la tienda activa' },
  { to: '/pos/reposicion', icon: PackageOpen, label: 'Solicitar Reposición', shortLabel: 'Reposición', desc: 'Pedir stock a almacén central' }
];

export function PosLayout() {
  const profile = useAuth((s) => s.profile)!;
  const uid = useAuth((s) => s.user?.uid);
  const logout = useAuth((s) => s.logout);
  const setProfileStoreId = useAuth((s) => s.setProfileStoreId);
  const navigate = useNavigate();
  const location = useLocation();
  const nav = [...POS_NAV,
    ...(profile.storeAccess === 'all' ? [{ to: '/pos/permisos-trabajadores', icon: Users, label: 'Permisos de Trabajadores', shortLabel: 'Permisos', desc: 'Autorizar ingresos y productos nuevos en la tienda activa', end: false }] : []),
    ...(profile.storeAccess === 'all' ? [{ to: '/pos/aprobar-reposiciones', icon: ClipboardCheck, label: 'Aprobar Reposiciones', shortLabel: 'Aprobar', desc: 'Atender solicitudes de todas las tiendas', end: false }] : []),
    ...(profile.canManageCalendar ? [{ to: '/pos/calendario', icon: CalendarDays, label: 'Calendario de la empresa', shortLabel: 'Calendario', desc: 'Fechas y recordatorios compartidos', end: false }] : [])];
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [selectingStore, setSelectingStore] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const canChooseStore = profile.role === 'pos' && profile.storeAccess === 'all';

  useEffect(() => {
    if (!canChooseStore) return;
    let active = true;
    void getDocs(query(tenantCollection('stores'), limit(50))).then((snapshot) => {
      if (active) setStores(snapshot.docs.map((document) => ({ ...document.data(), id: document.id } as StoreType)));
    }).catch(() => {
      if (active) setStoreError('No se pudieron cargar las tiendas.');
    });
    return () => {
      active = false;
    };
  }, [canChooseStore]);

  const chooseStore = async (storeId: string) => {
    if (!storeId || storeId === profile.storeId || selectingStore) return;
    setSelectingStore(true);
    setStoreError(null);
    try {
      const selected = await selectActivePosStore(storeId);
      setProfileStoreId(selected.storeId);
    } catch (error) {
      setStoreError(error instanceof Error ? error.message : 'No se pudo seleccionar la tienda.');
    } finally {
      setSelectingStore(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const primaryPaths = ['/pos', '/pos/caja', '/pos/ventas'];
  const navigation = nav.map((item) => ({ ...item, label: item.shortLabel }));
  const needsStore = canChooseStore && !profile.storeId && !['/pos/calendario', '/pos/aprobar-reposiciones'].includes(location.pathname);
  const selling = location.pathname === '/pos' || location.pathname === '/pos/';
  return <div className={`pos-shell ${selling ? 'is-selling' : ''}`}>
    <a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="pos-rail"><Brand compact /><Navigation items={navigation} compact /></aside>
    <div className="app-shell-body">
      <header className="app-topbar">
        <div className="lg:hidden"><Brand compact /></div>
        <div className="topbar-context"><span className="eyebrow">Punto de venta</span>
          {canChooseStore ? <select aria-label="Tienda activa" className="store-selector" value={profile.storeId ?? ''} disabled={selectingStore} onChange={(e) => void chooseStore(e.target.value)}>
            <option value="" disabled>Elegir tienda</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select> : <strong>{nav.find((item) => item.to === location.pathname)?.shortLabel ?? 'Operaciones de tienda'}</strong>}
        </div>
        <div className="topbar-actions"><ReplenishmentBell /><PriceBell /><AccountMenu name={profile.displayName} role={canChooseStore ? 'POS multitiendas' : 'Cajero'} onLogout={() => void handleLogout()} /></div>
      </header>
      {storeError && <p role="alert" className="mx-4 mt-2 text-sm text-critical">{storeError}</p>}
      <main id="main-content" className={`pos-content ${selling ? 'pos-content-sale' : 'page-content'}`}>
        {needsStore ? <div className="store-welcome"><Store size={32} strokeWidth={1.5} /><h1>Elige tu tienda</h1><p>Las operaciones se registrarán en la tienda seleccionada.</p>
          <select aria-label="Seleccionar tienda del turno" className="field" value="" disabled={selectingStore} onChange={(e) => void chooseStore(e.target.value)}><option value="" disabled>Elegir tienda…</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        </div> : <Suspense key={profile.storeId} fallback={<RouteLoading />}><Outlet key={`${profile.tenantId}:${uid}:${profile.storeId}`} /></Suspense>}
      </main>
    </div>
    <div className="mobile-navigation pos-mobile-nav"><Navigation items={navigation.filter((item) => primaryPaths.includes(item.to))} /><button className={`mobile-more ${!primaryPaths.includes(location.pathname) ? 'is-active' : ''}`} onClick={() => setDrawerOpen(true)} aria-label="Más operaciones"><MoreHorizontal size={21} /><span>Más</span></button></div>
    <Modal open={drawerOpen} title="Más operaciones" onClose={() => setDrawerOpen(false)} drawer><Navigation items={navigation.filter((item) => !primaryPaths.includes(item.to))} onNavigate={() => setDrawerOpen(false)} /></Modal>
  </div>;
}
