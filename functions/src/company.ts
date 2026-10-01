import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { requireAdmin } from './authz';
import { tenantDoc } from './tenant';

export const saveCustomUnits = onCall(async (request) => {
  const profile = await requireAdmin(request);
  const units: unknown = request.data?.units;
  if (!Array.isArray(units) || units.length > 50 || units.some((value: unknown) => typeof value !== 'string' || value.trim().length === 0 || value.length > 40)) {
    throw new HttpsError('invalid-argument', 'Las unidades deben ser textos de hasta 40 caracteres, con un máximo de 50.');
  }
  const customUnits = [...new Set((units as string[]).map((unit) => unit.trim().toUpperCase()))];
  await tenantDoc(profile.tenantId, 'config', 'company').update({ customUnits, updatedAt: Date.now() });
  return { customUnits };
});
