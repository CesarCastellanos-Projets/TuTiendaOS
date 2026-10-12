import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const records = new Map();
const counters = { reads: 0, writes: 0, sends: 0 };
let now;

function ref(path) {
  const write = async (patch) => {
    counters.writes++;
    records.set(path, { ...records.get(path), ...patch });
  };
  return {
    path, id: path.split('/').at(-1), update: write, set: write,
    async get() {
      counters.reads++;
      return { ref: ref(path), data: () => records.get(path) };
    },
    async delete() { records.delete(path); }
  };
}

function query(collection, filters = [], order, limit = Infinity) {
  return {
    where: (field, operator, value) => query(collection, [...filters, { field, operator, value }], order, limit),
    orderBy: (field) => query(collection, filters, field, limit),
    limit: (size) => query(collection, filters, order, size),
    async get() {
      const selected = [...records].filter(([path, value]) => path.startsWith(`${collection}/`) && filters.every((filter) => {
        if (filter.operator === '==') return value[filter.field] === filter.value;
        if (filter.operator === '<=') return value[filter.field] <= filter.value;
        throw new Error(`Operador inesperado: ${filter.operator}`);
      })).sort((a, b) => (a[1][order] ?? 0) - (b[1][order] ?? 0)).slice(0, limit);
      const docs = await Promise.all(selected.map(([path]) => ref(path).get()));
      return { docs, size: docs.length };
    }
  };
}

const emptyQuery = {
  where() { return this; }, orderBy() { return this; }, limit() { return this; },
  async get() { return { docs: [], size: 0, empty: true }; }
};
const db = {
  doc: ref,
  collection: query,
  collectionGroup: () => emptyQuery,
  async runTransaction(callback) {
    const writes = [];
    const result = await callback({
      get: (document) => document.get(),
      getAll: (...documents) => Promise.all(documents.map((document) => document.get())),
      update: (document, patch) => writes.push(() => document.update(patch))
    });
    for (const write of writes) await write();
    return result;
  }
};

// Sustituir el módulo completo impide inicializar credenciales o conexiones reales.
require.cache[require.resolve('../lib/firebase.js')] = { exports: {
  db,
  admin: { messaging: () => ({ send: async () => { counters.sends++; } }) }
} };
process.env.API_FACT_TOKEN = 'local-test-token';
process.env.API_FACT_URL = 'http://127.0.0.1:9999';
process.env.FUNCTIONS_EMULATOR = 'false';
const { deliverReplenishmentPush, runReplenishmentPushRetries } = require('../lib/replenishment-notifications.js');
const { retryPendingSunatSales } = require('../lib/tax.js');

beforeEach((t) => {
  records.clear();
  Object.assign(counters, { reads: 0, writes: 0, sends: 0 });
  now = Date.parse('2026-10-11T12:00:00Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Solicitud HTTP inesperada en prueba local'); });
});

function job(id, patch = {}) {
  const document = ref(`replenishment_push_jobs/${id}`);
  records.set(document.path, {
    tenantId: 'tenant-test', requestId: 'request-1', deviceId: 'device-1', uid: 'admin-1',
    state: 'pending', attempts: 0, nextAttemptAt: 0, leaseUntil: 0,
    expiresAt: { toMillis: () => now + 86400000 }, ...patch
  });
  return document;
}

function validRecipient() {
  records.set('calendar_push_devices/device-1', {
    uid: 'admin-1', tenantId: 'tenant-test', replenishment: true, expiresAt: now + 86400000, token: 'test-token'
  });
  records.set('users/admin-1', { active: true, tenantId: 'tenant-test', role: 'admin' });
  records.set('tenants/tenant-test/replenishment_requests/request-1', { status: 'pendiente' });
}

test('50 avisos vencidos salen de la cola y el siguiente lote entrega el aviso vigente', async () => {
  for (let index = 0; index < 50; index++) job(`expired-${index}`, { expiresAt: { toMillis: () => now } });
  const live = job('live', { nextAttemptAt: 1 });
  validRecipient();
  await runReplenishmentPushRetries();
  assert.deepEqual(counters, { reads: 100, writes: 50, sends: 0 });
  for (let index = 0; index < 50; index++) assert.equal(records.get(`replenishment_push_jobs/expired-${index}`).state, 'cancelled');
  await runReplenishmentPushRetries();
  assert.equal(records.get(live.path).state, 'sent');
  assert.equal(counters.sends, 1);
  const afterDelivery = { ...counters };
  await runReplenishmentPushRetries();
  assert.deepEqual(counters, afterDelivery);
});

test('vencimiento respeta leases activos y no altera estados terminales', async () => {
  for (const state of ['sent', 'failed', 'cancelled']) {
    const terminal = job(state, { state, expiresAt: { toMillis: () => now - 1 } });
    await deliverReplenishmentPush(terminal, now);
    assert.equal(records.get(terminal.path).state, state);
  }
  const leased = job('leased', { expiresAt: { toMillis: () => now - 1 }, leaseUntil: now + 1000 });
  await deliverReplenishmentPush(leased, now);
  assert.equal(counters.writes, 0);
  await deliverReplenishmentPush(leased, now + 1000);
  assert.equal(records.get(leased.path).state, 'cancelled');
  await deliverReplenishmentPush(leased, now + 1000);
  assert.equal(counters.writes, 1);
  assert.equal(counters.sends, 0);
});

test('backoff vigente y envío en curso conservan su exclusión de entrega', async () => {
  const future = job('future', { nextAttemptAt: now + 1000 });
  await deliverReplenishmentPush(future, now);
  assert.equal(counters.writes, 0);
  validRecipient();
  const live = job('live');
  let sends = 0;
  await deliverReplenishmentPush(live, now, async () => {
    sends++;
    await deliverReplenishmentPush(live, now, async () => { sends++; });
  });
  assert.equal(sends, 1);
  assert.equal(records.get(live.path).state, 'sent');
});

test('fallo transitorio mantiene reintento y luego el vencimiento lo retira', async () => {
  validRecipient();
  const expiresAt = now + 1000;
  const live = job('live', { expiresAt: { toMillis: () => expiresAt } });
  await deliverReplenishmentPush(live, now, async () => { throw new Error('FCM no disponible'); });
  assert.equal(records.get(live.path).state, 'pending');
  assert.equal(records.get(live.path).attempts, 1);
  assert.ok(records.get(live.path).nextAttemptAt > now);
  await deliverReplenishmentPush(live, expiresAt);
  assert.equal(records.get(live.path).state, 'cancelled');
});

function maintenance(t, tenantIds, onRequest = () => {}) {
  records.set('system/sunatMaintenance', { tenantIds, cursor: 0 });
  const visited = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:9999/api/maintenance/retry-pending');
    assert.deepEqual(JSON.parse(options.body), { limit: 5 });
    visited.push(options.headers['X-TENANT-ID']);
    onRequest(visited.length);
    return new Response(JSON.stringify({ documents: [] }), { status: 200 });
  });
  return visited;
}

test('scheduler recorre 250 empresas en lotes de 100 y vuelve al principio', async (t) => {
  const tenants = Array.from({ length: 250 }, (_, index) => `tenant-${index}`);
  const visited = maintenance(t, tenants);
  for (let run = 0; run < 3; run++) {
    await retryPendingSunatSales.run({});
    assert.equal(visited.length, (run + 1) * 100);
  }
  assert.deepEqual(visited, [...tenants, ...tenants.slice(0, 50)]);
  assert.equal(records.get('system/sunatMaintenance').cursor, 50);
});

test('scheduler guarda avance al agotar tiempo y continúa después de una empresa fallida', async (t) => {
  const tenants = Array.from({ length: 120 }, (_, index) => `tenant-${index}`);
  const visited = maintenance(t, tenants, (count) => {
    now += 61000;
    if (count === 2) throw new Error('API temporalmente no disponible');
  });
  t.mock.method(console, 'error', () => {});
  await retryPendingSunatSales.run({});
  assert.deepEqual(visited, tenants.slice(0, 3));
  assert.equal(records.get('system/sunatMaintenance').cursor, 3);
  await retryPendingSunatSales.run({});
  assert.deepEqual(visited, tenants.slice(0, 6));
  assert.equal(records.get('system/sunatMaintenance').cursor, 6);
});

test('sin empresas el scheduler no llama a la API ni escribe un cursor inválido', async (t) => {
  const visited = maintenance(t, []);
  await retryPendingSunatSales.run({});
  assert.deepEqual(visited, []);
  assert.equal(counters.writes, 0);
});

test('el presupuesto de reposiciones deja trabajos pendientes sin reclamarlos', async () => {
  const pending = job('budget');
  await runReplenishmentPushRetries(() => false);
  assert.equal(counters.reads, 0);
  assert.equal(records.get(pending.path).state, 'pending');
  let checks = 0;
  await runReplenishmentPushRetries(() => ++checks === 1);
  assert.equal(counters.reads, 1);
  assert.equal(counters.writes, 0);
});

test('el scheduler compartido conserva la cadencia, ejecuta ambas tareas y limita concurrencia', async () => {
  const { sendCalendarReminders } = require('../lib/calendar.js');
  const pending = job('combined', { expiresAt: { toMillis: () => now } });
  await sendCalendarReminders.run({});
  assert.equal(records.get(pending.path).state, 'cancelled');
  assert.equal(sendCalendarReminders.__endpoint.scheduleTrigger.schedule, 'every 5 minutes');
  assert.equal(sendCalendarReminders.__endpoint.concurrency, 1);
  assert.equal(sendCalendarReminders.__endpoint.timeoutSeconds, 240);
});
