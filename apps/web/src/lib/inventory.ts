import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db as fs } from './firebase';
import type { ProductStock, StockMovement } from '../types';
import { nowMs } from './utils';

export function stockId(productId: string, locationId: string): string {
  return `${productId}_${locationId}`;
}

type PendingMovement = Omit<StockMovement, 'createdAt'>;

async function pushMovements(movements: PendingMovement[]): Promise<void> {
  if (movements.length === 0) return;
  const col = collection(fs, 'stock_movements');
  const batch = writeBatch(fs);
  for (const m of movements) {
    batch.set(doc(col), { ...m, createdAt: nowMs() });
  }
  await batch.commit();
}

/** Decrementa stock por una venta (transaccional; falla si no hay suficiente). */
export async function sellStock(params: {
  storeId: string;
  items: { productId: string; name: string; qty: number }[];
  uid: string;
  userName: string;
  refId?: string;
}): Promise<void> {
  const { storeId, items } = params;
  const pending: PendingMovement[] = [];
  await runTransaction(fs, async (tx) => {
    const refs = items.map((i) => doc(fs, 'product_stocks', stockId(i.productId, storeId)));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((snap, i) => {
      if (!snap.exists()) throw new Error(`Sin stock registrado: ${items[i].name}`);
      const q = snap.data().quantity as number;
      if (q < items[i].qty) throw new Error(`Stock insuficiente de ${items[i].name} (quedan ${q})`);
      tx.update(refs[i], { quantity: q - items[i].qty, updatedAt: nowMs() });
    });
    for (const item of items) {
      pending.push({
        type: 'venta',
        productId: item.productId,
        productName: item.name,
        qty: -item.qty,
        toLocationId: storeId,
        refId: params.refId ?? null,
        userId: params.uid,
        userName: params.userName,
        userStoreId: storeId
      });
    }
  });
  await pushMovements(pending);
}

/** Suma stock en la ubicación destino al recibir una transferencia. */
export async function receiveTransferItems(params: {
  toLocationId: string;
  locationName: string;
  items: { productId: string; name: string; barcode?: string; salePrice: number; qtyReceived: number }[];
  uid: string;
  userName: string;
  transferCode: string;
}): Promise<void> {
  const { toLocationId, items } = params;
  const pending: PendingMovement[] = [];
  await runTransaction(fs, async (tx) => {
    for (const item of items) {
      if (item.qtyReceived <= 0) continue;
      const ref = doc(fs, 'product_stocks', stockId(item.productId, toLocationId));
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, {
          productId: item.productId,
          productName: item.name,
          barcode: item.barcode ?? null,
          salePrice: item.salePrice,
          locationType: 'store',
          locationId: toLocationId,
          locationName: params.locationName,
          quantity: item.qtyReceived,
          updatedAt: nowMs()
        } satisfies ProductStock);
      } else {
        tx.update(ref, {
          quantity: (snap.data().quantity as number) + item.qtyReceived,
          updatedAt: nowMs()
        });
      }
      pending.push({
        type: 'recepcion',
        productId: item.productId,
        productName: item.name,
        qty: item.qtyReceived,
        toLocationId,
        refId: params.transferCode,
        userId: params.uid,
        userName: params.userName
      });
    }
  });
  await pushMovements(pending);
}

/** Ingreso de mercadería del Admin a un almacén o tienda. */
export async function ingressStock(params: {
  locationId: string;
  locationType: 'store' | 'warehouse';
  locationName: string;
  items: { product: { id: string; name: string; barcode?: string; salePrice: number }; qty: number }[];
  uid: string;
  userName: string;
}): Promise<void> {
  const batch = writeBatch(fs);
  for (const it of params.items) {
    const ref = doc(fs, 'product_stocks', stockId(it.product.id, params.locationId));
    const snap = await getDoc(ref);
    if (snap.exists()) {
      batch.update(ref, { quantity: increment(it.qty), updatedAt: nowMs() });
    } else {
      batch.set(ref, {
        productId: it.product.id,
        productName: it.product.name,
        barcode: it.product.barcode ?? null,
        salePrice: it.product.salePrice,
        locationType: params.locationType,
        locationId: params.locationId,
        locationName: params.locationName,
        quantity: it.qty,
        updatedAt: nowMs()
      } satisfies ProductStock);
    }
  }
  await batch.commit();
  await pushMovements(
    params.items.map((it) => ({
      type: 'ingreso' as const,
      productId: it.product.id,
      productName: it.product.name,
      qty: it.qty,
      fromLocationId: null,
      toLocationId: params.locationId,
      reason: null,
      refId: null,
      userId: params.uid,
      userName: params.userName,
      userStoreId: null
    }))
  );
}

/** Ajuste de inventario (merma, daño, conteo físico): fija cantidad absoluta. */
export async function adjustStock(params: {
  locationId: string;
  productId: string;
  productName: string;
  newQty: number;
  reason: string;
  type: 'ajuste' | 'merma';
  uid: string;
  userName: string;
}): Promise<void> {
  const ref = doc(fs, 'product_stocks', stockId(params.productId, params.locationId));
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('El producto no tiene stock en esa ubicación');
  const prev = snap.data().quantity as number;
  const delta = params.newQty - prev;
  await updateDoc(ref, { quantity: params.newQty, updatedAt: nowMs() });
  await pushMovements([
    {
      type: params.type,
      productId: params.productId,
      productName: params.productName,
      qty: delta,
      fromLocationId: null,
      toLocationId: params.locationId,
      reason: params.reason || null,
      refId: null,
      userId: params.uid,
      userName: params.userName,
      userStoreId: null
    }
  ]);
}

/** Descuenta del origen al crear la transferencia (la mercadería sale del almacén). */
export async function deductTransferOrigin(params: {
  fromLocationId: string;
  items: { productId: string; name: string; qtySent: number }[];
  uid: string;
  userName: string;
  transferCode: string;
}): Promise<void> {
  const pending: PendingMovement[] = [];
  await runTransaction(fs, async (tx) => {
    const refs = params.items.map((i) =>
      doc(fs, 'product_stocks', stockId(i.productId, params.fromLocationId))
    );
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((snap, i) => {
      const item = params.items[i];
      const current = snap.exists() ? (snap.data().quantity as number) : 0;
      if (current < item.qtySent) {
        throw new Error(`Stock insuficiente en origen para ${item.name} (hay ${current})`);
      }
      tx.update(refs[i], { quantity: current - item.qtySent, updatedAt: nowMs() });
    });
    for (const item of params.items) {
      pending.push({
        type: 'transferencia',
        productId: item.productId,
        productName: item.name,
        qty: -item.qtySent,
        fromLocationId: params.fromLocationId,
        toLocationId: null,
        reason: null,
        refId: params.transferCode,
        userId: params.uid,
        userName: params.userName,
        userStoreId: null
      });
    }
  });
  await pushMovements(pending);
}

/** Devuelve al origen lo no recibido cuando se cancela una transferencia. */
export async function restockCancelledTransfer(params: {
  fromLocationId: string;
  items: { productId: string; name: string; qtySent: number; qtyReceived: number }[];
  uid: string;
  userName: string;
  transferCode: string;
}): Promise<void> {
  const pendingItems = params.items.filter((i) => i.qtySent > i.qtyReceived);
  if (pendingItems.length === 0) return;
  const pending: PendingMovement[] = [];
  await runTransaction(fs, async (tx) => {
    for (const item of pendingItems) {
      const back = item.qtySent - item.qtyReceived;
      const ref = doc(fs, 'product_stocks', stockId(item.productId, params.fromLocationId));
      const snap = await tx.get(ref);
      if (snap.exists()) {
        tx.update(ref, { quantity: (snap.data().quantity as number) + back, updatedAt: nowMs() });
        pending.push({
          type: 'transferencia',
          productId: item.productId,
          productName: item.name,
          qty: back,
          fromLocationId: null,
          toLocationId: params.fromLocationId,
          reason: 'cancelación de transferencia',
          refId: params.transferCode,
          userId: params.uid,
          userName: params.userName,
          userStoreId: null
        });
      }
    }
  });
  await pushMovements(pending);
}

/** Consulta paginada de stock por ubicación (nada lee colecciones completas). */
export function stocksByLocation(locationId: string, max = 300) {
  return query(
    collection(fs, 'product_stocks'),
    where('locationId', '==', locationId),
    limit(max)
  );
}
