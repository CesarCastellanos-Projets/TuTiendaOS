import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

export interface StockPresentation {
  id: string;
  unit: string;
  description?: string;
  barcode?: string;
  factor: number;
  salePrice: number;
  allowFractionalSale: boolean;
  fractionStep: number;
  autoUnpackEnabled: boolean;
  autoUnpackPriority: number;
}

export interface StockState {
  baseUnit?: string;
  baseQuantity: number;
  presentationQuantities: Record<string, number>;
  quantity: number;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function isMeasuredUnit(unit = 'UN'): boolean {
  return ['KG', 'LT', 'L', 'M', 'GR', 'G', 'ML'].includes(unit.toUpperCase());
}

export function positiveQuantity(value: unknown, field = 'La cantidad'): number {
  const parsed = Number(value);
  const rounded = round3(parsed);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000 || Math.abs(parsed - rounded) > 0.0000001) {
    throw new HttpsError('invalid-argument', `${field} debe ser positiva y admite como máximo 3 decimales.`);
  }
  return rounded;
}

export function parsePresentations(product: Record<string, unknown>): StockPresentation[] {
  const raw = Array.isArray(product.presentations) ? product.presentations : [];
  if (raw.length > 30) throw new HttpsError('failed-precondition', 'El producto tiene demasiadas presentaciones.');
  const ids = new Set<string>();
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpsError('failed-precondition', 'El producto tiene una presentación inválida.');
    const source = value as Record<string, unknown>;
    const factor = Number(source.factor ?? 1);
    const salePrice = Number(source.salePrice);
    if (!Number.isFinite(factor) || factor <= 1 || !Number.isInteger(factor) || !Number.isFinite(salePrice) || salePrice <= 0) {
      throw new HttpsError('failed-precondition', 'El producto tiene una presentación inválida. Edítalo antes de continuar.');
    }
    const unit = String(source.unit ?? '').trim().slice(0, 40);
    const id = String(source.id ?? `legacy-${index + 1}`).trim().slice(0, 80);
    if (!unit || !id || ids.has(id)) {
      throw new HttpsError('failed-precondition', 'El producto tiene una presentación sin identificar.');
    }
    ids.add(id);
    const configuredStep = Number(source.fractionStep ?? 0.5);
    const fractionStep = Number.isFinite(configuredStep) && configuredStep > 0 && configuredStep < 1
      ? round3(configuredStep)
      : 0.5;
    if (source.allowFractionalSale === true && (fractionStep < 0.001 || (!isMeasuredUnit(String(product.unit ?? 'UN')) && !Number.isInteger(round3(fractionStep * factor))))) {
      throw new HttpsError('failed-precondition', 'El paso fraccionario debe equivaler a unidades base completas. Revisa la presentación.');
    }
    const priority = Number(source.autoUnpackPriority ?? index + 1);
    return {
      id,
      unit,
      description: String(source.description ?? '').trim().slice(0, 80) || undefined,
      barcode: String(source.barcode ?? '').trim().slice(0, 80) || undefined,
      factor,
      salePrice: round2(salePrice),
      allowFractionalSale: source.allowFractionalSale === true && source.autoUnpackEnabled === true,
      fractionStep,
      autoUnpackEnabled: source.autoUnpackEnabled === true,
      autoUnpackPriority: Number.isInteger(priority) && priority > 0 ? priority : index + 1
    };
  });
}

export function readStockState(stock: Record<string, unknown>, presentations: StockPresentation[] = [], baseUnit = 'UN', allowReconciliation = false): StockState {
  const legacyQuantity = Number(stock.quantity ?? 0);
  if (!allowReconciliation && (stock.stockModelVersion === 3 || stock.requiresReconciliation === true) && legacyQuantity > 0 && presentations.some((p) => !p.autoUnpackEnabled)) {
    throw new HttpsError('failed-precondition', 'Este saldo se guardó como stock compartido. Un administrador debe contar y reclasificar las cajas cerradas en Ajustes antes de operar.');
  }
  if (!Number.isFinite(legacyQuantity) || legacyQuantity < 0
    || ([2, 3, 4].includes(Number(stock.stockModelVersion)) && (typeof stock.baseQuantity !== 'number' || !Number.isFinite(stock.baseQuantity) || stock.baseQuantity < 0))) {
    throw new HttpsError('failed-precondition', 'El stock tiene cantidades inconsistentes. Requiere conciliación.');
  }
  const hasV2Base = typeof stock.baseQuantity === 'number' && Number.isFinite(stock.baseQuantity);
  const baseQuantity = round3(hasV2Base ? Math.max(0, Number(stock.baseQuantity)) : legacyQuantity);
  const rawMap = stock.presentationQuantities && typeof stock.presentationQuantities === 'object'
    ? stock.presentationQuantities as Record<string, unknown>
    : {};
  const presentationQuantities: Record<string, number> = {};
  for (const [id, value] of Object.entries(rawMap)) {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 0) throw new HttpsError('failed-precondition', 'Stock de empaque inválido.');
    presentationQuantities[id] = quantity;
  }
  if (![2, 3, 4].includes(Number(stock.stockModelVersion)) && Object.values(presentationQuantities).some((quantity) => quantity > 0)) {
    throw new HttpsError('failed-precondition', 'El stock heredado mezcla unidades y empaques sin equivalencia verificable. Requiere conciliación.');
  }
  const total = totalBaseQuantity({ baseQuantity, presentationQuantities, quantity: legacyQuantity }, presentations);
  if ([2, 3, 4].includes(Number(stock.stockModelVersion)) && Math.abs(total - legacyQuantity) > 0.0001) {
    throw new HttpsError('failed-precondition', 'El equivalente del stock no coincide. Requiere conciliación.');
  }
  if (stock.stockModelVersion === 3 && Object.values(presentationQuantities).some((quantity) => quantity !== 0)) {
    throw new HttpsError('failed-precondition', 'El stock compartido contiene empaques independientes. Requiere conciliación.');
  }
  const state = { baseQuantity, presentationQuantities, quantity: total, baseUnit };
  for (const presentation of presentations) {
    if (presentation.autoUnpackEnabled) {
      state.baseQuantity = round3(state.baseQuantity + (state.presentationQuantities[presentation.id] ?? 0) * presentation.factor);
      delete state.presentationQuantities[presentation.id];
    }
  }
  return state;
}

export function totalBaseQuantity(state: StockState, presentations: StockPresentation[]): number {
  const byId = new Map(presentations.map((presentation) => [presentation.id, presentation]));
  let total = state.baseQuantity;
  for (const [id, quantity] of Object.entries(state.presentationQuantities)) {
    if (quantity > 0 && !byId.has(id)) throw new HttpsError('failed-precondition', 'Hay stock de una presentación que ya no existe.');
    total += quantity * (byId.get(id)?.factor ?? 0);
  }
  return round3(total);
}

export function stockPatch(state: StockState, presentations: StockPresentation[], minimum = 0, active = true) {
  const total = totalBaseQuantity(state, presentations);
  return {
    baseQuantity: state.baseQuantity,
    presentationQuantities: { ...state.presentationQuantities },
    quantity: total,
    minStock: minimum,
    isLowStock: active && total <= minimum,
    stockModelVersion: 4,
    committedAt: FieldValue.serverTimestamp(),
    updatedAt: Date.now()
  };
}

export function stockEquivalent(quantity: number, presentation: StockPresentation | null, baseUnit = 'UN'): number {
  if ((!presentation && !isMeasuredUnit(baseUnit) || presentation && !presentation.autoUnpackEnabled) && !Number.isInteger(quantity)) {
    throw new HttpsError('invalid-argument', 'Las unidades y los empaques cerrados deben tener cantidades enteras.');
  }
  const equivalent = round3(quantity * (presentation?.factor ?? 1));
  if (!Number.isFinite(quantity) || Math.abs(quantity - round3(quantity)) > 0.0000001
    || (presentation && !isMeasuredUnit(baseUnit) && !Number.isInteger(equivalent))) {
    throw new HttpsError('invalid-argument', 'La cantidad debe equivaler a unidades base completas y admite hasta tres decimales.');
  }
  return equivalent;
}

export function resolvePresentation(
  product: Record<string, unknown>,
  presentationId: string,
  barcode: string,
  legacyUnit: string
): StockPresentation | null {
  const presentations = parsePresentations(product);
  if (presentationId) {
    const found = presentations.find((presentation) => presentation.id === presentationId);
    if (!found) throw new HttpsError('failed-precondition', 'La presentación seleccionada ya no existe.');
    return found;
  }
  if (barcode) {
    const matches = presentations.filter((presentation) => presentation.barcode === barcode);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new HttpsError('failed-precondition', 'El código de barras está duplicado en el catálogo.');
  }
  if (legacyUnit) {
    const matches = presentations.filter((presentation) => presentation.unit === legacyUnit);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function assertSaleStep(quantity: number, presentation: StockPresentation | null, baseUnit = 'UN'): void {
  stockEquivalent(quantity, presentation, baseUnit);
  if (!presentation) {
    return;
  }
  if (Number.isInteger(quantity)) return;
  if (!presentation.allowFractionalSale) {
    throw new HttpsError('invalid-argument', `${presentation.description ?? presentation.unit} no permite venta fraccionada.`);
  }
  const steps = quantity / presentation.fractionStep;
  if (Math.abs(steps - Math.round(steps)) > 0.000001) {
    throw new HttpsError('invalid-argument', `La cantidad debe avanzar de ${presentation.fractionStep} en ${presentation.fractionStep}.`);
  }
  if (!isMeasuredUnit(baseUnit) && !Number.isInteger(round3(quantity * presentation.factor))) {
    throw new HttpsError('failed-precondition', 'El paso fraccionario configurado no equivale a unidades completas.');
  }
}

export function presentationLabel(presentation: StockPresentation): string {
  return presentation.description || `${presentation.unit} x${presentation.factor}`;
}

export function consumeSaleStock(
  state: StockState,
  presentations: StockPresentation[],
  presentation: StockPresentation | null,
  quantity: number
): { baseUnitsSold: number } {
  positiveQuantity(quantity);
  assertSaleStep(quantity, presentation, state.baseUnit);
  const baseUnitsSold = stockEquivalent(quantity, presentation, state.baseUnit);
  changeSelectedStock(state, presentation, -quantity);
  state.quantity = totalBaseQuantity(state, presentations);
  return { baseUnitsSold };
}

export function selectedAvailable(state: StockState, presentation: StockPresentation | null): number {
  return presentation && !presentation.autoUnpackEnabled
    ? state.presentationQuantities[presentation.id] ?? 0
    : state.baseQuantity / (presentation?.factor ?? 1);
}

export function changeSelectedStock(state: StockState, presentation: StockPresentation | null, delta: number): void {
  const equivalent = stockEquivalent(delta, presentation, state.baseUnit);
  const next = round3(selectedAvailable(state, presentation) + delta);
  if (next < -0.0000001) throw new HttpsError('failed-precondition', 'Stock insuficiente de la presentación seleccionada. Las cajas cerradas no se venden sueltas.');
  if (presentation && !presentation.autoUnpackEnabled) state.presentationQuantities[presentation.id] = Math.max(0, next);
  else state.baseQuantity = round3(state.baseQuantity + equivalent);
}
