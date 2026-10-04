import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { requireActiveProfile } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import { round2 } from './stock-model';
import { addCashSummary } from './payment-model';

function money(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || value > 100_000_000 || Math.abs(value - round2(value)) > 0.0000001) {
    throw new HttpsError('invalid-argument', 'El monto debe ser positivo o cero y tener hasta dos decimales.');
  }
  return value;
}

async function summarize(tenantId: string, sessionId: string, cutoff?: number) {
    let summary = { totalSales: 0, cashSales: 0, yapeSales: 0, cardSales: 0, otherSales: 0, salesCount: 0 };
    let cursor: string | undefined;
    do {
      const base = tenantCollection(tenantId, 'sales').where('cashSessionId', '==', sessionId).orderBy('__name__');
      const page = await (cursor ? base.startAfter(cursor) : base).limit(250).get();
      for (const doc of page.docs) {
        const sale = doc.data();
        if (sale.status === 'anulada' && (cutoff === undefined || Number(sale.voidedAt ?? 0) <= cutoff)) continue;
        const total = Number(sale.total);
        if (!Number.isFinite(total) || total < 0 || total > 100_000_000) throw new HttpsError('failed-precondition', 'Una venta de esta caja tiene un importe inconsistente.');
        summary = addCashSummary(summary, sale) as typeof summary;
      }
      cursor = page.size === 250 ? page.docs.at(-1)?.id : undefined;
    } while (cursor);
    return summary;
}

function lockId(uid: string, storeId: string) {
  return createHash('sha256').update(`${uid}:${storeId}`).digest('hex');
}

export const openCashSession = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'pos' || !profile.storeId) {
    throw new HttpsError('permission-denied', 'Solo el POS con tienda puede abrir una caja.');
  }
  const openingAmount = money(request.data?.openingAmount);
  const lock = tenantDoc(profile.tenantId, 'cash_session_locks', lockId(profile.uid, profile.storeId));
  const ref = tenantCollection(profile.tenantId, 'cash_sessions').doc();
  return db.runTransaction(async (tx) => {
    const [locked, legacy, store] = await Promise.all([
      tx.get(lock),
      tx.get(tenantCollection(profile.tenantId, 'cash_sessions')
        .where('userId', '==', profile.uid).where('storeId', '==', profile.storeId)
        .where('status', 'in', ['abierta', 'cerrando']).limit(2)),
      tx.get(tenantDoc(profile.tenantId, 'stores', profile.storeId!))
    ]);
    if (!store.exists) throw new HttpsError('failed-precondition', 'La tienda no existe.');
    if (locked.exists || !legacy.empty) {
      throw new HttpsError('failed-precondition', 'Ya tienes una caja abierta o un cierre pendiente en esta tienda.');
    }
    const session = {
      tenantId: profile.tenantId, storeId: profile.storeId, storeName: String(store.data()?.name ?? ''),
      userId: profile.uid, userName: profile.displayName, openingAmount,
      status: 'abierta', openedAt: Date.now(), summaryVersion: 1,
      salesSummary: { totalSales: 0, cashSales: 0, yapeSales: 0, cardSales: 0, otherSales: 0, salesCount: 0 }
    };
    tx.set(ref, session);
    tx.set(lock, { sessionId: ref.id });
    return { id: ref.id, ...session };
  });
});

export const getCashSessionSummary = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  const id = request.data?.sessionId;
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) {
    throw new HttpsError('invalid-argument', 'Caja inválida.');
  }
  const snapshot = await tenantDoc(profile.tenantId, 'cash_sessions', id).get();
  const session = snapshot.data();
  if (!session || (profile.role !== 'admin' && (profile.role !== 'pos'
    || session.userId !== profile.uid || session.storeId !== profile.storeId))) {
    throw new HttpsError('permission-denied', 'No puedes consultar esta caja.');
  }
  if (session.summaryVersion === 1 || session.status === 'cerrada') {
    if (!session.salesSummary) throw new HttpsError('failed-precondition', 'Este cierre antiguo no tiene desglose verificable.');
    return session.salesSummary;
  }
  return summarize(profile.tenantId, id);
});

export const closeCashSession = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  const id = request.data?.sessionId;
  if (profile.role !== 'pos' || typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) {
    throw new HttpsError('permission-denied', 'Caja inválida para tu usuario.');
  }
  const counted = money(request.data?.closingAmount);
  const ref = tenantDoc(profile.tenantId, 'cash_sessions', id);
  const frozen = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const session = snap.data();
    if (!session || session.userId !== profile.uid || session.storeId !== profile.storeId) {
      throw new HttpsError('permission-denied', 'Esta caja no corresponde a tu usuario y tienda.');
    }
    if (session.status === 'cerrada') return session;
    if (session.status === 'cerrando' && session.closingAmount !== counted) {
      throw new HttpsError('failed-precondition', 'Reintenta el cierre con el mismo efectivo contado.');
    }
    if (!['abierta', 'cerrando'].includes(String(session.status))) {
      throw new HttpsError('failed-precondition', 'La caja no puede cerrarse.');
    }
    const closingStartedAt = session.closingStartedAt ?? Date.now();
    tx.update(ref, { status: 'cerrando', closingAmount: counted, closingStartedAt });
    return { ...session, closingStartedAt };
  });
  if (frozen.status === 'cerrada') return { id, ...frozen };
  const salesSummary = frozen.summaryVersion === 1 && frozen.salesSummary
    ? frozen.salesSummary : await summarize(profile.tenantId, id, Number(frozen.closingStartedAt ?? Date.now()));
  return db.runTransaction(async (tx) => {
    const [snap, lock] = await Promise.all([
      tx.get(ref), tx.get(tenantDoc(profile.tenantId, 'cash_session_locks', lockId(profile.uid, profile.storeId!)))
    ]);
    const session = snap.data()!;
    if (session.status === 'cerrada') return { id, ...session };
    const expectedAmount = round2(Number(session.openingAmount) + salesSummary.cashSales);
    const closed = {
      ...session, status: 'cerrada', closingAmount: counted, expectedAmount,
      difference: round2(counted - expectedAmount), closedAt: Date.now(), salesSummary
    };
    tx.set(ref, closed);
    if (lock.data()?.sessionId === id) tx.delete(lock.ref);
    return { id, ...closed };
  });
});
