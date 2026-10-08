import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from './app-check';
import { requireActiveProfile } from './authz';
import { completeOperation, documentId, operationId, readOperation } from './operation-receipts';
import { db } from './firebase';
import { tenantDoc } from './tenant';

export const requestSaleAnulation = onCall(appCheckOptions, async (request) => {
  const profile = await requireActiveProfile(request);
  const saleId = documentId(request.data?.saleId, 'Venta');
  const requestId = operationId(request.data?.requestId);
  const reason = typeof request.data?.reason === 'string' ? request.data.reason.trim() : '';
  if (!reason || reason.length > 250) throw new HttpsError('invalid-argument', 'Indica un motivo de hasta 250 caracteres.');
  return db.runTransaction(async (tx) => {
    const operation = await readOperation(tx, profile, 'anulation-request', requestId, request.data);
    if (operation.result) return operation.result;
    const ref = tenantDoc(profile.tenantId, 'sales', saleId);
    const sale = (await tx.get(ref)).data();
    if (!sale || (profile.role !== 'admin' && (profile.role !== 'pos' || sale.userId !== profile.uid || sale.storeId !== profile.storeId))) {
      throw new HttpsError('permission-denied', 'No puedes solicitar la anulación de esta venta.');
    }
    if (sale.status !== 'activa' || sale.anulationRequest) throw new HttpsError('failed-precondition', 'La venta ya fue anulada o tiene una solicitud.');
    if (sale.type === 'nota') throw new HttpsError('failed-precondition', 'Una nota de venta no genera nota de crédito electrónica. Requiere revisión del administrador.');
    tx.update(ref, { anulationRequest: { reason, byUserId: profile.uid, byUserName: profile.displayName, requestedAt: Date.now() }, anulationStatus: 'solicitada' });
    const result = { ok: true };
    completeOperation(tx, profile, 'anulation-request', operation, result);
    return result;
  });
});
