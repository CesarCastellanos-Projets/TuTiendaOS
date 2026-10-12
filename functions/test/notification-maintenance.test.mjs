import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { runNotificationMaintenance } = require('../lib/notification-maintenance.js');

test('las tareas arrancan juntas y la rápida termina mientras la otra sigue pendiente', async () => {
  let release;
  let delivered = false;
  const slow = new Promise((resolve) => { release = resolve; });
  const work = runNotificationMaintenance(() => slow, async () => { delivered = true; });
  await new Promise(setImmediate);
  assert.equal(delivered, true);
  release();
  await work;
});

test('un fallo síncrono o asíncrono no impide ejecutar la otra tarea y se informa al scheduler', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const error of [() => { throw new Error('fallo'); }, async () => { throw new Error('fallo'); }]) {
    let otherRuns = 0;
    await assert.rejects(runNotificationMaintenance(error, async () => { otherRuns++; }), AggregateError);
    assert.equal(otherRuns, 1);
    await assert.rejects(runNotificationMaintenance(async () => { otherRuns++; }, error), AggregateError);
    assert.equal(otherRuns, 2);
  }
});
