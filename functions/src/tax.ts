import { defineSecret, defineString } from 'firebase-functions/params';
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { admin, db } from './firebase';
import { requireActiveProfile, requireAdmin } from './authz';
import { buildFiscalInvoicePayload, FiscalPayloadError } from './fiscal';
import { assertTenantId, tenantCollection, tenantDoc } from './tenant';

const API_FACT_TOKEN = defineSecret('API_FACT_TOKEN');
const API_FACT_URL = defineString('API_FACT_URL', {
  default: 'https://denzoz-api-fact.onrender.com'
});

interface TaxResponse {
  ok?: boolean;
  status?: 'pendiente' | 'procesando' | 'aceptado' | 'rechazado' | 'observado' | 'requiere_revision' | 'error';
  message?: string;
  [key: string]: unknown;
}

async function taxRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000,
  tenantId?: string
): Promise<TaxResponse> {
  const token = API_FACT_TOKEN.value();
  if (!token) {
    throw new HttpsError('failed-precondition', 'El token del motor tributario no está configurado.');
  }
  const url = API_FACT_URL.value().replace(/\/$/, '');
  let resolvedTenantId: string;
  try {
    resolvedTenantId = assertTenantId(tenantId);
  } catch {
    throw new HttpsError('failed-precondition', 'La empresa tributaria no está configurada.');
  }
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        'X-API-TOKEN': token,
        'X-TENANT-ID': resolvedTenantId,
        Accept: 'application/json',
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new HttpsError('unavailable', 'El motor tributario no está disponible.');
  }
  const body = await response.json().catch(() => ({})) as TaxResponse;
  if (!response.ok) {
    throw new HttpsError(
      response.status === 401 ? 'failed-precondition' : 'unavailable',
      String(body.message ?? `El motor tributario respondió ${response.status}.`)
    );
  }
  return body;
}

export const sendSaleToSunat = onCall({ secrets: [API_FACT_TOKEN] }, async (request) => {
  const profile = await requireActiveProfile(request);
  const saleId = typeof request.data?.saleId === 'string' ? request.data.saleId : '';
  if (!saleId) throw new HttpsError('invalid-argument', 'Venta inválida.');
  const saleSnap = await tenantDoc(profile.tenantId, 'sales', saleId).get();
  if (!saleSnap.exists) throw new HttpsError('not-found', 'La venta no existe.');
  const sale = saleSnap.data()!;
  if (profile.role !== 'admin' && sale.userId !== profile.uid) {
    throw new HttpsError('permission-denied', 'No puedes enviar esta venta.');
  }
  return processSaleToSunat(profile.tenantId, saleId);
});

export const sendNewSaleToSunat = onDocumentCreated(
  { document: 'tenants/{tenantId}/sales/{saleId}', secrets: [API_FACT_TOKEN] },
  async (event) => {
    const saleId = event.params.saleId;
    const tenantId = event.params.tenantId;
    const sale = event.data?.data();
    if (!saleId || sale?.type === 'nota' || sale?.consolidated === true) return;
    try {
      await processSaleToSunat(tenantId, saleId);
    } catch (error) {
      console.error('[SUNAT] Envío inicial pendiente', {
        saleId,
        error: error instanceof Error ? error.message : 'error desconocido'
      });
    }
  }
);

export const retryPendingSunatSales = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Lima',
    timeoutSeconds: 300,
    secrets: [API_FACT_TOKEN]
  },
  async () => {
    const pending = await db.collectionGroup('sales')
      .where('consolidated', '==', false)
      .where('sunatStatus', 'in', ['no_enviado', 'pendiente'])
      .limit(50)
      .get();

    for (let index = 0; index < pending.docs.length; index += 5) {
      const batch = pending.docs.slice(index, index + 5);
      const results = await Promise.allSettled(batch.map((sale) =>
        processSaleToSunat(String(sale.data().tenantId ?? ''), sale.id)
      ));
      results.forEach((result, batchIndex) => {
        if (result.status === 'rejected') {
          console.error('[SUNAT] Reintento automático pendiente', {
            saleId: batch[batchIndex].id,
            error: result.reason instanceof Error ? result.reason.message : 'error desconocido'
          });
        }
      });
    }

    const pendingCreditNotes = await db.collectionGroup('sales')
      .where('creditNoteStatus', '==', 'pendiente')
      .orderBy('createdAt', 'asc')
      .limit(20)
      .get();
    for (let index = 0; index < pendingCreditNotes.docs.length; index += 5) {
      const batch = pendingCreditNotes.docs.slice(index, index + 5);
      const results = await Promise.allSettled(batch.map((sale) =>
        processCreditNoteToSunat(String(sale.data().tenantId ?? ''), sale.id)
      ));
      results.forEach((result, batchIndex) => {
        if (result.status === 'rejected') {
          console.error('[SUNAT] Reintento de nota de crédito pendiente', {
            saleId: batch[batchIndex].id,
            error: result.reason instanceof Error ? result.reason.message : 'error desconocido'
          });
        }
      });
    }

    const maintenanceConfig = await db.doc('system/sunatMaintenance').get();
    const tenantIds = Array.isArray(maintenanceConfig.data()?.tenantIds)
      ? maintenanceConfig.data()!.tenantIds.slice(0, 100)
      : [];
    for (const rawTenantId of tenantIds) {
      try {
        const tenantId = assertTenantId(rawTenantId);
        const maintenance = await taxRequest('/api/maintenance/retry-pending', {
          method: 'POST',
          body: JSON.stringify({ limit: 5 })
        }, 55_000, tenantId);
        await applyMaintenanceResults(tenantId, maintenance.documents);
      } catch (error) {
        console.error('[SUNAT] Mantenimiento tributario pendiente', {
          tenantId: String(rawTenantId),
          error: error instanceof Error ? error.message : 'error desconocido'
        });
      }
    }
  }
);

async function processSaleToSunat(tenantId: string, saleId: string): Promise<TaxResponse & { busy?: boolean }> {
  const saleRef = tenantDoc(tenantId, 'sales', saleId);
  const now = Date.now();
  const sale = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(saleRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'La venta no existe.');
    const current = snapshot.data()!;
    if (current.type === 'nota') return null;
    if (current.consolidated === true) {
      throw new HttpsError('failed-precondition', 'La venta se envía mediante el resumen diario.');
    }
    if (current.sunatStatus === 'aceptado') return { alreadyAccepted: true };
    if (Number(current.sunatLeaseUntil ?? 0) > now) return { busy: true };
    tx.update(saleRef, {
      sunatStatus: 'pendiente',
      sunatMessage: null,
      sunatLeaseUntil: now + 60_000,
      sunatAttempts: Number(current.sunatAttempts ?? 0) + 1,
      sunatLastAttemptAt: now
    });
    return current;
  });
  if (!sale) return { ok: true, status: 'aceptado', message: 'No aplica' };
  if ('alreadyAccepted' in sale) return { ok: true, status: 'aceptado', message: 'Ya fue aceptado' };
  if ('busy' in sale) return { ok: true, status: 'pendiente', message: 'El envío ya está en proceso', busy: true };

  let payload;
  try {
    payload = buildFiscalInvoicePayload(saleId, sale);
  } catch (error) {
    const message = error instanceof FiscalPayloadError ? error.message : 'La venta contiene datos fiscales inválidos.';
    await saleRef.update({
      sunatStatus: 'error',
      sunatMessage: message,
      sunatLeaseUntil: admin.firestore.FieldValue.delete()
    });
    throw new HttpsError('failed-precondition', message);
  }

  try {
    const result = await taxRequest('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, 15_000, tenantId);
    const status = result.ok && ['aceptado', 'observado'].includes(String(result.status))
      ? result.status
      : 'rechazado';
    await saleRef.update({
      sunatStatus: status,
      sunatMessage: String(result.message ?? 'Respuesta recibida de SUNAT'),
      sunatLeaseUntil: admin.firestore.FieldValue.delete()
    });
    return { ok: result.ok === true, status, message: result.message };
  } catch (error) {
    await saleRef.update({
      sunatStatus: 'pendiente',
      sunatMessage: 'Motor tributario no disponible; reintenta desde Administración',
      sunatLeaseUntil: admin.firestore.FieldValue.delete()
    });
    throw error;
  }
}

export const sendCreditNoteToSunat = onCall({ secrets: [API_FACT_TOKEN] }, async (request) => {
  const profile = await requireAdmin(request);
  const saleId = typeof request.data?.saleId === 'string' ? request.data.saleId : '';
  if (!saleId) throw new HttpsError('invalid-argument', 'Venta inválida.');
  return processCreditNoteToSunat(profile.tenantId, saleId);
});

async function processCreditNoteToSunat(tenantId: string, saleId: string): Promise<TaxResponse & { busy?: boolean }> {
  const saleRef = tenantDoc(tenantId, 'sales', saleId);
  const now = Date.now();
  type CreditNoteClaim =
    | { kind: 'accepted' }
    | { kind: 'busy' }
    | { kind: 'exhausted' }
    | {
      kind: 'claimed';
      serie: string;
      correlativo: number;
      reason: string;
      originalStatus: string;
      attempt: number;
    };
  const claim = await db.runTransaction<CreditNoteClaim>(async (tx) => {
    const snapshot = await tx.get(saleRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'La venta no existe.');
    const current = snapshot.data()!;
    if (current.status === 'anulada' || current.anulationStatus === 'anulada') {
      return { kind: 'accepted' };
    }
    const requestReason = current.anulationRequest?.reason;
    if (typeof requestReason !== 'string' || requestReason.trim() === '') {
      throw new HttpsError('failed-precondition', 'La venta no tiene una solicitud de anulación.');
    }
    if (typeof current.serie !== 'string' || typeof current.correlativo !== 'number') {
      throw new HttpsError('failed-precondition', 'La venta no contiene una serie y correlativo válidos.');
    }
    if (!['aceptado', 'observado'].includes(String(current.sunatStatus))) {
      throw new HttpsError('failed-precondition', 'El comprobante original aún no fue aceptado por SUNAT.');
    }
    if (Number(current.creditNoteLeaseUntil ?? 0) > now) return { kind: 'busy' };
    if (Number(current.creditNoteNextRetryAt ?? 0) > now) return { kind: 'busy' };
    const attempt = Number(current.creditNoteAttempts ?? 0) + 1;
    if (attempt > 6) {
      tx.update(saleRef, {
        anulationStatus: 'error',
        creditNoteStatus: 'error',
        creditNoteMessage: 'Se agotaron los reintentos automáticos; requiere revisión manual',
        creditNoteLeaseUntil: admin.firestore.FieldValue.delete(),
        creditNoteNextRetryAt: admin.firestore.FieldValue.delete()
      });
      return { kind: 'exhausted' };
    }
    tx.update(saleRef, {
      anulationStatus: 'nc_pendiente',
      creditNoteStatus: 'pendiente',
      creditNoteMessage: 'Nota de crédito en proceso',
      creditNoteLeaseUntil: now + 60_000,
      creditNoteAttempts: attempt,
      creditNoteLastAttemptAt: now
    });
    return {
      kind: 'claimed',
      serie: current.serie,
      correlativo: current.correlativo,
      reason: requestReason,
      originalStatus: typeof current.status === 'string' ? current.status : 'activa',
      attempt
    };
  });
  if (claim.kind === 'accepted') return { ok: true, status: 'aceptado', message: 'La venta ya está anulada' };
  if (claim.kind === 'busy') return { ok: true, status: 'pendiente', message: 'La nota de crédito ya está en proceso' };
  if (claim.kind === 'exhausted') {
    throw new HttpsError('failed-precondition', 'La nota de crédito requiere revisión manual.');
  }

  try {
    const result = await taxRequest('/api/credit-notes', {
      method: 'POST',
      body: JSON.stringify({
        ref: `nc-${saleId}`,
        serie: claim.serie,
        correlativo: claim.correlativo,
        motivo: claim.reason
      })
    }, 15_000, tenantId);
    const accepted = result.ok === true && ['aceptado', 'observado'].includes(String(result.status));
    const terminalError = ['rechazado', 'requiere_revision', 'error'].includes(String(result.status));
    const document = result.document as Record<string, unknown> | undefined;
    await saleRef.update({
      status: accepted ? 'anulada' : claim.originalStatus,
      ...(accepted ? { voidedAt: Date.now() } : {}),
      anulationStatus: accepted ? 'anulada' : terminalError ? 'error' : 'nc_pendiente',
      creditNoteStatus: result.status ?? 'pendiente',
      creditNoteMessage: String(result.message ?? (accepted ? 'Nota de crédito aceptada' : 'Nota de crédito pendiente')),
      creditNoteRef: typeof document?.ref === 'string' ? document.ref : `nc-${saleId}`,
      creditNoteSerie: typeof document?.serie === 'string' ? document.serie : null,
      creditNoteCorrelativo: typeof document?.correlativo === 'number' ? document.correlativo : null,
      creditNoteLeaseUntil: admin.firestore.FieldValue.delete(),
      creditNoteNextRetryAt: admin.firestore.FieldValue.delete()
    });
    return { ok: accepted, status: result.status, message: result.message, document };
  } catch (error) {
    await saleRef.update({
      anulationStatus: 'nc_pendiente',
      creditNoteStatus: 'pendiente',
      creditNoteMessage: 'Motor tributario no disponible; la nota puede reenviarse',
      creditNoteLeaseUntil: admin.firestore.FieldValue.delete(),
      creditNoteNextRetryAt: Date.now() + creditNoteRetryDelayMs(claim.attempt)
    });
    throw error;
  }
}

function creditNoteRetryDelayMs(attempt: number): number {
  const minutes = [1, 5, 15, 60, 360];
  return minutes[Math.min(Math.max(attempt - 1, 0), minutes.length - 1)] * 60_000;
}

export const sendDailySummaryToSunat = onCall({ secrets: [API_FACT_TOKEN] }, async (request) => {
  const profile = await requireAdmin(request);
  const fecha = typeof request.data?.fecha === 'string' ? request.data.fecha : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new HttpsError('invalid-argument', 'El resumen diario es inválido.');
  }
  const start = Date.parse(`${fecha}T00:00:00-05:00`);
  if (!Number.isFinite(start)) throw new HttpsError('invalid-argument', 'La fecha del resumen no es válida.');
  const end = start + 86_400_000;
  const snapshot = await tenantCollection(profile.tenantId, 'sales')
    .where('type', '==', 'boleta')
    .where('consolidated', '==', true)
    .where('status', '==', 'activa')
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .limit(201)
    .get();
  const receipts = snapshot.docs.filter((document) => !document.data().sunatSummaryRef);
  if (receipts.length === 0 || receipts.length > 200) {
    throw new HttpsError(
      receipts.length > 200 ? 'resource-exhausted' : 'failed-precondition',
      receipts.length > 200 ? 'Hay más de 200 boletas; divide el resumen.' : 'No hay boletas consolidadas para esa fecha.'
    );
  }
  let boletas;
  try {
    boletas = receipts.map((document) => {
      const fiscal = buildFiscalInvoicePayload(document.id, document.data());
      return {
        ref: document.id,
        serie: fiscal.serie,
        correlativo: fiscal.correlativo,
        igv_rate: fiscal.igv_rate,
        cliente: fiscal.cliente,
        totals: fiscal.totals
      };
    });
  } catch (error) {
    throw new HttpsError(
      'failed-precondition',
      error instanceof FiscalPayloadError ? error.message : 'Una boleta contiene datos fiscales inválidos.'
    );
  }
  const summaryRef = `resumen:${fecha}:${stableIdHash(receipts.map((receipt) => receipt.id))}`;
  const result = await taxRequest('/api/summaries', {
    method: 'POST',
    body: JSON.stringify({ ref: summaryRef, fecha, boletas })
  }, 15_000, profile.tenantId);
  await registerSunatMaintenanceTenant(profile.tenantId);
  const document = result.document as Record<string, unknown> | undefined;
  const batch = db.batch();
  receipts.forEach((receipt) => batch.update(receipt.ref, {
    sunatStatus: 'pendiente',
    sunatMessage: String(result.message ?? 'Resumen diario enviado'),
    sunatSummaryRef: typeof document?.ref === 'string' ? document.ref : summaryRef
  }));
  await batch.commit();
  return result;
});

export const sendVoidedToSunat = onCall({ secrets: [API_FACT_TOKEN] }, async (request) => {
  const profile = await requireAdmin(request);
  const requestedSaleIds: unknown[] = Array.isArray(request.data?.saleIds) ? request.data.saleIds : [];
  const saleIds = [...new Set(requestedSaleIds.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  ))];
  const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim().slice(0, 250) : '';
  if (saleIds.length === 0 || saleIds.length > 100 || !reason) {
    throw new HttpsError('invalid-argument', 'La comunicación de baja es inválida.');
  }
  const refs = saleIds.map((saleId) => tenantDoc(profile.tenantId, 'sales', saleId));
  const snapshots = await db.getAll(...refs);
  const documents = snapshots.map((snapshot, index) => {
    if (!snapshot.exists) throw new HttpsError('not-found', 'Una de las ventas no existe.');
    const sale = snapshot.data()!;
    if (!['boleta', 'factura'].includes(String(sale.type)) || !['aceptado', 'observado'].includes(String(sale.sunatStatus))) {
      throw new HttpsError('failed-precondition', 'Solo se pueden dar de baja comprobantes enviados a SUNAT.');
    }
    return {
      ref: saleIds[index],
      tipo: String(sale.type),
      serie: String(sale.serie),
      correlativo: Number(sale.correlativo),
      motivo: reason,
      createdAt: Number(sale.createdAt)
    };
  });
  const dates = new Set(documents.map((document) => limaDate(document.createdAt)));
  if (dates.size !== 1) {
    throw new HttpsError('failed-precondition', 'Los comprobantes de una baja deben pertenecer a la misma fecha de emisión.');
  }
  const fecha = [...dates][0];
  const result = await taxRequest('/api/voided', {
    method: 'POST',
    body: JSON.stringify({
      fecha,
      documentos: documents.map(({ createdAt: _createdAt, ...document }) => document)
    })
  }, 15_000, profile.tenantId);
  await registerSunatMaintenanceTenant(profile.tenantId);
  const fiscalDocument = result.document as Record<string, unknown> | undefined;
  const batch = db.batch();
  refs.forEach((ref) => batch.update(ref, {
    voidedStatus: result.status ?? 'pendiente',
    voidedMessage: String(result.message ?? 'Comunicación de baja enviada'),
    voidedRef: typeof fiscalDocument?.ref === 'string' ? fiscalDocument.ref : null
  }));
  await batch.commit();
  return result;
});

async function applyMaintenanceResults(tenantId: string, value: unknown): Promise<void> {
  if (!Array.isArray(value)) return;
  const updates: Array<{
    saleId: string;
    data: {
      sunatStatus?: string;
      sunatMessage?: string;
      sunatSummaryRef?: string;
      voidedStatus?: string;
      voidedMessage?: string;
      voidedRef?: string;
      status?: string;
      anulationStatus?: string;
    };
  }> = [];
  value.forEach((raw) => {
    const document = raw as Record<string, unknown>;
    if (!['resumen', 'baja'].includes(String(document.type)) || !Array.isArray(document.saleRefs)) return;
    const status = String(document.status ?? 'pendiente');
    if (!['aceptado', 'observado', 'rechazado', 'requiere_revision'].includes(status)) return;
    document.saleRefs.slice(0, 200).forEach((saleId) => {
      if (typeof saleId !== 'string' || !saleId) return;
      const isVoided = document.type === 'baja';
      updates.push({
        saleId,
        data: {
          ...(isVoided
            ? {
                voidedStatus: status,
                voidedMessage: String(document.message ?? 'Resultado de la comunicación de baja'),
                voidedRef: String(document.ref ?? ''),
                ...(status === 'aceptado' || status === 'observado'
                  ? { status: 'anulada', anulationStatus: 'anulada', voidedAt: Date.now() }
                  : {})
              }
            : {
                sunatStatus: status === 'requiere_revision' ? 'error' : status,
                sunatMessage: String(document.message ?? 'Resultado del resumen diario'),
                sunatSummaryRef: String(document.ref ?? '')
              })
        }
      });
    });
  });
  for (let index = 0; index < updates.length; index += 400) {
    const batch = db.batch();
    updates.slice(index, index + 400).forEach((update) => {
      batch.update(tenantDoc(tenantId, 'sales', update.saleId), update.data);
    });
    await batch.commit();
  }
}

function stableIdHash(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join('|')).digest('hex').slice(0, 16);
}

function limaDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new HttpsError('failed-precondition', 'Una venta no tiene fecha válida.');
  return new Date(timestamp - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const taxHealthCheck = onCall({ secrets: [API_FACT_TOKEN], timeoutSeconds: 75 }, async (request) => {
  const profile = await requireAdmin(request);
  return taxRequest('/api/health-check', { method: 'POST' }, 60_000, profile.tenantId);
});

export const activateSunatDemoMode = onCall({ secrets: [API_FACT_TOKEN], timeoutSeconds: 75 }, async (request) => {
  const profile = await requireAdmin(request);
  await registerSunatMaintenanceTenant(profile.tenantId);
  return taxRequest('/api/config/demo-mode', { method: 'POST' }, 60_000, profile.tenantId);
});

export const saveSunatCredentials = onCall({ secrets: [API_FACT_TOKEN] }, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const ruc = typeof data.ruc === 'string' ? data.ruc.trim() : '';
  const razonSocial = typeof data.razonSocial === 'string' ? data.razonSocial.trim() : '';
  const solUser = typeof data.solUser === 'string' ? data.solUser.trim() : '';
  const solPassword = typeof data.solPassword === 'string' ? data.solPassword : '';
  const entorno = data.entorno === 'produccion' ? 'produccion' : 'beta';
  if (!/^\d{11}$/.test(ruc) || !razonSocial || !solUser || !solPassword) {
    throw new HttpsError('invalid-argument', 'Completa RUC, razón social, usuario y clave SOL.');
  }
  await registerSunatMaintenanceTenant(profile.tenantId);
  return taxRequest('/api/config/credentials', {
    method: 'POST',
    body: JSON.stringify({
      ruc,
      razon_social: razonSocial,
      sol_user: solUser,
      sol_password: solPassword,
      entorno
    })
  }, 15_000, profile.tenantId);
});

export const uploadSunatCertificate = onCall({ secrets: [API_FACT_TOKEN], timeoutSeconds: 60 }, async (request) => {
  const profile = await requireAdmin(request);
  const data = request.data as Record<string, unknown>;
  const base64 = typeof data.base64 === 'string' ? data.base64 : '';
  const filename = typeof data.filename === 'string' ? data.filename.slice(0, 180) : 'certificate.pfx';
  const certPassword = typeof data.certPassword === 'string' ? data.certPassword : '';
  if (!base64 || base64.length > 7_000_000 || !certPassword || !/\.(pfx|p12)$/i.test(filename)) {
    throw new HttpsError('invalid-argument', 'El certificado o su contraseña no son válidos.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'El certificado supera el límite de 5 MB.');
  }
  const form = new FormData();
  form.append('certificate', new Blob([bytes]), filename);
  form.append('cert_password', certPassword);
  await registerSunatMaintenanceTenant(profile.tenantId);
  return taxRequest('/api/config/certificate', { method: 'POST', body: form }, 30000, profile.tenantId);
});

async function registerSunatMaintenanceTenant(tenantId: string): Promise<void> {
  await db.doc('system/sunatMaintenance').set({
    tenantIds: admin.firestore.FieldValue.arrayUnion(assertTenantId(tenantId)),
    updatedAt: Date.now()
  }, { merge: true });
}
