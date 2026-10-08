import { createHash } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { tenantDoc } from './tenant';
import { salePaymentParts } from './payment-model';

export const PRODUCT_BUCKETS = 32;
export interface DayStatistics {
  revenue: number;
  tickets: number;
  units: number;
  hourly: number[];
  payments: Record<string, number>;
}
export interface ProductStatistics {
  name: string;
  unit: string;
  days: Record<string, { units: number; revenue: number; tickets: number }>;
}
interface ProductContribution { name: string; unit: string; units: number; revenue: number }
export function limaDay(timestamp: number): string {
  return new Date(timestamp - 5 * 3600000).toISOString().slice(0, 10);
}
export function emptyDay(): DayStatistics {
  return { revenue: 0, tickets: 0, units: 0, hourly: Array<number>(24).fill(0), payments: {} };
}
const rounded = (value: number, precision = 100) => Math.round(value * precision) / precision;

// Todos los documentos se leen antes de escribir para aplicar cada venta una sola vez.
export async function updateSalesStatistics(tx: Transaction, tenantId: string, sale: Record<string, unknown>, direction: 1 | -1) {
  if (!Number.isFinite(Number(sale.createdAt)) || !Array.isArray(sale.items) || !Number.isFinite(Number(sale.total))) {
    throw new HttpsError('failed-precondition', 'La venta requiere conciliación antes de agregarla a estadísticas.');
  }
  const day = limaDay(Number(sale.createdAt));
  const month = day.slice(0, 7);
  const storeId = String(sale.storeId);
  const hour = new Date(Number(sale.createdAt) - 5 * 3600000).getUTCHours();
  const items = sale.items as Array<Record<string, unknown>>;
  const products = new Map<string, ProductContribution>();
  for (const item of items) {
    const id = String(item.productId);
    const current = products.get(id) ?? { name: String(item.name).slice(0, 180), unit: String(item.baseUnit ?? 'UN').slice(0, 40), units: 0, revenue: 0 };
    current.units = rounded(current.units + Number(item.baseUnitsSold ?? Number(item.qty) * Number(item.factor ?? 1)), 1000);
    current.revenue = rounded(current.revenue + Number(item.total));
    products.set(id, current);
  }
  const groups = new Map<number, Map<string, ProductContribution>>();
  for (const [id, value] of products) {
    const bucket = createHash('sha256').update(id).digest()[0] % PRODUCT_BUCKETS;
    if (!groups.has(bucket)) groups.set(bucket, new Map());
    groups.get(bucket)!.set(id, value);
  }
  const summaryRef = tenantDoc(tenantId, 'sales_statistics', `${storeId}_${month}`);
  const refs = [...groups.keys()].map((bucket) => tenantDoc(tenantId, 'sales_statistics_products', `${storeId}_${month}_${bucket}`));
  const [summarySnap, ...snapshots] = await tx.getAll(summaryRef, ...refs);
  const days = { ...(summarySnap.data()?.days ?? {}) } as Record<string, DayStatistics>;
  const current = days[day] ?? emptyDay();
  const payments = { ...current.payments };
  for (const part of salePaymentParts(sale)) payments[part.method] = rounded((payments[part.method] ?? 0) + direction * part.amount);
  const hourly = [...current.hourly];
  hourly[hour] = (hourly[hour] ?? 0) + direction;
  days[day] = { revenue: rounded(current.revenue + direction * Number(sale.total)), tickets: current.tickets + direction,
    units: rounded(current.units + direction * [...products.values()].reduce((sum, item) => sum + item.units, 0), 1000), hourly, payments };
  if (days[day].tickets < 0) throw new HttpsError('failed-precondition', 'El resumen de ventas requiere revisión.');
  const writes: Array<{ ref: typeof summaryRef; document: Record<string, unknown> }> = [];
  function bit(id: string, depth: number): number {
    const hash = createHash('sha256').update(id).digest();
    return (hash[1 + Math.floor(depth / 8)] >> (depth % 8)) & 1;
  }
  function partition(ref: typeof summaryRef, bucket: number, entries: Record<string, ProductStatistics>, depth: number) {
    const document = { tenantId, storeId, month, bucket, products: entries, split: false, updatedAt: Date.now() };
    if (Buffer.byteLength(JSON.stringify(document)) <= 850_000) {
      writes.push({ ref, document }); return;
    }
    if (depth >= 24) throw new HttpsError('resource-exhausted', 'La partición analítica requiere revisión. La venta permanece registrada.');
    writes.push({ ref, document: { ...document, products: {}, split: true } });
    for (const branch of [0, 1]) {
      const subset = Object.fromEntries(Object.entries(entries).filter(([id]) => bit(id, depth) === branch));
      partition(tenantDoc(tenantId, 'sales_statistics_products', `${ref.id}_${branch}`), bucket, subset, depth + 1);
    }
  }
  async function updateNode(ref: typeof summaryRef, bucket: number, contributions: Map<string, ProductContribution>, depth: number,
    data?: Record<string, unknown>) {
    const current = data ?? (await tx.get(ref)).data() ?? {};
    if (current.split === true) {
      for (const branch of [0, 1]) {
        const subset = new Map([...contributions].filter(([id]) => bit(id, depth) === branch));
        if (subset.size) await updateNode(tenantDoc(tenantId, 'sales_statistics_products', `${ref.id}_${branch}`), bucket, subset, depth + 1);
      }
      return;
    }
    const entries = Object.assign(Object.create(null) as Record<string, ProductStatistics>, current.products ?? {});
    for (const [id, value] of contributions) {
      const previous = entries[id] ?? { name: value.name, unit: value.unit, days: {} };
      const productDay = previous.days[day] ?? { units: 0, revenue: 0, tickets: 0 };
      entries[id] = { name: value.name, unit: value.unit, days: { ...previous.days, [day]: {
        units: rounded(productDay.units + direction * value.units, 1000),
        revenue: rounded(productDay.revenue + direction * value.revenue), tickets: productDay.tickets + direction
      } } };
    }
    partition(ref, bucket, entries, depth);
  }
  for (let index = 0; index < snapshots.length; index++) {
    const bucket = [...groups.keys()][index];
    await updateNode(refs[index], bucket, groups.get(bucket)!, 0, snapshots[index].data() ?? {});
  }
  tx.set(summaryRef, { tenantId, storeId, storeName: String(sale.storeName ?? ''), month, days, updatedAt: Date.now() });
  writes.forEach(({ ref, document }) => tx.set(ref, document));
}
