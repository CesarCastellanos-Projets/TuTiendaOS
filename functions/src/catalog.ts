import { appCheckOptions } from './app-check';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { requireActiveProfile } from './authz';
import { assertInventoryTask } from './worker-permissions';
import { tenantCollection, tenantDoc } from './tenant';
import { completeOperation, operationId, readOperation } from './operation-receipts';
import { isMeasuredUnit, parsePresentations, round2, round3 } from './stock-model';

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function barcodeId(value: string): string {
  return Buffer.from(value.toLowerCase(), 'utf8').toString('base64url');
}

export const saveCatalogProduct = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  if (!['admin', 'trabajador'].includes(profile.role)) throw new HttpsError('permission-denied', 'No tienes permiso para crear productos.');
  const input = (request.data?.product ?? {}) as Record<string, unknown>;
  const requestedId = text(request.data?.productId, 128);
  const creationId = request.data?.creationId;
  const commandId = operationId(request.data?.requestId ?? creationId);
  if (profile.role === 'trabajador' && (requestedId || typeof creationId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(creationId))) {
    throw new HttpsError('permission-denied', 'El permiso solo permite crear productos nuevos.');
  }
  const productRef = requestedId
    ? tenantDoc(profile.tenantId, 'products', requestedId)
    : profile.role === 'trabajador' ? tenantDoc(profile.tenantId, 'products', creationId)
    : tenantDoc(profile.tenantId, 'products', createHash('sha256').update(`${profile.uid}:${commandId}`).digest('hex').slice(0, 24));
  const name = text(input.name, 180);
  const category = text(input.category, 80) || 'General';
  const brand = text(input.brand, 80);
  const unit = text(input.unit, 40).toUpperCase() || 'UN';
  const barcode = text(input.barcode, 80);
  const salePrice = round2(Number(input.salePrice));
  const minStock = Number(input.minStock ?? 0);
  if (!name || !Number.isFinite(salePrice) || salePrice <= 0 || salePrice > 1_000_000 || !Number.isInteger(minStock) || minStock < 0 || minStock > 1_000_000) {
    throw new HttpsError('invalid-argument', 'Nombre, precio y stock mínimo no son válidos.');
  }
  const rawPresentations = Array.isArray(input.presentations) ? input.presentations : [];
  if (rawPresentations.length > 30) {
    throw new HttpsError('invalid-argument', 'Un producto admite como máximo 30 presentaciones.');
  }
  const presentationIds = new Set<string>();
  const presentations = rawPresentations.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('invalid-argument', 'Hay una presentación inválida.');
    const source = value as Record<string, unknown>;
    const id = text(source.id, 80) || randomUUID();
    const presentationUnit = text(source.unit, 40).toUpperCase();
    const factor = Number(source.factor);
    const price = round2(Number(source.salePrice));
    const presentationBarcode = text(source.barcode, 80);
    const fractionStep = Number(source.fractionStep ?? 0.5);
    const priority = Number(source.autoUnpackPriority ?? index + 1);
    const fractionalSale = source.allowFractionalSale === true && source.autoUnpackEnabled === true;
    if (
      presentationIds.has(id) || !presentationUnit || !Number.isInteger(factor) || factor <= 1 || factor > 1_000_000
      || !Number.isFinite(price) || price <= 0 || price > 1_000_000
      || !Number.isFinite(fractionStep) || fractionStep < 0.001 || fractionStep >= 1 || Math.abs(fractionStep - round3(fractionStep)) > 0.0000001
      || (fractionalSale && !isMeasuredUnit(unit) && !Number.isInteger(Math.round(fractionStep * 1000) * factor / 1000))
      || !Number.isInteger(priority) || priority <= 0
    ) {
      throw new HttpsError('invalid-argument', 'Hay una presentación con datos inválidos.');
    }
    presentationIds.add(id);
    return {
      id,
      unit: presentationUnit,
      description: text(source.description, 80) || `${presentationUnit} x${factor}`,
      factor,
      ...(presentationBarcode ? { barcode: presentationBarcode } : {}),
      salePrice: price,
      allowFractionalSale: fractionalSale,
      fractionStep: Math.round(fractionStep * 1000) / 1000,
      autoUnpackEnabled: source.autoUnpackEnabled === true,
      autoUnpackPriority: priority
    };
  });
  const purchaseRequested = Object.prototype.hasOwnProperty.call(request.data ?? {}, 'purchase');
  if (purchaseRequested && profile.role !== 'admin') throw new HttpsError('permission-denied', 'Solo el administrador puede registrar compras.');
  const rawPurchase = request.data?.purchase;
  let purchase: Record<string, unknown> | null = null;
  if (purchaseRequested && rawPurchase !== null) {
    if (!rawPurchase || typeof rawPurchase !== 'object' || Array.isArray(rawPurchase)) throw new HttpsError('invalid-argument', 'Compra inválida.');
    const cost = round2(Number(rawPurchase.cost));
    const presentation = rawPurchase.presentationId ? presentations.find((p) => p.id === rawPurchase.presentationId) : null;
    if (!Number.isFinite(cost) || cost < 0 || cost > 1000000 || (rawPurchase.presentationId && !presentation)) throw new HttpsError('invalid-argument', 'Costo o presentación de compra inválidos.');
    purchase = { tenantId: profile.tenantId, productId: productRef.id, cost,
      presentationId: presentation?.id ?? null, presentationLabel: presentation?.description ?? unit,
      factor: presentation?.factor ?? 1, baseCost: round2(cost / (presentation?.factor ?? 1)),
      supplier: text(rawPurchase.supplier, 180), updatedAt: Date.now() };
  }
  const codes = [barcode, ...presentations.map((presentation) => presentation.barcode ?? '')].filter(Boolean);
  if (new Set(codes.map((code) => code.toLowerCase())).size !== codes.length) {
    throw new HttpsError('already-exists', 'Un código de barras está repetido dentro del producto.');
  }
  const product = {
    tenantId: profile.tenantId,
    name,
    category,
    ...(brand ? { brand } : {}),
    unit,
    ...(barcode ? { barcode } : {}),
    salePrice,
    minStock,
    locationHint: text(input.locationHint, 120),
    active: input.active === true,
    presentations,
    updatedAt: Date.now()
  };
  return db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'catalog-product', commandId, request.data);
    if (operation.result) return operation.result;
    await assertInventoryTask(tx, profile, 'canCreateProducts', profile.storeId ?? '');
    const currentSnap = await tx.get(productRef);
    const creationRef = tenantDoc(profile.tenantId, 'worker_product_creations', productRef.id);
    const fingerprint = createHash('sha256').update(JSON.stringify({ ...product, updatedAt: 0 })).digest('hex');
    const creation = profile.role === 'trabajador' ? await tx.get(creationRef) : null;
    if (profile.role === 'trabajador' && currentSnap.exists) {
      if (creation?.data()?.userId === profile.uid && creation.data()?.storeId === profile.storeId && creation.data()?.fingerprint === fingerprint) return { id: productRef.id, presentations: currentSnap.data()?.presentations ?? [] };
      throw new HttpsError('already-exists', 'Este producto ya existe. No puedes modificarlo con este permiso.');
    }
    const current = currentSnap.data() ?? {};
    const oldPresentations = parsePresentations(current);
    const changesInventory = currentSnap.exists && (current.unit !== unit || oldPresentations.some((old) =>
      presentations.find((p) => p.id === old.id)?.autoUnpackEnabled !== old.autoUnpackEnabled));
    if (changesInventory) {
      const [stocks, movements] = await Promise.all([
        tx.get(tenantCollection(profile.tenantId, 'product_stocks').where('productId', '==', productRef.id).limit(1)),
        tx.get(tenantCollection(profile.tenantId, 'stock_movements').where('productId', '==', productRef.id).limit(1))]);
      if (!stocks.empty || !movements.empty) throw new HttpsError('failed-precondition', 'Este producto tiene inventario registrado. Conserva la unidad base y la política de apertura; realiza una conversión de stock explícita.');
    }
    for (const old of parsePresentations(current)) {
      const next = presentations.find((p) => p.id === old.id);
      if (!next || next.factor !== old.factor) {
        throw new HttpsError('failed-precondition', 'No elimines ni cambies el factor de una presentación existente: conserva su identidad para stock y transferencias. Puedes agregar una presentación nueva.');
      }
    }
    const currentPresentations = Array.isArray(current.presentations)
      ? current.presentations as Record<string, unknown>[]
      : [];
    const oldCodes = [text(current.barcode, 80), ...currentPresentations.map((item) => text(item.barcode, 80))]
      .filter(Boolean);
    const registryRefs = [...new Set([...oldCodes, ...codes].map((code) => barcodeId(code)))]
      .map((id) => tenantDoc(profile.tenantId, 'barcode_registry', id));
    const registrySnaps = await Promise.all(registryRefs.map((ref) => tx.get(ref)));
    const registryById = new Map(registrySnaps.map((snap) => [snap.id, snap]));
    for (const code of codes) {
      const registered = registryById.get(barcodeId(code));
      if (registered?.exists && registered.data()?.productId !== productRef.id) {
        throw new HttpsError('already-exists', `El código ${code} ya pertenece a otro producto.`);
      }
    }
    for (const oldCode of oldCodes) {
      if (!codes.some((code) => code.toLowerCase() === oldCode.toLowerCase())) {
        const oldRef = tenantDoc(profile.tenantId, 'barcode_registry', barcodeId(oldCode));
        if (registryById.get(oldRef.id)?.data()?.productId === productRef.id) tx.delete(oldRef);
      }
    }
    codes.forEach((code) => {
      tx.set(tenantDoc(profile.tenantId, 'barcode_registry', barcodeId(code)), {
        tenantId: profile.tenantId,
        productId: productRef.id,
        code,
        updatedAt: product.updatedAt
      });
    });
    if (purchaseRequested) {
      const purchaseRef = tenantDoc(profile.tenantId, 'product_purchase', productRef.id);
      if (purchase) tx.set(purchaseRef, purchase); else tx.delete(purchaseRef);
    }
    if (currentSnap.exists) {
      const changes: { label: string; previous: number; current: number }[] = [];
      if (Number(current.salePrice) !== salePrice) changes.push({ label: unit, previous: Number(current.salePrice), current: salePrice });
      for (const item of presentations) {
        const old = oldPresentations.find((p) => p.id === item.id);
        if (old && old.salePrice !== item.salePrice) changes.push({ label: item.description, previous: old.salePrice, current: item.salePrice });
      }
      const noticeAt = Date.now();
      if (changes.length) tx.create(tenantDoc(profile.tenantId, 'price_notices', operation.ref.id), {
        tenantId: profile.tenantId, productId: productRef.id, productName: name, changes,
        createdAt: noticeAt, expiresAt: noticeAt + 5 * 3600000
      });
    }
    tx.set(productRef, { ...product, ...(current.internalCode ? { internalCode: current.internalCode } : {}), committedAt: FieldValue.serverTimestamp() });
    if (profile.role === 'trabajador') tx.create(creationRef, {
      tenantId: profile.tenantId, storeId: profile.storeId, userId: profile.uid, userName: profile.displayName,
      productId: productRef.id, productName: name, fingerprint, createdAt: product.updatedAt
    });
    tx.set(tenantDoc(profile.tenantId, 'meta', 'catalog'), {
      tenantId: profile.tenantId,
      updatedAt: product.updatedAt, committedAt: FieldValue.serverTimestamp()
    });
    const result = { id: productRef.id, presentations };
    completeOperation(tx, profile, 'catalog-product', operation, result);
    return result;
  });
});
