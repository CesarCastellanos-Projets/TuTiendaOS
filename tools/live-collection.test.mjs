import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
const compiled = transformSync(await readFile(new URL('../apps/web/src/lib/live-collection.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const stamp = (seconds) => ({ seconds, nanoseconds: 0 });
const item = (index, seconds = index + 1) => ({ id: `P${String(index).padStart(5, '0')}`, committedAt: stamp(seconds), quantity: 1, active: true });
const clone = (value) => structuredClone(value);
const cmp = (a, b) => typeof a === 'object' && a && b
  ? a.seconds - b.seconds || a.nanoseconds - b.nanoseconds : a < b ? -1 : a > b ? 1 : 0;

async function until(condition) {
  for (let count = 0; count < 100; count++) {
    if (condition()) return;
    await new Promise(setImmediate);
  }
  assert.fail('La sincronización no alcanzó el estado esperado');
}

function fixture(initial, cached = [], checkpoint) {
  const source = new Map(initial.map((row) => [row.id, clone(row)]));
  const cache = new Map(cached.map((row) => [row.id, clone(row)]));
  const metadata = new Map(checkpoint ? [['sync-v2:tenant:store', { value: 1, cursor: checkpoint }]] : []);
  const watchers = [];
  const reads = [];
  const events = new Map();
  const timers = new Map();
  let nextTimer = 0;
  let saveFailure = false;
  const control = { onRead: async () => {}, onSave: async () => {}, readError: null, listenerDocuments: 0, saves: [], idle: 0 };
  function select(constraints) {
    const orders = constraints.filter((part) => part.kind === 'order');
    const compareRows = (a, b) => {
      for (const order of orders) {
        const result = cmp(a[order.field], b[order.field]) * (order.direction === 'desc' ? -1 : 1);
        if (result) return result;
      }
      return cmp(a.id, b.id) * (orders[0]?.direction === 'desc' ? -1 : 1);
    };
    let rows = [...source.values()].filter((row) => orders.every((order) => row[order.field] !== undefined));
    for (const part of constraints) {
      if (part.kind === 'where') rows = rows.filter((row) => row[part.field] !== undefined
        && (part.operator === '>=' ? cmp(row[part.field], part.value) >= 0 : cmp(row[part.field], part.value) <= 0));
      if (part.kind === 'after') rows = rows.filter((row) => compareRows(row, part.document.data()) > 0);
    }
    return rows.sort(compareRows).slice(0, constraints.find((part) => part.kind === 'limit').count)
      .map((row) => { const data = clone(row); return { id: row.id, data: () => data }; });
  }
  function snapshot(watcher, fromCache = false, metadataOnly = false) {
    const docs = select(watcher.constraints);
    const previous = watcher.previous ?? [];
    const changed = docs.filter((doc) => !previous.some((old) => old.id === doc.id && JSON.stringify(old.data()) === JSON.stringify(doc.data())));
    const removed = previous.filter((doc) => !docs.some((current) => current.id === doc.id));
    if (!fromCache) control.listenerDocuments += changed.length;
    watcher.previous = docs;
    watcher.next({ docs, size: docs.length, metadata: { fromCache, hasPendingWrites: false },
      docChanges: () => metadataOnly ? [] : [...changed.map((doc) => ({ type: 'modified', doc })), ...removed.map((doc) => ({ type: 'removed', doc }))] });
  }
  const firestore = {
    documentId: () => 'id', query: (_collection, ...constraints) => constraints,
    where: (field, operator, value) => ({ kind: 'where', field, operator, value }),
    orderBy: (field, direction = 'asc') => ({ kind: 'order', field, direction }),
    limit: (count) => ({ kind: 'limit', count }), startAfter: (document) => ({ kind: 'after', document }),
    Timestamp: class { constructor(seconds, nanoseconds) { Object.assign(this, { seconds, nanoseconds }); } },
    async getDocsFromServer(constraints) {
      if (control.readError) throw control.readError;
      const docs = select(constraints);
      reads.push({ constraints, documents: docs.length });
      await control.onRead(constraints, reads.length);
      return { docs, size: docs.length };
    },
    onSnapshot(constraints, _options, next, error) {
      const watcher = { constraints, next, error, active: true };
      watchers.push(watcher);
      queueMicrotask(() => { if (watcher.active) snapshot(watcher); });
      return () => { watcher.active = false; };
    }
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, navigator: { onLine: true },
    window: { addEventListener: (name, handler) => events.set(name, handler), removeEventListener: (name) => events.delete(name) },
    setTimeout: (handler) => { timers.set(++nextTimer, handler); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    require(name) {
      if (name === 'firebase/firestore') return firestore;
      if (name === './catalog-cache') return { localDb: { catalogMeta: {
        get: async (key) => metadata.get(key), put: async (value) => metadata.set(value.key, clone(value))
      } } };
      throw new Error(`Dependencia inesperada: ${name}`);
    }
  });
  const repository = module.exports.liveCollection({
    key: 'tenant:store', collection: {}, id: (row) => row.id, decode: (id, data) => ({ ...data, id }),
    onIdle: () => { control.idle++; },
    load: async () => [...cache.values()],
    save: async (updates, replace) => {
      control.saves.push({ count: updates.length, replace });
      await control.onSave();
      if (saveFailure) { saveFailure = false; throw new Error('IndexedDB no disponible'); }
      if (replace) cache.clear();
      updates.forEach((row) => cache.set(row.id, clone(row)));
    }
  });
  return { repository, cache, metadata, reads, control, watchers, events,
    subscribe: () => repository.subscribe(() => {}),
    emit: (fromCache = false, metadataOnly = false) => watchers.filter((w) => w.active).forEach((w) => snapshot(w, fromCache, metadataOnly)),
    update: (updates) => updates.forEach((row) => source.set(row.id, clone(row))),
    online: () => events.get('online')(),
    stop: () => [...timers.values()].forEach((handler) => handler()),
    failSave: () => { saveFailure = true; }
  };
}

test('301 documentos: una sola carga inicial y listener desde el commit observado', async () => {
  const f = fixture(Array.from({ length: 301 }, (_, index) => item(index)));
  f.subscribe(); f.subscribe();
  await until(() => f.cache.size === 301);
  assert.equal(f.watchers.length, 1);
  assert.equal(f.reads.reduce((sum, read) => sum + read.documents, 0), 302);
  assert.equal(f.control.listenerDocuments, 1);
  assert.equal(f.repository.get().rows.length, 301);
});

test('301 commits iguales y filas heredadas no causan una segunda carga completa', async () => {
  const legacy = { id: 'legacy', quantity: 2, active: false };
  const f = fixture([...Array.from({ length: 301 }, (_, index) => item(index, 10)), legacy]);
  f.subscribe();
  await until(() => f.cache.size === 302);
  assert.equal(f.reads.reduce((sum, read) => sum + read.documents, 0), 303);
  assert.equal(f.control.listenerDocuments, 300);
  assert.equal(f.cache.get('legacy').quantity, 2);
});

test('más de 300 cambios durante paginación se recuperan por delta, incluidos IDs ya recorridos', async () => {
  const f = fixture(Array.from({ length: 650 }, (_, index) => item(index)));
  f.control.onRead = async (_constraints, count) => {
    if (count !== 2) return;
    f.update(Array.from({ length: 401 }, (_, index) => ({ ...item(index, 2000), quantity: 9, active: index !== 0 })));
    f.emit();
  };
  f.subscribe();
  await until(() => [...f.cache.values()].filter((row) => row.quantity === 9).length === 401);
  assert.equal(f.cache.size, 650);
  assert.equal(f.cache.get('P00000').active, false);
  assert.equal(f.reads.filter((read) => read.constraints.some((part) => part.kind === 'order' && part.field === 'id')
    && !read.constraints.some((part) => part.kind === 'where')).length, 3);
  assert.equal(f.metadata.get('sync-v2:tenant:store').cursor.seconds, 2000);
});

test('caché caliente, offline y reconexión recuperan 500 cambios con el mismo timestamp', async () => {
  const original = Array.from({ length: 650 }, (_, index) => item(index));
  const f = fixture(original, original, stamp(650));
  f.control.readError = { code: 'unavailable' };
  f.subscribe();
  await until(() => f.repository.get().offline);
  assert.equal(f.repository.get().rows.length, 650);
  f.update(Array.from({ length: 500 }, (_, index) => ({ ...item(index, 2000), quantity: 7 })));
  f.control.readError = null;
  f.online();
  await until(() => [...f.cache.values()].filter((row) => row.quantity === 7).length === 500);
  assert.equal(f.repository.get().error, null);
  assert.equal(f.reads.some((read) => read.constraints.some((part) => part.kind === 'order' && part.field === 'id')
    && !read.constraints.some((part) => part.kind === 'where')), false);
});

test('snapshot confirmado sin docChanges aplica datos que primero llegaron desde caché', async () => {
  const f = fixture([item(0)]);
  f.subscribe();
  await until(() => f.cache.size === 1);
  f.update([{ ...item(0, 20), quantity: 8 }]);
  f.emit(true);
  f.emit(false, true);
  await until(() => f.cache.get('P00000')?.quantity === 8);
  assert.equal(f.metadata.get('sync-v2:tenant:store').cursor.seconds, 20);
});

test('una escritura IndexedDB fallida no permite avanzar cobertura con filas faltantes', async () => {
  const f = fixture([item(0), item(1)]);
  f.failSave();
  f.subscribe();
  await until(() => f.repository.get().error !== null);
  assert.equal(f.metadata.size, 0);
  f.update([{ ...item(0, 20), quantity: 8 }]);
  f.emit();
  await until(() => f.cache.size === 2);
  assert.equal(f.cache.get('P00000').quantity, 8);
  assert.equal(f.metadata.get('sync-v2:tenant:store').cursor.seconds, 20);
});

test('desmontar detiene el listener y otra suscripción recupera cambios pendientes', async () => {
  const f = fixture([item(0)]);
  const stop = f.subscribe();
  await until(() => f.cache.size === 1);
  stop(); f.stop();
  assert.equal(f.watchers.filter((watcher) => watcher.active).length, 0);
  f.update([{ ...item(0, 20), quantity: 8 }]);
  f.subscribe();
  await until(() => f.cache.get('P00000')?.quantity === 8);
  assert.equal(f.watchers.filter((watcher) => watcher.active).length, 1);
});

test('recuperar un cambio en 5000 filas persiste el intervalo y conserva referencias de metadatos', async () => {
  const cached = Array.from({ length: 5000 }, (_, index) => item(index));
  const f = fixture(cached, cached, stamp(5000));
  f.subscribe();
  await until(() => f.control.saves.length > 0);
  f.control.saves.length = 0;
  const changed = { ...item(0, 6000), quantity: 3 };
  f.update([changed]);
  await f.repository.refresh();
  assert.equal(f.cache.size, 5000);
  assert.equal(f.cache.get(changed.id).quantity, 3);
  assert.equal(f.control.saves.some((save) => save.replace), false);
  assert.ok(f.control.saves.reduce((sum, save) => sum + save.count, 0) <= 2);
  const rows = f.repository.get().rows;
  f.emit(true);
  assert.equal(f.repository.get().rows, rows);
});

test('repositorio inactivo libera filas y evento online; otra suscripción conserva la caché', async () => {
  const f = fixture([item(0)]);
  const stop = f.subscribe();
  await f.repository.refresh();
  stop(); f.stop();
  await until(() => f.control.idle === 1);
  assert.equal(f.events.size, 0);
  assert.equal(f.repository.get().rows.length, 0);
  assert.equal(f.cache.size, 1);
  f.subscribe();
  await until(() => f.events.size === 1 && f.repository.get().rows.length === 1);
  assert.equal(f.control.saves.filter((save) => save.replace).length, 1);
});

test('eventos recibidos mientras IndexedDB guarda se persisten antes de avanzar la cobertura', async () => {
  const f = fixture([item(0), item(1)]);
  let release;
  let saving = false;
  const blocked = new Promise((resolve) => { release = resolve; });
  f.control.onSave = async () => { saving = true; await blocked; };
  f.subscribe();
  await until(() => saving);
  f.update([{ ...item(0, 10), quantity: 8 }]);
  f.emit();
  release();
  await until(() => f.metadata.size === 1);
  f.update([{ ...item(1, 20), quantity: 9 }]);
  f.emit();
  await until(() => f.metadata.get('sync-v2:tenant:store').cursor.seconds === 20);
  assert.equal(f.cache.get('P00000').quantity, 8);
  assert.equal(f.cache.get('P00001').quantity, 9);
});

test('catálogo vacío, error de índice y repositorios distintos no mezclan datos', async () => {
  const empty = fixture([]);
  await empty.repository.refresh();
  assert.equal(empty.cache.size, 0);
  const other = fixture([item(1)]);
  other.control.readError = { code: 'failed-precondition' };
  await other.repository.refresh();
  assert.match(other.repository.get().error, /índice/);
  assert.equal(empty.repository.get().error, null);
  other.control.readError = null;
  await other.repository.refresh();
  assert.equal(other.cache.size, 1);
  assert.equal(empty.cache.size, 0);
});
