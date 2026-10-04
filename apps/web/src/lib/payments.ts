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
export function buildMixedPayments(total: number, drafts: PaymentDraft[]): SalePayment[] {
  const seen = new Set<PaymentMethod>();
  const parts = drafts.map((draft) => {
    if (seen.has(draft.method)) throw new Error('Usa cada método de pago en una sola línea.');
    seen.add(draft.method);
    const amount = paymentCents(draft.amount);
    const received = draft.method === 'efectivo' && draft.received.trim() ? paymentCents(draft.received) : amount;
    if (amount <= 0 || received < amount) throw new Error('Cada pago debe ser mayor que cero y el efectivo recibido debe cubrir su parte.');
    return { method: draft.method, amount: amount / 100, receivedAmount: received / 100,
      bankName: draft.method === 'transferencia' ? draft.bankName : null, operationNumber: draft.operationNumber.trim() || null };
  });
  if (parts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0) !== Math.round(total * 100)) throw new Error('La suma de los pagos debe coincidir con el total de la venta.');
  return parts;
}
export function salePayments(sale: Sale): SalePayment[] {
  return sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod === 'mixto' ? 'otro' : sale.paymentMethod,
    amount: sale.total, receivedAmount: sale.paidAmount, bankName: sale.bankName, operationNumber: sale.operationNumber }];
}
