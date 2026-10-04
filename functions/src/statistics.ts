import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';
import { requireActiveProfile, requireAdmin } from './authz';
import { db } from './firebase';
import { tenantCollection, tenantDoc } from './tenant';
import { emptyDay, limaDay, PRODUCT_BUCKETS, updateSalesStatistics, type DayStatistics, type ProductStatistics } from './statistics-model';

function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new HttpsError('invalid-argument', 'Fecha inválida.');
  }
  return value;
}

export const getSalesStatistics = onCall(async (request) => {
  const profile = await requireActiveProfile(request, false);
  if (!['admin', 'pos'].includes(profile.role)) throw new HttpsError('permission-denied', 'Tu rol no puede consultar estadísticas.');
  const start = date(request.data?.start);
  const end = date(request.data?.end);
  if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365 || end > limaDay(Date.now())) {
    throw new HttpsError('invalid-argument', 'Selecciona hasta un año y fechas que no sean futuras.');
  }
  if (profile.role === 'pos' && (start !== limaDay(Date.now()) || end !== start)) {
    throw new HttpsError('permission-denied', 'El POS solo puede consultar las estadísticas de hoy.');
  }
  const raw: unknown = request.data?.storeIds;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10
    || raw.some((id: unknown) => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) || new Set(raw).size !== raw.length) {
    throw new HttpsError('invalid-argument', 'Selecciona de una a diez tiendas por consulta.');
  }
  const storeIds = raw as string[];
  if (profile.role === 'pos' && (storeIds.length !== 1 || storeIds[0] !== profile.storeId)) {
    throw new HttpsError('permission-denied', 'Selecciona la tienda activa para consultar sus estadísticas.');
  }
  return db.runTransaction(async (tx) => {
    const stores = await tx.getAll(...storeIds.map((id) => tenantDoc(profile.tenantId, 'stores', id)));
    if (stores.some((store) => !store.exists)) throw new HttpsError('not-found', 'Una de las tiendas ya no existe.');
    const firstMonth = start.slice(0, 7);
    const lastMonth = end.slice(0, 7);
    const total = emptyDay();
    const daily = new Map<string, DayStatistics>();
    const byStore = new Map(storeIds.map((id, index) => [id, { storeId: id, name: String(stores[index].data()?.name ?? ''), revenue: 0, tickets: 0 }]));
    const products = new Map<string, { productId: string; name: string; unit: string; units: number; revenue: number; tickets: number }>();
    let documentsRead = stores.length;
    const summaries = await Promise.all(storeIds.map((id) => tx.get(tenantCollection(profile.tenantId, 'sales_statistics')
      .where('storeId', '==', id).where('month', '>=', firstMonth).where('month', '<=', lastMonth).orderBy('month').limit(13))));
    for (let index = 0; index < summaries.length; index++) {
      documentsRead += Math.max(1, summaries[index].size);
      const storeTotal = byStore.get(storeIds[index])!;
      for (const document of summaries[index].docs) {
        const days = document.data().days as Record<string, DayStatistics>;
        for (const [day, value] of Object.entries(days)) {
          if (day < start || day > end) continue;
          const row = daily.get(day) ?? emptyDay();
          row.revenue += value.revenue; row.tickets += value.tickets;
          storeTotal.revenue += value.revenue; storeTotal.tickets += value.tickets;
          total.revenue += value.revenue; total.tickets += value.tickets; total.units += value.units;
          value.hourly.forEach((count, hour) => { total.hourly[hour] += count; });
          for (const [method, amount] of Object.entries(value.payments)) total.payments[method] = (total.payments[method] ?? 0) + amount;
          daily.set(day, row);
        }
      }
    }
    // Se recorren meses, no ventas; el límite total es 10 tiendas × 13 meses × 32 documentos.
    for (const id of storeIds) {
      const storeIndex = storeIds.indexOf(id);
      const pages = await Promise.all(summaries[storeIndex].docs.map((summary) => tx.get(tenantCollection(profile.tenantId, 'sales_statistics_products')
        .where('storeId', '==', id).where('month', '==', summary.data().month).limit(PRODUCT_BUCKETS))));
      for (const page of pages) {
        documentsRead += Math.max(1, page.size);
        for (const document of page.docs) {
          for (const [productId, value] of Object.entries(document.data().products as Record<string, ProductStatistics>)) {
            const row = products.get(productId) ?? { productId, name: value.name, unit: value.unit, units: 0, revenue: 0, tickets: 0 };
            for (const [day, amounts] of Object.entries(value.days)) {
              if (day < start || day > end) continue;
              row.units += amounts.units; row.revenue += amounts.revenue; row.tickets += amounts.tickets;
            }
            products.set(productId, row);
          }
        }
      }
    }
    const rounding = (n: number) => Math.round(n * 100) / 100;
    const sold = [...products.values()].filter((item) => item.tickets > 0)
      .map((item) => ({ ...item, revenue: rounding(item.revenue), units: Math.round(item.units * 1000) / 1000 }));
    const sort = (a: typeof sold[number], b: typeof sold[number]) => b.tickets - a.tickets || b.revenue - a.revenue || a.productId.localeCompare(b.productId);
    const coverage = await tx.get(tenantDoc(profile.tenantId, 'meta', 'statistics'));
    return { start, end, revenue: rounding(total.revenue), tickets: total.tickets, averageTicket: total.tickets ? rounding(total.revenue / total.tickets) : 0,
      hourly: total.hourly, payments: Object.fromEntries(Object.entries(total.payments).map(([method, amount]) => [method, rounding(amount)])),
      daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, row]) => ({ date: day, revenue: rounding(row.revenue), tickets: row.tickets })),
      stores: [...byStore.values()].map((row) => ({ ...row, revenue: rounding(row.revenue) })),
      topProducts: sold.sort(sort).slice(0, 3), bottomProducts: [...sold].sort((a, b) => -sort(a, b)).slice(0, 3),
      soldProductIds: sold.map((row) => row.productId), generatedAt: Date.now(), documentsRead: documentsRead + 1,
      historicalComplete: coverage.data()?.historicalComplete === true };
  }, { readOnly: true }).catch((cause: unknown) => {
    if (cause instanceof HttpsError) throw cause;
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    const message = cause instanceof Error ? cause.message : '';
    if (code === '9' && /index/i.test(message)) {
      throw new HttpsError('failed-precondition', 'Los índices de estadísticas todavía no están listos. Espera a que termine su construcción en Firebase y pulsa Actualizar.');
    }
    console.error('No se pudo consultar el resumen de estadísticas', cause);
    if (['4', '14'].includes(code)) throw new HttpsError('unavailable', 'Firebase no respondió a tiempo. Vuelve a pulsar Actualizar.');
    throw new HttpsError('internal', 'No se pudieron cargar las estadísticas. Intenta actualizar nuevamente.');
  });
});

export const backfillSalesStatistics = onCall({ timeoutSeconds: 120 }, async (request) => {
  const profile = await requireAdmin(request);
  const stateRef = tenantDoc(profile.tenantId, 'meta', 'statistics');
  const leaseId = randomUUID();
  const state = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(stateRef);
    const current = snapshot.data() ?? {};
    if (current.historicalComplete === true) return current;
    if (Number(current.leaseUntil ?? 0) > Date.now()) throw new HttpsError('failed-precondition', 'Ya se está integrando un bloque de ventas. Espera a que termine.');
    tx.set(stateRef, { ...current, tenantId: profile.tenantId, leaseId, leaseUntil: Date.now() + 180000, historicalComplete: false });
    return current;
  });
  if (state.historicalComplete === true) return { scanned: 0, imported: 0, scannedTotal: Number(state.scannedTotal ?? 0), complete: true };
  const cursor = typeof state.cursor === 'string' ? state.cursor : null;
  const base = tenantCollection(profile.tenantId, 'sales').orderBy('__name__');
  try {
    const page = await (cursor ? base.startAfter(cursor) : base).limit(100).get();
    let imported = 0;
    for (const document of page.docs) {
      const added = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(document.ref);
        const sale = snapshot.data();
        if (!sale || sale.statisticsVersion === 1 || sale.status !== 'activa') return false;
        await updateSalesStatistics(tx, profile.tenantId, sale, 1);
        tx.update(document.ref, { statisticsVersion: 1 });
        return true;
      });
      if (added) imported++;
    }
    const complete = page.size < 100;
    const scannedTotal = Number(state.scannedTotal ?? 0) + page.size;
    await db.runTransaction(async (tx) => {
      const current = await tx.get(stateRef);
      if (current.data()?.leaseId !== leaseId) throw new HttpsError('aborted', 'La integración cambió; vuelve a consultar el avance.');
      tx.set(stateRef, { tenantId: profile.tenantId, historicalComplete: complete, scannedTotal,
        cursor: complete ? null : page.docs.at(-1)!.id, leaseUntil: 0, updatedAt: Date.now() });
    });
    return { scanned: page.size, imported, scannedTotal, complete };
  } catch (cause) {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(stateRef);
      if (current.data()?.leaseId === leaseId) tx.update(stateRef, { leaseUntil: 0 });
    });
    throw cause;
  }
});
