import {
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { tenantCollection } from './tenant-firestore';
import type { CompanyConfig, ProductStock, Sale, SaleItem, UserProfile } from '../types';

interface SaleInput {
  company: CompanyConfig;
  storeId: string;
  storeName: string;
  profile: UserProfile;
  uid: string;
  requestId: string;
  clientDoc: Sale['clientDoc'];
  items: SaleItem[];
  paymentMethod: Sale['paymentMethod'];
  bankName?: string | null;
  operationNumber?: string | null;
  paidAmount: number;
  consolidated: boolean;
  cashSessionId?: string;
  type: 'boleta' | 'factura' | 'nota';
}

export function pendingSaleKey(tenantId: string, uid: string, storeId: string): string {
  return `denzoz_pending_sale_v1_${tenantId}_${uid}_${storeId}`;
}

export function hasPendingSale(tenantId: string, uid: string, storeId: string): boolean {
  try { return localStorage.getItem(pendingSaleKey(tenantId, uid, storeId)) !== null; }
  catch { return false; }
}

function definitiveFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return ['functions/invalid-argument', 'functions/failed-precondition', 'functions/resource-exhausted'].includes(code);
}

export async function resumePendingSale(tenantId: string, uid: string, storeId: string): Promise<(Sale & { id: string }) | null> {
  const key = pendingSaleKey(tenantId, uid, storeId);
  const requestId = localStorage.getItem(key);
  if (!requestId) return null;
  try {
    const response = await httpsCallable<{ requestId: string }, CreateSaleResult | { cancelled: true }>(functions, 'resumeSaleRecord')({ requestId });
    localStorage.removeItem(key);
    return 'cancelled' in response.data ? null : { ...response.data.sale, id: response.data.id };
  } catch (error) {
    if (definitiveFailure(error)) localStorage.removeItem(key);
    throw error;
  }
}

interface CreateSaleResult {
  id: string;
  sale: Sale;
}

export async function createSale(input: SaleInput): Promise<Sale & { id: string }> {
  const key = pendingSaleKey(input.profile.tenantId, input.uid, input.storeId);
  if (localStorage.getItem(key)) throw new Error('Resuelve el cobro pendiente antes de iniciar otra venta.');
  const requestId = input.requestId;
  localStorage.setItem(key, requestId);
  const callable = httpsCallable<
    Omit<SaleInput, 'company' | 'profile' | 'uid' | 'storeName'> & { requestId: string },
    CreateSaleResult
  >(functions, 'createSaleRecord');
  try {
    const response = await callable({
    requestId,
    storeId: input.storeId,
    clientDoc: input.clientDoc,
    items: input.items,
    paymentMethod: input.paymentMethod,
    bankName: input.bankName,
    operationNumber: input.operationNumber,
    paidAmount: input.paidAmount,
    consolidated: input.consolidated,
    cashSessionId: input.cashSessionId,
    type: input.type
  });
    localStorage.removeItem(key);
    return { ...response.data.sale, id: response.data.id };
  } catch (error) {
    if (definitiveFailure(error)) localStorage.removeItem(key);
    throw error;
  }
}

export function paginatedSales(storeId: string, pageSize = 25) {
  return query(
    tenantCollection('sales'),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(pageSize)
  );
}

export function nextSalesPage(storeId: string, afterCreatedAt: number, pageSize = 25) {
  return query(
    tenantCollection('sales'),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    startAfter(afterCreatedAt),
    limit(pageSize)
  );
}

export async function getProductByBarcode(barcode: string): Promise<ProductStock | null> {
  const stockQuery = query(tenantCollection('product_stocks'), where('barcode', '==', barcode), limit(5));
  const snapshot = await getDocs(stockQuery);
  return snapshot.empty ? null : (snapshot.docs[0].data() as ProductStock);
}
