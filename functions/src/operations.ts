import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { db } from './firebase';
import { requireActiveProfile } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import {
  consumeSaleStock,
  parsePresentations,
  positiveQuantity,
  presentationLabel,
  readStockState, changeSelectedStock,
  resolvePresentation,
  round2,
  round3,
  stockPatch,
  type StockState
} from './stock-model';

interface RequestedSaleItem {
  productId?: unknown;
  qty?: unknown;
  presentationId?: unknown;
  presentationUnit?: unknown;
  barcode?: unknown;
  unitPrice?: unknown;
}

interface TrustedSaleItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  factor: number;
  presentationId?: string;
  presentationLabel?: string;
  presentationUnit?: string;
  barcode?: string;
  catalogUnitPrice: number;
  priceOverridden: boolean;
  baseUnitsSold: number;
}

function positiveNumber(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpsError('invalid-argument', `${field} debe ser mayor que cero.`);
  }
  return parsed;
}

function saleQuantity(value: unknown): number {
  return positiveQuantity(value, 'La cantidad');
}

function salePrice(value: unknown): number {
  const parsed = positiveNumber(value, 'El precio');
  const rounded = round2(parsed);
  if (parsed > 1_000_000 || Math.abs(parsed - rounded) > 0.0000001) {
    throw new HttpsError('invalid-argument', 'El precio admite como máximo 2 decimales.');
  }
  return rounded;
}

function shortText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

const PUBLIC_COMPANY_FIELDS = [
  'ruc', 'razonSocial', 'direccion', 'regimen', 'serieFactura', 'serieBoleta',
  'serieNota', 'entornoSunat', 'igvRate', 'minBoletaSinDni',
  'umbralConsolidacion', 'certFileName', 'certExpiresAt', 'certIssuer',
  'isDemoMode', 'logoUrl', 'slogan', 'phone', 'footerText', 'ticketWidth', 'ticketDesign',
  'customUnits', 'updatedAt'
] as const;

export const getCompanyConfig = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  const snapshot = await tenantDoc(profile.tenantId, 'config', 'company').get();
  if (!snapshot.exists) return null;
  const source = snapshot.data()!;
  const publicConfig = Object.fromEntries(
    PUBLIC_COMPANY_FIELDS
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]])
  );
  return publicConfig;
});

async function registerSale(request: CallableRequest<Record<string, unknown>>) {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'pos' && profile.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Tu rol no puede registrar ventas.');
  }

  const data = request.data as Record<string, unknown>;
  const storeId = shortText(data.storeId, 128);
  if (!storeId || (profile.role === 'pos' && profile.storeId !== storeId)) {
    throw new HttpsError('permission-denied', 'La tienda no corresponde a tu usuario.');
  }

  const requestedItems = Array.isArray(data.items) ? data.items as RequestedSaleItem[] : [];
  if (requestedItems.length === 0 || requestedItems.length > 100) {
    throw new HttpsError('invalid-argument', 'La venta debe tener entre 1 y 100 productos.');
  }
  if (requestedItems.some((item) => !item || typeof item !== 'object' || Array.isArray(item))
    || JSON.stringify(requestedItems).length > 150_000) {
    throw new HttpsError('invalid-argument', 'Los productos de la venta no son válidos.');
  }

  const type = data.type;
  if (type !== 'boleta' && type !== 'factura' && type !== 'nota') {
    throw new HttpsError('invalid-argument', 'Tipo de comprobante inválido.');
  }
  const paymentMethod = data.paymentMethod;
  if (!['efectivo', 'transferencia', 'tarjeta', 'yape', 'plin', 'sip', 'otro'].includes(String(paymentMethod))) {
    throw new HttpsError('invalid-argument', 'Método de pago inválido.');
  }

  const [companySnap, storeSnap] = await Promise.all([
    tenantDoc(profile.tenantId, 'config', 'company').get(),
    tenantDoc(profile.tenantId, 'stores', storeId).get()
  ]);
  if (!companySnap.exists || !storeSnap.exists) {
    throw new HttpsError('failed-precondition', 'Falta configurar la empresa o la tienda.');
  }
  const company = companySnap.data() ?? {};
  const serie = type === 'factura'
    ? String(company.serieFactura ?? 'F001')
    : type === 'nota'
      ? String(company.serieNota ?? 'NV01')
      : String(company.serieBoleta ?? 'B001');
  const igvRate = Number(company.igvRate ?? 0.18);
  if (!/^[A-Z0-9]{1,8}$/.test(serie) || !Number.isFinite(igvRate) || igvRate < 0 || igvRate > 1
    || !Number.isFinite(Number(company.minBoletaSinDni ?? 700)) || Number(company.minBoletaSinDni ?? 700) < 0
    || !Number.isFinite(Number(company.umbralConsolidacion ?? 5)) || Number(company.umbralConsolidacion ?? 5) < 0) {
    throw new HttpsError('failed-precondition', 'Revisa las series, IGV y umbrales de la empresa.');
  }

  const client = (data.clientDoc ?? {}) as Record<string, unknown>;
  const cashSessionId = shortText(data.cashSessionId, 128);
  const clientDoc = {
    tipo: shortText(client.tipo, 3) || '-',
    numero: shortText(client.numero, 11),
    nombre: shortText(client.nombre, 180)
  };
  if (type === 'factura' && (!/^\d{11}$/.test(clientDoc.numero) || !clientDoc.nombre)) {
    throw new HttpsError('invalid-argument', 'La factura requiere RUC y razón social.');
  }

  const requestId = shortText(data.requestId, 80);
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Falta el identificador de la operación.');
  }
  if (profile.role === 'pos' && !cashSessionId) {
    throw new HttpsError('failed-precondition', 'Abre una caja antes de vender.');
  }
  if (!['-', 'DNI', 'RUC'].includes(clientDoc.tipo)
    || (clientDoc.tipo === 'DNI' && !/^\d{8}$/.test(clientDoc.numero))
    || (clientDoc.tipo === 'RUC' && !/^\d{11}$/.test(clientDoc.numero))
    || (type === 'factura' && clientDoc.tipo !== 'RUC')) {
    throw new HttpsError('invalid-argument', 'El tipo y número del documento no coinciden.');
  }
  if (paymentMethod === 'transferencia' && !shortText(data.bankName, 80)) {
    throw new HttpsError('invalid-argument', 'Selecciona el banco de la transferencia.');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical({
    storeId, items: requestedItems, type, paymentMethod, clientDoc,
    cashSessionId, paidAmount: data.paidAmount, bankName: data.bankName ?? null,
    operationNumber: data.operationNumber ?? null
  }))).digest('hex');
  const saleRef = tenantCollection(profile.tenantId, 'sales').doc(
    createHash('sha256').update(`${profile.uid}:${requestId}`).digest('hex')
  );
  const reservation = tenantDoc(profile.tenantId, 'sale_requests', saleRef.id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reservation);
    if (snap.data()?.cancelled === true) throw new HttpsError('failed-precondition', 'Esta operación fue cancelada antes del cobro.');
    if (snap.exists && snap.data()?.fingerprint !== fingerprint) {
      throw new HttpsError('already-exists', 'Esta operación tiene datos diferentes.');
    }
    if (!snap.exists) tx.set(reservation, {
      userId: profile.uid, storeId, fingerprint, createdAt: Date.now(),
      input: { requestId, storeId, items: requestedItems, type, paymentMethod, clientDoc,
        cashSessionId, paidAmount: data.paidAmount, bankName: data.bankName ?? null,
        operationNumber: data.operationNumber ?? null }
    });
  });
  const result = await db.runTransaction(async (tx) => {
    const [existing, reserved] = await Promise.all([tx.get(saleRef), tx.get(reservation)]);
    if (existing.exists) {
      if (existing.data()?.requestFingerprint !== fingerprint) {
        throw new HttpsError('already-exists', 'Esta operación ya fue usada con otros datos.');
      }
      return { id: existing.id, sale: existing.data()! };
    }
    if (reserved.data()?.cancelled === true) throw new HttpsError('failed-precondition', 'La operación fue cancelada antes del cobro.');
    const productIds = [...new Set(requestedItems.map((item) => shortText(item.productId, 128)))];
    if (productIds.some((id) => !/^[\w-]{1,128}$/.test(id))) {
      throw new HttpsError('invalid-argument', 'Hay un producto inválido.');
    }
    const productRefs = productIds.map((id) => tenantDoc(profile.tenantId, 'products', id));
    const stockRefs = productIds.map((id) => tenantDoc(profile.tenantId, 'product_stocks', `${id}_${storeId}`));
    const counterRef = tenantDoc(profile.tenantId, 'counters', serie);
    const [counterSnap, ...snapshots] = await Promise.all([
      tx.get(counterRef),
      ...productRefs.map((ref) => tx.get(ref)),
      ...stockRefs.map((ref) => tx.get(ref)),
      ...(cashSessionId ? [tx.get(tenantDoc(profile.tenantId, 'cash_sessions', cashSessionId))] : [])
    ]);
    const productSnaps = snapshots.slice(0, productRefs.length);
    const stockSnaps = snapshots.slice(productRefs.length);
    const cashSessionSnap = cashSessionId ? snapshots[productRefs.length * 2] : null;

    if (cashSessionId && (
      !cashSessionSnap?.exists
      || cashSessionSnap.data()?.userId !== profile.uid
      || cashSessionSnap.data()?.storeId !== storeId
      || cashSessionSnap.data()?.status !== 'abierta'
    )) {
      throw new HttpsError('failed-precondition', 'La caja seleccionada no está abierta para este usuario.');
    }

    const products = new Map(productIds.map((id, index) => [id, productSnaps[index]]));
    const stocks = new Map(productIds.map((id, index) => [id, stockSnaps[index]]));
    const stockStates = new Map<string, StockState>(
      productIds.map((id) => [id, readStockState(stocks.get(id)?.data() ?? {}, parsePresentations(products.get(id)?.data() ?? {}), String(products.get(id)?.data()?.unit ?? 'UN'))])
    );

    const items: TrustedSaleItem[] = requestedItems.map((requested) => {
      const productId = shortText(requested.productId, 128);
      const productSnap = products.get(productId);
      const stockSnap = stocks.get(productId);
      if (!productSnap?.exists || !stockSnap?.exists) {
        throw new HttpsError('failed-precondition', 'Uno de los productos no tiene stock registrado.');
      }
      const product = productSnap.data()!;
      if (product.active !== true) {
        throw new HttpsError('failed-precondition', `${String(product.name)} ya no está activo.`);
      }

      const qty = saleQuantity(requested.qty);
      const presentationId = shortText(requested.presentationId, 80);
      const presentationUnit = shortText(requested.presentationUnit, 40);
      const barcode = shortText(requested.barcode, 80);
      const presentations = parsePresentations(product);
      const presentation = resolvePresentation(product, presentationId, barcode, presentationUnit);
      const factor = presentation?.factor ?? 1;
      const catalogPrice = presentation
        ? presentation.salePrice
        : positiveNumber(product.salePrice, 'El precio');
      const mayOverridePrice = profile.role === 'admin' || profile.canOverridePrices;
      const unitPrice = mayOverridePrice && requested.unitPrice !== undefined
        ? salePrice(requested.unitPrice)
        : round2(catalogPrice);
      const state = stockStates.get(productId)!;
      const consumed = consumeSaleStock(state, presentations, presentation, qty);
      return {
        productId,
        name: String(product.name),
        qty,
        unitPrice,
        total: round2(qty * unitPrice),
        factor,
        ...(presentation ? { presentationId: presentation.id, presentationLabel: presentationLabel(presentation) } : {}),
        catalogUnitPrice: round2(catalogPrice),
        priceOverridden: Math.abs(unitPrice - catalogPrice) >= 0.005,
        baseUnitsSold: consumed.baseUnitsSold,
        ...(presentationUnit ? { presentationUnit } : {}),
        ...(barcode ? { barcode } : {})
      };
    });

    const total = round2(items.reduce((sum, item) => sum + item.total, 0));
    if (!Number.isFinite(total) || total <= 0 || total > 100_000_000) {
      throw new HttpsError('invalid-argument', 'El total de la venta es inválido.');
    }
    if (type === 'boleta' && total >= Number(company.minBoletaSinDni ?? 700) && (clientDoc.tipo !== 'DNI' || !/^\d{8}$/.test(clientDoc.numero))) {
      throw new HttpsError('invalid-argument', 'La boleta requiere DNI para este importe.');
    }
    const paidAmount = Number(data.paidAmount);
    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > 100_000_000
      || Math.abs(paidAmount - round2(paidAmount)) > 0.0000001
      || (paymentMethod === 'efectivo' ? paidAmount < total : Math.abs(paidAmount - total) >= 0.005)) {
      throw new HttpsError('invalid-argument', 'El monto pagado es inválido.');
    }

    const correlativo = Number(counterSnap.data()?.current ?? 0) + 1;
    const code = `${serie}-${String(correlativo).padStart(6, '0')}`;
    const now = Date.now();
    const subtotal = round2(total / (1 + igvRate));
    const sale = {
      tenantId: profile.tenantId,
      requestId,
      requestFingerprint: fingerprint,
      code,
      serie,
      correlativo,
      type,
      storeId,
      storeName: String(storeSnap.data()?.name ?? ''),
      userId: profile.uid,
      userName: profile.displayName,
      clientDoc,
      items,
      subtotal,
      igv: round2(total - subtotal),
      total,
      paymentMethod,
      bankName: shortText(data.bankName, 80) || null,
      operationNumber: shortText(data.operationNumber, 80) || null,
      paidAmount,
      changeAmount: round2(Math.max(0, paidAmount - total)),
      consolidated: type === 'boleta' && total < Number(company.umbralConsolidacion ?? 5),
      igvRate,
      minBoletaSinDni: Number(company.minBoletaSinDni ?? 700),
      sunatStatus: type === 'nota' ? 'no_aplica' : 'no_enviado',
      sunatSummaryRef: null,
      status: 'activa',
      cashSessionId: cashSessionId || null,
      anulationRequest: null,
      createdAt: now
    };

    tx.set(counterRef, { tenantId: profile.tenantId, current: correlativo });
    for (const productId of productIds) {
      const stockSnap = stocks.get(productId)!;
      const product = products.get(productId)!.data()!;
      tx.update(stockSnap.ref, stockPatch(stockStates.get(productId)!, parsePresentations(product)));
    }
    for (const item of items) {
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'venta',
        productId: item.productId,
        productName: item.name,
        qty: -item.baseUnitsSold,
        baseQty: -item.baseUnitsSold,
        presentationId: item.presentationId ?? null,
        presentationLabel: item.presentationLabel ?? null,
        presentationQty: item.presentationId ? -item.qty : null,
        toLocationId: storeId,
        refId: saleRef.id,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: storeId,
        createdAt: now
      });
    }
    tx.set(saleRef, sale);
    return { id: saleRef.id, sale };
  });

  return result;
}

async function safeRegisterSale(request: CallableRequest<Record<string, unknown>>) {
  try { return await registerSale(request); }
  catch (error) {
    if (!(error instanceof HttpsError) || !['invalid-argument', 'failed-precondition', 'resource-exhausted'].includes(error.code)) throw error;
    const profile = await requireActiveProfile(request);
    const requestId = shortText(request.data.requestId, 80);
    if (!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) throw error;
    const id = createHash('sha256').update(`${profile.uid}:${requestId}`).digest('hex');
    const saleRef = tenantDoc(profile.tenantId, 'sales', id);
    const reservation = tenantDoc(profile.tenantId, 'sale_requests', id);
    const existing = await db.runTransaction(async (tx) => {
      const [sale, pending] = await Promise.all([tx.get(saleRef), tx.get(reservation)]);
      if (sale.exists) return sale.data()!;
      tx.set(reservation, { ...pending.data(), userId: profile.uid, cancelled: true, failedAt: Date.now(), failureCode: error.code });
      return null;
    });
    if (existing) return { id, sale: existing };
    throw error;
  }
}

export const createSaleRecord = onCall(safeRegisterSale);

export const resumeSaleRecord = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  const requestId = shortText(request.data?.requestId, 80);
  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(requestId)) throw new HttpsError('invalid-argument', 'Operación inválida.');
  const id = createHash('sha256').update(`${profile.uid}:${requestId}`).digest('hex');
  const existingSale = await tenantDoc(profile.tenantId, 'sales', id).get();
  if (existingSale.exists) return { id, sale: existingSale.data()! };
  const ref = tenantDoc(profile.tenantId, 'sale_requests', id);
  const input = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { userId: profile.uid, cancelled: true, createdAt: Date.now() });
      return null;
    }
    if (snap.data()?.cancelled) return null;
    if (snap.data()?.storeId !== profile.storeId && profile.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Vuelve a la tienda de la operación pendiente.');
    }
    return snap.data()?.input as Record<string, unknown>;
  });
  if (!input) return { cancelled: true };
  return safeRegisterSale({ ...request, data: input });
});

export const receiveTransfer = onCall(async (request) => {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'pos' || !profile.storeId) {
    throw new HttpsError('permission-denied', 'Solo el POS de destino puede recibir transferencias.');
  }
  const storeId = profile.storeId;
  const data = request.data as Record<string, unknown>;
  const transferId = shortText(data.transferId, 128);
  const quantities = data.quantities as Record<string, unknown> | undefined;
  if (!transferId || !quantities || typeof quantities !== 'object') {
    throw new HttpsError('invalid-argument', 'Faltan los datos de recepción.');
  }

  const transferRef = tenantDoc(profile.tenantId, 'transfers', transferId);
  await db.runTransaction(async (tx) => {
    const transferSnap = await tx.get(transferRef);
    if (!transferSnap.exists) throw new HttpsError('not-found', 'La transferencia no existe.');
    const transfer = transferSnap.data()!;
    if (transfer.toLocationId !== storeId || !['pendiente', 'en_transito'].includes(String(transfer.status))) {
      throw new HttpsError('failed-precondition', 'La transferencia no puede recibirse en esta tienda.');
    }
    const items = Array.isArray(transfer.items) ? transfer.items as Record<string, unknown>[] : [];
    if (items.length === 0 || items.length > 100) {
      throw new HttpsError('failed-precondition', 'La transferencia no contiene productos válidos.');
    }
    const stockRefs = items.map((item) => tenantDoc(profile.tenantId, 'product_stocks', `${String(item.productId)}_${storeId}`));
    const productRefs = items.map((item) => tenantDoc(profile.tenantId, 'products', String(item.productId)));
    const snapshots = await Promise.all([
      ...stockRefs.map((ref) => tx.get(ref)),
      ...productRefs.map((ref) => tx.get(ref))
    ]);
    const stockSnaps = snapshots.slice(0, items.length);
    const productSnaps = snapshots.slice(items.length);
    const storeSnap = await tx.get(tenantDoc(profile.tenantId, 'stores', storeId));
    const now = Date.now();
    const states = new Map<string, StockState>();
    const products = new Map<string, (typeof productSnaps)[number]>();
    const stocks = new Map<string, (typeof stockSnaps)[number]>();
    const receivedItems = items.map((item, index) => {
      const productId = String(item.productId);
      const qtySent = Number(item.qtySent);
      const itemPresentationId = shortText(item.presentationId, 80);
      const quantityKey = `${productId}:${itemPresentationId || 'base'}`;
      const received = quantities[quantityKey]
        ?? (items.filter((line) => line.productId === productId).length === 1 ? quantities[productId] : undefined);
      const qtyReceived = Number(received);
      if (typeof received !== 'number' || !Number.isFinite(qtyReceived) || Math.abs(qtyReceived - round3(qtyReceived)) > 0.0000001 || qtyReceived < 0 || qtyReceived > qtySent) {
        throw new HttpsError('invalid-argument', `Cantidad recibida inválida para ${String(item.name)}.`);
      }
      if (qtyReceived > 0) {
        const stockSnap = stockSnaps[index];
        const productSnap = productSnaps[index];
        if (!productSnap.exists) {
          throw new HttpsError('failed-precondition', `El producto ${String(item.name)} ya no existe.`);
        }
        const product = productSnap.data()!;
        const presentation = itemPresentationId
          ? resolvePresentation(product, itemPresentationId, '', '')
          : null;
        if (presentation && presentation.factor !== Number(item.factor)) {
          throw new HttpsError('failed-precondition', 'El factor de la presentación cambió desde el envío.');
        }
        const state = states.get(productId) ?? readStockState(stockSnap.data() ?? {}, parsePresentations(product), String(product.unit ?? 'UN'));
        states.set(productId, state);
        products.set(productId, productSnap);
        stocks.set(productId, stockSnap);
        changeSelectedStock(state, presentation, qtyReceived);
        const factor = presentation?.factor ?? 1;
        tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
          tenantId: profile.tenantId,
          type: 'recepcion',
          productId,
          productName: String(item.name),
          qty: round3(qtyReceived * factor),
          baseQty: round3(qtyReceived * factor),
          presentationId: presentation?.id ?? null,
          presentationLabel: presentation ? presentationLabel(presentation) : 'Unidad base',
          presentationQty: qtyReceived,
          toLocationId: profile.storeId,
          refId: String(transfer.code),
          userId: profile.uid,
          userName: profile.displayName,
          userStoreId: profile.storeId,
          createdAt: now
        });
      }
      return { ...item, qtyReceived, qtyMissing: round3(qtySent - qtyReceived) };
    });

    for (const [productId, state] of states) {
      const product = products.get(productId)!.data()!;
      const stockSnap = stocks.get(productId)!;
      const updatedStock = stockPatch(state, parsePresentations(product));
      if (stockSnap.exists) {
        tx.update(stockSnap.ref, updatedStock);
      } else {
        tx.set(stockSnap.ref, {
          tenantId: profile.tenantId,
          productId,
          productName: String(product.name),
          barcode: product.barcode ?? null,
          salePrice: Number(product.salePrice ?? 0),
          locationType: 'store',
          locationId: profile.storeId,
          locationName: String(storeSnap.data()?.name ?? ''),
          ...updatedStock,
          unit: product.unit ?? null
        });
      }
    }

    tx.update(transferRef, {
      status: 'recibido',
      items: receivedItems,
      shortageStatus: receivedItems.some((item) => item.qtyMissing > 0) ? 'pendiente' : 'sin_faltantes',
      receivedBy: profile.uid,
      receivedByName: profile.displayName,
      receivedAt: now
    });
  });

  return { ok: true };
});
