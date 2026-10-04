import { HttpsError } from 'firebase-functions/v2/https';

export const PAYMENT_METHODS = ['efectivo', 'transferencia', 'tarjeta', 'yape', 'plin', 'sip', 'otro'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export interface PaymentPart {
  method: PaymentMethod;
  amount: number;
  receivedAmount: number;
  bankName: string | null;
  operationNumber: string | null;
}
export interface PaymentTotals { cashSales: number; yapeSales: number; cardSales: number; otherSales: number }

function cents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000
    || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    throw new HttpsError('invalid-argument', 'El importe de pago debe tener hasta dos decimales.');
  }
  return Math.round(value * 100);
}
function text(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 80) throw new HttpsError('invalid-argument', 'Referencia de pago inválida.');
  return value.trim() || null;
}

export function normalizePayments(data: Record<string, unknown>, total: number) {
  const totalCents = cents(total);
  const raw: unknown = data.payments === undefined
    ? [{ method: data.paymentMethod, amount: total, receivedAmount: data.paidAmount, bankName: data.bankName, operationNumber: data.operationNumber }]
    : data.payments;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > PAYMENT_METHODS.length) {
    throw new HttpsError('invalid-argument', 'Selecciona de uno a siete métodos de pago.');
  }
  const seen = new Set<string>();
  let received = 0;
  let change = 0;
  let applied = 0;
  const payments: PaymentPart[] = raw.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Pago inválido.');
    const item = value as Record<string, unknown>;
    const method = item.method as PaymentMethod;
    if (!PAYMENT_METHODS.includes(method) || seen.has(method)) throw new HttpsError('invalid-argument', 'Método de pago inválido o repetido.');
    seen.add(method);
    const amount = cents(item.amount);
    const receivedAmount = cents(item.receivedAmount ?? item.amount);
    if (amount <= 0 || (method === 'efectivo' ? receivedAmount < amount : receivedAmount !== amount)) {
      throw new HttpsError('invalid-argument', 'Revisa los importes de pago. Solo el efectivo puede generar vuelto.');
    }
    const bankName = method === 'transferencia' ? text(item.bankName) : null;
    if (method === 'transferencia' && !bankName) throw new HttpsError('invalid-argument', 'Selecciona el banco de la transferencia.');
    applied += amount;
    received += receivedAmount;
    change += receivedAmount - amount;
    return { method, amount: amount / 100, receivedAmount: receivedAmount / 100, bankName, operationNumber: text(item.operationNumber) };
  });
  if (applied !== totalCents) throw new HttpsError('invalid-argument', 'La suma de los pagos debe coincidir con el total de la venta.');
  if (received > 10_000_000_000) throw new HttpsError('invalid-argument', 'El monto recibido excede el máximo.');
  const paymentTotals = totalsByPayment(payments);
  return { payments, paymentMethod: payments.length > 1 ? 'mixto' as const : payments[0].method,
    paidAmount: received / 100, changeAmount: change / 100, paymentTotals,
    bankName: payments.find((part) => part.method === 'transferencia')?.bankName ?? null,
    operationNumber: payments.length === 1 ? payments[0].operationNumber : null };
}

export function totalsByPayment(payments: Pick<PaymentPart, 'method' | 'amount'>[]): PaymentTotals {
  const totals: PaymentTotals = { cashSales: 0, yapeSales: 0, cardSales: 0, otherSales: 0 };
  for (const part of payments) {
    const field = part.method === 'efectivo' ? 'cashSales' : ['yape', 'plin'].includes(part.method) ? 'yapeSales' : part.method === 'tarjeta' ? 'cardSales' : 'otherSales';
    totals[field] = Math.round((totals[field] + part.amount) * 100) / 100;
  }
  return totals;
}

export function salePaymentParts(sale: Record<string, unknown>): PaymentPart[] {
  if (Array.isArray(sale.payments) && sale.payments.length) return sale.payments as PaymentPart[];
  return [{ method: sale.paymentMethod as PaymentMethod, amount: Number(sale.total), receivedAmount: Number(sale.paidAmount),
    bankName: typeof sale.bankName === 'string' ? sale.bankName : null, operationNumber: typeof sale.operationNumber === 'string' ? sale.operationNumber : null }];
}

export function addCashSummary(summary: Record<string, number>, sale: Record<string, unknown>, direction = 1) {
  const totals = totalsByPayment(salePaymentParts(sale));
  const result = { ...summary };
  for (const [key, value] of Object.entries({ ...totals, totalSales: Number(sale.total), salesCount: 1 })) {
    result[key] = Math.round(((result[key] ?? 0) + direction * value) * 100) / 100;
  }
  return result;
}
