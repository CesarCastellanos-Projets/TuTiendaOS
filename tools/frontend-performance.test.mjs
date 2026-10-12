import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { transformSync } = require('esbuild');
async function compile(path, dependencies = {}) {
  const code = transformSync(await readFile(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Blob, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Dependencia inesperada ${name}`);
    return dependencies[name];
  } });
  return module.exports;
}
const { createPhotoCache } = await compile('lib/photo-cache.ts');
const scoring = await compile('lib/catalog-search.ts');
const availability = await compile('lib/stock-availability.ts');

test('fotos deduplican descargas, revalidan permisos y no reutilizan otra sesión', async () => {
  let downloads = 0; let checks = 0; let denied = false;
  const cache = createPhotoCache(async () => { downloads++; return new Blob(['foto']); }, async () => { checks++; if (denied) throw new Error('403'); });
  const [one, two] = await Promise.all([cache.get('A', 'path'), cache.get('A', 'path')]);
  assert.equal(one, two); assert.equal(downloads, 1);
  assert.equal(await cache.get('A', 'path'), one); assert.equal(checks, 1);
  denied = true;
  await assert.rejects(cache.get('A', 'path'), /403/);
  denied = false;
  await cache.get('A', 'path'); assert.equal(downloads, 2);
  await cache.get('B', 'path'); assert.equal(downloads, 3);
  cache.clear(); await cache.get('B', 'path'); assert.equal(downloads, 4);
});

test('fotos conservan el límite de bytes y descartan cargas de sesiones que terminaron', async () => {
  const downloads = [];
  const cache = createPhotoCache(async (path) => { downloads.push(path); return new Blob(['1234']); }, async () => {}, 8);
  await cache.get('A', '1'); await cache.get('A', '2'); await cache.get('A', '1');
  await cache.get('A', '3'); await cache.get('A', '2');
  assert.deepEqual(downloads, ['1', '2', '3', '2']);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let count = 0;
  const switching = createPhotoCache(async () => { count++; if (count === 1) return pending; return new Blob(['nueva']); }, async () => {});
  const old = switching.get('A', 'path');
  switching.clear();
  release(new Blob(['anterior'])); await old;
  assert.equal(await (await switching.get('B', 'path')).text(), 'nueva');
  assert.equal(count, 2);
});

test('búsqueda de 5000 productos mantiene índice y ranking cuando cambia disponibilidad', async () => {
  let cursor = 0;
  const slots = [];
  const memo = (factory, dependencies) => {
    const position = cursor++;
    if (!slots[position] || dependencies.some((value, index) => value !== slots[position].deps[index])) {
      slots[position] = { deps: dependencies, value: factory() };
    }
    return slots[position].value;
  };
  let products = Array.from({ length: 5000 }, (_, index) => ({ id: `P${index}`, active: true, name: `Producto ${index}`, unit: 'UN', category: 'General', salePrice: 1 }));
  products[0] = { ...products[0], name: 'Lápiz azul', barcode: '75001', internalCode: 'INT1', presentations: [
    { id: 'caja', unit: 'CJA', factor: 12, salePrice: 10, barcode: '75012', description: 'Caja azul', autoUnpackEnabled: false }
  ] };
  let normalized = 0; let scores = 0;
  const hooks = await compile('hooks/useStoreCatalog.ts', {
    react: { useMemo: memo }, '../lib/stock-availability': availability,
    '../lib/stock-repository': {}, '../lib/catalog-repository': {}, '../lib/tenant-firestore': {}, '../lib/auth': {},
    './useProductsCatalog': { useProductsCatalog: () => products },
    '../lib/catalog-search': {
      normalizeSearch: (value) => { normalized++; return scoring.normalizeSearch(value); },
      searchScore: (...args) => { scores++; return scoring.searchScore(...args); }
    }
  });
  const stock = { productId: 'P0', quantity: 26, baseQuantity: 2, presentationQuantities: { caja: 2 }, stockModelVersion: 4, locationId: 'S1', locationName: 'Tienda' };
  const render = (items) => { cursor = 0; return hooks.useCatalogSearch(items); };
  let search = render([stock]);
  const initial = search('75012');
  assert.equal(initial[0].presentationId, 'caja'); assert.equal(initial[0].quantity, 2);
  const normalizedBefore = normalized; const scoresBefore = scores;
  assert.equal(normalizedBefore, 5001); assert.equal(scoresBefore, 5001);
  search = render([{ ...stock, quantity: 14, presentationQuantities: { caja: 1 } }]);
  const updated = search('75012');
  assert.equal(updated[0].quantity, 1); assert.equal(normalized, normalizedBefore); assert.equal(scores, scoresBefore);
  assert.equal(search('lapiz azul')[0].searchKey, 'P0_caja');
  assert.equal(search('lpaiz')[0].productId, 'P0');
  assert.equal(search('75001')[0].quantity, 2);
  assert.equal(search('INT1')[0].presentationId, 'caja');
  products = products.map((product) => product.id === 'P0' ? { ...product, active: false } : product);
  search = render([stock]);
  assert.equal(search('75012').length, 0);
  assert.ok(normalized > normalizedBefore);
});
