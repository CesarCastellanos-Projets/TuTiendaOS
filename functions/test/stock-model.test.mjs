import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeSaleStock,
  parsePresentations,
  resolvePresentation,
  stockPatch
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

test('media caja consume una caja y devuelve el sobrante a unidades sueltas', () => {
  const presentations = parsePresentations(product);
  const state = { baseQuantity: 0, presentationQuantities: { 'caja-12': 1 }, quantity: 12 };
  const result = consumeSaleStock(state, presentations, presentations[0], 0.5);
  assert.deepEqual(state.presentationQuantities, { 'caja-12': 0 });
  assert.equal(state.baseQuantity, 6);
  assert.equal(result.baseUnitsSold, 6);
  assert.equal(result.packagesConsumed, 1);
  assert.equal(result.remainderToBase, 6);
  assert.equal(stockPatch(state, presentations).quantity, 6);
});

test('la venta base abre empaques siguiendo prioridad y nunca deja stock negativo', () => {
  const presentations = parsePresentations(product);
  const state = {
    baseQuantity: 2,
    presentationQuantities: { 'caja-12': 2, 'caja-30': 1 },
    quantity: 56
  };
  const result = consumeSaleStock(state, presentations, null, 20);
  assert.equal(result.conversions[0].presentation.id, 'caja-30');
  assert.equal(state.presentationQuantities['caja-30'], 0);
  assert.equal(state.presentationQuantities['caja-12'], 2);
  assert.equal(state.baseQuantity, 12);
  assert.equal(stockPatch(state, presentations).quantity, 36);
});

test('rechaza decimales en unidad base, pasos inválidos y cajas inexistentes', () => {
  const presentations = parsePresentations(product);
  assert.throws(() => consumeSaleStock({ baseQuantity: 5, presentationQuantities: {}, quantity: 5 }, presentations, null, 0.5));
  assert.throws(() => consumeSaleStock({ baseQuantity: 0, presentationQuantities: { 'caja-12': 1 }, quantity: 12 }, presentations, presentations[0], 0.25));
  assert.throws(() => consumeSaleStock({ baseQuantity: 100, presentationQuantities: { 'caja-12': 0 }, quantity: 100 }, presentations, presentations[0], 1));
});

test('rechaza una fracción que produciría media unidad base', () => {
  const presentations = parsePresentations({
    presentations: [{
      id: 'caja-10', unit: 'CJA', factor: 10, salePrice: 10,
      allowFractionalSale: true, fractionStep: 0.25,
      autoUnpackEnabled: false, autoUnpackPriority: 1
    }]
  });
  assert.throws(() => consumeSaleStock(
    { baseQuantity: 0, presentationQuantities: { 'caja-10': 1 }, quantity: 10 },
    presentations,
    presentations[0],
    0.25
  ));
});
