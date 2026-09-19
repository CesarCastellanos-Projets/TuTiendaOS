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
  return raw.map((value, index) => {
    const source = value as Record<string, unknown>;
    const factor = Number(source.factor ?? 1);
    const salePrice = Number(source.salePrice);
    if (!Number.isFinite(factor) || factor <= 1 || !Number.isInteger(factor) || !Number.isFinite(salePrice) || salePrice <= 0) {
      throw new HttpsError('failed-precondition', 'El producto tiene una presentación inválida. Edítalo antes de continuar.');
    }
    const unit = String(source.unit ?? '').trim().slice(0, 40);
    const id = String(source.id ?? `legacy-${index + 1}`).trim().slice(0, 80);
    if (!unit || !id) {
      throw new HttpsError('failed-precondition', 'El producto tiene una presentación sin identificar.');
    }
    const configuredStep = Number(source.fractionStep ?? 0.5);
    const fractionStep = Number.isFinite(configuredStep) && configuredStep > 0 && configuredStep < 1
      ? round3(configuredStep)
      : 0.5;
    const priority = Number(source.autoUnpackPriority ?? index + 1);
    return {
      id,
      unit,
      description: String(source.description ?? '').trim().slice(0, 80) || undefined,
      barcode: String(source.barcode ?? '').trim().slice(0, 80) || undefined,
      factor,
      salePrice: round2(salePrice),
      allowFractionalSale: source.allowFractionalSale !== false,
      fractionStep,
      autoUnpackEnabled: source.autoUnpackEnabled === true,
      autoUnpackPriority: Number.isInteger(priority) && priority > 0 ? priority : index + 1
    };
  });
}

export function readStockState(stock: Record<string, unknown>): StockState {
  const legacyQuantity = Math.max(0, Number(stock.quantity ?? 0));
  const hasV2Base = Number.isFinite(Number(stock.baseQuantity));
  const baseQuantity = round3(hasV2Base ? Math.max(0, Number(stock.baseQuantity)) : legacyQuantity);
  const rawMap = stock.presentationQuantities && typeof stock.presentationQuantities === 'object'
    ? stock.presentationQuantities as Record<string, unknown>
    : {};
  const presentationQuantities: Record<string, number> = {};
  for (const [id, value] of Object.entries(rawMap)) {
    const quantity = Number(value);
    if (Number.isInteger(quantity) && quantity >= 0) presentationQuantities[id] = quantity;
  }
  return { baseQuantity, presentationQuantities, quantity: round3(legacyQuantity) };
}

export function totalBaseQuantity(state: StockState, presentations: StockPresentation[]): number {
  const byId = new Map(presentations.map((presentation) => [presentation.id, presentation]));
  let total = state.baseQuantity;
  for (const [id, quantity] of Object.entries(state.presentationQuantities)) {
    total += quantity * (byId.get(id)?.factor ?? 0);
  }
  return round3(total);
}

export function stockPatch(state: StockState, presentations: StockPresentation[]) {
  return {
    baseQuantity: round3(state.baseQuantity),
    presentationQuantities: state.presentationQuantities,
    quantity: totalBaseQuantity(state, presentations),
    stockModelVersion: 2,
    updatedAt: Date.now()
  };
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

export function assertSaleStep(quantity: number, presentation: StockPresentation | null): void {
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
  if (!Number.isInteger(round3(quantity * presentation.factor))) {
    throw new HttpsError('failed-precondition', 'El paso fraccionario configurado no equivale a unidades completas.');
  }
}

export function presentationLabel(presentation: StockPresentation): string {
  return presentation.description || `${presentation.unit} x${presentation.factor}`;
}

export interface StockConversion {
  presentation: StockPresentation;
  packagesOpened: number;
  baseUnitsReleased: number;
  reason: 'apertura por venta fraccionada' | 'apertura automática para venta por unidad';
}

export function consumeSaleStock(
  state: StockState,
  presentations: StockPresentation[],
  presentation: StockPresentation | null,
  quantity: number
): { baseUnitsSold: number; packagesConsumed: number; remainderToBase: number; conversions: StockConversion[] } {
  assertSaleStep(quantity, presentation);
  const factor = presentation?.factor ?? 1;
  const baseUnitsSold = round3(quantity * factor);
  const conversions: StockConversion[] = [];
  let packagesConsumed = 0;
  let remainderToBase = 0;

  if (presentation) {
    packagesConsumed = Math.ceil(quantity - 0.0000001);
    const available = state.presentationQuantities[presentation.id] ?? 0;
    if (available < packagesConsumed) {
      throw new HttpsError('failed-precondition', `Stock insuficiente de ${presentationLabel(presentation)}.`);
    }
    state.presentationQuantities[presentation.id] = available - packagesConsumed;
    remainderToBase = round3(packagesConsumed * factor - baseUnitsSold);
    if (remainderToBase > 0) {
      state.baseQuantity = round3(state.baseQuantity + remainderToBase);
      conversions.push({
        presentation,
        packagesOpened: packagesConsumed,
        baseUnitsReleased: remainderToBase,
        reason: 'apertura por venta fraccionada'
      });
    }
    return { baseUnitsSold, packagesConsumed, remainderToBase, conversions };
  }

  let missing = round3(Math.max(0, quantity - state.baseQuantity));
  if (missing > 0) {
    const candidates = presentations
      .filter((candidate) => candidate.autoUnpackEnabled && (state.presentationQuantities[candidate.id] ?? 0) > 0)
      .sort((a, b) => a.autoUnpackPriority - b.autoUnpackPriority || a.factor - b.factor || a.id.localeCompare(b.id));
    for (const candidate of candidates) {
      if (missing <= 0) break;
      const available = state.presentationQuantities[candidate.id] ?? 0;
      const needed = Math.ceil(missing / candidate.factor);
      const opened = Math.min(available, needed);
      if (opened <= 0) continue;
      state.presentationQuantities[candidate.id] = available - opened;
      const released = opened * candidate.factor;
      state.baseQuantity = round3(state.baseQuantity + released);
      missing = round3(Math.max(0, quantity - state.baseQuantity));
      conversions.push({
        presentation: candidate,
        packagesOpened: opened,
        baseUnitsReleased: released,
        reason: 'apertura automática para venta por unidad'
      });
    }
  }
  if (state.baseQuantity + 0.0001 < quantity) {
    throw new HttpsError('failed-precondition', 'Stock suelto insuficiente.');
  }
  state.baseQuantity = round3(state.baseQuantity - quantity);
  return { baseUnitsSold, packagesConsumed, remainderToBase, conversions };
}
