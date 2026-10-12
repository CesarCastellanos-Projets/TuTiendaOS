import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildFiscalInvoicePayload, FiscalPayloadError } = require('../functions/lib/fiscal.js');

function sale(overrides = {}) {
  return {
    type: 'factura',
    serie: 'F001',
    correlativo: 1,
    createdAt: Date.parse('2026-09-16T10:00:00-05:00'),
    igvRate: 0.18,
    minBoletaSinDni: 700,
    clientDoc: { tipo: 'RUC', numero: '20123456789', nombre: 'CLIENTE SAC' },
    items: [{ productId: 'P1', name: 'Producto', qty: 2, unitPrice: 59, total: 118 }],
    subtotal: 100,
    igv: 18,
    total: 118,
    ...overrides
  };
}

test('reconstruye el comprobante únicamente desde la venta confiable', () => {
  const payload = buildFiscalInvoicePayload('sale-1', sale());

  assert.equal(payload.ref, 'sale-1');
  assert.equal(payload.igv_rate, 18);
  assert.deepEqual(payload.totals, { subtotal: 100, igv: 18, total: 118 });
  assert.equal(payload.items[0].precio, 59);
});

test('rechaza importes almacenados que no coinciden con cantidad y precio', () => {
  assert.throws(
    () => buildFiscalInvoicePayload('sale-2', sale({ total: 1 })),
    FiscalPayloadError
  );
});

test('rechaza facturas sin RUC y razón social válidos', () => {
  assert.throws(
    () => buildFiscalInvoicePayload('sale-3', sale({ clientDoc: { tipo: 'DNI', numero: '12345678', nombre: 'Persona' } })),
    FiscalPayloadError
  );
});


test('medio millar conserva cantidad, precio por millar e identificación fiscal', () => {
  const payload = buildFiscalInvoicePayload('sale-half', sale({
    items: [{ productId: 'P1', name: 'Hojas bond', presentationLabel: 'Millar', factor: 1000, qty: 0.5, unitPrice: 100, total: 50, baseUnitsSold: 500 }],
    subtotal: 42.37, igv: 7.63, total: 50
  }));
  assert.equal(payload.items[0].cantidad, 0.5);
  assert.equal(payload.items[0].precio, 100);
  assert.equal(payload.items[0].descripcion, 'Hojas bond · Millar');
  assert.equal(payload.totals.total, 50);
});

function receipt(total, minimumDni = 700, clientDoc = { tipo: '-', numero: '', nombre: '' }) {
  const subtotal = Math.round((total / 1.18 + Number.EPSILON) * 100) / 100;
  return sale({
    type: 'boleta', serie: 'B001', minBoletaSinDni: minimumDni, clientDoc,
    items: [{ productId: 'P1', name: 'Producto', qty: 1, unitPrice: total, total }],
    total, subtotal, igv: Math.round((total - subtotal + Number.EPSILON) * 100) / 100
  });
}

test('boleta exige DNI desde el umbral inclusive y mantiene 700 por defecto', () => {
  assert.equal(buildFiscalInvoicePayload('below', receipt(699.99)).totals.total, 699.99);
  assert.throws(() => buildFiscalInvoicePayload('at', receipt(700)), FiscalPayloadError);
  const legacy = receipt(700);
  delete legacy.minBoletaSinDni;
  assert.throws(() => buildFiscalInvoicePayload('legacy', legacy), FiscalPayloadError);
  assert.equal(buildFiscalInvoicePayload('identified', receipt(700, 700, {
    tipo: 'DNI', numero: '12345678', nombre: 'Persona'
  })).cliente.numero, '12345678');
});

test('contrato actual valida el umbral de la venta pero no lo transmite a Laravel (F19)', () => {
  const payload = buildFiscalInvoicePayload('threshold-1000', receipt(800, 1000));
  assert.equal(payload.totals.total, 800);
  assert.equal(payload.cliente.tipo, '-');
  assert.equal('minBoletaSinDni' in payload, false);
  assert.equal('min_boleta_dni' in payload, false);
  assert.throws(() => buildFiscalInvoicePayload('at-configured', receipt(1000, 1000)), FiscalPayloadError);
});
