import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { workBudget, roundRobin } = require('../lib/work-budget.js');

test('mantenimiento deja margen de tiempo y rota empresas sin omisiones', () => {
  let now = 1000;
  const budget = workBudget(240000, () => now);
  assert.equal(budget.canStart(), true);
  now += 180000;
  assert.equal(budget.canStart(), false);
  assert.deepEqual(roundRobin(['a', 'b', 'c'], 1), { values: ['b', 'c', 'a'], start: 1 });
  assert.deepEqual(roundRobin(['a', 'b', 'c'], 4).values, ['b', 'c', 'a']);
  assert.deepEqual(roundRobin([], NaN), { values: [], start: 0 });
});
