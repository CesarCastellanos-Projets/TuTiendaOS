export interface FiscalInvoicePayload {
  ref: string;
  tipo: 'boleta' | 'factura';
  serie: string;
  correlativo: number;
  fecha: string;
  igv_rate: number;
  cliente: { tipo: string; numero: string; nombre: string };
  items: Array<{
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio: number;
  }>;
  totals: { subtotal: number; igv: number; total: number };
}

export class FiscalPayloadError extends Error {}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyMatches(left: unknown, right: number): boolean {
  const value = Number(left);
  return Number.isFinite(value) && Math.abs(value - right) <= 0.01;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function buildFiscalInvoicePayload(
  saleId: string,
  sale: Record<string, unknown>
): FiscalInvoicePayload {
  const type = sale.type;
  if (type !== 'boleta' && type !== 'factura') {
    throw new FiscalPayloadError('La venta no genera un comprobante electrónico individual.');
  }
  const series = text(sale.serie, 4);
  const correlative = Number(sale.correlativo);
  const rawItems = sale.items;
  if (!saleId || !series || !Number.isInteger(correlative) || correlative < 1 || !Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 100) {
    throw new FiscalPayloadError('La identidad o el detalle fiscal de la venta es inválido.');
  }

  let total = 0;
  const items = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const quantity = Number(item.qty);
    const price = round2(Number(item.unitPrice));
    const name = text(item.name, 180);
    const presentation = text(item.presentationLabel, 80);
    const description = text(presentation ? `${name} · ${presentation}` : name, 250);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0 || !name) {
      throw new FiscalPayloadError('La venta contiene productos fiscales inválidos.');
    }
    const lineTotal = round2(quantity * price);
    if (!moneyMatches(item.total, lineTotal)) {
      throw new FiscalPayloadError('El total de un producto no coincide con su cantidad y precio.');
    }
    total = round2(total + lineTotal);
    return {
      codigo: text(item.productId, 30),
      descripcion: description,
      cantidad: quantity,
      precio: price
    };
  });

  const storedSubtotal = Number(sale.subtotal);
  const storedIgv = Number(sale.igv);
  const configuredRate = Number(sale.igvRate);
  const rate = Number.isFinite(configuredRate) && configuredRate > 0 && configuredRate <= 1
    ? configuredRate
    : Number.isFinite(storedSubtotal) && storedSubtotal > 0 && Number.isFinite(storedIgv)
      ? storedIgv / storedSubtotal
      : 0.18;
  const subtotal = round2(total / (1 + rate));
  const igv = round2(total - subtotal);
  if (!moneyMatches(sale.total, total) || !moneyMatches(sale.subtotal, subtotal) || !moneyMatches(sale.igv, igv)) {
    throw new FiscalPayloadError('Los totales almacenados no coinciden con el cálculo fiscal del servidor.');
  }

  const rawClient = (sale.clientDoc ?? {}) as Record<string, unknown>;
  const client = {
    tipo: text(rawClient.tipo, 3) || '-',
    numero: text(rawClient.numero, 15).replace(/\D/g, ''),
    nombre: text(rawClient.nombre, 120)
  };
  if (type === 'factura' && (client.tipo !== 'RUC' || !/^\d{11}$/.test(client.numero) || !client.nombre)) {
    throw new FiscalPayloadError('La factura almacenada no tiene RUC y razón social válidos.');
  }
  const minimumDni = Number(sale.minBoletaSinDni ?? 700);
  if (type === 'boleta' && total >= minimumDni && (client.tipo !== 'DNI' || !/^\d{8}$/.test(client.numero))) {
    throw new FiscalPayloadError('La boleta almacenada requiere un DNI válido.');
  }

  const createdAt = Number(sale.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new FiscalPayloadError('La fecha de la venta es inválida.');
  }

  return {
    ref: saleId,
    tipo: type,
    serie: series,
    correlativo: correlative,
    fecha: new Date(createdAt).toISOString(),
    igv_rate: round2(rate * 100),
    cliente: client,
    items,
    totals: { subtotal, igv, total }
  };
}
