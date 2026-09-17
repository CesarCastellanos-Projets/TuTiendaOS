import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { requireAdmin } from './authz';
import { tenantCollection, tenantDoc } from './tenant';

type LocationType = 'store' | 'warehouse';

interface QuantityItem {
  productId: string;
  quantity: number;
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
    const item = raw as Record<string, unknown>;
    const productId = shortText(item.productId, 128);
    const quantity = Number(item[quantityField]);
    if (!productId || seen.has(productId) || !Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', 'La lista contiene productos o cantidades inválidas.');
    }
    seen.add(productId);
    return { productId, quantity };
  });
}

function locationRef(tenantId: string, type: LocationType, id: string) {
  return tenantDoc(tenantId, type === 'store' ? 'stores' : 'warehouses', id);
}

export const recordStockIngress = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const targetId = shortText(data.locationId, 128);
  const targetType = locationType(data.locationType, 'La ubicación');
  const items = quantityItems(data.items, 'qty');
  if (!targetId) throw new HttpsError('invalid-argument', 'Falta la ubicación de destino.');

  await db.runTransaction(async (tx) => {
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
    if (!targetSnap.exists) throw new HttpsError('not-found', 'La ubicación no existe.');
    const now = Date.now();

    items.forEach((item, index) => {
      const productSnap = productSnaps[index];
      const stockSnap = stockSnaps[index];
      if (!productSnap.exists || productSnap.data()?.active !== true) {
        throw new HttpsError('failed-precondition', 'Uno de los productos no existe o está inactivo.');
      }
      const product = productSnap.data()!;
      if (stockSnap.exists) {
        tx.update(stockSnap.ref, {
          quantity: Number(stockSnap.data()?.quantity ?? 0) + item.quantity,
          updatedAt: now
        });
      } else {
        tx.set(stockSnap.ref, {
          tenantId: profile.tenantId,
          productId: item.productId,
          productName: String(product.name),
          barcode: product.barcode ?? null,
          salePrice: Number(product.salePrice ?? 0),
          locationType: targetType,
          locationId: targetId,
          locationName: String(targetSnap.data()?.name ?? ''),
          quantity: item.quantity,
          unit: product.unit ?? null,
          updatedAt: now
        });
      }
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'ingreso',
        productId: item.productId,
        productName: String(product.name),
        qty: item.quantity,
        fromLocationId: null,
        toLocationId: targetId,
        reason: null,
        refId: null,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: null,
        createdAt: now
      });
    });
  });
  return { ok: true };
});

export const adjustInventory = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const targetId = shortText(data.locationId, 128);
  const productId = shortText(data.productId, 128);
  const reason = shortText(data.reason, 250);
  const adjustmentType = data.type;
  const newQty = Number(data.newQty);
  if (!targetId || !productId || !reason || !['ajuste', 'merma'].includes(String(adjustmentType))) {
    throw new HttpsError('invalid-argument', 'Faltan datos del ajuste.');
  }
  if (!Number.isFinite(newQty) || newQty < 0) {
    throw new HttpsError('invalid-argument', 'La cantidad final no es válida.');
  }

  await db.runTransaction(async (tx) => {
    const stockRef = tenantDoc(profile.tenantId, 'product_stocks', `${productId}_${targetId}`);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) throw new HttpsError('not-found', 'El producto no tiene stock en esa ubicación.');
    const previous = Number(stockSnap.data()?.quantity ?? 0);
    const now = Date.now();
    tx.update(stockRef, { quantity: newQty, updatedAt: now });
    tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
      tenantId: profile.tenantId,
      type: adjustmentType,
      productId,
      productName: String(stockSnap.data()?.productName ?? ''),
      qty: newQty - previous,
      fromLocationId: null,
      toLocationId: targetId,
      reason,
      refId: null,
      userId: profile.uid,
      userName: profile.displayName,
      userStoreId: null,
      createdAt: now
    });
  });
  return { ok: true };
});

export const createInventoryTransfer = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const fromId = shortText(data.fromLocationId, 128);
  const toId = shortText(data.toLocationId, 128);
  const fromType = locationType(data.fromLocationType, 'El origen');
  const toType = locationType(data.toLocationType, 'El destino');
  const note = shortText(data.note, 250) || null;
  const items = quantityItems(data.items, 'qtySent');
  if (!fromId || !toId || fromId === toId) {
    throw new HttpsError('invalid-argument', 'El origen y destino deben ser distintos.');
  }
  const transferRef = tenantCollection(profile.tenantId, 'transfers').doc();
  const code = `TR-${transferRef.id.slice(0, 8).toUpperCase()}`;

  await db.runTransaction(async (tx) => {
    const fromRef = locationRef(profile.tenantId, fromType, fromId);
    const toRef = locationRef(profile.tenantId, toType, toId);
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${item.productId}_${fromId}`));
    const snapshots = await Promise.all([
      tx.get(fromRef),
      tx.get(toRef),
      ...stockRefs.map((ref) => tx.get(ref))
    ]);
    if (!snapshots[0].exists || !snapshots[1].exists) {
      throw new HttpsError('not-found', 'El origen o destino no existe.');
    }
    const stockSnaps = snapshots.slice(2);
    const now = Date.now();
    const transferItems = items.map((item, index) => {
      const stockSnap = stockSnaps[index];
      const current = Number(stockSnap.data()?.quantity ?? 0);
      if (!stockSnap.exists || current < item.quantity) {
        throw new HttpsError('failed-precondition', `Stock insuficiente de ${String(stockSnap.data()?.productName ?? 'producto')}.`);
      }
      tx.update(stockSnap.ref, { quantity: current - item.quantity, updatedAt: now });
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId: item.productId,
        productName: String(stockSnap.data()?.productName ?? ''),
        qty: -item.quantity,
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
        qtyReceived: 0
      };
    });
    tx.set(transferRef, {
      tenantId: profile.tenantId,
      code,
      fromLocationId: fromId,
      fromLocationName: String(snapshots[0].data()?.name ?? ''),
      fromLocationType: fromType,
      toLocationId: toId,
      toLocationName: String(snapshots[1].data()?.name ?? ''),
      toLocationType: toType,
      status: 'pendiente',
      items: transferItems,
      createdBy: profile.uid,
      createdByName: profile.displayName,
      createdAt: now,
      note
    });
  });
  return { id: transferRef.id, code };
});

export const cancelInventoryTransfer = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const transferId = shortText(request.data?.transferId, 128);
  if (!transferId) throw new HttpsError('invalid-argument', 'Transferencia inválida.');
  const transferRef = tenantDoc(profile.tenantId, 'transfers', transferId);

  await db.runTransaction(async (tx) => {
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
    const stockSnaps = await Promise.all(stockRefs.map((ref) => tx.get(ref)));
    const now = Date.now();
    items.forEach((item, index) => {
      const returned = Number(item.qtySent ?? 0) - Number(item.qtyReceived ?? 0);
      if (!Number.isFinite(returned) || returned < 0 || !stockSnaps[index].exists) {
        throw new HttpsError('failed-precondition', 'La transferencia contiene cantidades inconsistentes.');
      }
      if (returned === 0) return;
      const stockSnap = stockSnaps[index];
      tx.update(stockSnap.ref, {
        quantity: Number(stockSnap.data()?.quantity ?? 0) + returned,
        updatedAt: now
      });
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId: String(item.productId),
        productName: String(item.name ?? stockSnap.data()?.productName ?? ''),
        qty: returned,
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
    tx.update(transferRef, {
      status: 'cancelado',
      cancelledBy: profile.uid,
      cancelledByName: profile.displayName,
      cancelledAt: now
    });
  });
  return { ok: true };
});

export const attendReplenishmentRequest = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const requestId = shortText(request.data?.requestId, 128);
  const warehouseId = shortText(request.data?.warehouseId, 128);
  if (!requestId || !warehouseId) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const replenishmentRef = tenantDoc(profile.tenantId, 'replenishment_requests', requestId);
  const transferRef = tenantCollection(profile.tenantId, 'transfers').doc();
  const code = `RP-${transferRef.id.slice(0, 8).toUpperCase()}`;

  await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(replenishmentRef);
    if (!requestSnap.exists || requestSnap.data()?.status !== 'pendiente') {
      throw new HttpsError('failed-precondition', 'La solicitud ya fue atendida o no existe.');
    }
    const replenishment = requestSnap.data()!;
    const items = quantityItems(
      (replenishment.items as Record<string, unknown>[]).map((item) => ({
        productId: item.productId,
        qtySent: item.requestedQty
      })),
      'qtySent'
    );
    const warehouseRef = tenantDoc(profile.tenantId, 'warehouses', warehouseId);
    const storeRef = tenantDoc(profile.tenantId, 'stores', String(replenishment.storeId));
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${item.productId}_${warehouseId}`));
    const snapshots = await Promise.all([
      tx.get(warehouseRef),
      tx.get(storeRef),
      ...stockRefs.map((ref) => tx.get(ref))
    ]);
    if (!snapshots[0].exists || snapshots[0].data()?.isCentral !== true || !snapshots[1].exists) {
      throw new HttpsError('failed-precondition', 'El almacén central o la tienda no son válidos.');
    }
    const stockSnaps = snapshots.slice(2);
    const now = Date.now();
    const transferItems = items.map((item, index) => {
      const stockSnap = stockSnaps[index];
      const current = Number(stockSnap.data()?.quantity ?? 0);
      if (!stockSnap.exists || current < item.quantity) {
        throw new HttpsError('failed-precondition', `Stock insuficiente de ${String(stockSnap.data()?.productName ?? 'producto')}.`);
      }
      tx.update(stockSnap.ref, { quantity: current - item.quantity, updatedAt: now });
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'transferencia',
        productId: item.productId,
        productName: String(stockSnap.data()?.productName ?? ''),
        qty: -item.quantity,
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
        qtyReceived: 0
      };
    });
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
      attendedAt: now,
      transferId: transferRef.id
    });
  });
  return { id: transferRef.id, code };
});

export const rejectReplenishmentRequest = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const requestId = shortText(request.data?.requestId, 128);
  if (!requestId) throw new HttpsError('invalid-argument', 'Solicitud inválida.');
  const ref = tenantDoc(profile.tenantId, 'replenishment_requests', requestId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data()?.status !== 'pendiente') {
      throw new HttpsError('failed-precondition', 'La solicitud ya fue procesada o no existe.');
    }
    tx.update(ref, {
      status: 'rechazada',
      rejectedBy: profile.uid,
      rejectedAt: Date.now()
    });
  });
  return { ok: true };
});
