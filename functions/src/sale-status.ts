import { db } from './firebase';
import { tenantDoc } from './tenant';
import { updateSalesStatistics } from './statistics-model';
import { addCashSummary } from './payment-model';

export async function applySaleStatusPatch(tenantId: string, saleId: string, patch: Record<string, unknown>) {
  const ref = tenantDoc(tenantId, 'sales', saleId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const sale = snapshot.data();
    if (!sale) return;
    const voiding = patch.status === 'anulada' && sale.status === 'activa';
    const cash = voiding && typeof sale.cashSessionId === 'string'
      ? await tx.get(tenantDoc(tenantId, 'cash_sessions', sale.cashSessionId)) : null;
    if (voiding && sale.statisticsVersion === 1) await updateSalesStatistics(tx, tenantId, sale, -1);
    if (voiding && cash?.data()?.summaryVersion === 1 && cash.data()?.status === 'abierta') {
      tx.update(cash.ref, { salesSummary: addCashSummary(cash.data()?.salesSummary ?? {}, sale, -1) });
    }
    const fields = { ...patch };
    if (sale.status === 'anulada') {
      fields.status = 'anulada';
      if (sale.voidedAt !== undefined) fields.voidedAt = sale.voidedAt;
    }
    tx.set(ref, fields, { merge: true });
  });
}
