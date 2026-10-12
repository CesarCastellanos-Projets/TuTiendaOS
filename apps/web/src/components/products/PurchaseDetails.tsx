import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { PurchaseData } from './PurchaseFields';
import { useAuth } from '../../lib/auth';

export function PurchaseDetails({ productId }: { productId: string }) {
  const profile = useAuth((s) => s.profile);
  const [open, setOpen] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseData | null>();
  const [error, setError] = useState('');
  const permitted = profile?.role === 'admin' || (profile?.role === 'pos' && profile.canViewPurchaseCosts === true);
  useEffect(() => {
    if (!open || !permitted) return;
    let alive = true;
    setPurchase(undefined); setError('');
    void httpsCallable<unknown, { purchase: PurchaseData | null }>(functions, 'getProductPurchase')({ productId }).then(({ data }) => { if (alive) setPurchase(data.purchase); }).catch(() => { if (alive) setError('No se pudieron consultar los datos de compra.'); });
    return () => { alive = false; };
  }, [open, permitted, productId]);
  if (!permitted) return null;
  return <div className="space-y-2"><button type="button" className="btn-ghost" onClick={() => setOpen(!open)}>Costo y proveedor</button>{open && <div>{error || (purchase === undefined ? 'Consultando…' : purchase === null ? 'Sin datos de compra registrados.' : `Compra: S/ ${purchase.cost.toFixed(2)} por ${purchase.presentationLabel ?? 'unidad'}. Proveedor: ${purchase.supplier || 'Sin especificar'}.`)}</div>}</div>;
}
