import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
  ];
  for (const [group, scope, fields] of required) assert.ok(configuration.indexes.some((index) => index.collectionGroup === group
    && index.queryScope === scope && JSON.stringify(index.fields) === JSON.stringify(fields.map(([fieldPath, order]) => ({ fieldPath, order })))), `${group}: ${JSON.stringify(fields)}`);
  const keys = configuration.indexes.map((index) => JSON.stringify(index));
  assert.equal(new Set(keys).size, keys.length, 'No debe haber índices duplicados.');
});
