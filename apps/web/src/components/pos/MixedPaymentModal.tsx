import { useState } from 'react';
import { buildMixedPayments, type PaymentDraft } from '../../lib/payments';
import { money } from '../../lib/utils';
import type { SaleItem } from '../../types';
import { Modal } from '../ui/Modal';
import { MixedPaymentEditor } from './MixedPaymentEditor';

export function MixedPaymentModal({ total, items, value, disabled, onClose, onApply }: {
  total: number; items: Pick<SaleItem, 'name' | 'qty' | 'total'>[]; value: PaymentDraft[]; disabled: boolean;
  onClose: () => void; onApply: (value: PaymentDraft[]) => void;
}) {
  const [drafts, setDrafts] = useState(() => value.map((part) => ({ ...part })));
  const [error, setError] = useState('');
  const apply = () => {
    try { buildMixedPayments(total, drafts); onApply(drafts); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa los pagos combinados.'); }
  };
  return <Modal open title="Combinar métodos de pago" wide onClose={() => { if (!disabled) onClose(); }}>
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-xl bg-slate-950 p-4 text-white">
        <span className="text-sm font-semibold">Total por cobrar</span><strong className="font-mono text-xl">{money(total)}</strong>
      </div>
      <details className="rounded-xl border border-slate-200 p-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Ver productos ({items.length})</summary>
        <ul className="mt-3 space-y-2">{items.map((item, index) => <li key={index} className="flex justify-between gap-3"><span className="min-w-0 break-words">{item.qty} × {item.name}</span><span className="shrink-0 font-mono">{money(item.total)}</span></li>)}</ul>
      </details>
      <MixedPaymentEditor total={total} value={drafts} disabled={disabled} onChange={(next) => { setDrafts(next); setError(''); }} />
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      <div className="sticky bottom-0 grid grid-cols-1 gap-2 border-t border-slate-200 bg-white py-3 sm:grid-cols-2">
        <button type="button" className="btn-secondary" disabled={disabled} onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-brand" disabled={disabled} onClick={apply}>Aplicar pagos</button>
      </div>
    </div>
  </Modal>;
}
