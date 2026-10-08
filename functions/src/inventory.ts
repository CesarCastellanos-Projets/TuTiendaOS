import { appCheckOptions } from './app-check';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { completeOperation, readOperation, operationId, documentId } from './operation-receipts';
import { assertCurrentProfile, requireActiveProfile, requireAdmin, requireReplenishmentApprover } from './authz';
import { assertInventoryTask } from './worker-permissions';
import { tenantCollection, tenantDoc } from './tenant';
import {
  parsePresentations,
  selectedAvailable,
  changeSelectedStock,
  positiveQuantity,
  presentationLabel,
  readStockState,
  resolvePresentation,
  round3,
  stockPatch,
  stockEquivalent,
  type StockPresentation,
  type StockState
} from './stock-model';

type LocationType = 'store' | 'warehouse';

interface QuantityItem {
  productId: string;
  quantity: number;
  presentationId: string | null;
}

const MAX_ITEMS = 100;

function shortText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function locationType(value: unknown, field: string): LocationType {
  if (value !== 'store' && value !== 'warehouse') {
    throw new HttpsError('invalid-argument', `${field} no es válido.`);
  }
  return value;
}

function quantityItems(value: unknown, quantityField: string): QuantityItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) {
    throw new HttpsError('invalid-argument', `La operación debe incluir entre 1 y ${MAX_ITEMS} productos.`);
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpsError('invalid-argument', 'La lista de productos no es válida.');
    const item = raw as Record<string, unknown>;
    const productId = documentId(item.productId, 'Producto');
    const presentationId = shortText(item.presentationId, 80) || null;
    const key = `${productId}:${presentationId ?? 'base'}`;
    const quantity = positiveQuantity(item[quantityField]);
    if (!productId || seen.has(key)) {
      throw new HttpsError('invalid-argument', 'La lista contiene productos o cantidades inválidas.');
    }
    seen.add(key);
    return { productId, quantity, presentationId };
  });
}

function selectedPresentation(product: Record<string, unknown>, presentationId: string | null): StockPresentation | null {
  if (!presentationId) return null;
  return resolvePresentation(product, presentationId, '', '');
}

function movementPresentation(presentation: StockPresentation | null, quantity: number) {
  return {
    presentationId: presentation?.id ?? null,
    presentationLabel: presentation ? presentationLabel(presentation) : 'Unidad base',
    presentationQty: quantity,
    baseQty: round3(quantity * (presentation?.factor ?? 1))
  };
}

function locationRef(tenantId: string, type: LocationType, id: string) {
  return tenantDoc(tenantId, type === 'store' ? 'stores' : 'warehouses', id);
}

export const recordStockIngress = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) throw new HttpsError('invalid-argument', 'Los datos del ingreso no son válidos.');
  const data = request.data as Record<string, unknown>;
  const targetId = shortText(data.locationId, 128);
  const targetType = locationType(data.locationType, 'La ubicación');
  const items = quantityItems(data.items, 'qty');
  if (!targetId || targetId.includes('/')) throw new HttpsError('invalid-argument', 'Falta una ubicación de destino válida.');
  if (profile.role !== 'admin' && (profile.role !== 'trabajador' || targetType !== 'store' || profile.storeId !== targetId)) {
    throw new HttpsError('permission-denied', 'Solo puedes registrar mercadería en tu tienda autorizada.');
  }
  const requestId = operationId(data.requestId);
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Falta el identificador del ingreso.');
  }
  const note = shortText(data.note, 250);
  const fingerprint = createHash('sha256').update(JSON.stringify({ targetId, targetType, items, note })).digest('hex');

  await db.runTransaction(async (tx) => {
    await assertInventoryTask(tx, profile, 'canIngress', targetId);
    const ingressRef = tenantDoc(profile.tenantId, 'stock_ingresses', requestId);
    const existing = await tx.get(ingressRef);
    if (existing.exists) {
      if (existing.data()?.userId !== profile.uid || existing.data()?.fingerprint !== fingerprint) {
        throw new HttpsError('already-exists', 'Este ingreso ya se registró con otros datos.');
      }
      return;
    }
    const targetRef = locationRef(profile.tenantId, targetType, targetId);
    const productRefs = items.map((item) => tenantDoc(profile.tenantId, 'products', item.productId));
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${item.productId}_${targetId}`));
    const snapshots = await Promise.all([
      tx.get(targetRef),
      ...productRefs.map((ref) => tx.get(ref)),
      ...stockRefs.map((ref) => tx.get(ref))
    ]);
    const targetSnap = snapshots[0];
    const productSnaps = snapshots.slice(1, 1 + items.length);
    const stockSnaps = snapshots.slice(1 + items.length);
    if (!targetSnap.exists || targetSnap.data()?.active === false) throw new HttpsError('not-found', 'La ubicación no está activa.');
    const now = Date.now();
    const states = new Map<string, StockState>();
    const products = new Map<string, (typeof productSnaps)[number]>();
    const stocks = new Map<string, (typeof stockSnaps)[number]>();

    items.forEach((item, index) => {
      const productSnap = productSnaps[index];
      const stockSnap = stockSnaps[index];
      if (!productSnap.exists || productSnap.data()?.active !== true) {
        throw new HttpsError('failed-precondition', 'Uno de los productos no existe o está inactivo.');
      }
      const product = productSnap.data()!;
      const presentation = selectedPresentation(product, item.presentationId);
      const state = states.get(item.productId) ?? readStockState(stockSnap.data() ?? {}, parsePresentations(product), String(product.unit ?? 'UN'));
      states.set(item.productId, state);
      products.set(item.productId, productSnap);
      stocks.set(item.productId, stockSnap);
      changeSelectedStock(state, presentation, item.quantity);
      const presentationFields = movementPresentation(presentation, item.quantity);
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'ingreso',
        productId: item.productId,
        productName: String(product.name),
        qty: presentationFields.baseQty,
        ...presentationFields,
        fromLocationId: null,
        toLocationId: targetId,
        reason: note || null,
        refId: requestId,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: profile.role === 'trabajador' ? targetId : null,
        createdAt: now
      });
    });
    tx.create(ingressRef, {
      tenantId: profile.tenantId, locationId: targetId, locationType: targetType,
      locationName: String(targetSnap.data()?.name ?? ''), userId: profile.uid, userName: profile.displayName,
      createdAt: now, note, fingerprint,
      items: items.map((item, index) => ({ ...item, productName: String(productSnaps[index].data()?.name ?? ''),
        ...movementPresentation(selectedPresentation(productSnaps[index].data()!, item.presentationId), item.quantity) }))
    });
    for (const [productId, state] of states) {
      const product = products.get(productId)!.data()!;
      const stockSnap = stocks.get(productId)!;
      const stockData = stockPatch(state, parsePresentations(product), Number(product.minStock ?? 0), product.active === true);
      if (stockSnap.exists) {
        tx.update(stockSnap.ref, stockData);
      } else {
        tx.set(stockSnap.ref, {
          tenantId: profile.tenantId,
          productId,
          productName: String(product.name),
          barcode: product.barcode ?? null,
          salePrice: Number(product.salePrice ?? 0),
          locationType: targetType,
          locationId: targetId,
          locationName: String(targetSnap.data()?.name ?? ''),
          ...stockData,
          unit: product.unit ?? null
        });
      }
    }
  });
  return { ok: true };
});

export const adjustInventory = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const targetId = shortText(data.locationId, 128);
  const productId = shortText(data.productId, 128);
  const presentationId = shortText(data.presentationId, 80) || null;
  const reason = shortText(data.reason, 250);
  const adjustmentType = data.type;
  const newQty = Number(data.newQty);
  if (!targetId || !productId || !reason || !['ajuste', 'merma', 'reclasificar'].includes(String(adjustmentType))) {
    throw new HttpsError('invalid-argument', 'Faltan datos del ajuste.');
  }
  if (!Number.isFinite(newQty) || Math.abs(newQty - round3(newQty)) > 0.0000001 || newQty < 0 || newQty > 1_000_000) {
    throw new HttpsError('invalid-argument', 'La cantidad final no es válida.');
  }

  const requestId = operationId(data.requestId);
  await db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'adjustment', requestId, { targetId, productId, presentationId, reason, adjustmentType, newQty });
    if (operation.result) return;
    const stockRef = tenantDoc(profile.tenantId, 'product_stocks', `${productId}_${targetId}`);
    const productRef = tenantDoc(profile.tenantId, 'products', productId);
    const [stockSnap, productSnap] = await Promise.all([tx.get(stockRef), tx.get(productRef)]);
    if (!stockSnap.exists || !productSnap.exists) throw new HttpsError('not-found', 'El producto no tiene stock en esa ubicación.');
    const target = await tx.get(locationRef(profile.tenantId, stockSnap.data()?.locationType === 'warehouse' ? 'warehouse' : 'store', targetId));
    if (!target.exists || target.data()?.active === false) throw new HttpsError('failed-precondition', 'La ubicación ya no está activa.');
    const product = productSnap.data()!;
    const presentations = parsePresentations(product);
    const presentation = selectedPresentation(product, presentationId);
    const state = readStockState(stockSnap.data()!, parsePresentations(product), String(product.unit ?? 'UN'), adjustmentType === 'reclasificar');
    const previous = selectedAvailable(state, presentation);
    const oldStock = stockSnap.data()!;
    const pendingReconciliation = oldStock.stockModelVersion === 3 || oldStock.requiresReconciliation === true;
    const reconciledIds = new Set<string>(Array.isArray(oldStock.reconciledPresentationIds) ? oldStock.reconciledPresentationIds.filter((id: unknown): id is string => typeof id === 'string') : []);
    stockEquivalent(newQty, presentation, state.baseUnit);
    if (adjustmentType === 'merma' && newQty > previous) throw new HttpsError('invalid-argument', 'Una merma no puede aumentar el stock.');
    if (adjustmentType === 'reclasificar') {
      if (!presentation || presentation.autoUnpackEnabled) throw new HttpsError('invalid-argument', 'Selecciona una presentación que se vende cerrada.');
      const units = stockEquivalent(newQty - previous, presentation, state.baseUnit);
      if (state.baseQuantity < units) throw new HttpsError('failed-precondition', 'No hay suficientes unidades sin clasificar para ese conteo de cajas.');
      state.baseQuantity = round3(state.baseQuantity - units);
      reconciledIds.add(presentation.id);
    }
    if (presentation && !presentation.autoUnpackEnabled) state.presentationQuantities[presentation.id] = newQty;
    else state.baseQuantity = stockEquivalent(newQty, presentation, state.baseUnit);
    const now = Date.now();
    const requiresReconciliation = pendingReconciliation && presentations.some((p) => !p.autoUnpackEnabled && !reconciledIds.has(p.id));
    tx.update(stockRef, {
      ...stockPatch(state, presentations, Number(product.minStock ?? 0), product.active === true),
      requiresReconciliation,
      reconciledPresentationIds: requiresReconciliation ? [...reconciledIds] : []
    });
    const presentationFields = movementPresentation(presentation, newQty - previous);
    tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
      tenantId: profile.tenantId,
      type: adjustmentType === 'reclasificar' ? 'conversion' : adjustmentType,
      productId,
      productName: String(stockSnap.data()?.productName ?? ''),
      ...presentationFields,
      qty: adjustmentType === 'reclasificar' ? 0 : presentationFields.baseQty,
      baseQty: adjustmentType === 'reclasificar' ? 0 : presentationFields.baseQty,
      fromLocationId: null,
      toLocationId: targetId,
      reason: adjustmentType === 'reclasificar' ? `Reclasificación sin cambiar el total: ${reason}` : reason,
      refId: requestId,
      userId: profile.uid,
      userName: profile.displayName,
      userStoreId: null,
      createdAt: now
    });
    completeOperation(tx, profile, 'adjustment', operation, { ok: true });
  });
  return { ok: true };
});

export const createInventoryTransfer = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const fromId = documentId(data.fromLocationId, 'Origen');
  const toId = documentId(data.toLocationId, 'Destino');
  const fromType = locationType(data.fromLocationType, 'El origen');
  const toType = locationType(data.toLocationType, 'El destino');
  const note = shortText(data.note, 250) || null;
  const items = quantityItems(data.items, 'qtySent');
  if (!fromId || !toId || fromId === toId) {
    throw new HttpsError('invalid-argument', 'El origen y destino deben ser distintos.');
  }
  const transferRef = tenantCollection(profile.tenantId, 'transfers').doc();
  const code = `TR-${transferRef.id.slice(0, 8).toUpperCase()}`;

  const requestId = operationId(data.requestId);
  return db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'transfer', requestId, { fromId, toId, fromType, toType, note, items });
    if (operation.result) return operation.result;
    const fromRef = locationRef(profile.tenantId, fromType, fromId);
    const toRef = locationRef(profile.tenantId, toType, toId);
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${item.productId}_${fromId}`));
    const productRefs = items.map((item) => tenantDoc(profile.tenantId, 'products', item.productId));
    const snapshots = await Promise.all([
      tx.get(fromRef),
      tx.get(toRef),
      ...stockRefs.map((ref) => tx.get(ref)),
      ...productRefs.map((ref) => tx.get(ref))
    ]);
    if (!snapshots[0].exists || !snapshots[1].exists || snapshots[0].data()?.active === false || snapshots[1].data()?.active === false) {
      throw new HttpsError('not-found', 'El origen o destino no existe.');
    }
    const stockSnaps = snapshots.slice(2, 2 + items.length);
    const productSnaps = snapshots.slice(2 + items.length);
    const now = Date.now();
    const states = new Map<string, StockState>();
    const transferItems = items.map((item, index) => {
      const stockSnap = stockSnaps[index];
      const productSnap = productSnaps[index];
      if (!stockSnap.exists || !productSnap.exists) {
        throw new HttpsError('failed-precondition', 'Uno de los productos no tiene stock o catálogo.');
      }
      const product = productSnap.data()!;
      const presentation = selectedPresentation(product, item.presentationId);
      const state = states.get(item.productId) ?? readStockState(stockSnap.data()!, parsePresentations(product), String(product.unit ?? 'UN'));
      states.set(item.productId, state);
      const current = selectedAvailable(state, presentation);
      if (current < item.quantity) {
        throw new HttpsError('failed-precondition', `Stock insuficiente de ${String(stockSnap.data()?.productName ?? 'producto')}.`);
      }
      changeSelectedStock(state, presentation, -item.quantity);
      const presentationFields = movementPresentation(presentation, -item.quantity);
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId: item.productId,
        productName: String(stockSnap.data()?.productName ?? ''),
        qty: presentationFields.baseQty,
        ...presentationFields,
        fromLocationId: fromId,
        toLocationId: null,
        reason: null,
        refId: code,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: null,
        createdAt: now
      });
      return {
        productId: item.productId,
        name: String(stockSnap.data()?.productName ?? ''),
        qtySent: item.quantity,
        qtyReceived: 0,
        presentationId: presentation?.id ?? null,
        presentationLabel: presentation ? presentationLabel(presentation) : 'Unidad base',
        factor: presentation?.factor ?? 1,
        baseEquivalent: round3(item.quantity * (presentation?.factor ?? 1))
      };
    });
    for (const [productId, state] of states) {
      const index = items.findIndex((item) => item.productId === productId);
      tx.update(stockSnaps[index].ref, stockPatch(state, parsePresentations(productSnaps[index].data()!), Number(productSnaps[index].data()!.minStock ?? 0)));
    }
    tx.set(transferRef, {
      tenantId: profile.tenantId,
      code,
      fromLocationId: fromId,
      fromLocationName: String(snapshots[0].data()?.name ?? ''),
      fromLocationType: fromType,
      toLocationId: toId,
      toLocationName: String(snapshots[1].data()?.name ?? ''),
      toLocationType: toType,
      requestId,
      productIds: [...states.keys()],
      status: 'pendiente',
      items: transferItems,
      createdBy: profile.uid,
      createdByName: profile.displayName,
      createdAt: now,
      note
    });
    const result = { id: transferRef.id, code };
    completeOperation(tx, profile, 'transfer', operation, result);
    return result;
  });
});

export const cancelInventoryTransfer = onCall(appCheckOptions, async (request) => {
  const profile = await requireAdmin(request);
  const transferId = shortText(request.data?.transferId, 128);
  if (!transferId) throw new HttpsError('invalid-argument', 'Transferencia inválida.');
  const transferRef = tenantDoc(profile.tenantId, 'transfers', transferId);

  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const transferSnap = await tx.get(transferRef);
    if (!transferSnap.exists) throw new HttpsError('not-found', 'La transferencia no existe.');
    const transfer = transferSnap.data()!;
    if (!['pendiente', 'en_transito'].includes(String(transfer.status))) {
      throw new HttpsError('failed-precondition', 'La transferencia ya fue recibida o cancelada.');
    }
    const items = Array.isArray(transfer.items) ? transfer.items as Record<string, unknown>[] : [];
    if (items.length === 0 || items.length > MAX_ITEMS) {
      throw new HttpsError('failed-precondition', 'La transferencia no contiene productos válidos.');
    }
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${String(item.productId)}_${String(transfer.fromLocationId)}`));
    const productRefs = items.map((item) => tenantDoc(profile.tenantId, 'products', String(item.productId)));
    const snapshots = await Promise.all([
      ...stockRefs.map((ref) => tx.get(ref)),
      ...productRefs.map((ref) => tx.get(ref))
    ]);
    const stockSnaps = snapshots.slice(0, items.length);
    const productSnaps = snapshots.slice(items.length);
    const now = Date.now();
    const states = new Map<string, StockState>();
    items.forEach((item, index) => {
      const productId = String(item.productId);
      const returned = round3(Number(item.qtySent ?? 0) - Number(item.qtyReceived ?? 0));
      if (!Number.isFinite(returned) || returned < 0 || !stockSnaps[index].exists || !productSnaps[index].exists) {
        throw new HttpsError('failed-precondition', 'La transferencia contiene cantidades inconsistentes.');
      }
      if (returned === 0) return;
      const stockSnap = stockSnaps[index];
      const product = productSnaps[index].data()!;
      const presentation = selectedPresentation(product, shortText(item.presentationId, 80) || null);
      if (presentation && presentation.factor !== Number(item.factor)) throw new HttpsError('failed-precondition', 'El factor cambió desde el envío.');
      const state = states.get(productId) ?? readStockState(stockSnap.data()!, parsePresentations(product), String(product.unit ?? 'UN'));
      states.set(productId, state);
      changeSelectedStock(state, presentation, returned);
      const presentationFields = movementPresentation(presentation, returned);
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId,
        productName: String(item.name ?? stockSnap.data()?.productName ?? ''),
        qty: presentationFields.baseQty,
        ...presentationFields,
        fromLocationId: null,
        toLocationId: String(transfer.fromLocationId),
        reason: 'cancelación de transferencia',
        refId: String(transfer.code),
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: null,
        createdAt: now
      });
    });
    for (const [productId, state] of states) {
      const index = items.findIndex((item) => String(item.productId) === productId);
      tx.update(stockSnaps[index].ref, stockPatch(state, parsePresentations(productSnaps[index].data()!), Number(productSnaps[index].data()!.minStock ?? 0)));
    }
    tx.update(transferRef, {
      status: 'cancelado',
      cancelledBy: profile.uid,
      cancelledByName: profile.displayName,
      cancelledAt: now
    });
  });
  return { ok: true };
});

export const attendReplenishmentRequest = onCall(appCheckOptions, async (request) => {
  const profile = await requireReplenishmentApprover(request);
  const requestId = shortText(request.data?.requestId, 128);
  const warehouseId = shortText(request.data?.warehouseId, 128);
  if (!requestId || !warehouseId) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const replenishmentRef = tenantDoc(profile.tenantId, 'replenishment_requests', requestId);
  const transferRef = tenantCollection(profile.tenantId, 'transfers').doc();
  const code = `RP-${transferRef.id.slice(0, 8).toUpperCase()}`;

  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const requestSnap = await tx.get(replenishmentRef);
    if (!requestSnap.exists || requestSnap.data()?.status !== 'pendiente') {
      throw new HttpsError('failed-precondition', 'La solicitud ya fue atendida o no existe.');
    }
    const replenishment = requestSnap.data()!;
    const items = quantityItems(
      (replenishment.items as Record<string, unknown>[]).map((item) => ({
        productId: item.productId,
        presentationId: item.presentationId,
        qtySent: item.requestedQty
      })),
      'qtySent'
    );
    const warehouseRef = tenantDoc(profile.tenantId, 'warehouses', warehouseId);
    const storeRef = tenantDoc(profile.tenantId, 'stores', String(replenishment.storeId));
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${item.productId}_${warehouseId}`));
    const productRefs = items.map((item) => tenantDoc(profile.tenantId, 'products', item.productId));
    const snapshots = await Promise.all([
      tx.get(warehouseRef),
      tx.get(storeRef),
      ...stockRefs.map((ref) => tx.get(ref)),
      ...productRefs.map((ref) => tx.get(ref))
    ]);
    if (!snapshots[0].exists || snapshots[0].data()?.isCentral !== true || !snapshots[1].exists || snapshots[0].data()?.active === false || snapshots[1].data()?.active === false) {
      throw new HttpsError('failed-precondition', 'El almacén central o la tienda no son válidos.');
    }
    const stockSnaps = snapshots.slice(2, 2 + items.length);
    const productSnaps = snapshots.slice(2 + items.length);
    const now = Date.now();
    const states = new Map<string, StockState>();
    const transferItems = items.map((item, index) => {
      const stockSnap = stockSnaps[index];
      const productSnap = productSnaps[index];
      if (!stockSnap.exists || !productSnap.exists) {
        throw new HttpsError('failed-precondition', 'Uno de los productos no tiene stock o catálogo.');
      }
      const product = productSnap.data()!;
      const presentation = selectedPresentation(product, item.presentationId);
      const state = states.get(item.productId) ?? readStockState(stockSnap.data()!, parsePresentations(product), String(product.unit ?? 'UN'));
      states.set(item.productId, state);
      const current = selectedAvailable(state, presentation);
      if (current < item.quantity) {
        throw new HttpsError('failed-precondition', `Stock insuficiente de ${String(stockSnap.data()?.productName ?? 'producto')}.`);
      }
      changeSelectedStock(state, presentation, -item.quantity);
      const presentationFields = movementPresentation(presentation, -item.quantity);
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId: item.productId,
        productName: String(stockSnap.data()?.productName ?? ''),
        qty: presentationFields.baseQty,
        ...presentationFields,
        fromLocationId: warehouseId,
        toLocationId: null,
        reason: 'reposición atendida',
        refId: code,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: null,
        createdAt: now
      });
      return {
        productId: item.productId,
        name: String(stockSnap.data()?.productName ?? ''),
        qtySent: item.quantity,
        qtyReceived: 0,
        presentationId: presentation?.id ?? null,
        presentationLabel: presentation ? presentationLabel(presentation) : 'Unidad base',
        factor: presentation?.factor ?? 1,
        baseEquivalent: round3(item.quantity * (presentation?.factor ?? 1))
      };
    });
    for (const [productId, state] of states) {
      const index = items.findIndex((item) => item.productId === productId);
      tx.update(stockSnaps[index].ref, stockPatch(state, parsePresentations(productSnaps[index].data()!), Number(productSnaps[index].data()!.minStock ?? 0)));
    }
    tx.set(transferRef, {
      tenantId: profile.tenantId,
      code,
      fromLocationId: warehouseId,
      fromLocationName: String(snapshots[0].data()?.name ?? ''),
      fromLocationType: 'warehouse',
      toLocationId: String(replenishment.storeId),
      toLocationName: String(snapshots[1].data()?.name ?? ''),
      toLocationType: 'store',
      status: 'pendiente',
      items: transferItems,
      createdBy: profile.uid,
      createdByName: profile.displayName,
      createdAt: now,
      note: `Reposición solicitada por ${String(replenishment.createdByName ?? '')}`
    });
    tx.update(replenishmentRef, {
      status: 'atendida',
      attendedBy: profile.uid,
      attendedByName: profile.displayName,
      attendedAt: now,
      transferId: transferRef.id
    });
  });
  return { id: transferRef.id, code };
});

export const rejectReplenishmentRequest = onCall(appCheckOptions, async (request) => {
  const profile = await requireReplenishmentApprover(request);
  const requestId = shortText(request.data?.requestId, 128);
  if (!requestId) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const ref = tenantDoc(profile.tenantId, 'replenishment_requests', requestId);
  await db.runTransaction(async (tx) => {
    await assertCurrentProfile(tx, profile);
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.status !== 'pendiente') {
      throw new HttpsError('failed-precondition', 'La solicitud ya fue procesada o no existe.');
    }
    tx.update(ref, {
      status: 'rechazada',
      rejectedBy: profile.uid,
      rejectedByName: profile.displayName,
      rejectedAt: Date.now()
    });
  });
  return { ok: true };
});
