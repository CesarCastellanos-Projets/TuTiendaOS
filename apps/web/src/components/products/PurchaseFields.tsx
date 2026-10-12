import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { ProductPresentation } from '../../types';

export interface PurchaseData { cost: number; supplier: string; presentationId: string | null; presentationLabel?: string }
export function PurchaseFields({ productId, unit, presentations, changed }: { productId?: string; unit: string; presentations: ProductPresentation[]; changed: (purchase: PurchaseData | null | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [presentationId, setPresentationId] = useState('');
  const [ready, setReady] = useState(!productId);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!productId || !open || ready) return;
    let alive = true;
    void httpsCallable<unknown, { purchase: PurchaseData | null }>(functions, 'getProductPurchase')({ productId }).then(({ data }) => {
      if (!alive) return;
      setEnabled(Boolean(data.purchase)); setCost(String(data.purchase?.cost ?? '')); setSupplier(data.purchase?.supplier ?? ''); setPresentationId(data.purchase?.presentationId ?? ''); setReady(true);
    }).catch(() => { if (alive) setError('No se pudieron cargar los datos de compra. Cierra y vuelve a abrir Avanzado.'); });
    return () => { alive = false; };
  }, [open, productId, ready]);
  return <section className="space-y-3 rounded-xl border p-4"><button type="button" className="btn-ghost" onClick={() => { setError(''); setOpen(!open); }}>Avanzado: costo y proveedor</button>{open && <>{error ? <p role="alert">{error}</p> : !ready ? <p>Cargando datos privados…</p> : <><label className="flex gap-2"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); changed(e.target.checked ? { cost: Number(cost), supplier, presentationId: presentationId || null } : null); }} />Registrar datos de compra</label>{enabled && <div className="grid gap-3 sm:grid-cols-2"><label className="label">Presentación comprada<select className="field" value={presentationId} onChange={(e) => { setPresentationId(e.target.value); changed({ cost: Number(cost), supplier, presentationId: e.target.value || null }); }}><option value="">{unit} (base)</option>{presentations.map((p) => <option key={p.id} value={p.id}>{p.description ?? p.unit}</option>)}</select></label><label className="label">Costo de compra S/<input className="field" type="number" min="0" max="1000000" step="0.01" required value={cost} onChange={(e) => { setCost(e.target.value); changed({ cost: Number(e.target.value), supplier, presentationId: presentationId || null }); }} /></label><label className="label sm:col-span-2">Proveedor<input className="field" maxLength={180} value={supplier} onChange={(e) => { setSupplier(e.target.value); changed({ cost: Number(cost), supplier: e.target.value, presentationId: presentationId || null }); }} /></label></div>}<p className="text-sm text-slate-500">Visible para el administrador y el POS con permiso para consultar costos.</p></>}</>}</section>;
}
