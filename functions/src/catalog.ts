import { randomUUID } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from './firebase';
import { requireAdmin } from './authz';
import { tenantCollection, tenantDoc } from './tenant';
import { parsePresentations, round2, round3 } from './stock-model';

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function barcodeId(value: string): string {
  return Buffer.from(value.toLowerCase(), 'utf8').toString('base64url');
}

export const saveCatalogProduct = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const input = (request.data?.product ?? {}) as Record<string, unknown>;
  const requestedId = text(request.data?.productId, 128);
  const productRef = requestedId
    ? tenantDoc(profile.tenantId, 'products', requestedId)
    : tenantCollection(profile.tenantId, 'products').doc();
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
      || (fractionalSale && !Number.isInteger(Math.round(fractionStep * 1000) * factor / 1000))
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

  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(productRef);
    const current = currentSnap.data() ?? {};
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
    tx.set(productRef, product);
    tx.set(tenantDoc(profile.tenantId, 'meta', 'catalog'), {
      tenantId: profile.tenantId,
      updatedAt: product.updatedAt
    });
  });
  return { id: productRef.id, presentations };
});
