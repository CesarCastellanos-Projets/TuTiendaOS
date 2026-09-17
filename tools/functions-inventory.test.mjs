import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-denzoz-ops';
const tenantId = 'tenant-ops';
const app = initializeApp({ projectId }, `inventory-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);

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
      presentations: [{ unit: 'CJA', factor: 12, barcode: 'CAJA-12', salePrice: 10 }]
    }),
    db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).set({
      tenantId: saleTenantId, productId: 'P1', productName: 'Lapicero', salePrice: 1,
      locationType: 'store', locationId: 'S1', locationName: 'Tienda Uno',
      quantity: 30, updatedAt: 1
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
  assert.equal((await db.doc(`users/${multiStorePos.localId}`).get()).data().storeId, 'S1');

  const salePayload = {
    storeId: 'S1',
    clientDoc: { tipo: '-', numero: '', nombre: 'Consumidor Final' },
    items: [{
      productId: 'P1', qty: 0.5, presentationUnit: 'CJA', barcode: 'CAJA-12',
      unitPrice: 8, total: 4
    }],
    paymentMethod: 'efectivo',
    paidAmount: 10,
    type: 'boleta'
  };

  const regularSale = await callFunction('createSaleRecord', salePayload, regularPos.idToken);
  assert.equal(regularSale.ok, true);
  assert.equal(regularSale.body.result.sale.items[0].unitPrice, 10);
  assert.equal(regularSale.body.result.sale.items[0].total, 5);
  assert.equal(regularSale.body.result.sale.items[0].priceOverridden, false);
  assert.equal((await db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).get()).data().quantity, 24);

  const multiStoreSale = await callFunction('createSaleRecord', salePayload, refreshedMultiStorePos.idToken);
  assert.equal(multiStoreSale.ok, true);
  assert.equal(multiStoreSale.body.result.sale.items[0].catalogUnitPrice, 10);
  assert.equal(multiStoreSale.body.result.sale.items[0].unitPrice, 8);
  assert.equal(multiStoreSale.body.result.sale.items[0].total, 4);
  assert.equal(multiStoreSale.body.result.sale.items[0].priceOverridden, true);
  assert.equal((await db.doc(`tenants/${saleTenantId}/product_stocks/P1_S1`).get()).data().quantity, 18);
});
