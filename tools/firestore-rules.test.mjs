import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';

let env;
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const profile = (role, tenantId, storeId = null) => ({
  displayName: role,
  email: `${role}-${tenantId}@example.com`,
  role,
  tenantId,
  storeId,
  active: true,
  createdAt: 1
});

const stock = (tenantId, storeId) => ({
  tenantId,
  productId: 'p1',
  productName: 'Producto',
  barcode: '7750000000001',
  salePrice: 10,
  locationType: 'store',
  locationId: storeId,
  locationName: `Tienda ${storeId}`,
  quantity: 10,
  updatedAt: 1
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-denzoz-rules',
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8') }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/admin-a'), profile('admin', TENANT_A)),
      setDoc(doc(db, 'users/admin-b'), profile('admin', TENANT_B)),
      setDoc(doc(db, 'users/pos-a'), profile('pos', TENANT_A, 'A01')),
      setDoc(doc(db, 'users/pos-b'), profile('pos', TENANT_B, 'B01')),
      setDoc(doc(db, 'users/worker-a'), profile('trabajador', TENANT_A, 'A01')),
      setDoc(doc(db, `tenants/${TENANT_A}/product_stocks/p1_A01`), stock(TENANT_A, 'A01')),
      setDoc(doc(db, `tenants/${TENANT_B}/product_stocks/p1_B01`), stock(TENANT_B, 'B01')),
      setDoc(doc(db, `tenants/${TENANT_A}/config/company`), {
        ruc: '20123456789', razonSocial: 'TENANT A SAC', serieFactura: 'F001',
        serieBoleta: 'B001', entornoSunat: 'beta', igvRate: 0.18,
        minBoletaSinDni: 700, umbralConsolidacion: 5, updatedAt: 1
      }),
      setDoc(doc(db, `tenants/${TENANT_A}/sales/sale1`), {
        tenantId: TENANT_A, storeId: 'A01', userId: 'pos-a', status: 'activa', total: 10
      })
    ]);
  });
});

after(async () => env.cleanup());

test('bloquea usuarios anónimos, perfiles inexistentes y rutas heredadas', async () => {
  const path = `tenants/${TENANT_A}/product_stocks/p1_A01`;
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), path)));
  await assertFails(getDoc(doc(env.authenticatedContext('ghost').firestore(), path)));
  await assertFails(getDoc(doc(env.authenticatedContext('admin-a').firestore(), 'product_stocks/p1_A01')));
});

test('impide lecturas y escrituras entre empresas incluso a administradores', async () => {
  const adminA = env.authenticatedContext('admin-a').firestore();
  const posA = env.authenticatedContext('pos-a').firestore();
  await assertSucceeds(getDoc(doc(adminA, `tenants/${TENANT_A}/product_stocks/p1_A01`)));
  await assertFails(getDoc(doc(adminA, `tenants/${TENANT_B}/product_stocks/p1_B01`)));
  await assertFails(getDoc(doc(posA, `tenants/${TENANT_B}/product_stocks/p1_B01`)));
  await assertFails(setDoc(doc(adminA, `tenants/${TENANT_B}/products/attack`), {
    tenantId: TENANT_B, name: 'Ataque', category: 'X', unit: 'UN', salePrice: 1,
    minStock: 0, active: true, updatedAt: 1
  }));
});

test('el administrador solo enumera perfiles de su empresa', async () => {
  const db = env.authenticatedContext('admin-a').firestore();
  await assertSucceeds(getDocs(query(collection(db, 'users'), where('tenantId', '==', TENANT_A))));
  await assertFails(getDocs(query(collection(db, 'users'), where('tenantId', '==', TENANT_B))));
  await assertFails(getDoc(doc(db, 'users/admin-b')));
});

test('POS y trabajador no pueden mutar stock ni crear ventas directamente', async () => {
  for (const uid of ['pos-a', 'worker-a']) {
    const db = env.authenticatedContext(uid).firestore();
    const stockRef = doc(db, `tenants/${TENANT_A}/product_stocks/p1_A01`);
    await assertSucceeds(getDoc(stockRef));
    await assertFails(updateDoc(stockRef, { quantity: 9 }));
    await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/sales/direct-${uid}`), {
      tenantId: TENANT_A, storeId: 'A01', userId: uid
    }));
  }
});

test('ni el administrador puede saltarse las transacciones servidor de inventario', async () => {
  const db = env.authenticatedContext('admin-a').firestore();
  await assertFails(updateDoc(doc(db, `tenants/${TENANT_A}/product_stocks/p1_A01`), { quantity: 9 }));
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/stock_movements/direct`), {
    tenantId: TENANT_A, type: 'ajuste', productId: 'p1', productName: 'Producto', qty: -1
  }));
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/transfers/direct`), {
    tenantId: TENANT_A, code: 'TR-DIRECT', status: 'pendiente', items: []
  }));
});

test('POS solo abre su propia caja y no puede falsificar tenantId', async () => {
  const db = env.authenticatedContext('pos-a').firestore();
  await assertSucceeds(setDoc(doc(db, `tenants/${TENANT_A}/cash_sessions/own`), {
    tenantId: TENANT_A, storeId: 'A01', userId: 'pos-a', userName: 'Caja',
    openingAmount: 50, status: 'abierta', openedAt: 1
  }));
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/cash_sessions/forged`), {
    tenantId: TENANT_B, storeId: 'A01', userId: 'pos-a', userName: 'Caja',
    openingAmount: 50, status: 'abierta', openedAt: 1
  }));
});

test('POS solo solicita la anulación de su venta', async () => {
  const db = env.authenticatedContext('pos-a').firestore();
  const saleRef = doc(db, `tenants/${TENANT_A}/sales/sale1`);
  await assertSucceeds(getDoc(saleRef));
  await assertFails(updateDoc(saleRef, { status: 'anulada' }));
  await assertSucceeds(updateDoc(saleRef, {
    anulationRequest: { reason: 'Error de cobro', byUserId: 'pos-a', byUserName: 'Caja', requestedAt: 2 },
    anulationStatus: 'solicitada'
  }));
  await assertFails(getDoc(doc(env.authenticatedContext('pos-b').firestore(), `tenants/${TENANT_A}/sales/sale1`)));
});

test('un documento de configuración con secretos no se expone al cliente', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), `tenants/${TENANT_A}/config/company`), {
      apiFactToken: 'legacy-secret'
    });
  });
  await assertFails(getDoc(doc(env.authenticatedContext('admin-a').firestore(), `tenants/${TENANT_A}/config/company`)));
});

test('Storage limita incidencias al tenant y al usuario propietario', async () => {
  const ownRef = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/pos-a/photo.png`);
  await assertSucceeds(uploadString(ownRef, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ownRef));

  const otherTenant = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_B}/incidents/pos-a/attack.png`);
  const otherUser = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/worker-a/attack.png`);
  const invalidType = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/pos-a/attack.exe`);
  await assertFails(uploadString(otherTenant, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertFails(uploadString(otherUser, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertFails(uploadString(invalidType, 'binario', 'raw', { contentType: 'application/octet-stream' }));
  await assertFails(getBytes(ref(env.authenticatedContext('pos-b').storage(), ownRef.fullPath)));
});
