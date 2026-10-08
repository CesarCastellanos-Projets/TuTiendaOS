import type { PaymentMethod, Sale, SalePayment } from '../types';

export const PAYMENT_LABELS: Record<PaymentMethod | 'mixto', string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', yape: 'Yape', plin: 'Plin', sip: 'Sip', otro: 'Otro', mixto: 'Pago combinado'
};
export interface PaymentDraft { method: PaymentMethod; amount: string; received: string; bankName: string; operationNumber: string }
export const newPaymentDraft = (method: PaymentMethod): PaymentDraft => ({ method, amount: '', received: '', bankName: 'BCP', operationNumber: '' });
export function paymentCents(value: string): number {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Ingresa un importe con hasta dos decimales.');
  const number = Number(value.replace(',', '.'));
  if (number > 100_000_000) throw new Error('El importe excede el máximo permitido.');
  return Math.round(number * 100);
}
function calculateMixedPayments(total: number, drafts: PaymentDraft[]) {
  if (!Number.isFinite(total) || total <= 0) throw new Error('Agrega productos a la venta antes de combinar pagos.');
  if (!drafts.length || drafts.length > 7) throw new Error('Selecciona de uno a siete métodos de pago.');
  const seen = new Set<PaymentMethod>();
  const parts = drafts.map((draft) => {
    if (seen.has(draft.method)) throw new Error('Usa cada método de pago en una sola línea.');
    seen.add(draft.method);
    const amount = draft.amount.trim() ? paymentCents(draft.amount) : 0;
    const received = draft.method === 'efectivo' && draft.received.trim() ? paymentCents(draft.received) : amount;
    if (received < amount) throw new Error('El efectivo recibido debe cubrir su parte.');
    return { method: draft.method, amount: amount / 100, receivedAmount: received / 100,
      bankName: draft.method === 'transferencia' ? draft.bankName : null, operationNumber: draft.operationNumber.trim() || null };
  });
  let remaining = Math.round(total * 100) - parts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
  if (remaining < 0) {
    const cash = parts.find((part) => part.method === 'efectivo');
    if (!cash || Math.round(cash.amount * 100) + remaining <= 0) {
      throw new Error('Los pagos sin efectivo ya cubren o superan el total. Corrige sus importes o retira el efectivo.');
    }
    cash.amount = (Math.round(cash.amount * 100) + remaining) / 100;
    remaining = 0;
  }
  const change = parts.reduce((sum, part) => sum + Math.round(part.receivedAmount * 100) - Math.round(part.amount * 100), 0);
  return { payments: parts, remaining: remaining / 100, change: change / 100 };
}

export function mixedPaymentSummary(total: number, drafts: PaymentDraft[]) {
  try { return { ...calculateMixedPayments(total, drafts), error: null }; }
  catch (cause) {
    return { payments: [] as SalePayment[], remaining: 0, change: 0,
      error: cause instanceof Error ? cause.message : 'Revisa los pagos combinados.' };
  }
}

export function buildMixedPayments(total: number, drafts: PaymentDraft[]): SalePayment[] {
  const summary = calculateMixedPayments(total, drafts);
  if (summary.remaining > 0) throw new Error(`Falta completar S/ ${summary.remaining.toFixed(2)} para cobrar la venta.`);
  if (summary.payments.some((part) => part.amount <= 0)) throw new Error('Ingresa un importe mayor que cero en cada método o quita las líneas que no usarás.');
  if (summary.payments.some((part) => part.method === 'transferencia' && !part.bankName?.trim())) throw new Error('Indica el banco de la transferencia.');
  return summary.payments;
}
export function salePayments(sale: Sale): SalePayment[] {
  return sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod === 'mixto' ? 'otro' : sale.paymentMethod,
    amount: sale.total, receivedAmount: sale.paidAmount, bankName: sale.bankName, operationNumber: sale.operationNumber }];
}
