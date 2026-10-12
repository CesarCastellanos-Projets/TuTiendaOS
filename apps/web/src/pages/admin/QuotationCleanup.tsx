import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { fmtDateTime } from '../../lib/utils';

interface Preview { id: string; code: string; createdAt: number; status: string }
export function QuotationCleanup() {
  const [items, setItems] = useState<Preview[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const preview = async () => {
    setBusy(true); setChecked([]);
    try { const { data } = await httpsCallable<unknown, { items: Preview[]; hasMore: boolean }>(functions, 'previewQuotationCleanup')({}); setItems(data.items); setMessage(data.hasMore ? 'Primer lote de 100. Después de eliminarlo, revisa el siguiente.' : `${data.items.length} cotizaciones vencidas.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo consultar.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4"><h1 className="font-display text-2xl">Limpieza de cotizaciones</h1><p>Las cotizaciones nuevas vencen a los 30 días y se limpian automáticamente. Revisa aquí el alcance antes de eliminar cotizaciones antiguas. Sus ventas y comprobantes se conservan.</p><button className="btn-ghost" disabled={busy} onClick={() => void preview()}>Revisar cotizaciones vencidas</button><p role="status">{message}</p>{items.length > 0 && <><label className="flex gap-2"><input type="checkbox" checked={checked.length === items.length} onChange={(e) => setChecked(e.target.checked ? items.map((item) => item.id) : [])} />Seleccionar este lote</label><div className="space-y-2">{items.map((item) => <label key={item.id} className="card flex flex-wrap items-center gap-3 p-3"><input type="checkbox" checked={checked.includes(item.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, item.id] : checked.filter((id) => id !== item.id))} /><strong>{item.code}</strong><span>{fmtDateTime(item.createdAt)} · {item.status}</span></label>)}</div><button className="btn-ghost text-critical" disabled={busy || !checked.length} onClick={async () => {
    if (!window.confirm(`Eliminar definitivamente ${checked.length} cotizaciones vencidas y sus copias?`)) return;
    setBusy(true);
    try { await httpsCallable(functions, 'purgeExpiredQuotations')({ ids: checked }); await preview(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo completar la limpieza. Revisa el lote nuevamente.'); }
    finally { setBusy(false); }
  }}>Eliminar seleccionadas ({checked.length})</button></>}</div>;
}
