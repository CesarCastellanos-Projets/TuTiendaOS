import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from './app-check';
import { requireActiveProfile } from './authz';
import { tenantCollection } from './tenant';
import { documentId } from './operation-receipts';
import { normalizeSearch, quotationExpires, QUOTATION_LIFETIME } from './quotation-lifecycle';

export const searchQuotations = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  if (!profile.storeId || !['pos', 'trabajador'].includes(profile.role)) throw new HttpsError('permission-denied', 'Selecciona una tienda.');
  const term = request.data?.term;
  if (typeof term !== 'string' || term.length > 180) throw new HttpsError('invalid-argument', 'Búsqueda inválida.');
  const search = normalizeSearch(term);
  let source = tenantCollection(profile.tenantId, 'quotations').where('storeId', '==', profile.storeId)
    .where('status', '==', 'pendiente').where('createdAt', '>', Date.now() - QUOTATION_LIFETIME)
    .orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
  if (request.data?.cursor) {
    const cursor = request.data.cursor;
    if (!cursor || typeof cursor.createdAt !== 'number') throw new HttpsError('invalid-argument', 'Cursor inválido.');
    source = source.startAfter(cursor.createdAt, documentId(cursor.id));
  }
  const page = await source.limit(100).get();
  const items: Record<string, unknown>[] = [];
  let last = page.docs.at(-1);
  let capped = false;
  for (const doc of page.docs) {
    const data = doc.data();
    const digits = search.replace(/\D/g, '');
    const textMatch = [data.clientName, data.clientPhone, data.code].some((value) => normalizeSearch(String(value ?? '')).includes(search));
    const phoneMatch = digits.length >= 3 && String(data.clientPhone ?? '').replace(/\D/g, '').includes(digits);
    if (quotationExpires(data) > Date.now() && (textMatch || phoneMatch)) items.push({ ...data, id: doc.id });
    if (items.length === 20) { last = doc; capped = true; break; }
  }
  return { items, cursor: (capped || page.size === 100) && last ? { createdAt: last.data().createdAt, id: last.id } : null };
});
