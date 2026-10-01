import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeSaleStock,
  parsePresentations,
  resolvePresentation,
  stockPatch,
  readStockState
} from '../lib/stock-model.js';

const product = {
  presentations: [
    {
      id: 'caja-12', unit: 'CJA', description: 'Caja x12', factor: 12,
      barcode: 'CAJA12', salePrice: 10, allowFractionalSale: true,
      fractionStep: 0.5, autoUnpackEnabled: true, autoUnpackPriority: 2
    },
    {
      id: 'caja-30', unit: 'CJA', description: 'Caja x30', factor: 30,
      barcode: 'CAJA30', salePrice: 22, allowFractionalSale: false,
      fractionStep: 0.5, autoUnpackEnabled: true, autoUnpackPriority: 1
    }
  ]
};

test('dos cajas con la misma unidad se resuelven por ID o código exacto', () => {
  assert.equal(resolvePresentation(product, 'caja-12', '', 'CJA').id, 'caja-12');
  assert.equal(resolvePresentation(product, '', 'CAJA30', 'CJA').id, 'caja-30');
  assert.equal(resolvePresentation(product, '', '', 'CJA'), null);
});

test('media caja consume el saldo compartido sin exigir un empaque cerrado', () => {
  const presentations = parsePresentations(product);
  const state = readStockState({ baseQuantity: 12, presentationQuantities: {}, quantity: 12, stockModelVersion: 3 }, presentations);
  const result = consumeSaleStock(state, presentations, presentations[0], 0.5);
  assert.deepEqual(state.presentationQuantities, {});
  assert.equal(state.baseQuantity, 6);
  assert.equal(result.baseUnitsSold, 6);
  assert.equal(stockPatch(state, presentations).stockModelVersion, 4);
});

test('cajas cerradas conservan su identidad y nunca cubren ventas sueltas', () => {
  const presentations = parsePresentations(product).map((p) => ({ ...p, autoUnpackEnabled: false }));
  const state = readStockState({ baseQuantity: 10, presentationQuantities: { 'caja-12': 2 }, quantity: 34, stockModelVersion: 2 }, presentations);
  assert.equal(state.baseQuantity, 10);
  assert.throws(() => consumeSaleStock(state, presentations, null, 11));
  assert.throws(() => consumeSaleStock(state, presentations, presentations[0], 0.5));
  consumeSaleStock(state, presentations, presentations[0], 1);
  assert.equal(state.baseQuantity, 10);
  assert.equal(state.presentationQuantities['caja-12'], 1);
  consumeSaleStock(state, presentations, null, 10);
  assert.equal(stockPatch(state, presentations).quantity, 12);
});

test('las unidades contables son enteras; KG y LT admiten decimales', () => {
  const presentations = parsePresentations(product);
  const state = { baseQuantity: 100, presentationQuantities: {}, quantity: 100 };
  assert.throws(() => consumeSaleStock(state, presentations, null, 0.5));
  consumeSaleStock(state, presentations, presentations[0], 1);
  assert.equal(state.baseQuantity, 88);
  assert.throws(() => consumeSaleStock(state, presentations, null, -1));
  assert.throws(() => consumeSaleStock(state, presentations, presentations[0], 0.25));
  const measured = readStockState({ quantity: 2 }, [], 'KG');
  consumeSaleStock(measured, [], null, 0.5);
  assert.equal(measured.baseQuantity, 1.5);
});

test('rechaza configurar un paso que produciría media unidad base', () => {
  assert.throws(() => parsePresentations({ presentations: [{ id: 'caja-10', unit: 'CJA', factor: 10, salePrice: 10, allowFractionalSale: true, fractionStep: 0.25 }] }));
  assert.throws(() => parsePresentations({ presentations: [{ autoUnpackEnabled: true, id: 'millar', unit: 'MIL', factor: 1000, salePrice: 100, allowFractionalSale: true, fractionStep: 0.0001 }] }));
});

test('no convierte stock corrupto en saldos válidos ni pierde empaques desconocidos', () => {
  assert.throws(() => readStockState({ stockModelVersion: 2, quantity: 5, baseQuantity: null }));
  assert.throws(() => readStockState({ quantity: -1 }));
  assert.throws(() => readStockState({ quantity: 10, presentationQuantities: { caja: -2 } }));
  assert.throws(() => stockPatch({ quantity: 10, baseQuantity: 0, presentationQuantities: { desconocido: 1 } }, []));
});

test('fraccionamiento exige habilitación explícita', () => {
  const presentations = parsePresentations({ presentations: [{ id: 'caja', unit: 'CJA', factor: 12, salePrice: 10 }] });
  assert.equal(presentations[0].allowFractionalSale, false);
  assert.throws(() => consumeSaleStock({ quantity: 12, baseQuantity: 0, presentationQuantities: { caja: 1 } }, presentations, presentations[0], 0.5));
});


test('1050 hojas menos 100 y medio millar quedan 450, con varias presentaciones', () => {
  const presentations = parsePresentations({ presentations: [
    { autoUnpackEnabled: true, id: 'millar', unit: 'MIL', factor: 1000, salePrice: 100, allowFractionalSale: true, fractionStep: 0.5 },
    { autoUnpackEnabled: true, id: 'ciento', unit: 'CTO', factor: 100, salePrice: 12 },
    { autoUnpackEnabled: true, id: 'cincuenta', unit: 'PQ', factor: 50, salePrice: 7 }
  ] });
  const state = readStockState({ baseQuantity: 50, presentationQuantities: { millar: 1 }, quantity: 1050, stockModelVersion: 2 }, presentations);
  consumeSaleStock(state, presentations, presentations[1], 1);
  assert.equal(state.baseQuantity, 950);
  assert.throws(() => consumeSaleStock(state, presentations, presentations[0], 1));
  assert.equal(state.baseQuantity, 950);
  consumeSaleStock(state, presentations, presentations[0], 0.5);
  assert.equal(state.baseQuantity, 450);
  consumeSaleStock(state, presentations, presentations[2], 1);
  assert.equal(stockPatch(state, presentations).quantity, 400);
});

test('distintas presentaciones no pueden consumir dos veces el mismo saldo', () => {
  const presentations = parsePresentations(product);
  const state = { baseQuantity: 30, presentationQuantities: {}, quantity: 30 };
  consumeSaleStock(state, presentations, presentations[0], 2);
  assert.equal(state.baseQuantity, 6);
  assert.throws(() => consumeSaleStock(state, presentations, presentations[1], 1));
  assert.equal(state.baseQuantity, 6);
});

test('rechaza totales inconsistentes y mezclas ambiguas al leer stock anterior', () => {
  const presentations = parsePresentations(product);
  assert.throws(() => readStockState({ stockModelVersion: 2, baseQuantity: 1, presentationQuantities: { 'caja-12': 1 }, quantity: 12 }, presentations));
  assert.throws(() => readStockState({ quantity: 12, presentationQuantities: { 'caja-12': 1 } }, presentations));
  assert.throws(() => readStockState({ stockModelVersion: 3, baseQuantity: 0, presentationQuantities: { 'caja-12': 1 }, quantity: 12 }, presentations));
});

test('saldo unificado previo nunca inventa cajas cerradas', () => {
  const presentations = parsePresentations({ presentations: [{ id: 'caja', unit: 'CJA', factor: 12, salePrice: 10 }] });
  const old = { stockModelVersion: 3, baseQuantity: 34, quantity: 34, presentationQuantities: {} };
  assert.throws(() => readStockState(old, presentations));
  const state = readStockState(old, presentations, 'UN', true);
  assert.throws(() => consumeSaleStock(state, presentations, presentations[0], 1));
  assert.equal(stockPatch(state, presentations).quantity, 34);
});
