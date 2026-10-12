import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { appCheckOptions } from './app-check';
import { assertCurrentProfile, requireAdmin } from './authz';
import { db } from './firebase';
import { tenantCollection, tenantDoc } from './tenant';
import { documentId } from './operation-receipts';
import { quotationExpires, QUOTATION_LIFETIME } from './quotation-lifecycle';
import { removeQuotation } from './transient-maintenance';

export const previewQuotationCleanup = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const page = await tenantCollection(actor.tenantId, 'quotations').where('createdAt', '<=', Date.now() - QUOTATION_LIFETIME).orderBy('createdAt').limit(100).get();
  return { items: page.docs.map((doc) => ({ id: doc.id, code: doc.data().code ?? doc.id, createdAt: doc.data().createdAt, status: doc.data().status })), hasMore: page.size === 100 };
});
export const purgeExpiredQuotations = onCall(appCheckOptions, async (request) => {
  const actor = await requireAdmin(request);
  const ids = request.data?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new HttpsError('invalid-argument', 'Selecciona entre 1 y 100 cotizaciones.');
  for (const value of new Set(ids)) {
    const ref = tenantDoc(actor.tenantId, 'quotations', documentId(value));
    await db.runTransaction(async (tx) => {
      await assertCurrentProfile(tx, actor);
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      if (quotationExpires(doc.data()!) > Date.now()) throw new HttpsError('failed-precondition', 'La cotización todavía está vigente.');
      await removeQuotation(tx, ref, doc.data()!);
    });
  }
  return { ok: true };
});
