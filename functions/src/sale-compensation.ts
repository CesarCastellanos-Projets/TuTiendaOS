import { appCheckOptions } from './app-check';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAdmin } from './authz';
import { completeOperation, documentId, operationId, readOperation } from './operation-receipts';
import { db } from './firebase';
import { tenantCollection, tenantDoc } from './tenant';
import { changeSelectedStock, parsePresentations, readStockState, resolvePresentation, round2, stockPatch } from './stock-model';
import { PAYMENT_METHODS } from './payment-model';

export const recordSaleCompensation = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data ?? {};
  const saleId = documentId(data.saleId, 'Venta');
  const requestId = operationId(data.requestId);
  const returnStock = data.returnStock === true;
  const refund = data.refund === true;
  if (!returnStock && !refund) throw new HttpsError('invalid-argument', 'Selecciona devolución de productos o reembolso.');
  const method = data.method;
  if (refund && !PAYMENT_METHODS.includes(method)) throw new HttpsError('invalid-argument', 'Método de reembolso inválido.');
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!note || note.length > 500) throw new HttpsError('invalid-argument', 'Registra el motivo o referencia de la devolución.');
  return db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'sale-compensation', requestId, data);
    if (operation.result) return operation.result;
    const saleRef = tenantDoc(profile.tenantId, 'sales', saleId);
    const sale = (await tx.get(saleRef)).data();
    if (!sale || sale.status !== 'anulada') throw new HttpsError('failed-precondition', 'Primero autoriza y confirma la anulación del comprobante.');
    if ((returnStock && sale.stockReturnedAt) || (refund && sale.refundedAt)) throw new HttpsError('already-exists', 'Esta devolución o reembolso ya se registró.');
    const items = sale.items as Array<Record<string, unknown>>;
    const ids = [...new Set(items.map((item) => String(item.productId)))];
    const products = returnStock ? await tx.getAll(...ids.map((id) => tenantDoc(profile.tenantId, 'products', id))) : [];
    const stocks = returnStock ? await tx.getAll(...ids.map((id) => tenantDoc(profile.tenantId, 'product_stocks', `${id}_${sale.storeId}`))) : [];
    const store = returnStock ? await tx.get(tenantDoc(profile.tenantId, 'stores', String(sale.storeId))) : null;
    if (returnStock && (!store?.exists || store.data()?.active === false)) throw new HttpsError('failed-precondition', 'La tienda original no está activa. Revisa el destino antes de devolver stock.');
    const sessionId = refund && method === 'efectivo' ? documentId(data.cashSessionId || sale.cashSessionId, 'Caja del reembolso') : null;
    const cash = sessionId ? await tx.get(tenantDoc(profile.tenantId, 'cash_sessions', sessionId)) : null;
    if (sessionId && (cash?.data()?.status !== 'abierta' || cash.data()?.storeId !== sale.storeId)) throw new HttpsError('failed-precondition', 'Selecciona una caja abierta de la tienda para registrar la salida de efectivo.');
    if (cash && sessionId === sale.cashSessionId && sale.cashRetentionRecorded !== true) {
      throw new HttpsError('failed-precondition', 'Esta anulación antigua requiere conciliar la caja original antes de reembolsar desde ella.');
    }
    const now = Date.now();
    if (returnStock) {
      for (let index = 0; index < ids.length; index++) {
        const product = products[index].data();
        if (!product) throw new HttpsError('failed-precondition', 'Un producto ya no existe.');
        const presentations = parsePresentations(product);
        const state = readStockState(stocks[index].data() ?? {}, presentations, String(product.unit ?? 'UN'));
        for (const item of items.filter((line) => line.productId === ids[index])) {
          if (item.baseUnit && item.baseUnit !== product.unit) throw new HttpsError('failed-precondition', 'La unidad del producto cambió; requiere conciliación.');
          const presentation = item.presentationId ? resolvePresentation(product, String(item.presentationId), '', '') : null;
          if (Number(item.factor ?? 1) !== (presentation?.factor ?? 1)) throw new HttpsError('failed-precondition', 'La equivalencia del producto cambió.');
          changeSelectedStock(state, presentation, Number(item.qty));
          tx.create(tenantCollection(profile.tenantId, 'stock_movements').doc(), { tenantId: profile.tenantId, type: 'devolucion',
            productId: ids[index], productName: product.name, qty: Number(item.baseUnitsSold ?? Number(item.qty) * Number(item.factor ?? 1)),
            presentationId: item.presentationId ?? null, presentationQty: Number(item.qty), presentationLabel: item.presentationLabel ?? 'Unidad base',
            fromLocationId: null, toLocationId: sale.storeId, refId: saleId, userId: profile.uid, userName: profile.displayName, reason: note, createdAt: now });
        }
        tx.set(stocks[index].ref, { tenantId: profile.tenantId, productId: ids[index], productName: product.name, unit: product.unit,
          locationId: sale.storeId, locationType: 'store', locationName: sale.storeName,
          ...stockPatch(state, presentations, Number(product.minStock ?? 0), product.active === true) }, { merge: true });
      }
    }
    if (refund) {
      tx.create(tenantDoc(profile.tenantId, 'sale_refunds', saleId), { tenantId: profile.tenantId, saleId, storeId: sale.storeId,
        amount: sale.total, method, cashSessionId: sessionId, userId: profile.uid, userName: profile.displayName, note, createdAt: now });
      if (cash) tx.update(cash.ref, { cashBalanceAdjustment: round2(Number(cash.data()?.cashBalanceAdjustment ?? 0) - Number(sale.total)) });
    }
    tx.update(saleRef, { ...(returnStock ? { stockReturnedAt: now } : {}), ...(refund ? { refundedAt: now, refundMethod: method } : {}) });
    const result = { ok: true, saleId };
    completeOperation(tx, profile, 'sale-compensation', operation, result);
    return result;
  });
});
