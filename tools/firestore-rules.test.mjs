import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getBytes, getMetadata, ref, uploadString } from 'firebase/storage';

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
    projectId: 'demo-denzoz-ops',
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

after(async () => env?.cleanup?.());

test('incidencias conservan origen, actor y transición de resolución', async () => {
  const path = `tenants/${TENANT_A}/incidents/incident-a`;
  const workerRef = doc(env.authenticatedContext('worker-a').firestore(), path);
  const adminRef = doc(env.authenticatedContext('admin-a').firestore(), path);
  const incident = { tenantId: TENANT_A, storeId: 'A01', storeName: 'Tienda', type: 'otro', description: 'Producto dañado',
    status: 'abierta', createdBy: 'worker-a', createdByName: 'trabajador', createdAt: Date.now() };
  await assertFails(setDoc(workerRef, { ...incident, resolvedBy: 'admin-a' }));
  await assertFails(setDoc(workerRef, { ...incident, createdByName: 'Administrador' }));
  await assertSucceeds(setDoc(workerRef, incident));
  const resolution = { status: 'resuelta', resolutionNote: 'Revisado', resolvedBy: 'admin-a', resolvedByName: 'admin', resolvedAt: Date.now() };
  await assertFails(updateDoc(workerRef, resolution));
  await assertFails(updateDoc(adminRef, { ...resolution, description: 'Origen alterado' }));
  await assertFails(updateDoc(adminRef, { ...resolution, resolvedByName: 'Otro actor' }));
  await assertSucceeds(updateDoc(adminRef, resolution));
  await assertFails(updateDoc(adminRef, { ...resolution, status: 'abierta' }));
  await assertFails(updateDoc(adminRef, { ...resolution, resolutionNote: 'Reescrito' }));
});

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
  await assertSucceeds(getDocs(query(collection(db, 'users'), where('tenantId', '==', TENANT_A), limit(100))));
  await assertFails(getDocs(query(collection(db, 'users'), where('tenantId', '==', TENANT_A))));
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

test('el cliente no puede abrir cajas directamente ni falsificar tenantId', async () => {
  const db = env.authenticatedContext('pos-a').firestore();
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/cash_sessions/own`), {
    tenantId: TENANT_A, storeId: 'A01', userId: 'pos-a', userName: 'Caja',
    openingAmount: 50, status: 'abierta', openedAt: 1
  }));
  await assertFails(setDoc(doc(db, `tenants/${TENANT_A}/cash_sessions/forged`), {
    tenantId: TENANT_B, storeId: 'A01', userId: 'pos-a', userName: 'Caja',
    openingAmount: 50, status: 'abierta', openedAt: 1
  }));
});

test('POS lee su venta pero solo Functions pueden registrar la solicitud de anulación', async () => {
  const db = env.authenticatedContext('pos-a').firestore();
  const saleRef = doc(db, `tenants/${TENANT_A}/sales/sale1`);
  await assertSucceeds(getDoc(saleRef));
  await assertFails(updateDoc(saleRef, { status: 'anulada' }));
  await assertFails(updateDoc(saleRef, {
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
  const ownRef = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/A01/pos-a/photo.png`);
  await assertSucceeds(uploadString(ownRef, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ownRef));
  await assertSucceeds(getMetadata(ownRef));

  const otherTenant = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_B}/incidents/A01/pos-a/attack.png`);
  const otherUser = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/A01/worker-a/attack.png`);
  const invalidType = ref(env.authenticatedContext('pos-a').storage(), `tenants/${TENANT_A}/incidents/A01/pos-a/attack.exe`);
  await assertFails(uploadString(otherTenant, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertFails(uploadString(otherUser, 'imagen', 'raw', { contentType: 'image/png' }));
  await assertFails(uploadString(invalidType, 'binario', 'raw', { contentType: 'application/octet-stream' }));
  await assertFails(getBytes(ref(env.authenticatedContext('pos-b').storage(), ownRef.fullPath)));
  await assertFails(getMetadata(ref(env.authenticatedContext('pos-b').storage(), ownRef.fullPath)));
  await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'users', 'pos-a'), { active: false }));
  await assertFails(getMetadata(ownRef));
});


test('configuración rechaza ancho de impresión malicioso y mapas críticos son solo servidor', async () => {
  const admin = env.authenticatedContext('admin-a').firestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `tenants/${TENANT_A}/config/company`), {
      ruc: '20123456789', razonSocial: 'Demo', serieFactura: 'F001', serieBoleta: 'B001',
      entornoSunat: 'beta', igvRate: 0.18, minBoletaSinDni: 700, umbralConsolidacion: 5, updatedAt: 1
    });
  });
  await assertFails(updateDoc(doc(admin, `tenants/${TENANT_A}/config/company`), { ticketWidth: '" onmouseover="alert(1)' }));
  await assertSucceeds(updateDoc(doc(admin, `tenants/${TENANT_A}/config/company`), { ticketWidth: '58mm' }));
  for (const collection of ['products', 'barcode_registry', 'quotations', 'replenishment_requests', 'cash_sessions']) {
    await assertFails(setDoc(doc(admin, `tenants/${TENANT_A}/${collection}/forged`), { tenantId: TENANT_A, items: [{ qty: -50 }] }));
  }
});


test('configuración valida cada unidad personalizada y acepta logo vacío', async () => {
  const ref = doc(env.authenticatedContext('admin-a').firestore(), `tenants/${TENANT_A}/config/company`);
  await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), `tenants/${TENANT_A}/config/company`), { customUnits: Array.from({ length: 50 }, (_, i) => `UN${i}`) }));
  await assertSucceeds(updateDoc(ref, { logoUrl: null, slogan: null, phone: null, footerText: null }));
  await assertFails(updateDoc(ref, { customUnits: ['UN', { unit: 'CJA' }] }));
  await assertFails(updateDoc(ref, { customUnits: ['X'.repeat(41)] }));
  await assertFails(updateDoc(ref, { customUnits: [''] }));
});


test('calendario compartido protege empresa, rol, permisos y escritura de servidor', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, 'users/pos-a'), { canManageCalendar: true });
    await setDoc(doc(db, `tenants/${TENANT_A}/calendar_events/event1`), { title: 'Pago', dueDate: '2026-10-01' });
    await setDoc(doc(db, `tenants/${TENANT_B}/calendar_events/event1`), { title: 'Privado' });
    await setDoc(doc(db, `tenants/${TENANT_A}/calendar_inboxes/pos-a/notifications/n1`), { active: true, createdAt: 1 });
  });
  const pos = env.authenticatedContext('pos-a').firestore();
  const worker = env.authenticatedContext('worker-a', { canManageCalendar: true }).firestore();
  const other = env.authenticatedContext('admin-b').firestore();
  const admin = env.authenticatedContext('admin-a').firestore();
  await assertSucceeds(getDocs(query(collection(pos, `tenants/${TENANT_A}/calendar_events`), where('dueDate', '>=', '2026-10-01'), where('dueDate', '<', '2026-11-01'), orderBy('dueDate'), limit(51))));
  await assertSucceeds(getDocs(query(collection(pos, `tenants/${TENANT_A}/calendar_inboxes/pos-a/notifications`), where('active', '==', true), orderBy('createdAt', 'desc'), limit(50))));
  await assertFails(getDoc(doc(worker, `tenants/${TENANT_A}/calendar_events/event1`)));
  await assertFails(getDoc(doc(other, `tenants/${TENANT_A}/calendar_events/event1`)));
  await assertFails(getDoc(doc(admin, `tenants/${TENANT_A}/calendar_inboxes/pos-a/notifications/n1`)));
  await assertFails(setDoc(doc(pos, `tenants/${TENANT_A}/calendar_events/forged`), { title: 'Inyectado' }));
  await assertFails(setDoc(doc(admin, `tenants/${TENANT_A}/calendar_events/forged`), { title: 'Inyectado' }));
  await assertFails(updateDoc(doc(pos, `tenants/${TENANT_A}/calendar_inboxes/pos-a/notifications/n1`), { readAt: 1 }));
  await assertFails(getDoc(doc(pos, 'calendar_push_devices/token')));
  await assertFails(updateDoc(doc(pos, 'users/pos-a'), { canManageCalendar: false }));
  await assertFails(updateDoc(doc(admin, 'users/pos-a'), { canManageCalendar: false }));
  await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'users/pos-a'), { canManageCalendar: false }));
  await assertFails(getDoc(doc(pos, `tenants/${TENANT_A}/calendar_events/event1`)));
});

test('POS multi-tienda antiguo conserva calendario y revocación supera claims viejos', async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'users/pos-a'), { storeAccess: 'all' });
    await setDoc(doc(context.firestore(), `tenants/${TENANT_A}/calendar_events/event1`), { title: 'Pago' });
  });
  const pos = env.authenticatedContext('pos-a', { canManageCalendar: true }).firestore();
  await assertSucceeds(getDoc(doc(pos, `tenants/${TENANT_A}/calendar_events/event1`)));
  await env.withSecurityRulesDisabled(async (context) => { await updateDoc(doc(context.firestore(), 'users/pos-a'), { canManageCalendar: false }); });
  await assertFails(getDoc(doc(pos, `tenants/${TENANT_A}/calendar_events/event1`)));
});

test('diseño del ticket valida cada campo al crear y actualizar y exige administrador de la empresa', async () => {
  const design = { layout: 'detailed', fontSize: 11, logoWidth: 120, headerAlign: 'center', showCode: true, showUnitPrice: true, showCashier: true, showClient: true };
  const path = `tenants/${TENANT_A}/config/company`;
  const admin = doc(env.authenticatedContext('admin-a').firestore(), path);
  await assertSucceeds(updateDoc(admin, { ticketDesign: design }));
  for (const invalid of [{ ...design, html: '<script>' }, { ...design, fontSize: 15 }, { ...design, fontSize: 10.5 }, { ...design, logoWidth: 181 }, { ...design, showClient: 'true' }, { ...design, layout: 'custom' }, { ...design, headerAlign: 'right' }, { layout: 'compact' }, null]) {
    await assertFails(updateDoc(admin, { ticketDesign: invalid }));
  }
  await assertFails(updateDoc(admin, { 'ticketDesign.fontSize': 0 }));
  await assertFails(updateDoc(doc(env.authenticatedContext('pos-a').firestore(), path), { ticketDesign: design }));
  await assertFails(updateDoc(doc(env.authenticatedContext('admin-b').firestore(), path), { ticketDesign: design }));
  await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), path), { ticketDesign: design }));
  const data = { ruc: '20123456789', razonSocial: 'Demo', serieFactura: 'F001', serieBoleta: 'B001', entornoSunat: 'beta', igvRate: 0.18, minBoletaSinDni: 700, umbralConsolidacion: 5, updatedAt: 1, ticketDesign: design };
  await env.withSecurityRulesDisabled(async context => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(context.firestore(), path)); });
  await assertFails(setDoc(admin, { ...data, ticketDesign: { ...design, showCode: 1 } }));
  await assertSucceeds(setDoc(admin, data));
});
