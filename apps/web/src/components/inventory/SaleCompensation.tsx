import { useEffect, useState } from 'react';
import { getDocs, limit, query, where } from 'firebase/firestore';
import { tenantCollection } from '../../lib/tenant-firestore';
import { durableCommand } from '../../lib/durable-command';
import type { PaymentMethod, Sale } from '../../types';
import { PAYMENT_LABELS } from '../../lib/payments';
import { Modal } from '../ui/Modal';

export function SaleCompensation({ sale, onClose, onSaved }: { sale: (Sale & { id: string }) | null; onClose: () => void; onSaved: () => void }) {
  const [returnStock, setReturnStock] = useState(false);
  const [refund, setRefund] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReturnStock(false); setRefund(false); setNote(''); setError(null); }, [sale]);
  useEffect(() => {
    let active = true; setSessions([]); setSessionId('');
    if (!sale || !refund || method !== 'efectivo') return;
    void getDocs(query(tenantCollection('cash_sessions'), where('storeId', '==', sale.storeId), where('status', '==', 'abierta'), limit(30)))
      .then((snapshot) => { if (active) {
        setSessions(snapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.data().userName) })));
        setSessionId(snapshot.docs.find((doc) => doc.id === sale.cashSessionId)?.id ?? snapshot.docs[0]?.id ?? '');
      } }).catch(() => { if (active) setError('No se pudieron consultar las cajas abiertas.'); });
    return () => { active = false; };
  }, [sale, refund, method]);
  return <Modal open={!!sale} title="Registrar devolución" onClose={onClose}><div className="space-y-4">
    <p className="text-sm text-slate-500">{sale?.code} · Devuelve el stock solo cuando hayas recibido todos los productos. El reembolso se registra por el total de la venta.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={returnStock} disabled={!!sale?.stockReturnedAt} onChange={(event) => setReturnStock(event.target.checked)} />Recibí todos los productos y empaques cerrados en buen estado</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={refund} disabled={!!sale?.refundedAt} onChange={(event) => setRefund(event.target.checked)} />Reembolsé el total al cliente</label>
    {refund && <><label className="block"><span className="label">Método del reembolso</span><select className="field" value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{Object.entries(PAYMENT_LABELS).filter(([key]) => key !== 'mixto').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {method === 'efectivo' && <label className="block"><span className="label">Caja que entregó el efectivo</span><select className="field" value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Seleccionar caja abierta</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}</select></label>}</>}
    <label className="block"><span className="label">Motivo o referencia</span><textarea className="field" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    <button className="btn-primary w-full" disabled={busy || (!returnStock && !refund) || !note.trim()} onClick={async () => {
      if (!sale) return; setBusy(true); setError(null);
      try { await durableCommand('recordSaleCompensation', { saleId: sale.id, returnStock, refund, method, cashSessionId: sessionId, note: note.trim() }); onSaved(); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo registrar'); }
      finally { setBusy(false); }
    }}>Guardar devolución</button>
  </div></Modal>;
}
