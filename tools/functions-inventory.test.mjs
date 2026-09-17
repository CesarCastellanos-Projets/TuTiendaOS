import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-denzoz-ops';
const tenantId = 'tenant-ops';
const app = initializeApp({ projectId }, `inventory-${Date.now()}`);
const db = getFirestore(app);

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
