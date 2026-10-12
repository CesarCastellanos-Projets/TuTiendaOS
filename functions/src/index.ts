import { appCheckOptions } from './app-check';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineString } from 'firebase-functions/params';
import { admin, db } from './firebase';
import { requireActiveProfile, requireAdmin } from './authz';
import { tenantCollection } from './tenant';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
const APISPERU_TOKEN = defineString('APISPERU_TOKEN', { default: 'disabled' });

export { createSaleRecord, resumeSaleRecord, getCompanyConfig, receiveTransfer } from './operations';
export { syncProductStockMetadata } from './stock-metadata';
export { saveLocation, archiveLocation } from './locations';
export { aggregateSaleStatistics, recoverSalesStatistics } from './statistics-processing';
export { saveCustomUnits } from './company';
export { saveCalendarEvent, completeCalendarEvent, setCalendarPermission, markCalendarNotification, registerCalendarDevice, unregisterCalendarDevice, sendCalendarReminders } from './calendar';
export { saveCatalogProduct } from './catalog';
export { getAccessState, setUserSettings, changeUserPassword, deleteSystemUser, getProductPurchase } from './user-management';
export { listWorkerInventoryAccess, setWorkerInventoryAccess } from './worker-permissions';
export { openCashSession, closeCashSession, getCashSessionSummary } from './cash';
export { getSalesStatistics, backfillSalesStatistics } from './statistics';
export { notifyReplenishmentRequest } from './replenishment-notifications';
export { createQuotationRecord, createReplenishmentRecord, discardQuotation } from './requests';
export { resolveTransferShortage } from './shortages';
export {
  adjustInventory,
  attendReplenishmentRequest,
  cancelInventoryTransfer,
  createInventoryTransfer,
  recordStockIngress,
  rejectReplenishmentRequest
} from './inventory';
export {
  activateSunatDemoMode,
  saveSunatCredentials,
  sendCreditNoteToSunat,
  sendDailySummaryToSunat,
  sendCashCloseSummary,
  sendNewSaleToSunat,
  sendSaleToSunat,
  sendVoidedToSunat,
  retryPendingSunatSales,
  taxHealthCheck,
  uploadSunatCertificate
} from './tax';

export { createUser, setUserActive } from './users';
export { recordSaleCompensation } from './sale-compensation';
export { requestSaleAnulation } from './anulations';

/** Selecciona la tienda operativa de un POS multi-tienda. */
export const selectPosStore = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  if (profile.role !== 'pos' || profile.storeAccess !== 'all') {
    throw new HttpsError('permission-denied', 'Tu cuenta no puede cambiar de tienda.');
  }
  const storeId = typeof request.data?.storeId === 'string'
    ? request.data.storeId.trim().slice(0, 128)
    : '';
  if (!storeId) throw new HttpsError('invalid-argument', 'Selecciona una tienda válida.');
  const store = await db.doc(`tenants/${profile.tenantId}/stores/${storeId}`).get();
  if (!store.exists || store.data()?.active === false) throw new HttpsError('not-found', 'La tienda seleccionada no está activa.');
  return { storeId, storeName: String(store.data()?.name ?? 'Tienda') };
});

/** Consulta DNI/RUC desde el servidor y cachea en Firestore. */
export const lookupClient = onCall(appCheckOptions, async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const profile = await requireActiveProfile(request);
    if (!['admin', 'pos'].includes(profile.role)) throw new HttpsError('permission-denied', 'Tu rol no puede consultar documentos.');
    const { type, number } = request.data as { type?: 'dni' | 'ruc'; number?: string };
    if ((type !== 'dni' && type !== 'ruc') || !number || !/^\d{8}$|^\d{11}$/.test(number)) {
      throw new HttpsError('invalid-argument', 'Documento inválido.');
    }
    if (type === 'dni' && number.length !== 8) throw new HttpsError('invalid-argument', 'DNI debe tener 8 dígitos.');
    if (type === 'ruc' && number.length !== 11) throw new HttpsError('invalid-argument', 'RUC debe tener 11 dígitos.');

    const now = Date.now();
    const rateRef = tenantCollection(profile.tenantId, 'lookup_limits').doc(profile.uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(rateRef);
      const current = snap.data() ?? {};
      const minute = Math.floor(now / 60000);
      const day = Math.floor(now / 86400000);
      const minuteCount = current.minute === minute ? Number(current.minuteCount ?? 0) : 0;
      const dayCount = current.day === day ? Number(current.dayCount ?? 0) : 0;
      if (minuteCount >= 10 || dayCount >= 100) throw new HttpsError('resource-exhausted', 'Límite de consultas alcanzado. Intenta más tarde.');
      tx.set(rateRef, { minute, day, minuteCount: minuteCount + 1, dayCount: dayCount + 1 });
    });
    const cacheId = `${type === 'dni' ? 'DNI' : 'RUC'}-${number}`;
    const clients = tenantCollection(profile.tenantId, 'clients');
    const cached = await clients.doc(cacheId).get();
    if (cached.exists && now - Number(cached.data()?.updatedAt ?? 0) < 30 * 86400000) {
      const value = cached.data()!;
      return { tipo: value.tipo, numero: value.numero, nombre: value.nombre, direccion: value.direccion ?? null };
    }

    const apiToken = APISPERU_TOKEN.value().trim();
    if (!apiToken || apiToken === 'disabled') {
      throw new HttpsError(
        'failed-precondition',
        'La consulta automática de DNI/RUC aún no está configurada.'
      );
    }

    const endpoint =
      type === 'dni'
        ? `https://api.apis.net.pe/v2/reniec/dni?numero=${number}`
        : `https://api.apis.net.pe/v2/sunat/ruc?numero=${number}`;

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Referer: 'https://denzoz.pe'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      throw new HttpsError('unavailable', 'El servicio de consulta no respondió.');
    }
    const data = (await res.json()) as Record<string, unknown>;

    let nombre: string;
    if (type === 'dni') {
      nombre = [data.nombres, data.apellidoPaterno, data.apellidoMaterno]
        .filter(Boolean)
        .join(' ');
    } else {
      nombre = String(data.razonSocial ?? data.nombre ?? '');
    }
    if (!nombre) throw new HttpsError('not-found', 'No se encontró el documento.');

    const result = {
      tipo: type === 'dni' ? 'DNI' : 'RUC',
      numero: number,
      nombre: nombre.slice(0, 180),
      direccion: typeof data.direccion === 'string' ? data.direccion.slice(0, 240) : null,
      updatedAt: Date.now()
    };
    await clients.doc(cacheId).set({ ...result, tenantId: profile.tenantId });
    return result;
});

export const migrateCatalogAndStocks = onCall(appCheckOptions, async (request) => {
  await requireAdmin(request);
  throw new HttpsError('failed-precondition', 'Esta migración fue retirada. Usa tools/migrate-presentation-stock.mjs con credenciales administrativas y revisión del dry-run.');
});

export { searchQuotations } from './quotation-search';
export { previewQuotationCleanup, purgeExpiredQuotations } from './quotation-cleanup';
