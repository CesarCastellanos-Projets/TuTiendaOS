import { db } from './firebase';
import { tenantDoc } from './tenant';

import { addCashSummary } from './payment-model';
import { salePaymentParts } from './payment-model';

export async function applySaleStatusPatch(tenantId: string, saleId: string, patch: Record<string, unknown>) {
  const ref = tenantDoc(tenantId, 'sales', saleId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const sale = snapshot.data();
    if (!sale) return;
    const voiding = patch.status === 'anulada' && sale.status === 'activa';
    const cash = voiding && typeof sale.cashSessionId === 'string'
      ? await tx.get(tenantDoc(tenantId, 'cash_sessions', sale.cashSessionId)) : null;

    if (voiding && cash?.data()?.summaryVersion === 1 && ['abierta', 'cerrando'].includes(cash.data()?.status)) {
      const retained = salePaymentParts(sale).filter((part) => part.method === 'efectivo').reduce((sum, part) => sum + part.amount, 0);
      tx.update(cash.ref, { salesSummary: addCashSummary(cash.data()?.salesSummary ?? {}, sale, -1),
        cashBalanceAdjustment: Math.round((Number(cash.data()?.cashBalanceAdjustment ?? 0) + retained) * 100) / 100 });
    }
    const fields: Record<string, unknown> = { ...patch, ...(voiding ? { statisticsPending: true, statisticsNextRetryAt: 0,
      cashRetentionRecorded: true } : {}) };
    if (sale.status === 'anulada') {
      fields.status = 'anulada';
      if (sale.voidedAt !== undefined) fields.voidedAt = sale.voidedAt;
    }
    tx.set(ref, fields, { merge: true });
  });
}
