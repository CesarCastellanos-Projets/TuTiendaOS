import { lazy, Suspense, useEffect, useState } from 'react';
import { getDoc } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { tenantDoc } from '../../lib/tenant-firestore';
import { workerInventoryTasks } from '../../lib/worker-inventory';
import { StockIngressForm } from '../../components/inventory/StockIngressForm';
import { IngressHistory } from '../../components/inventory/IngressHistory';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

const NewWorkerProduct = lazy(() => import('../../components/inventory/NewWorkerProduct').then((m) => ({ default: m.NewWorkerProduct })));

export function WorkerIngressPage() {
  const profile = useAuth((s) => s.profile);
  const storeId = profile?.storeId;
  const tenantId = profile?.tenantId;
  const { canIngress, canCreateProducts } = workerInventoryTasks(profile);
  const allowed = canIngress || canCreateProducts;
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [productFormLoaded, setProductFormLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const { msg, flash } = useFlash();
  useEffect(() => {
    let current = true;
    setStoreName(''); setError('');
    if (storeId && allowed) void getDoc(tenantDoc('stores', storeId)).then((doc) => {
      if (!current) return;
      if (doc.exists()) setStoreName(String(doc.data().name));
      else setError('La tienda asignada no existe.');
    }).catch(() => { if (current) setError('No se pudo cargar tu tienda.'); });
    return () => { current = false; };
  }, [storeId, tenantId, allowed]);
  if (!storeId || (!canIngress && !canCreateProducts)) return <section className="card space-y-2 p-4"><h1 className="font-display text-xl font-bold">Ingreso de mercadería</h1><p className="text-sm text-slate-500">No tienes permisos activos. Pide al administrador o al POS multitiendas que habilite tu acceso.</p></section>;
  return <div className="space-y-4">
    <h1 className="font-display text-xl font-bold">Ingreso de mercadería</h1>
    <p className="text-sm text-slate-500">Registra la mercadería que llega directamente a {storeName || 'tu tienda'}.</p>
    {error && <p className="text-sm text-critical" role="alert">{error}</p>}
    {canCreateProducts && <button className="btn-secondary w-full" onClick={() => { setProductFormLoaded(true); setCreating(true); }}><Plus size={16} /> Crear producto nuevo</button>}
    {canIngress && storeName && <StockIngressForm key={`${tenantId}:${storeId}`} locationId={storeId} locationType="store" locationName={storeName} onSaved={() => setRevision((value) => value + 1)} />}
    {!canIngress && <p className="text-sm text-slate-500">Puedes crear productos. El registro de cantidades requiere el permiso de ingreso de mercadería.</p>}
    {canIngress && storeName && <IngressHistory key={`history:${tenantId}:${storeId}:${revision}`} locationId={storeId} locationType="store" revision={revision} />}
    {canCreateProducts && productFormLoaded && <Suspense fallback={<p className="text-sm">Cargando formulario…</p>}><NewWorkerProduct key={`${tenantId}:${storeId}`} open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); flash('Producto creado. Búscalo por nombre o código para registrar su ingreso.'); }} /></Suspense>}
    <FlashBar msg={msg} />
  </div>;
}
