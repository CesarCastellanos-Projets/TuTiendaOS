import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { localDb } from './catalog-cache';
import { useAuth } from './auth';
import { peruToday } from './calendar';

export interface StatisticsProduct { productId: string; name: string; unit: string; units: number; revenue: number; tickets: number }
export interface SalesStatistics {
  start: string; end: string; revenue: number; tickets: number; averageTicket: number;
  hourly: number[]; payments: Record<string, number>;
  daily: { date: string; revenue: number; tickets: number }[];
  stores: { storeId: string; name: string; revenue: number; tickets: number }[];
  topProducts: StatisticsProduct[]; bottomProducts: StatisticsProduct[]; soldProductIds: string[];
  generatedAt: number; documentsRead: number; historicalComplete: boolean;
}
export interface CachedStatistics { key: string; result: SalesStatistics; expiresAt: number }
export interface StatisticsFilter { start: string; end: string; storeIds: string[] }
export type StatisticsPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
const pending = new Map<string, Promise<SalesStatistics>>();

export function statisticsRange(period: StatisticsPeriod, anchor: string, today = peruToday()) {
  const date = new Date(`${anchor}T12:00:00Z`);
  let start = anchor;
  let end = anchor;
  if (period === 'weekly') {
    const monday = new Date(date); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    start = monday.toISOString().slice(0, 10); end = sunday.toISOString().slice(0, 10);
  } else if (period === 'monthly') {
    start = `${anchor.slice(0, 7)}-01`;
    end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  } else if (period === 'yearly') {
    start = `${anchor.slice(0, 4)}-01-01`; end = `${anchor.slice(0, 4)}-12-31`;
  }
  return { start, end: end > today ? today : end };
}

export async function getStatistics(filter: StatisticsFilter, refresh = false): Promise<SalesStatistics> {
  const { profile, user } = useAuth.getState();
  if (!profile || !user) throw new Error('Inicia sesión para consultar estadísticas.');
  const storeIds = [...filter.storeIds].sort();
  const key = `stats-v1:${profile.tenantId}:${user.uid}:${profile.role}:${storeIds.join(',')}:${filter.start}:${filter.end}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const cached = await localDb.statisticsQueries.get(key).catch(() => undefined);
    if (cached && ((!refresh && cached.expiresAt > Date.now()) || !navigator.onLine)) return cached.result;
    if (!navigator.onLine) throw new Error('Conéctate para consultar este periodo por primera vez.');
    const response = await httpsCallable<StatisticsFilter, SalesStatistics>(functions, 'getSalesStatistics')({ ...filter, storeIds });
    const expiresAt = Date.now() + (filter.end < peruToday() ? 24 * 3600000 : 5 * 60000);
    await localDb.statisticsQueries.put({ key, result: response.data, expiresAt }).catch(() => undefined);
    const keys = await localDb.statisticsQueries.orderBy('expiresAt').primaryKeys().catch(() => []);
    if (keys.length > 60) await localDb.statisticsQueries.bulkDelete(keys.slice(0, keys.length - 60)).catch(() => undefined);
    return response.data;
  })().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export async function importStatisticsHistory() {
  const response = await httpsCallable<Record<string, never>, { scanned: number; imported: number; scannedTotal: number; complete: boolean }>(functions, 'backfillSalesStatistics')({});
  await localDb.statisticsQueries.clear().catch(() => undefined);
  return response.data;
}
