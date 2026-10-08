import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-denzoz-ops';
const tenantId = 'tenant-ops';
if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST) || !['127.0.0.1:9099', 'localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('Las pruebas requieren emuladores locales explícitos.');
const app = initializeApp({ projectId }, `inventory-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);
after(async () => { await db.terminate(); });

before(async () => {
  const authReset = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  const dataReset = await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(authReset.ok, true); assert.equal(dataReset.ok, true);
});

async function createIdentity(email) {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
    }
  );
  assert.equal(response.ok, true);
  return response.json();
}

async function signInIdentity(email) {
  const response = await fetch(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test1234!', returnSecureToken: true })
    }
  );
  assert.equal(response.ok, true);
  return response.json();
}

async function callFunction(name, data, token) {
  if (['createInventoryTransfer', 'adjustInventory', 'recordStockIngress', 'createQuotationRecord', 'createReplenishmentRecord', 'saveLocation', 'saveCatalogProduct'].includes(name) && !data.requestId) data = { ...data, requestId: crypto.randomUUID() };
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ data })
    }
  );
  const body = await response.json();
  return { ok: response.ok && body.result !== undefined, body };
}

test('transferencias concurrentes mantienen stock, kardex y estado atómicos', { timeout: 90000 }, async () => {
  const [admin, pos] = await Promise.all([
    createIdentity('admin-ops@example.com'),
    createIdentity('pos-ops@example.com')
  ]);
  await Promise.all([
    db.doc(`users/${admin.localId}`).set({
      displayName: 'Administrador', email: 'admin-ops@example.com', role: 'admin', tenantId, active: true
    }),
    db.doc(`users/${pos.localId}`).set({
      displayName: 'Caja', email: 'pos-ops@example.com', role: 'pos', tenantId, storeId: 'S1', active: true
    }),
    db.doc(`tenants/${tenantId}/warehouses/W1`).set({ tenantId, name: 'Central', code: 'W1', isCentral: true }),
    db.doc(`tenants/${tenantId}/stores/S1`).set({ tenantId, name: 'Tienda', code: 'S1', address: '' }),
    db.doc(`tenants/${tenantId}/products/P1`).set({
      tenantId,
      name: 'Producto', category: 'Prueba', unit: 'UN', salePrice: 10,
      minStock: 1, active: true
    }),
    db.doc(`tenants/${tenantId}/product_stocks/P1_W1`).set({
      tenantId,
      productId: 'P1', productName: 'Producto', salePrice: 10,
      locationType: 'warehouse', locationId: 'W1', locationName: 'Central',
      quantity: 5, updatedAt: 1
    })
  ]);

  const payload = {
    fromLocationId: 'W1', fromLocationType: 'warehouse',
    toLocationId: 'S1', toLocationType: 'store',
    items: [{ productId: 'P1', qtySent: 4 }]
  };
  const attempts = await Promise.all([
    callFunction('createInventoryTransfer', payload, admin.idToken),
    callFunction('createInventoryTransfer', payload, admin.idToken)
  ]);
  assert.equal(attempts.filter((result) => result.ok).length, 1);

  const stockAfterDispatch = await db.doc(`tenants/${tenantId}/product_stocks/P1_W1`).get();
  assert.equal(stockAfterDispatch.data().quantity, 1);
  const transfers = await db.collection(`tenants/${tenantId}/transfers`).get();
  assert.equal(transfers.size, 1);
  const transferId = transfers.docs[0].id;
  const dispatchMovements = await db.collection(`tenants/${tenantId}/stock_movements`).get();
  assert.equal(dispatchMovements.size, 1);
  assert.equal(dispatchMovements.docs[0].data().qty, -4);

  const cancellations = await Promise.all([
    callFunction('cancelInventoryTransfer', { transferId }, admin.idToken),
    callFunction('cancelInventoryTransfer', { transferId }, admin.idToken)
  ]);
  assert.equal(cancellations.filter((result) => result.ok).length, 1);

  const [stockAfterCancel, transferAfterCancel, allMovements] = await Promise.all([
    db.doc(`tenants/${tenantId}/product_stocks/P1_W1`).get(),
    db.doc(`tenants/${tenantId}/transfers/${transferId}`).get(),
    db.collection(`tenants/${tenantId}/stock_movements`).get()
  ]);
  assert.equal(stockAfterCancel.data().quantity, 5);
  assert.equal(transferAfterCancel.data().status, 'cancelado');
  assert.equal(allMovements.size, 2);
  assert.equal(allMovements.docs.reduce((sum, movement) => sum + movement.data().qty, 0), 0);

  const dispatch = await callFunction('createInventoryTransfer', payload, admin.idToken);
  assert.equal(dispatch.ok, true);
  const receivedTransferId = dispatch.body.result.id;
  const receptions = await Promise.all([
    callFunction('receiveTransfer', { transferId: receivedTransferId, quantities: { P1: 4 } }, pos.idToken),
    callFunction('receiveTransfer', { transferId: receivedTransferId, quantities: { P1: 4 } }, pos.idToken)
  ]);
  assert.equal(receptions.filter((result) => result.ok).length, 1);

  const [sourceAfterReception, destinationAfterReception, receivedTransfer, finalMovements] = await Promise.all([
    db.doc(`tenants/${tenantId}/product_stocks/P1_W1`).get(),
    db.doc(`tenants/${tenantId}/product_stocks/P1_S1`).get(),
    db.doc(`tenants/${tenantId}/transfers/${receivedTransferId}`).get(),
    db.collection(`tenants/${tenantId}/stock_movements`).get()
  ]);
  assert.equal(sourceAfterReception.data().quantity, 1);
  assert.equal(destinationAfterReception.data().quantity, 4);
  assert.equal(receivedTransfer.data().status, 'recibido');
  assert.equal(finalMovements.size, 4);
  assert.equal(finalMovements.docs.reduce((sum, movement) => sum + movement.data().qty, 0), 0);
});

test('POS multi-tienda selecciona local, vende fracciones y el servidor controla el precio', { timeout: 90000 }, async () => {
  const saleTenantId = 'tenant-sale-fractions';
  const [regularPos, multiStorePos] = await Promise.all([
    createIdentity('pos-sale-regular@example.com'),
    createIdentity('pos-sale-multi@example.com')
  ]);

  await Promise.all([
    db.doc(`users/${regularPos.localId}`).set({
      displayName: 'Caja fija', email: 'pos-sale-regular@example.com', role: 'pos',
      tenantId: saleTenantId, storeId: 'S1', active: true
    }),
    db.doc(`users/${multiStorePos.localId}`).set({
      displayName: 'Caja multi-tienda', email: 'pos-sale-multi@example.com', role: 'pos',
      tenantId: saleTenantId, storeId: null, storeAccess: 'all', active: true
    }),
    db.doc(`tenants/${saleTenantId}/config/company`).set({
      tenantId: saleTenantId, serieBoleta: 'B001', igvRate: 0.18,
      minBoletaSinDni: 700, umbralConsolidacion: 5
    }),
    db.doc(`tenants/${saleTenantId}/stores/S1`).set({
      tenantId: saleTenantId, name: 'Tienda Uno', code: 'S1', address: ''
    }),
    db.doc(`tenants/${saleTenantId}/products/P1`).set({
      tenantId: saleTenantId, name: 'Lapicero', category: 'Prueba', unit: 'UN',
      barcode: 'BASE-1', salePrice: 1, minStock: 1, active: true,
      presentations: [{
        id: 'caja-12', unit: 'CJA', description: 'Caja x12', factor: 12,
        barcode: 'CAJA-12', salePrice: 10, allowFractionalSale: true,
        fractionStep: 0.5, autoUnpackEnabled: true, autoUnpackPriority: 1
      }]
    }),
    db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).set({
      tenantId: saleTenantId, productId: 'P1', productName: 'Lapicero', salePrice: 1,
      locationType: 'store', locationId: 'S1', locationName: 'Tienda Uno',
      baseQuantity: 6, presentationQuantities: { 'caja-12': 2 },
      quantity: 30, stockModelVersion: 2, updatedAt: 1
    })
  ]);

  await auth.setCustomUserClaims(multiStorePos.localId, {
    tenantId: saleTenantId,
    role: 'pos',
    posStoreAccess: 'all',
    canOverridePrices: true
  });
  const refreshedMultiStorePos = await signInIdentity('pos-sale-multi@example.com');

  const selected = await callFunction('selectPosStore', { storeId: 'S1' }, refreshedMultiStorePos.idToken);
  assert.equal(selected.ok, true);
  assert.equal(selected.body.result.storeId, 'S1');
  assert.equal((await db.doc(`users/${multiStorePos.localId}`).get()).data().storeId, null);

  const regularCash = await callFunction('openCashSession', { openingAmount: 50 }, regularPos.idToken);
  const multiCash = await callFunction('openCashSession', { openingAmount: 20, storeId: 'S1' }, refreshedMultiStorePos.idToken);
  assert.equal(regularCash.ok, true); assert.equal(multiCash.ok, true);
  const salePayload = {
    requestId: crypto.randomUUID(), cashSessionId: regularCash.body.result.id,
    storeId: 'S1',
    clientDoc: { tipo: '-', numero: '', nombre: 'Consumidor Final' },
    items: [{
      productId: 'P1', qty: 0.5, presentationId: 'caja-12', presentationUnit: 'CJA', barcode: 'CAJA-12',
      unitPrice: 8, total: 4
    }],
    paymentMethod: 'efectivo',
    paidAmount: 10,
    type: 'boleta'
  };

  const stalePrice = await callFunction('createSaleRecord', salePayload, regularPos.idToken);
  assert.equal(stalePrice.ok, false);
  const regularSale = await callFunction('createSaleRecord', { ...salePayload, requestId: crypto.randomUUID(), items: [{ ...salePayload.items[0], unitPrice: 10 }] }, regularPos.idToken);
  assert.equal(regularSale.ok, true);
  assert.equal(regularSale.body.result.sale.items[0].unitPrice, 10);
  assert.equal(regularSale.body.result.sale.items[0].total, 5);
  assert.equal(regularSale.body.result.sale.items[0].priceOverridden, false);
  const stockAfterRegular = (await db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).get()).data();
  assert.equal(stockAfterRegular.quantity, 24);
  assert.equal(stockAfterRegular.baseQuantity, 24);
  assert.deepEqual(stockAfterRegular.presentationQuantities, {});

  const multiPayload = { ...salePayload, requestId: crypto.randomUUID(), cashSessionId: multiCash.body.result.id };
  const multiStoreSale = await callFunction('createSaleRecord', multiPayload, refreshedMultiStorePos.idToken);
  assert.equal(multiStoreSale.ok, true);
  assert.equal(multiStoreSale.body.result.sale.items[0].catalogUnitPrice, 10);
  assert.equal(multiStoreSale.body.result.sale.items[0].unitPrice, 8);
  assert.equal(multiStoreSale.body.result.sale.items[0].total, 4);
  assert.equal(multiStoreSale.body.result.sale.items[0].priceOverridden, true);
  const stockAfterMulti = (await db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).get()).data();
  assert.equal(stockAfterMulti.quantity, 18);
  assert.equal(stockAfterMulti.baseQuantity, 18);
  assert.deepEqual(stockAfterMulti.presentationQuantities, {});

  const unavailablePackage = await callFunction('createSaleRecord', { ...multiPayload, requestId: crypto.randomUUID(), items: [{ productId: 'P1', qty: 2, presentationId: 'caja-12' }], paidAmount: 30 }, refreshedMultiStorePos.idToken);
  assert.equal(unavailablePackage.ok, false);
});

test('una operación conserva varias presentaciones del mismo producto sin sobrescribir stock', { timeout: 90000 }, async () => {
  const scopedTenantId = 'tenant-multiple-presentations';
  const admin = await createIdentity('admin-multiple-presentations@example.com');
  const pos = await createIdentity('pos-multiple-presentations@example.com');
  await Promise.all([
    db.doc(`users/${admin.localId}`).set({
      displayName: 'Administrador', email: 'admin-multiple-presentations@example.com',
      role: 'admin', tenantId: scopedTenantId, active: true
    }),
    db.doc(`users/${pos.localId}`).set({
      displayName: 'Caja', email: 'pos-multiple-presentations@example.com',
      role: 'pos', tenantId: scopedTenantId, storeId: 'S1', active: true
    }),
    db.doc(`tenants/${scopedTenantId}/warehouses/W1`).set({
      tenantId: scopedTenantId, name: 'Central', code: 'W1', isCentral: true
    }),
    db.doc(`tenants/${scopedTenantId}/stores/S1`).set({
      tenantId: scopedTenantId, name: 'Tienda', code: 'S1', address: ''
    }),
    db.doc(`tenants/${scopedTenantId}/products/P1`).set({
      tenantId: scopedTenantId, name: 'Producto', category: 'Prueba', unit: 'UN',
      salePrice: 1, minStock: 1, active: true,
      presentations: [
        { id: 'caja-12', unit: 'CJA', factor: 12, salePrice: 10, allowFractionalSale: false, fractionStep: 0.5, autoUnpackEnabled: false, autoUnpackPriority: 1 },
        { id: 'caja-30', unit: 'CJA', factor: 30, salePrice: 22, allowFractionalSale: false, fractionStep: 0.5, autoUnpackEnabled: false, autoUnpackPriority: 2 }
      ]
    })
  ]);

  const ingress = await callFunction('recordStockIngress', {
    locationId: 'W1', locationType: 'warehouse',
    items: [
      { productId: 'P1', presentationId: null, qty: 5 },
      { productId: 'P1', presentationId: 'caja-12', qty: 2 },
      { productId: 'P1', presentationId: 'caja-30', qty: 1 }
    ]
  }, admin.idToken);
  assert.equal(ingress.ok, true);
  const afterIngress = (await db.doc(`tenants/${scopedTenantId}/product_stocks/P1_W1`).get()).data();
  assert.equal(afterIngress.baseQuantity, 5);
  assert.deepEqual(afterIngress.presentationQuantities, { 'caja-12': 2, 'caja-30': 1 });
  assert.equal(afterIngress.quantity, 59);

  const transfer = await callFunction('createInventoryTransfer', {
    fromLocationId: 'W1', fromLocationType: 'warehouse',
    toLocationId: 'S1', toLocationType: 'store',
    items: [
      { productId: 'P1', presentationId: 'caja-12', qtySent: 1 },
      { productId: 'P1', presentationId: 'caja-30', qtySent: 1 }
    ]
  }, admin.idToken);
  assert.equal(transfer.ok, true);
  const afterDispatch = (await db.doc(`tenants/${scopedTenantId}/product_stocks/P1_W1`).get()).data();
  assert.deepEqual(afterDispatch.presentationQuantities, { 'caja-12': 1, 'caja-30': 0 });
  assert.equal(afterDispatch.quantity, 17);

  const reception = await callFunction('receiveTransfer', {
    transferId: transfer.body.result.id,
    quantities: { 'P1:caja-12': 1, 'P1:caja-30': 1 }
  }, pos.idToken);
  assert.equal(reception.ok, true);
  const destination = (await db.doc(`tenants/${scopedTenantId}/product_stocks/P1_S1`).get()).data();
  assert.equal(destination.baseQuantity, 0);
  assert.deepEqual(destination.presentationQuantities, { 'caja-12': 1, 'caja-30': 1 });
  assert.equal(destination.quantity, 42);
  const root = `tenants/${scopedTenantId}`;
  const destinationRef = db.doc(`${root}/product_stocks/P1_S1`);
  await destinationRef.update({ baseQuantity: 34, quantity: 34, presentationQuantities: {}, stockModelVersion: 3 });
  const reconcile = (newQty) => callFunction('adjustInventory', { locationId: 'S1', productId: 'P1', presentationId: 'caja-12', newQty, type: 'reclasificar', reason: 'Conteo: 10 sueltos y 2 cajas de 12' }, admin.idToken);
  assert.equal((await reconcile(3)).ok, false);
  assert.equal((await reconcile(2)).ok, true);
  assert.equal((await reconcile(2)).ok, true);
  assert.equal((await destinationRef.get()).data().requiresReconciliation, true);
  assert.equal((await callFunction('adjustInventory', { locationId: 'S1', productId: 'P1', presentationId: 'caja-30', newQty: 0, type: 'reclasificar', reason: 'No hay cajas de 30' }, admin.idToken)).ok, true);
  const classified = (await destinationRef.get()).data();
  assert.equal(classified.requiresReconciliation, false);
  assert.equal(classified.quantity, 34);
  assert.equal(classified.baseQuantity, 10);
  assert.equal(classified.presentationQuantities['caja-12'], 2);
  const restock = await callFunction('createReplenishmentRecord', { storeId: 'S1', items: [
    { productId: 'P1', requestedQty: 10 }, { productId: 'P1', presentationId: 'caja-12', requestedQty: 2 }
  ] }, pos.idToken);
  assert.equal(restock.ok, true, JSON.stringify(restock.body));
  const requested = (await db.doc(`${root}/replenishment_requests/${restock.body.result.id}`).get()).data();
  assert.equal(requested.items.length, 2);
  assert.equal(requested.items[0].currentQty, 10);
  assert.equal(requested.items[1].currentQty, 2);
  assert.equal((await callFunction('createReplenishmentRecord', { storeId: 'S1', items: [{ productId: 'P1', presentationId: 'caja-12', requestedQty: 0.5 }] }, pos.idToken)).ok, false);
  const quote = (items) => callFunction('createQuotationRecord', { storeId: 'S1', items }, pos.idToken);
  assert.equal((await quote([{ productId: 'P1', qty: 0.5 }])).ok, false);
  assert.equal((await quote([{ productId: 'P1', presentationId: 'caja-12', qty: 0.5 }])).ok, false);
  const validQuote = await quote([{ productId: 'P1', qty: 10 }, { productId: 'P1', presentationId: 'caja-12', qty: 2 }]);
  assert.equal(validQuote.ok, true, JSON.stringify(validQuote.body));
  assert.ok(validQuote.body.result.items.every((item) => item.isAvailable));
  const unavailable = await quote([{ productId: 'P1', qty: 11 }]);
  assert.equal(unavailable.body.result.items[0].isAvailable, false);
  const closedTransfer = await callFunction('createInventoryTransfer', { fromLocationId: 'S1', fromLocationType: 'store', toLocationId: 'W1', toLocationType: 'warehouse', items: [{ productId: 'P1', presentationId: 'caja-12', qtySent: 1 }] }, admin.idToken);
  assert.equal(closedTransfer.ok, true);
  assert.equal((await callFunction('cancelInventoryTransfer', { transferId: closedTransfer.body.result.id }, admin.idToken)).ok, true);
  assert.equal((await destinationRef.get()).data().baseQuantity, 10);
  assert.equal((await destinationRef.get()).data().presentationQuantities['caja-12'], 2);
  await destinationRef.update({ baseQuantity: 9.5, quantity: 33.5 });
  const repairHalfUnit = await callFunction('adjustInventory', { locationId: 'S1', productId: 'P1', newQty: 10, type: 'ajuste', reason: 'Corregir fracción antigua según conteo físico' }, admin.idToken);
  assert.equal(repairHalfUnit.ok, true, JSON.stringify(repairHalfUnit.body));
  assert.equal((await destinationRef.get()).data().quantity, 34);
  assert.equal((await destinationRef.get()).data().presentationQuantities['caja-12'], 2);

});

test('cobros idempotentes, caja servidor, precios vigentes, privacidad y faltantes', { timeout: 180000 }, async () => {
  const tenant = 'tenant-hardening';
  const [pos, admin, worker] = await Promise.all([
    createIdentity('pos-hardening@example.com'), createIdentity('admin-hardening@example.com'), createIdentity('worker-hardening@example.com')
  ]);
  const root = `tenants/${tenant}`;
  await Promise.all([
    ...[[pos, 'pos'], [admin, 'admin'], [worker, 'trabajador']].map(([identity, role]) => db.doc(`users/${identity.localId}`).set({ tenantId: tenant, role, storeId: 'S1', displayName: role, active: true })),
    db.doc(`${root}/config/company`).set({ serieBoleta: 'B001', serieFactura: 'F001', serieNota: 'NV01', igvRate: 0.18, minBoletaSinDni: 700, umbralConsolidacion: 5 }),
    db.doc(`${root}/stores/S1`).set({ name: 'Tienda', tenantId: tenant }),
    db.doc(`${root}/warehouses/W1`).set({ name: 'Central', tenantId: tenant, isCentral: true }),
    db.doc(`${root}/products/P1`).set({ name: 'Producto', salePrice: 7, active: true, unit: 'UN', presentations: [] }),
    ...['S1', 'W1'].map((locationId) => db.doc(`${root}/product_stocks/P1_${locationId}`).set({ tenantId: tenant, productId: 'P1', productName: 'Producto', locationId, locationType: locationId === 'S1' ? 'store' : 'warehouse', baseQuantity: 20, quantity: 20, presentationQuantities: {}, stockModelVersion: 2, salePrice: 3, updatedAt: 1 })),
    db.doc(`${root}/clients/DNI-12345678`).set({ tenantId: tenant, tipo: 'DNI', numero: '12345678', nombre: 'Cliente', updatedAt: Date.now() })
  ]);
  const noCash = await callFunction('createSaleRecord', { requestId: crypto.randomUUID(), storeId: 'S1', type: 'boleta', items: [{ productId: 'P1', qty: 1 }], paymentMethod: 'efectivo', paidAmount: 10 }, pos.idToken);
  assert.equal(noCash.ok, false);
  const openings = await Promise.all([
    callFunction('openCashSession', { openingAmount: 50 }, pos.idToken),
    callFunction('openCashSession', { openingAmount: 50 }, pos.idToken)
  ]);
  assert.equal(openings.filter((r) => r.ok).length, 1);
  const sessionId = openings.find((r) => r.ok).body.result.id;
  const input = { requestId: crypto.randomUUID(), storeId: 'S1', cashSessionId: sessionId, type: 'boleta', items: [{ productId: 'P1', qty: 1 }], clientDoc: { tipo: '-', numero: '', nombre: '' }, paymentMethod: 'efectivo', paidAmount: 20 };
  const concurrent = await Promise.all([callFunction('createSaleRecord', input, pos.idToken), callFunction('createSaleRecord', input, pos.idToken)]);
  assert.ok(concurrent.every((r) => r.ok), JSON.stringify(concurrent));
  assert.equal(concurrent[0].body.result.id, concurrent[1].body.result.id);
  assert.equal(concurrent[0].body.result.sale.total, 7);
  assert.equal((await db.doc(`${root}/product_stocks/P1_S1`).get()).data().quantity, 19);
  assert.equal((await db.collection(`${root}/stock_movements`).where('type', '==', 'venta').get()).size, 1);
  assert.equal((await callFunction('createSaleRecord', { ...input, paidAmount: 30 }, pos.idToken)).ok, false);
  const recovered = await callFunction('resumeSaleRecord', { requestId: input.requestId }, pos.idToken);
  assert.equal(recovered.body.result.id, concurrent[0].body.result.id);
  const cancelledId = crypto.randomUUID();
  const cancelled = await callFunction('resumeSaleRecord', { requestId: cancelledId }, pos.idToken);
  assert.equal(cancelled.body.result.cancelled, true);
  assert.equal((await callFunction('createSaleRecord', { ...input, requestId: cancelledId }, pos.idToken)).ok, false);
  for (const invalid of [
    { paymentMethod: 'yape', paidAmount: -1 }, { paymentMethod: 'yape', paidAmount: 8 },
    { type: 'factura', clientDoc: { tipo: '-', numero: '20123456789', nombre: 'Cliente' } },
    { paymentMethod: 'transferencia', paidAmount: 7, bankName: '' }
  ]) assert.equal((await callFunction('createSaleRecord', { ...input, ...invalid, requestId: crypto.randomUUID() }, pos.idToken)).ok, false);
  assert.equal((await db.doc(`${root}/product_stocks/P1_S1`).get()).data().quantity, 19);
  const rejectedId = crypto.randomUUID();
  assert.equal((await callFunction('createSaleRecord', { ...input, requestId: rejectedId, paidAmount: 1 }, pos.idToken)).ok, false);
  assert.equal((await callFunction('resumeSaleRecord', { requestId: rejectedId }, pos.idToken)).body.result.cancelled, true);
  assert.equal((await callFunction('createSaleRecord', { ...input, requestId: rejectedId }, pos.idToken)).ok, false);
  const yape = await callFunction('createSaleRecord', { ...input, requestId: crypto.randomUUID(), paymentMethod: 'yape', paidAmount: 7 }, pos.idToken);
  assert.equal(yape.ok, true);
  const close = await callFunction('closeCashSession', { sessionId, closingAmount: 57 }, pos.idToken);
  assert.equal(close.ok, true, JSON.stringify(close.body));
  assert.deepEqual(close.body.result.salesSummary, { totalSales: 14, cashSales: 7, yapeSales: 7, cardSales: 0, otherSales: 0, salesCount: 2 });
  assert.equal(close.body.result.expectedAmount, 57);
  assert.equal(close.body.result.difference, 0);
  const again = await callFunction('closeCashSession', { sessionId, closingAmount: 57 }, pos.idToken);
  assert.deepEqual(again.body.result.salesSummary, close.body.result.salesSummary);
  assert.equal((await callFunction('createSaleRecord', { ...input, requestId: crypto.randomUUID() }, pos.idToken)).ok, false);
  assert.equal((await callFunction('resumeSaleRecord', { requestId: input.requestId }, pos.idToken)).body.result.id, concurrent[0].body.result.id);
  const quote = await callFunction('createQuotationRecord', { storeId: 'S1', items: [{ productId: 'P1', qty: 2, unitPrice: 0.01, total: 0.02, name: '<script>' }], clientName: 'Cliente' }, worker.idToken);
  assert.equal(quote.ok, true, JSON.stringify(quote.body));
  assert.equal(quote.body.result.totalAll, 14);
  assert.equal(quote.body.result.items[0].name, 'Producto');
  for (const item of [null, { productId: 'P1', qty: -2 }, { productId: 'P1', qty: Infinity }]) {
    assert.equal((await callFunction('createQuotationRecord', { storeId: 'S1', items: [item] }, worker.idToken)).ok, false);
  }
  assert.equal((await callFunction('createReplenishmentRecord', { storeId: 'S1', items: [{ productId: 'P1', requestedQty: 2 }] }, pos.idToken)).ok, true);
  assert.equal((await callFunction('createReplenishmentRecord', { storeId: 'S1', items: [{ productId: 'P1', requestedQty: -1 }] }, pos.idToken)).ok, false);
  assert.equal((await callFunction('lookupClient', { type: 'dni', number: '12345678' }, worker.idToken)).ok, false);
  for (let n = 0; n < 10; n++) assert.equal((await callFunction('lookupClient', { type: 'dni', number: '12345678' }, pos.idToken)).ok, true);
  await db.doc(`${root}/lookup_limits/${pos.localId}`).set({ minute: Math.floor(Date.now() / 60000), day: Math.floor(Date.now() / 86400000), minuteCount: 10, dayCount: 10 });
  assert.equal((await callFunction('lookupClient', { type: 'dni', number: '12345678' }, pos.idToken)).body.error.status, 'RESOURCE_EXHAUSTED');
  const dispatch = await callFunction('createInventoryTransfer', { fromLocationId: 'W1', fromLocationType: 'warehouse', toLocationId: 'S1', toLocationType: 'store', items: [{ productId: 'P1', qtySent: 4 }] }, admin.idToken);
  assert.equal(dispatch.ok, true);
  const transferId = dispatch.body.result.id;
  assert.equal((await callFunction('receiveTransfer', { transferId, quantities: {} }, pos.idToken)).ok, false);
  assert.equal((await callFunction('receiveTransfer', { transferId, quantities: { P1: 2 } }, pos.idToken)).ok, true);
  const partial = (await db.doc(`${root}/transfers/${transferId}`).get()).data();
  assert.equal(partial.status, 'recibido'); assert.equal(partial.shortageStatus, 'pendiente');
  assert.equal(partial.items[0].qtyMissing, 2);
  const resolutions = await Promise.all([
    callFunction('resolveTransferShortage', { transferId, action: 'devolver', reason: 'Verificación física' }, admin.idToken),
    callFunction('resolveTransferShortage', { transferId, action: 'devolver', reason: 'Verificación física' }, admin.idToken)
  ]);
  assert.ok(resolutions.every((r) => r.ok));
  assert.equal((await db.doc(`${root}/product_stocks/P1_W1`).get()).data().quantity, 18);
  assert.equal((await db.doc(`${root}/product_stocks/P1_S1`).get()).data().quantity, 20);
  const merma = await callFunction('adjustInventory', { locationId: 'S1', productId: 'P1', newQty: 30, reason: 'Prueba', type: 'merma' }, admin.idToken);
  assert.equal(merma.ok, false);
  assert.equal((await callFunction('migrateCatalogAndStocks', {}, admin.idToken)).ok, false);
  assert.equal((await callFunction('saveCustomUnits', { units: Array.from({ length: 50 }, (_, i) => `UN${i}`) }, admin.idToken)).ok, true);
  assert.equal((await callFunction('saveCustomUnits', { units: ['UN', { name: 'CJA' }] }, admin.idToken)).ok, false);
  assert.equal((await callFunction('saveCustomUnits', { units: ['CJA'] }, worker.idToken)).ok, false);
  await db.doc(`${root}/meta/inventory_maintenance`).set({ active: true });
  assert.equal((await callFunction('openCashSession', { openingAmount: 10 }, pos.idToken)).body.error.status, 'UNAVAILABLE');
  await db.doc(`${root}/meta/inventory_maintenance`).delete();
});


test('stock común: hojas, precios por presentación, cotizaciones, reposición y transferencias fraccionadas', { timeout: 180000 }, async () => {
  const tenant = 'tenant-shared-stock';
  const root = `tenants/${tenant}`;
  const [admin, pos, worker] = await Promise.all([createIdentity('shared-admin@example.com'), createIdentity('shared-pos@example.com'), createIdentity('shared-worker@example.com')]);
  const presentations = [
    { id: 'millar', unit: 'MIL', factor: 1000, salePrice: 100, allowFractionalSale: true, fractionStep: 0.1, autoUnpackEnabled: true },
    { id: 'ciento', unit: 'CTO', factor: 100, salePrice: 12, allowFractionalSale: true, fractionStep: 0.5, autoUnpackEnabled: true },
    { autoUnpackEnabled: true, id: 'cincuenta', unit: 'PQ', factor: 50, salePrice: 7, allowFractionalSale: false }
  ];
  await Promise.all([
    ...[[admin, 'admin'], [pos, 'pos'], [worker, 'trabajador']].map(([user, role]) => db.doc(`users/${user.localId}`).set({ tenantId: tenant, role, storeId: 'S1', displayName: role, active: true })),
    db.doc(`${root}/stores/S1`).set({ tenantId: tenant, name: 'Tienda' }),
    db.doc(`${root}/warehouses/W1`).set({ tenantId: tenant, name: 'Central', isCentral: true }),
    db.doc(`${root}/config/company`).set({ serieBoleta: 'B001', serieNota: 'NV01', igvRate: 0.18, minBoletaSinDni: 700, umbralConsolidacion: 5 }),
    db.doc(`${root}/products/P1`).set({ name: 'Hojas bond', salePrice: 0.2, unit: 'UN', active: true, presentations }),
    ...['W1', 'S1'].map((locationId) => db.doc(`${root}/product_stocks/P1_${locationId}`).set({ tenantId: tenant, productId: 'P1', productName: 'Hojas bond', locationId, quantity: 1050, baseQuantity: 50, presentationQuantities: { millar: 1 }, stockModelVersion: 2 }))
  ]);
  const balance = async (location = 'S1') => (await db.doc(`${root}/product_stocks/P1_${location}`).get()).data().quantity;
  const cash = await callFunction('openCashSession', { openingAmount: 0 }, pos.idToken);
  assert.equal(cash.ok, true, JSON.stringify(cash.body));
  const sale = (items, paidAmount) => callFunction('createSaleRecord', { requestId: crypto.randomUUID(), storeId: 'S1', cashSessionId: cash.body.result.id, type: 'nota', items, paymentMethod: 'yape', paidAmount, clientDoc: { tipo: '-', numero: '', nombre: '' } }, pos.idToken);
  assert.equal((await sale([{ productId: 'P1', qty: 100 }], 20)).ok, true);
  assert.equal(await balance(), 950);
  assert.equal((await sale([{ productId: 'P1', presentationId: 'millar', qty: 1 }], 100)).ok, false);
  assert.equal(await balance(), 950);
  const half = await sale([{ productId: 'P1', presentationId: 'millar', qty: 0.5, unitPrice: 100 }], 50);
  assert.equal(half.ok, true, JSON.stringify(half.body));
  assert.equal(half.body.result.sale.total, 50);
  assert.equal(half.body.result.sale.items[0].baseUnitsSold, 500);
  assert.equal(await balance(), 450);
  assert.equal((await sale([{ productId: 'P1', presentationId: 'cincuenta', qty: 1 }], 7)).ok, true);
  assert.equal(await balance(), 400);
  assert.equal((await sale([{ productId: 'P1', presentationId: 'ciento', qty: 4 }, { productId: 'P1', qty: 1 }], 48.2)).ok, false);
  assert.equal(await balance(), 400);
  const quote = await callFunction('createQuotationRecord', { storeId: 'S1', items: [{ productId: 'P1', presentationId: 'millar', qty: 0.5 }, { productId: 'P1', presentationId: 'ciento', qty: 2 }, { productId: 'P1', presentationId: 'cincuenta', qty: 5 }] }, worker.idToken);
  assert.equal(quote.ok, true, JSON.stringify(quote.body));
  assert.deepEqual(quote.body.result.items.map((item) => item.isAvailable), [false, true, false]);
  assert.equal(quote.body.result.totalAvailable, 24);
  assert.equal(await balance(), 400);
  const dispatch = (items) => callFunction('createInventoryTransfer', { fromLocationId: 'W1', fromLocationType: 'warehouse', toLocationId: 'S1', toLocationType: 'store', items }, admin.idToken);
  const transfer = await dispatch([{ productId: 'P1', presentationId: 'millar', qtySent: 0.5 }, { productId: 'P1', presentationId: 'ciento', qtySent: 1 }]);
  assert.equal(transfer.ok, true, JSON.stringify(transfer.body));
  assert.equal(await balance('W1'), 450);
  const reception = await callFunction('receiveTransfer', { transferId: transfer.body.result.id, quantities: { 'P1:millar': 0.4, 'P1:ciento': 0.5 } }, pos.idToken);
  assert.equal(reception.ok, true, JSON.stringify(reception.body));
  assert.equal(await balance(), 850);
  assert.equal((await callFunction('resolveTransferShortage', { transferId: transfer.body.result.id, action: 'devolver', reason: 'Retorno físico de 150 hojas' }, admin.idToken)).ok, true);
  assert.equal(await balance('W1'), 600);
  const cancelled = await dispatch([{ productId: 'P1', presentationId: 'millar', qtySent: 0.5 }]);
  assert.equal(cancelled.ok, true);
  assert.equal((await callFunction('cancelInventoryTransfer', { transferId: cancelled.body.result.id }, admin.idToken)).ok, true);
  assert.equal(await balance('W1'), 600);
  const restock = await callFunction('createReplenishmentRecord', { storeId: 'S1', items: [{ productId: 'P1', presentationId: 'millar', requestedQty: 0.5 }] }, pos.idToken);
  assert.equal(restock.ok, true);
  const attended = await callFunction('attendReplenishmentRequest', { requestId: restock.body.result.id, warehouseId: 'W1' }, admin.idToken);
  assert.equal(attended.ok, true, JSON.stringify(attended.body));
  assert.equal(await balance('W1'), 100);
  assert.equal((await callFunction('receiveTransfer', { transferId: attended.body.result.id, quantities: { 'P1:millar': 0.5 } }, pos.idToken)).ok, true);
  assert.equal(await balance(), 1350);
  const adjust = (newQty, type = 'ajuste') => callFunction('adjustInventory', { locationId: 'S1', productId: 'P1', presentationId: 'millar', newQty, type, reason: 'Conteo físico compartido' }, admin.idToken);
  assert.equal((await adjust(0.95)).ok, true);
  assert.equal(await balance(), 950);
  assert.equal((await adjust(0.5, 'merma')).ok, true);
  assert.equal((await adjust(0.6, 'merma')).ok, false);
  assert.equal(await balance(), 500);
  const concurrent = await Promise.all([sale([{ productId: 'P1', presentationId: 'millar', qty: 0.5 }], 50), sale([{ productId: 'P1', presentationId: 'ciento', qty: 5 }], 60)]);
  assert.equal(concurrent.filter((item) => item.ok).length, 1);
  assert.equal(await balance(), 0);
  assert.equal((await adjust(0)).ok, true);
  const stock = (await db.doc(`${root}/product_stocks/P1_S1`).get()).data();
  assert.equal(stock.stockModelVersion, 4);
  assert.deepEqual(stock.presentationQuantities, {});
  const movements = await db.collection(`${root}/stock_movements`).get();
  const localDelta = movements.docs.reduce((sum, doc) => { const item = doc.data(); return sum + (item.toLocationId === 'S1' ? item.qty : 0) + (item.type === 'venta' && item.fromLocationId === 'S1' ? item.qty : 0); }, 0);
  assert.equal(localDelta, -1050);
});
