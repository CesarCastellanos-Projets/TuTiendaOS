import { Plus, Trash2 } from 'lucide-react';
import { PAYMENT_LABELS, newPaymentDraft, type PaymentDraft } from '../../lib/payments';
import { money } from '../../lib/utils';
import type { PaymentMethod } from '../../types';

const methods = Object.keys(PAYMENT_LABELS).filter((method) => method !== 'mixto') as PaymentMethod[];
export function MixedPaymentEditor({ total, value, onChange, disabled }: {
  total: number; value: PaymentDraft[]; onChange: (value: PaymentDraft[]) => void; disabled: boolean;
}) {
  const amounts = value.map((part) => Math.round((Number(part.amount.replace(',', '.')) || 0) * 100));
  const remaining = Math.round(total * 100) - amounts.reduce((sum, amount) => sum + amount, 0);
  const change = value.reduce((sum, part, index) => sum + (part.method === 'efectivo' && part.received ? Math.max(0, Math.round((Number(part.received.replace(',', '.')) || 0) * 100) - amounts[index]) : 0), 0);
  const update = (index: number, patch: Partial<PaymentDraft>) => onChange(value.map((part, i) => i === index ? { ...part, ...patch } : part));
  return <section className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Pagos combinados">
    {value.map((part, index) => <div key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <label className="min-w-0"><span className="label">Método</span><select className="field !min-h-11 text-xs" value={part.method} disabled={disabled}
          onChange={(event) => update(index, { method: event.target.value as PaymentMethod, received: '' })}>
          {methods.filter((method) => method === part.method || !value.some((line) => line.method === method)).map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>)}
        </select></label>
        <label className="min-w-0"><span className="label">Importe S/</span><input className="field !min-h-11 font-mono" inputMode="decimal" placeholder="0.00" value={part.amount}
          disabled={disabled} onChange={(event) => update(index, { amount: event.target.value })} /></label>
        <button type="button" className="btn-ghost !min-h-11 !px-2 text-critical" disabled={disabled || value.length <= 2} aria-label={`Quitar ${PAYMENT_LABELS[part.method]}`}
          onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>
      <button type="button" className="text-xs font-semibold text-primary" disabled={disabled || Math.round(total * 100) - amounts.filter((_, i) => i !== index).reduce((sum, amount) => sum + amount, 0) <= 0}
        onClick={() => update(index, { amount: ((Math.round(total * 100) - amounts.filter((_, i) => i !== index).reduce((sum, amount) => sum + amount, 0)) / 100).toFixed(2) })}>Completar saldo aquí</button>
      {part.method === 'efectivo' && <label className="block"><span className="label">Efectivo recibido S/ (opcional)</span><input className="field !min-h-11 font-mono" inputMode="decimal" value={part.received} placeholder={part.amount || 'Igual al importe'} disabled={disabled} onChange={(event) => update(index, { received: event.target.value })} /></label>}
      {part.method === 'transferencia' && <label className="block"><span className="label">Banco</span><input className="field !min-h-11" maxLength={80} value={part.bankName} disabled={disabled} onChange={(event) => update(index, { bankName: event.target.value })} /></label>}
      {part.method !== 'efectivo' && <label className="block"><span className="label">Número de operación (opcional)</span><input className="field !min-h-11" maxLength={80} value={part.operationNumber} disabled={disabled} onChange={(event) => update(index, { operationNumber: event.target.value })} /></label>}
    </div>)}
    {value.length < methods.length && <button type="button" className="btn-ghost text-xs" disabled={disabled} onClick={() => onChange([...value, newPaymentDraft(methods.find((method) => !value.some((part) => part.method === method))!)])}><Plus size={15} /> Agregar método</button>}
    <div className="flex flex-wrap justify-between gap-2 text-sm"><strong className={remaining === 0 ? 'text-success' : 'text-amber-800'}>{remaining >= 0 ? 'Falta' : 'Exceso'}: {money(Math.abs(remaining) / 100)}</strong><span>Vuelto: {money(change / 100)}</span></div>
    <p className="text-xs text-slate-500">Verifica los pagos digitales antes de cobrar. El vuelto sale únicamente del efectivo.</p>
  </section>;
}
