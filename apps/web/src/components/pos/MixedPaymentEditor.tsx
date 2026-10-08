import { Plus, Trash2 } from 'lucide-react';
import { PAYMENT_LABELS, mixedPaymentSummary, newPaymentDraft, type PaymentDraft } from '../../lib/payments';
import { money } from '../../lib/utils';
import type { PaymentMethod } from '../../types';

const methods = Object.keys(PAYMENT_LABELS).filter((method) => method !== 'mixto') as PaymentMethod[];
export function MixedPaymentEditor({ total, value, onChange, disabled }: {
  total: number; value: PaymentDraft[]; onChange: (value: PaymentDraft[]) => void; disabled: boolean;
}) {
  const amounts = value.map((part) => Math.round((Number(part.amount.replace(',', '.')) || 0) * 100));
  const summary = mixedPaymentSummary(total, value);
  const update = (index: number, patch: Partial<PaymentDraft>) => onChange(value.map((part, i) => i === index ? { ...part, ...patch } : part));
  return <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3" aria-label="Pagos combinados">
    {value.map((part, index) => <div key={index} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="min-w-0"><span className="label">Método</span><select className="field !min-h-11 text-xs" value={part.method} disabled={disabled}
          onChange={(event) => update(index, { method: event.target.value as PaymentMethod, received: '' })}>
          {methods.filter((method) => method === part.method || !value.some((line) => line.method === method)).map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method]}</option>)}
        </select></label>
        <label className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1"><span className="label">{part.method === 'efectivo' ? 'Efectivo recibido S/' : 'Importe S/'}</span><input className="field !min-h-11 font-mono" inputMode="decimal" placeholder="0.00" value={part.amount}
          disabled={disabled} onChange={(event) => update(index, { amount: event.target.value, received: '' })} /></label>
        <button type="button" className="btn-ghost col-start-2 row-start-1 !min-h-11 !min-w-11 !px-2 text-critical sm:col-start-3" disabled={disabled || value.length <= 1} aria-label={`Quitar ${PAYMENT_LABELS[part.method]}`}
          onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 size={16} /></button>
      </div>
      <button type="button" className="text-xs font-semibold text-primary" disabled={disabled || Math.round(total * 100) - amounts.filter((_, i) => i !== index).reduce((sum, amount) => sum + amount, 0) <= 0}
        onClick={() => update(index, { amount: ((Math.round(total * 100) - amounts.filter((_, i) => i !== index).reduce((sum, amount) => sum + amount, 0)) / 100).toFixed(2), received: '' })}>Completar saldo aquí</button>
      {part.method === 'efectivo' && !summary.error && <p className="text-xs text-slate-500">Aplicado a la venta: {money(summary.payments.find((payment) => payment.method === 'efectivo')?.amount ?? 0)}</p>}
      {part.method === 'transferencia' && <label className="block"><span className="label">Banco</span><input className="field !min-h-11" maxLength={80} value={part.bankName} disabled={disabled} onChange={(event) => update(index, { bankName: event.target.value })} /></label>}
      {part.method !== 'efectivo' && <label className="block"><span className="label">Número de operación (opcional)</span><input className="field !min-h-11" maxLength={80} value={part.operationNumber} disabled={disabled} onChange={(event) => update(index, { operationNumber: event.target.value })} /></label>}
    </div>)}
    {value.length < methods.length && <button type="button" className="btn-ghost text-xs" disabled={disabled} onClick={() => onChange([...value, newPaymentDraft(methods.find((method) => !value.some((part) => part.method === method))!)])}><Plus size={15} /> Agregar método</button>}
    {summary.error ? <p role="alert" className="text-sm text-critical">{summary.error}</p> : <div aria-live="polite" className="flex flex-wrap justify-between gap-2 text-sm"><strong className={summary.remaining === 0 ? 'text-success' : 'text-amber-800'}>{summary.remaining === 0 ? 'Pago completo' : `Falta: ${money(summary.remaining)}`}</strong><strong>Vuelto: {money(summary.change)}</strong></div>}
    <p className="text-xs text-slate-500">Ingresa el efectivo que entrega el cliente. Su excedente se calcula como vuelto. Verifica los pagos digitales antes de cobrar.</p>
  </section>;
}
