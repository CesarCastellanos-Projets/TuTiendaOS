import { appCheckOptions } from './app-check';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { assertCurrentProfile, requireAdmin } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import { parsePresentations, readStockState, changeSelectedStock, round3, stockEquivalent, stockPatch, type StockState } from './stock-model';

export const resolveTransferShortage = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const { transferId, action, reason } = request.data as Record<string, unknown>;
  if (typeof transferId !== 'string' || !/^[\w-]{1,128}$/.test(transferId)
    || !['devolver', 'merma'].includes(String(action))
    || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 250) {
    throw new HttpsError('invalid-argument', 'Indica transferencia, resolución y motivo.');
  }
  const ref = tenantDoc(profile.tenantId, 'transfers', transferId);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const snap = await tx.get(ref);
    const transfer = snap.data();
    if (!transfer || transfer.status !== 'recibido') throw new HttpsError('failed-precondition', 'La transferencia aún no fue recibida.');
    if (['devuelto', 'merma'].includes(String(transfer.shortageStatus))) return;
    if (action === 'devolver') {
      const source = await tx.get(tenantDoc(profile.tenantId, transfer.fromLocationType === 'store' ? 'stores' : 'warehouses', String(transfer.fromLocationId)));
      if (!source.exists || source.data()?.active === false) throw new HttpsError('failed-precondition', 'La ubicación de origen ya no está activa.');
    }
    const items = transfer.items as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new HttpsError('failed-precondition', 'Transferencia inconsistente.');
    const ids = [...new Set(items.map((item) => String(item.productId)))];
    const products = await Promise.all(ids.map((id) => tx.get(tenantDoc(profile.tenantId, 'products', id))));
    const stocks = await Promise.all(ids.map((id) => tx.get(tenantDoc(profile.tenantId, 'product_stocks', `${id}_${transfer.fromLocationId}`))));
    const states = new Map<string, StockState>();
    let hasShortage = false;
    for (const item of items) {
      const missing = round3(Number(item.qtySent) - Number(item.qtyReceived));
      if (!Number.isFinite(missing) || missing < 0) throw new HttpsError('failed-precondition', 'Cantidades inconsistentes.');
      if (!missing) continue;
      hasShortage = true;
      const index = ids.indexOf(String(item.productId));
      const product = products[index].data();
      if (!product || !stocks[index].exists) throw new HttpsError('failed-precondition', 'Falta catálogo o stock de origen.');
      const presentations = parsePresentations(product);
      const presentation = item.presentationId ? presentations.find((p) => p.id === item.presentationId) : null;
      if (item.presentationId && (!presentation || presentation.factor !== Number(item.factor))) {
        throw new HttpsError('failed-precondition', 'La presentación cambió; requiere conciliación del catálogo.');
      }
      const baseQty = stockEquivalent(missing, presentation ?? null, String(products[index].data()?.unit ?? 'UN'));
      if (action === 'devolver') {
        const state = states.get(ids[index]) ?? readStockState(stocks[index].data()!, presentations, String(products[index].data()?.unit ?? 'UN'));
        changeSelectedStock(state, presentation ?? null, missing);
        states.set(ids[index], state);
      }
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId, type: action === 'devolver' ? 'transferencia' : 'merma',
        productId: ids[index], productName: String(item.name),
        qty: action === 'devolver' ? baseQty : 0,
        baseQty: action === 'devolver' ? baseQty : 0,
        transitLossBaseQty: action === 'merma' ? baseQty : 0,
        presentationId: presentation?.id ?? null, presentationLabel: item.presentationLabel ?? 'Unidad base',
        presentationQty: action === 'devolver' ? missing : 0,
        toLocationId: transfer.fromLocationId, refId: String(transfer.code),
        reason: `${action === 'merma' ? `Merma en tránsito: ${baseQty} unidades base` : 'Devolución física del faltante'}: ${reason.trim()}`,
        userId: profile.uid, userName: profile.displayName, userStoreId: null, createdAt: Date.now()
      });
    }
    if (!hasShortage) throw new HttpsError('failed-precondition', 'La transferencia no tiene faltantes.');
    for (const [id, state] of states) {
      const index = ids.indexOf(id);
      tx.update(stocks[index].ref, stockPatch(state, parsePresentations(products[index].data()!), Number(products[index].data()!.minStock ?? 0), products[index].data()!.active === true));
    }
    tx.update(ref, {
      shortageStatus: action === 'devolver' ? 'devuelto' : 'merma',
      shortageResolvedBy: profile.uid, shortageResolvedAt: Date.now(), shortageResolution: reason.trim()
    });
  });
  return { ok: true };
});
