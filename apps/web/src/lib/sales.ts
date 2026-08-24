import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  runTransaction
} from 'firebase/firestore';
import { db } from './firebase';
import { stockId } from './inventory';
import type { CompanyConfig, ProductStock, Sale, SaleItem, UserProfile } from '../types';
import { nowMs, pad } from './utils';

interface SaleInput {
  company: CompanyConfig;
  storeId: string;
  storeName: string;
  profile: UserProfile;
  uid: string;
  clientDoc: Sale['clientDoc'];
  items: SaleItem[];
  paymentMethod: Sale['paymentMethod'];
  paidAmount: number;
  consolidated: boolean;
  cashSessionId?: string;
  type: 'boleta' | 'factura';
}

/** Correlativo transaccional por serie. Los contadores se crean en el seed. */
export async function createSale(input: SaleInput): Promise<Sale> {
  const serie = input.type === 'factura' ? input.company.serieFactura : input.company.serieBoleta;
  const igvRate = input.company.igvRate || 0.18;

  const total = round2(input.items.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  const subtotal = round2(total / (1 + igvRate));
  const igv = round2(total - subtotal);
  const finalItems = input.items.map((i) => ({
    ...i,
    total: round2(i.unitPrice * i.qty)
  }));

  let correlativo = 0;
  await runTransaction(db, async (tx) => {
    const counterRef = doc(db, 'counters', serie);
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists()) throw new Error(`Serie ${serie} no inicializada`);
    correlativo = (counterSnap.data().current as number) + 1;
    tx.update(counterRef, { current: correlativo });

    const refs = finalItems.map((i) =>
      doc(db, 'product_stocks', stockId(i.productId, input.storeId))
    );
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    snaps.forEach((snap, i) => {
      if (!snap.exists()) throw new Error(`Sin stock registrado: ${finalItems[i].name}`);
      const q = snap.data().quantity as number;
      if (q < finalItems[i].qty) {
        throw new Error(`Stock insuficiente de ${finalItems[i].name} (quedan ${q})`);
      }
      tx.update(refs[i], { quantity: q - finalItems[i].qty, updatedAt: nowMs() });
    });

    const saleDoc: Omit<Sale, 'createdAt'> & { createdAt: number } = {
      code: `${serie}-${pad(correlativo, 6)}`,
      serie,
      correlativo,
      type: input.type,
      storeId: input.storeId,
      storeName: input.storeName,
      userId: input.uid,
      userName: input.profile.displayName,
      clientDoc: input.clientDoc,
      items: finalItems,
      subtotal,
      igv,
      total,
      paymentMethod: input.paymentMethod,
      paidAmount: input.paidAmount,
      changeAmount: round2(Math.max(0, input.paidAmount - total)),
      consolidated: input.consolidated,
      sunatStatus: 'no_enviado',
      status: 'activa',
      cashSessionId: input.cashSessionId ?? null,
      anulationRequest: null,
      createdAt: Date.now()
    };
    tx.set(doc(collection(db, 'sales')), saleDoc);
  });

  return {
    code: `${serie}-${pad(correlativo, 6)}`,
    serie,
    correlativo,
    type: input.type,
    storeId: input.storeId,
    storeName: input.storeName,
    userId: input.uid,
    userName: input.profile.displayName,
    clientDoc: input.clientDoc,
    items: finalItems,
    subtotal,
    igv,
    total,
    paymentMethod: input.paymentMethod,
    paidAmount: input.paidAmount,
    changeAmount: round2(Math.max(0, input.paidAmount - total)),
    consolidated: input.consolidated,
    sunatStatus: 'no_enviado',
    status: 'activa',
    cashSessionId: input.cashSessionId,
    anulationRequest: null,
    createdAt: Date.now()
  };
}

export function paginatedSales(storeId: string, pageSize = 25) {
  return query(
    collection(db, 'sales'),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    limit(pageSize)
  );
}

export function nextSalesPage(storeId: string, afterCreatedAt: number, pageSize = 25) {
  return query(
    collection(db, 'sales'),
    where('storeId', '==', storeId),
    orderBy('createdAt', 'desc'),
    startAfter(afterCreatedAt),
    limit(pageSize)
  );
}

export async function getProductByBarcode(barcode: string): Promise<ProductStock | null> {
  const q = query(collection(db, 'product_stocks'), where('barcode', '==', barcode), limit(5));
  const snap = await getDocs(q);
  return snap.empty ? null : (snap.docs[0].data() as ProductStock);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
