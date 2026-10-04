import { InventoryPermissionsWorkspace } from '../../components/inventory/InventoryPermissionsWorkspace';
import { useAuth } from '../../lib/auth';

export function PosWorkerPermissions() {
  const profile = useAuth((s) => s.profile)!;
  if (profile.role !== 'pos' || profile.storeAccess !== 'all') return <p className="card p-4">Solo el POS multitiendas puede administrar estos permisos.</p>;
  if (!profile.storeId) return <p className="card p-4">Selecciona una tienda en el menú para administrar sus trabajadores.</p>;
  return <InventoryPermissionsWorkspace key={`${profile.tenantId}:${profile.storeId}`} activeStoreId={profile.storeId} />;
}
