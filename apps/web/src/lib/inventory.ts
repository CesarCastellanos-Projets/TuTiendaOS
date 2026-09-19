import { limit, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { tenantCollection } from './tenant-firestore';

export async function receiveTransferItems(params: {
  transferId: string;
  quantities: Record<string, number>;
}): Promise<void> {
  const callable = httpsCallable<typeof params, { ok: boolean }>(functions, 'receiveTransfer');
  await callable(params);
}

export async function ingressStock(params: {
  locationId: string;
  locationType: 'store' | 'warehouse';
  items: { productId: string; presentationId: string | null; qty: number }[];
}): Promise<void> {
  const callable = httpsCallable<typeof params, { ok: boolean }>(functions, 'recordStockIngress');
  await callable(params);
}

export async function adjustStock(params: {
  locationId: string;
  productId: string;
  presentationId: string | null;
  newQty: number;
  reason: string;
  type: 'ajuste' | 'merma';
}): Promise<void> {
  const callable = httpsCallable<typeof params, { ok: boolean }>(functions, 'adjustInventory');
  await callable(params);
}

export async function createTransfer(params: {
  fromLocationId: string;
  fromLocationType: 'store' | 'warehouse';
  toLocationId: string;
  toLocationType: 'store' | 'warehouse';
  items: { productId: string; presentationId: string | null; qtySent: number }[];
  note?: string | null;
}): Promise<{ id: string; code: string }> {
  const callable = httpsCallable<typeof params, { id: string; code: string }>(
    functions,
    'createInventoryTransfer'
  );
  return (await callable(params)).data;
}

export async function cancelTransfer(transferId: string): Promise<void> {
  const callable = httpsCallable<{ transferId: string }, { ok: boolean }>(
    functions,
    'cancelInventoryTransfer'
  );
  await callable({ transferId });
}

export async function attendReplenishment(params: {
  requestId: string;
  warehouseId: string;
}): Promise<{ id: string; code: string }> {
  const callable = httpsCallable<typeof params, { id: string; code: string }>(
    functions,
    'attendReplenishmentRequest'
  );
  return (await callable(params)).data;
}

export async function rejectReplenishment(requestId: string): Promise<void> {
  const callable = httpsCallable<{ requestId: string }, { ok: boolean }>(
    functions,
    'rejectReplenishmentRequest'
  );
  await callable({ requestId });
}

export function stocksByLocation(locationId: string, max = 300) {
  return query(
    tenantCollection('product_stocks'),
    where('locationId', '==', locationId),
    limit(max)
  );
}
