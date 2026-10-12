import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from './firebase';
import { tenantDoc } from './tenant';
import { updateSalesStatistics } from './statistics-model';

export async function reconcileSaleStatistics(tenantId: string, saleId: string): Promise<void> {
  const ref = tenantDoc(tenantId, 'sales', saleId);
  let attempts = 0;
  let completed = false;
  const startedAt = Date.now();
  try {
    await db.runTransaction(async (tx) => {
      attempts++;
      const snapshot = await tx.get(ref);
      const sale = snapshot.data();
      if (!sale) return;
      const applied = sale.statisticsApplied === true || (sale.statisticsVersion === 1 && sale.statisticsApplied === undefined);
      const desired = sale.status === 'activa';
      if (applied !== desired) await updateSalesStatistics(tx, tenantId, sale, desired ? 1 : -1);
      if (sale.statisticsPending === true || sale.statisticsApplied !== desired) {
        tx.update(ref, { statisticsApplied: desired, statisticsPending: false, statisticsVersion: 2, statisticsError: null, statisticsAttempts: 0 });
      }
    });
    completed = true;
  } finally {
    if (attempts > 1) console.warn('Reintentos de transacción analítica', {
      tenantId, saleId, attempts, elapsedMs: Date.now() - startedAt, completed
    });
  }
}

export const aggregateSaleStatistics = onDocumentWritten({ document: 'tenants/{tenantId}/sales/{saleId}', retry: true }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || (after.statisticsVersion !== 2 && after.statisticsPending !== true && before?.statisticsVersion !== 1)) return;
  if ((before && before.status === after.status && before.statisticsPending === after.statisticsPending)) return;
  if (after.statisticsPending !== true && before?.status === after.status) return;
  try { await reconcileSaleStatistics(event.params.tenantId, event.params.saleId); }
  catch (cause) { await recordStatisticsFailure(event.params.tenantId, event.params.saleId, cause); }
});

async function recordStatisticsFailure(tenantId: string, saleId: string, cause: unknown): Promise<void> {
  console.error('Analítica pendiente de recuperación', { saleId, error: cause instanceof Error ? cause.message : 'error' });
  await db.runTransaction(async (tx) => {
    const ref = tenantDoc(tenantId, 'sales', saleId);
    const sale = (await tx.get(ref)).data();
    if (!sale || sale.statisticsPending !== true) return;
    const attempts = Number(sale.statisticsAttempts ?? 0) + 1;
    tx.update(ref, { statisticsAttempts: attempts, statisticsPending: attempts < 6,
      statisticsError: attempts >= 6 ? 'Requiere conciliación manual de la analítica.' : 'Actualización pendiente de recuperación.',
      statisticsNextRetryAt: Date.now() + Math.min(3600000, 60000 * 2 ** attempts) });
  });
}

export const recoverSalesStatistics = onSchedule({ schedule: 'every 10 minutes', maxInstances: 1 }, async () => {
  const pending = await db.collectionGroup('sales').where('statisticsPending', '==', true)
    .where('statisticsNextRetryAt', '<=', Date.now()).orderBy('statisticsNextRetryAt').limit(50).get();
  for (const sale of pending.docs) {
    try { await reconcileSaleStatistics(String(sale.data().tenantId), sale.id); }
    catch (cause) { await recordStatisticsFailure(String(sale.data().tenantId), sale.id, cause); }
  }
});
