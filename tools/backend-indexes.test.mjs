import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const ts = require('typescript');

test('índices de sincronización, colas y listas paginadas están versionados', async () => {
  const configuration = JSON.parse(await readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const required = [
    ['product_stocks', 'COLLECTION', [['locationId', 'ASCENDING'], ['committedAt', 'DESCENDING']]],
    ['product_stocks', 'COLLECTION', [['locationId', 'ASCENDING'], ['committedAt', 'ASCENDING'], ['__name__', 'ASCENDING']]],
    ['sales', 'COLLECTION_GROUP', [['statisticsPending', 'ASCENDING'], ['statisticsNextRetryAt', 'ASCENDING']]],
    ['sales', 'COLLECTION_GROUP', [['consolidated', 'ASCENDING'], ['sunatStatus', 'ASCENDING'], ['sunatNextRetryAt', 'ASCENDING']]],
    ['sales', 'COLLECTION_GROUP', [['creditNoteStatus', 'ASCENDING'], ['creditNoteNextRetryAt', 'ASCENDING']]],
    ['sales', 'COLLECTION', [['userId', 'ASCENDING'], ['storeId', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
    ['sales', 'COLLECTION', [['anulationStatus', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
    ['sunat_summary_jobs', 'COLLECTION_GROUP', [['state', 'ASCENDING'], ['nextAttemptAt', 'ASCENDING']]],
    ['sunat_summary_days', 'COLLECTION_GROUP', [['pending', 'ASCENDING'], ['day', 'ASCENDING']]],
    ['replenishment_push_jobs', 'COLLECTION', [['state', 'ASCENDING'], ['nextAttemptAt', 'ASCENDING']]],
    ['quotations', 'COLLECTION', [['storeId', 'ASCENDING'], ['status', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
    ['incidents', 'COLLECTION', [['storeId', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
    ['incidents', 'COLLECTION', [['storeId', 'ASCENDING'], ['createdBy', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
    ['transfers', 'COLLECTION', [['fromLocationId', 'ASCENDING'], ['shortageStatus', 'ASCENDING']]],
    ['transfers', 'COLLECTION', [['toLocationId', 'ASCENDING'], ['status', 'ASCENDING']]],
    ['stock_movements', 'COLLECTION', [['type', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
  ];
  for (const [group, scope, fields] of required) assert.ok(configuration.indexes.some((index) => index.collectionGroup === group
    && index.queryScope === scope && JSON.stringify(index.fields) === JSON.stringify(fields.map(([fieldPath, order]) => ({ fieldPath, order })))), `${group}: ${JSON.stringify(fields)}`);
  const keys = configuration.indexes.map((index) => JSON.stringify(index));
  assert.equal(new Set(keys).size, keys.length, 'No debe haber índices duplicados.');
});

test('los mapas grandes siguen exentos; solo el ID escalar de cotización admite un índice manual', async () => {
  const configuration = JSON.parse(await readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
  const exemptions = [['sales', 'items'], ['sale_requests', 'input'], ['operation_receipts', 'result'], ['sunat_summary_jobs', 'payload']];
  const overlaps = (field, parent) => field !== 'result.id' && (field === parent || field.startsWith(`${parent}.`));
  assert.ok(configuration.indexes.some((index) => index.collectionGroup === 'operation_receipts'
    && index.fields.some((field) => field.fieldPath === 'kind') && index.fields.some((field) => field.fieldPath === 'result.id')));
  for (const [collection, field] of exemptions) {
    assert.ok(configuration.fieldOverrides.some((rule) => rule.collectionGroup === collection && rule.fieldPath === field && rule.indexes.length === 0));
    assert.ok(!configuration.indexes.some((index) => index.collectionGroup === collection && index.fields.some((entry) => overlaps(entry.fieldPath, field))));
  }
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { await inspect(url); continue; }
      if (!['.ts', '.tsx', '.mjs'].includes(extname(entry.name))) continue;
      const source = ts.createSourceFile(entry.name, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node)) {
          const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(source);
          const field = node.arguments[0];
          if (['where', 'orderBy'].includes(name) && field && ts.isStringLiteral(field)) {
            assert.ok(!exemptions.some(([, parent]) => overlaps(field.text, parent)), `${url.pathname}: consulta sobre ${field.text}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const path of ['../apps/web/src/', '../functions/src/', './']) await inspect(new URL(path, import.meta.url));
});
