import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { requireActiveProfile } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import {
  consumeSaleStock,
  parsePresentations,
  positiveQuantity,
  presentationLabel,
  readStockState,
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
  packagesConsumed: number;
  remainderToBase: number;
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

const PUBLIC_COMPANY_FIELDS = [
  'ruc', 'razonSocial', 'direccion', 'regimen', 'serieFactura', 'serieBoleta',
  'serieNota', 'entornoSunat', 'igvRate', 'minBoletaSinDni',
  'umbralConsolidacion', 'certFileName', 'certExpiresAt', 'certIssuer',
  'isDemoMode', 'logoUrl', 'slogan', 'phone', 'footerText', 'ticketWidth',
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
  const hasLegacySecrets = ['solUser', 'solPassword', 'apiFactUrl', 'apiFactToken']
    .some((field) => Object.hasOwn(source, field));
  if (profile.role === 'admin' && hasLegacySecrets) {
    await snapshot.ref.set({ ...publicConfig, updatedAt: Date.now() });
  }
  return publicConfig;
});

export const createSaleRecord = onCall(async (request) => {
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

  const saleRef = tenantCollection(profile.tenantId, 'sales').doc();
  const result = await db.runTransaction(async (tx) => {
    const productIds = [...new Set(requestedItems.map((item) => shortText(item.productId, 128)))];
    if (productIds.some((id) => !id)) {
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
      productIds.map((id) => [id, readStockState(stocks.get(id)?.data() ?? {})])
    );
    const conversionMovements: Array<Record<string, unknown>> = [];

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
      const stock = stockSnap.data()!;
      const catalogPrice = presentation
        ? presentation.salePrice
        : positiveNumber(stock.salePrice ?? product.salePrice, 'El precio');
      const mayOverridePrice = profile.role === 'admin' || profile.canOverridePrices;
      const unitPrice = mayOverridePrice && requested.unitPrice !== undefined
        ? salePrice(requested.unitPrice)
        : round2(catalogPrice);
      const state = stockStates.get(productId)!;
      const consumed = consumeSaleStock(state, presentations, presentation, qty);
      for (const conversion of consumed.conversions) {
        conversionMovements.push({
          productId,
          productName: String(product.name),
          presentationId: conversion.presentation.id,
          presentationLabel: presentationLabel(conversion.presentation),
          packagesOpened: conversion.packagesOpened,
          remainderToBase: conversion.baseUnitsReleased,
          qty: 0,
          baseQty: conversion.baseUnitsReleased,
          reason: conversion.reason
        });
      }

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
        packagesConsumed: consumed.packagesConsumed,
        remainderToBase: consumed.remainderToBase,
        ...(presentationUnit ? { presentationUnit } : {}),
        ...(barcode ? { barcode } : {})
      };
    });

    const total = round2(items.reduce((sum, item) => sum + item.total, 0));
    if (type === 'boleta' && total >= Number(company.minBoletaSinDni ?? 700) && !/^\d{8}$/.test(clientDoc.numero)) {
      throw new HttpsError('invalid-argument', 'La boleta requiere DNI para este importe.');
    }
    const paidAmount = Number(data.paidAmount);
    if (!Number.isFinite(paidAmount) || (paymentMethod === 'efectivo' && paidAmount < total)) {
      throw new HttpsError('invalid-argument', 'El monto pagado es inválido.');
    }

    const correlativo = Number(counterSnap.data()?.current ?? 0) + 1;
    const code = `${serie}-${String(correlativo).padStart(6, '0')}`;
    const now = Date.now();
    const subtotal = round2(total / (1 + igvRate));
    const sale = {
      tenantId: profile.tenantId,
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
    for (const movement of conversionMovements) {
      tx.set(tenantCollection(profile.tenantId, 'stock_movements').doc(), {
        tenantId: profile.tenantId,
        type: 'conversion',
        ...movement,
        toLocationId: storeId,
        refId: saleRef.id,
        userId: profile.uid,
        userName: profile.displayName,
        userStoreId: storeId,
        createdAt: now
      });
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
        packagesOpened: item.packagesConsumed || null,
        remainderToBase: item.remainderToBase || null,
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
      const qtyReceived = Number(quantities[quantityKey] ?? quantities[productId] ?? qtySent);
      if (!Number.isInteger(qtyReceived) || qtyReceived < 0 || qtyReceived > qtySent) {
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
        const state = states.get(productId) ?? readStockState(stockSnap.data() ?? {});
        states.set(productId, state);
        products.set(productId, productSnap);
        stocks.set(productId, stockSnap);
        if (presentation) {
          state.presentationQuantities[presentation.id] = (state.presentationQuantities[presentation.id] ?? 0) + qtyReceived;
        } else {
          state.baseQuantity += qtyReceived;
        }
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
      return { ...item, qtyReceived };
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
      receivedBy: profile.uid,
      receivedByName: profile.displayName,
      receivedAt: now
    });
  });

  return { ok: true };
});
