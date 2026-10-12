const methods = new Set(['efectivo', 'transferencia', 'tarjeta', 'yape', 'plin', 'sip', 'otro']);
const summaryFields = ['totalSales', 'cashSales', 'yapeSales', 'cardSales', 'otherSales', 'salesCount'];
const emptySummary = () => Object.fromEntries(summaryFields.map((field) => [field, 0]));

function cents(value, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000_000
    || (!signed && value < 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('INVALID_MONEY');
  return Math.round(value * 100);
}

export function createCashAudit(tenantId, sessionId, session) {
  scope(tenantId, sessionId);
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw new Error('Caja inválida.');
  const sum = emptySummary();
  let scanned = 0;
  let issueCount = 0;
  const issues = [];
  const issue = (code, saleId) => {
    issueCount++;
    if (issues.length < 20) issues.push({ code, ...(saleId ? { saleId } : {}) });
  };
  if (session.tenantId !== tenantId || typeof session.storeId !== 'string' || typeof session.userId !== 'string') issue('SESSION_CONTEXT');
  if (!['abierta', 'cerrando', 'cerrada'].includes(session.status)) issue('SESSION_STATUS');
  const frozen = ['cerrando', 'cerrada'].includes(session.status);
  const cutoff = frozen ? session.closingStartedAt : undefined;
  if (frozen && (typeof cutoff !== 'number' || !Number.isFinite(cutoff))) issue('UNKNOWN_CLOSING_CUTOFF');
  return {
    add(id, sale) {
      scanned++;
      if (sale.tenantId !== tenantId || sale.cashSessionId !== sessionId || sale.storeId !== session.storeId || sale.userId !== session.userId) {
        issue('SALE_CONTEXT', id); return;
      }
      if (!['activa', 'anulada'].includes(sale.status)) { issue('SALE_STATUS', id); return; }
      if (typeof sale.createdAt !== 'number' || !Number.isFinite(sale.createdAt)
        || (typeof cutoff === 'number' && sale.createdAt > cutoff)) { issue('SALE_DATE', id); return; }
      if (sale.status === 'anulada' && (typeof sale.voidedAt !== 'number' || !Number.isFinite(sale.voidedAt))) {
        issue('UNKNOWN_VOID_DATE', id); return;
      }
      try {
        const total = cents(sale.total);
        const parts = sale.payments === undefined
          ? [{ method: sale.paymentMethod, amount: sale.total }]
          : sale.payments;
        if (!Array.isArray(parts) || parts.length < 1 || parts.length > methods.size) throw new Error('INVALID_PAYMENT');
        const seen = new Set();
        const amounts = emptySummary();
        let paid = 0;
        for (const part of parts) {
          if (!part || !methods.has(part.method) || seen.has(part.method)) throw new Error('INVALID_PAYMENT');
          seen.add(part.method);
          const amount = cents(part.amount);
          if (amount <= 0) throw new Error('INVALID_PAYMENT');
          paid += amount;
          const field = part.method === 'efectivo' ? 'cashSales' : ['yape', 'plin'].includes(part.method)
            ? 'yapeSales' : part.method === 'tarjeta' ? 'cardSales' : 'otherSales';
          amounts[field] += amount;
        }
        if (paid !== total) throw new Error('PAYMENT_TOTAL_MISMATCH');
        if (sale.status === 'anulada' && amounts.cashSales > 0) issue('VOID_CASH_HISTORY_REVIEW', id);
        if (sale.refundedAt !== undefined) issue('REFUND_HISTORY_REVIEW', id);
        if (sale.status === 'anulada' && (cutoff === undefined || sale.voidedAt <= cutoff)) return;
        sum.totalSales += total;
        sum.salesCount++;
        for (const field of summaryFields.slice(1, -1)) sum[field] += amounts[field];
      } catch (cause) { issue(cause.message, id); }
    },
    finish(complete, documentsRead) {
      if (!complete) issue('READ_BUDGET_EXHAUSTED');
      const computedSummary = Object.fromEntries(summaryFields.map((field) => [field, field === 'salesCount' ? sum[field] : sum[field] / 100]));
      let expectedAmount = null;
      let difference = null;
      try {
        const opening = cents(session.openingAmount);
        const adjustment = cents(session.cashBalanceAdjustment ?? 0, true);
        const counted = frozen ? cents(session.closingAmount) : null;
        if (complete) {
          expectedAmount = (opening + sum.cashSales + adjustment) / 100;
          if (counted !== null) difference = (counted - Math.round(expectedAmount * 100)) / 100;
        }
      } catch { issue('SESSION_BALANCE'); }
      const storedSummary = session.salesSummary;
      const comparison = !complete ? 'not_checked_incomplete' : storedSummary && typeof storedSummary === 'object'
        ? summaryFields.every((field) => storedSummary[field] === computedSummary[field]) ? 'matches' : 'differs' : 'absent';
      if (comparison === 'differs') issue('STORED_SUMMARY_MISMATCH');
      if (complete && session.status === 'cerrada' && expectedAmount !== session.expectedAmount) issue('CLOSED_EXPECTED_MISMATCH');
      if (complete && session.status === 'cerrada' && difference !== session.difference) issue('CLOSED_DIFFERENCE_MISMATCH');
      return { mode: 'cash', tenantId, sessionId, status: session.status, summaryVersion: session.summaryVersion ?? null,
        complete, scanned, documentsRead, computedSummary, expectedAmount, difference, storedSummaryComparison: comparison,
        issueCount, issues, balancePreviewOnly: true, requiresFinancialReview: true, migrationApplied: false };
    }
  };
}

function scope(tenantId, id) {
  if (typeof tenantId !== 'string' || typeof id !== 'string'
    || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(tenantId) || !/^[\w-]{1,128}$/.test(id)) throw new Error('Contexto inválido.');
}
function readBudget(value) {
  if (!Number.isInteger(value) || value < 3 || value > 5000) throw new Error('Presupuesto entre 3 y 5000 lecturas.');
}

export async function inspectCashSession(db, tenantId, sessionId, budget = 1000) {
  scope(tenantId, sessionId); readBudget(budget);
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(db.doc(`tenants/${tenantId}/cash_sessions/${sessionId}`));
    if (!snapshot.exists) throw new Error('La caja no existe.');
    const audit = createCashAudit(tenantId, sessionId, snapshot.data());
    const base = db.collection(`tenants/${tenantId}/sales`).where('cashSessionId', '==', sessionId).orderBy('__name__');
    let documentsRead = 1;
    let cursor;
    while (documentsRead < budget) {
      const size = Math.min(250, budget - documentsRead);
      const page = await tx.get((cursor ? base.startAfter(cursor) : base).limit(size));
      documentsRead += Math.max(1, page.size);
      for (const document of page.docs) audit.add(document.id, document.data());
      if (page.size < size) return audit.finish(true, documentsRead);
      cursor = page.docs.at(-1);
    }
    return audit.finish(false, documentsRead);
  }, { readOnly: true });
}

export async function inspectStatistics(db, tenantId, storeId, month, budget = 515) {
  scope(tenantId, storeId); readBudget(budget);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes inválido.');
  return db.runTransaction(async (tx) => {
    const summary = await tx.get(db.doc(`tenants/${tenantId}/sales_statistics/${storeId}_${month}`));
    const base = db.collection(`tenants/${tenantId}/sales_statistics_products`)
      .where('storeId', '==', storeId).where('month', '==', month).orderBy('__name__');
    let documentsRead = 1;
    let cursor;
    let complete = false;
    const partitions = [];
    while (documentsRead < budget) {
      const size = Math.min(100, budget - documentsRead);
      const page = await tx.get((cursor ? base.startAfter(cursor) : base).limit(size));
      documentsRead += Math.max(1, page.size);
      for (const document of page.docs) {
        const data = document.data();
        const jsonBytes = Buffer.byteLength(JSON.stringify(data));
        partitions.push({ id: document.id, split: data.split === true, productCount: Object.keys(data.products ?? {}).length,
          jsonBytes, nearPartitionThreshold: jsonBytes >= 800_000 });
      }
      if (page.size < size) { complete = true; break; }
      cursor = page.docs.at(-1);
    }
    const days = summary.data()?.days ?? {};
    return { mode: 'statistics', tenantId, storeId, month, complete, documentsRead, summaryExists: summary.exists,
      summaryJsonBytes: summary.exists ? Buffer.byteLength(JSON.stringify(summary.data())) : 0,
      tickets: Object.values(days).reduce((sum, day) => sum + Number(day.tickets ?? 0), 0),
      partitions, repartitionApplied: false, contentionMeasured: false };
  }, { readOnly: true });
}

export async function inspectRetention(db, tenantId, uid, sampleSize = 100, now = Date.now()) {
  scope(tenantId, uid);
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 250) throw new Error('Muestra entre 1 y 250 documentos por colección.');
  const paths = [`tenants/${tenantId}/calendar_inboxes/${uid}/notifications`, 'replenishment_push_jobs', 'calendar_push_devices'];
  return db.runTransaction(async (tx) => {
    const samples = [];
    let documentsRead = 0;
    for (const path of paths) {
      let base = db.collection(path);
      if (!path.startsWith('tenants/')) base = base.where('tenantId', '==', tenantId);
      const page = await tx.get(base.orderBy('__name__').limit(sampleSize));
      documentsRead += Math.max(1, page.size);
      let expired = 0;
      let reviewPendingOrLeased = 0;
      let invalidExpiry = 0;
      for (const document of page.docs) {
        const data = document.data();
        const expiry = typeof data.expiresAt === 'number' ? data.expiresAt
          : typeof data.expiresAt?.toMillis === 'function' ? data.expiresAt.toMillis() : undefined;
        if (!Number.isFinite(expiry)) { invalidExpiry++; continue; }
        if (expiry > now) continue;
        expired++;
        if (data.state === 'pending' || data.pushState === 'pending' || Number(data.leaseUntil ?? data.pushLeaseUntil ?? 0) > now) reviewPendingOrLeased++;
      }
      samples.push({ collection: path.startsWith('tenants/') ? 'notifications' : path, scanned: page.size,
        mayHaveMore: page.size === sampleSize, expired, reviewPendingOrLeased, invalidExpiry });
    }
    return { mode: 'retention', tenantId, sampledAt: now, documentsRead, sampleSize, samples,
      sampling: 'first_documents_by_id', deletionApplied: false, ttlChanged: false, ttlConfigurationChecked: false };
  }, { readOnly: true });
}
