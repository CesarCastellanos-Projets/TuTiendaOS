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
  bankName?: string | null;
  operationNumber?: string | null;
  paidAmount: number;
  consolidated: boolean;
  cashSessionId?: string;
  type: 'boleta' | 'factura' | 'nota';
}

/** Correlativo transaccional por serie. Los contadores se crean en el seed. */
export async function createSale(input: SaleInput): Promise<Sale> {
  const serie =
    input.type === 'factura'
      ? input.company.serieFactura
      : input.type === 'nota'
      ? (input.company.serieNota || 'NV01')
      : input.company.serieBoleta;
  const igvRate = input.company.igvRate || 0.18;

  const total = round2(input.items.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  const subtotal = round2(total / (1 + igvRate));
  const igv = round2(total - subtotal);
  const finalItems: SaleItem[] = input.items.map((i) => {
    const item: SaleItem = {
      productId: i.productId,
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      total: round2(i.unitPrice * i.qty),
      factor: i.factor || 1
    };
    if (i.presentationUnit) item.presentationUnit = i.presentationUnit;
    if (i.barcode) item.barcode = i.barcode;
    return item;
  });

  let correlativo = 0;
  await runTransaction(db, async (tx) => {
    // 1. LECTURAS (Todas antes de cualquier escritura)
    const counterRef = doc(db, 'counters', serie);
    const counterSnap = await tx.get(counterRef);
    const counterExists = counterSnap.exists();

    const refs = finalItems.map((i) =>
      doc(db, 'product_stocks', stockId(i.productId, input.storeId))
    );
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));

    // 2. VALIDACIONES
    correlativo = counterExists ? ((counterSnap.data()?.current as number ?? 0) + 1) : 1;
    snaps.forEach((snap, i) => {
      if (!snap.exists()) throw new Error(`Sin stock registrado: ${finalItems[i].name}`);
      const data = snap.data();
      const q = data ? (data.quantity as number) : 0;
      const baseUnitsNeeded = finalItems[i].qty * (finalItems[i].factor || 1);
      if (q < baseUnitsNeeded) {
        throw new Error(`Stock insuficiente de ${finalItems[i].name} (quedan ${q} unidades base, requiere ${baseUnitsNeeded})`);
      }
    });

    // 3. ESCRITURAS
    if (counterExists) {
      tx.update(counterRef, { current: correlativo });
    } else {
      tx.set(counterRef, { current: correlativo });
    }

    snaps.forEach((snap, i) => {
      const data = snap.data();
      const q = data ? (data.quantity as number) : 0;
      const baseUnitsNeeded = finalItems[i].qty * (finalItems[i].factor || 1);
      tx.update(refs[i], { quantity: q - baseUnitsNeeded, updatedAt: nowMs() });
    });

    const rawSaleDoc: Omit<Sale, 'createdAt'> & { createdAt: number } = {
      code: `${serie}-${pad(correlativo, 6)}`,
      serie,
      correlativo,
      type: input.type,
      storeId: input.storeId,
      storeName: input.storeName,
      userId: input.uid,
      userName: input.profile.displayName,
      clientDoc: {
        tipo: input.clientDoc.tipo || '-',
        numero: input.clientDoc.numero || '',
        nombre: input.clientDoc.nombre || ''
      },
      items: finalItems,
      subtotal,
      igv,
      total,
      paymentMethod: input.paymentMethod,
      bankName: input.bankName ?? null,
      operationNumber: input.operationNumber ?? null,
      paidAmount: input.paidAmount,
      changeAmount: round2(Math.max(0, input.paidAmount - total)),
      consolidated: input.consolidated,
      sunatStatus: input.type === 'nota' ? 'no_aplica' : 'no_enviado',
      status: 'activa',
      cashSessionId: input.cashSessionId ?? null,
      anulationRequest: null,
      createdAt: Date.now()
    };

    // Sanitizar objeto para eliminar cualquier propiedad 'undefined' incompatible con Firestore
    const cleanDoc = JSON.parse(JSON.stringify(rawSaleDoc));
    tx.set(doc(collection(db, 'sales')), cleanDoc);
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
    bankName: input.bankName ?? null,
    operationNumber: input.operationNumber ?? null,
    paidAmount: input.paidAmount,
    changeAmount: round2(Math.max(0, input.paidAmount - total)),
    consolidated: input.consolidated,
    sunatStatus: 'no_enviado',
    status: 'activa',
    cashSessionId: input.cashSessionId ?? null,
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
