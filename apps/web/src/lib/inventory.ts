import { limit, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { useAuth } from './auth';
import { durableCommand } from './durable-command';
import { tenantCollection } from './tenant-firestore';

export async function receiveTransferItems(params: {
  transferId: string;
  quantities: Record<string, number>;
}): Promise<void> {
  const callable = httpsCallable<typeof params & { storeId?: string | null }, { ok: boolean }>(functions, 'receiveTransfer');
  await callable({ ...params, storeId: useAuth.getState().profile?.storeId });
}

export async function ingressStock(params: {
  requestId?: string;
  note?: string;
  locationId: string;
  locationType: 'store' | 'warehouse';
  items: { productId: string; presentationId: string | null; qty: number }[];
}): Promise<void> {
  await durableCommand('recordStockIngress', params);
}

export async function adjustStock(params: {
  locationId: string;
  productId: string;
  presentationId: string | null;
  newQty: number;
  reason: string;
  type: 'ajuste' | 'merma' | 'reclasificar';
}): Promise<void> {
  await durableCommand('adjustInventory', params);
}

export async function createTransfer(params: {
  fromLocationId: string;
  fromLocationType: 'store' | 'warehouse';
  toLocationId: string;
  toLocationType: 'store' | 'warehouse';
  items: { productId: string; presentationId: string | null; qtySent: number }[];
  note?: string | null;
}): Promise<{ id: string; code: string }> {
  return durableCommand('createInventoryTransfer', params);
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
