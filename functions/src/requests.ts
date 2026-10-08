import { appCheckOptions } from './app-check';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import type { Transaction } from 'firebase-admin/firestore';
import { completeOperation, readOperation, operationId } from './operation-receipts';
import { assertCurrentProfile, requireActiveProfile, type ActiveProfile } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import { assertSaleStep, consumeSaleStock, parsePresentations, positiveQuantity, presentationLabel, readStockState, changeSelectedStock, selectedAvailable, resolvePresentation, round2, stockEquivalent } from './stock-model';

function text(value: unknown, max: number): string {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) throw new HttpsError('invalid-argument', 'Texto inválido o demasiado largo.');
  return value.trim();
}

async function prepare(request: Parameters<typeof requireActiveProfile>[0], quotation: boolean, tx: Transaction, profile: ActiveProfile) {
  if (!['pos', 'trabajador'].includes(profile.role) || !profile.storeId) {
    throw new HttpsError('permission-denied', 'Tu usuario necesita una tienda asignada.');
  }
  const input = request.data as Record<string, unknown>;
  if (input.storeId !== profile.storeId) throw new HttpsError('permission-denied', 'Tienda inválida.');
  const raw = input.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    throw new HttpsError('invalid-argument', 'Selecciona de 1 a 100 productos.');
  }
  const seen = new Set<string>();
  const parsed = raw.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Producto inválido.');
    const item = value as Record<string, unknown>;
    const productId = text(item.productId, 128);
    const presentationId = text(item.presentationId, 80);
    if (!/^[\w-]+$/.test(productId) || seen.has(`${productId}:${presentationId}`)) {
      throw new HttpsError('invalid-argument', 'Producto inválido o repetido.');
    }
    seen.add(`${productId}:${presentationId}`);
    const qty = positiveQuantity(quotation ? item.qty : item.requestedQty);

    return { productId, presentationId, qty };
  });
  const ids = [...new Set(parsed.map((item) => item.productId))];
  const snapshots = await Promise.all(ids.map(async (id) => {
    const [product, stock] = await Promise.all([
      tx.get(tenantDoc(profile.tenantId, 'products', id)),
      tx.get(tenantDoc(profile.tenantId, 'product_stocks', `${id}_${profile.storeId}`))
    ]);
    return { id, product, stock };
  }));
  const byId = new Map(snapshots.map((value) => [value.id, value]));
  const states = new Map(snapshots.map(({ id, product, stock }) => [id, readStockState(stock.data() ?? {}, parsePresentations(product.data() ?? {}), String(product.data()?.unit ?? 'UN'))]));
  const items = parsed.map(({ productId, presentationId, qty }) => {
    const productSnap = byId.get(productId)!.product;
    const product = productSnap.data();
    if (!product || product.active !== true) throw new HttpsError('failed-precondition', 'Uno de los productos ya no está activo.');
    const presentation = resolvePresentation(product, presentationId, '', '');
    if (quotation) assertSaleStep(qty, presentation, String(product.unit ?? 'UN'));
    const state = states.get(productId)!;
    const availableQty = Math.floor((selectedAvailable(state, presentation) + 0.0000001) * 1000) / 1000;
    stockEquivalent(qty, presentation, String(product.unit ?? 'UN'));
    const presentationFields = presentation ? { presentationId: presentation.id, presentationLabel: presentationLabel(presentation) } : {};
    if (!quotation) return {
      productId, name: String(product.name), ...presentationFields,
      currentQty: availableQty, requestedQty: qty
    };
    const unitPrice = round2(presentation?.salePrice ?? Number(product.salePrice));
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new HttpsError('failed-precondition', 'Precio de catálogo inválido.');
    let isAvailable = true;
    try { consumeSaleStock(state, parsePresentations(product), presentation, qty); }
    catch { isAvailable = false; }
    return {
      productId, name: String(product.name), ...presentationFields,
      factor: presentation?.factor ?? 1, unit: presentation?.unit ?? String(product.unit ?? 'UN'),
      barcode: presentation?.barcode ?? String(product.barcode ?? ''),
      unitPrice, qty, total: round2(qty * unitPrice), availableQty, isAvailable
    };
  });
  const store = await tx.get(tenantDoc(profile.tenantId, 'stores', profile.storeId));
  if (!store.exists || store.data()?.active === false) throw new HttpsError('failed-precondition', 'La tienda ya no existe.');
  return { profile, input, items, storeName: String(store.data()?.name ?? '') };
}

export const createQuotationRecord = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  const requestId = operationId(request.data?.requestId);
  return db.runTransaction(async (tx) => {
  const operation = await readOperation(tx, profile, 'quotation', requestId, request.data);
  if (operation.result) return operation.result;
  const { input, items, storeName } = await prepare(request, true, tx, profile);
  const ref = tenantCollection(profile.tenantId, 'quotations').doc();
  const totalAll = round2(items.reduce((sum, item) => sum + ('total' in item ? item.total ?? 0 : 0), 0));
  if (totalAll > 100_000_000) throw new HttpsError('invalid-argument', 'Cotización demasiado grande.');
  const quotation = {
    tenantId: profile.tenantId, id: ref.id, code: `COT-${ref.id.toUpperCase()}`,
    storeId: profile.storeId, storeName, items, totalAll,
    totalAvailable: round2(items.reduce((sum, item) => sum + ('isAvailable' in item && item.isAvailable ? item.total ?? 0 : 0), 0)),
    clientName: text(input.clientName, 180), clientPhone: text(input.clientPhone, 30),
    note: text(input.note, 500), createdBy: profile.uid, createdByName: profile.displayName,
    status: 'pendiente', createdAt: Date.now()
  };
  tx.create(ref, quotation);
  completeOperation(tx, profile, 'quotation', operation, quotation);
  return quotation;
  });
});

export const createReplenishmentRecord = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  const requestId = operationId(request.data?.requestId);
  return db.runTransaction(async (tx) => {
  const operation = await readOperation(tx, profile, 'replenishment', requestId, request.data);
  if (operation.result) return operation.result;
  const { input, items, storeName } = await prepare(request, false, tx, profile);
  const ref = tenantCollection(profile.tenantId, 'replenishment_requests').doc();
  tx.create(ref, {
    tenantId: profile.tenantId, storeId: profile.storeId, storeName, items,
    status: 'pendiente', createdBy: profile.uid, createdByName: profile.displayName,
    createdAt: Date.now(), note: text(input.note, 250)
  });
  const result = { id: ref.id };
  completeOperation(tx, profile, 'replenishment', operation, result);
  return result;
  });
});

export const discardQuotation = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  const id = text(request.data?.quotationId, 128);
  if (!/^[\w-]+$/.test(id)) throw new HttpsError('invalid-argument', 'Cotización inválida.');
  const ref = tenantDoc(profile.tenantId, 'quotations', id);
  const { db } = await import('./firebase');
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const snap = await tx.get(ref);
    const quote = snap.data();
    if (!quote || (profile.role !== 'admin' && (quote.createdBy !== profile.uid || quote.storeId !== profile.storeId))) {
      throw new HttpsError('permission-denied', 'No puedes descartar esta cotización.');
    }
    if (quote.status !== 'pendiente') throw new HttpsError('failed-precondition', 'La cotización ya fue procesada.');
    tx.update(ref, { status: 'descartada' });
  });
  return { ok: true };
});
