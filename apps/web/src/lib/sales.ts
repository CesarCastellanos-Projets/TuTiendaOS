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

interface CreateSaleResult {
  id: string;
  sale: Sale;
}

export async function createSale(input: SaleInput): Promise<Sale & { id: string }> {
  const callable = httpsCallable<
    Omit<SaleInput, 'company' | 'profile' | 'uid' | 'storeName'>,
    CreateSaleResult
  >(functions, 'createSaleRecord');
  const response = await callable({
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
  return { ...response.data.sale, id: response.data.id };
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
