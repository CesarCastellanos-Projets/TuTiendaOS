import type { Product, ProductPresentation, ProductStock } from '../types';

export function needsStockReconciliation(stock: ProductStock | undefined, presentations: Product['presentations'] = []): boolean {
  return (stock?.stockModelVersion === 3 || stock?.requiresReconciliation === true) && stock.quantity > 0 && (presentations ?? []).some((p) => p.autoUnpackEnabled !== true);
}

export function availableBase(stock: ProductStock | undefined, presentations: Product['presentations'] = []): number {
  if (!stock || needsStockReconciliation(stock, presentations)) return 0;
  const total = (presentations ?? []).reduce((quantity, presentation, index) =>
    quantity + (presentation.autoUnpackEnabled === true ? (stock.presentationQuantities?.[presentation.id || `legacy-${index + 1}`] ?? 0) * presentation.factor : 0),
    stock.baseQuantity ?? stock.quantity ?? 0);
  return Math.round((total + Number.EPSILON) * 1000) / 1000;
}

export function availablePresentation(stock: ProductStock | undefined, presentations: Product['presentations'], presentation?: ProductPresentation | null): number {
  if (needsStockReconciliation(stock, presentations)) return 0;
  if (presentation && presentation.autoUnpackEnabled !== true) {
    const index = (presentations ?? []).indexOf(presentation);
    return stock?.presentationQuantities?.[presentation.id || `legacy-${index + 1}`] ?? 0;
  }
  return Math.floor((availableBase(stock, presentations) / (presentation?.factor ?? 1) + 0.0000001) * 1000) / 1000;
}

type SalePresentation = Pick<ProductPresentation, 'factor' | 'allowFractionalSale' | 'fractionStep' | 'autoUnpackEnabled'>;

export function baseQuantityStep(unit = 'UN'): number {
  return ['KG', 'LT', 'L', 'M', 'GR', 'G', 'ML'].includes(unit.toUpperCase()) ? 0.001 : 1;
}

export function saleQuantityError(quantity: number, presentation?: SalePresentation | null, baseUnit = 'UN'): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
    || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001) return 'La cantidad debe ser positiva y tener hasta tres decimales.';
  if (!presentation) return baseQuantityStep(baseUnit) === 1 && !Number.isInteger(quantity) ? 'Este producto se vende en unidades completas.' : null;
  if (Math.abs(quantity * presentation.factor - Math.round(quantity * presentation.factor)) > 0.000001) return 'La cantidad debe equivaler a unidades base completas.';
  if (Number.isInteger(quantity)) return null;
  if (presentation.autoUnpackEnabled !== true) return 'Esta presentación debe venderse cerrada y completa.';
  if (presentation.allowFractionalSale !== true) return 'Esta presentación no permite venta fraccionada.';
  const step = presentation.fractionStep ?? 0.5;
  if (Math.abs(quantity / step - Math.round(quantity / step)) > 0.000001) return `La cantidad debe avanzar de ${step} en ${step}.`;
  return null;
}

export function initialSaleQuantity(available: number, presentation?: SalePresentation | null, baseUnit = 'UN'): number {
  if (available >= 1) return 1;
  const step = presentation ? (presentation.autoUnpackEnabled === true && presentation.allowFractionalSale === true ? presentation.fractionStep ?? 0.5 : 1) : baseQuantityStep(baseUnit);
  const quantity = Math.round(Math.floor((available + 0.0000001) / step) * step * 1000) / 1000;
  return saleQuantityError(quantity, presentation, baseUnit) ? 0 : quantity;
}

type DemandItem = { productId: string; qty: number; presentationId?: string | null };

export function remainingPresentation(stock: ProductStock | undefined, product: Product | undefined, items: DemandItem[], productId: string, presentationId?: string | null): number {
  const presentations = product?.presentations ?? [];
  const find = (id?: string | null) => presentations.find((p, index) => (p.id || `legacy-${index + 1}`) === id);
  const selected = find(presentationId);
  if (presentationId && !selected) return 0;
  const sealed = selected && selected.autoUnpackEnabled !== true;
  const demand = items.filter((item) => item.productId === productId).reduce((sum, item) => {
    const p = find(item.presentationId);
    if (item.presentationId && !p) return Infinity;
    if (sealed) return sum + (item.presentationId === presentationId ? item.qty : 0);
    return sum + (p && p.autoUnpackEnabled !== true ? 0 : item.qty * (p?.factor ?? 1));
  }, 0);
  return Math.round((availablePresentation(stock, presentations, selected) - demand / (sealed ? 1 : selected?.factor ?? 1)) * 1000) / 1000;
}
