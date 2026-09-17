import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

interface SunatResponse {
  ok: boolean;
  status?: 'pendiente' | 'procesando' | 'aceptado' | 'rechazado' | 'observado' | 'requiere_revision' | 'error' | 'no_aplica';
  message?: string | null;
}

export const SUNAT_DEMO_CREDENTIALS = {
  ruc: '20000000001',
  razonSocial: 'EMPRESA DEMO S.A.C.',
  direccion: 'AV. DE PRUEBA 123 - LIMA',
  regimen: 'RMT',
  entornoSunat: 'beta' as const,
  serieFactura: 'F001',
  serieBoleta: 'B001',
  isDemoMode: true
};

export async function sendToSunat(saleId: string): Promise<void> {
  const callable = httpsCallable<{ saleId: string }, SunatResponse>(functions, 'sendSaleToSunat');
  await callable({ saleId });
}

export async function sendCreditNote(saleId: string): Promise<SunatResponse> {
  const callable = httpsCallable<{ saleId: string }, SunatResponse>(functions, 'sendCreditNoteToSunat');
  return (await callable({ saleId })).data;
}

export interface HealthCheckResult {
  ok: boolean;
  status: 'listo' | 'requiere_atencion' | 'error';
  timestamp?: string;
  execution_time_ms?: number;
  error?: string;
  laravel?: { status: string; php_version: string; timezone: string };
  certificate?: {
    configured: boolean;
    exists: boolean;
    valid: boolean;
    expires_at: string | null;
    days_left: number | null;
    issuer: string | null;
    message: string;
  };
  sol?: { configured: boolean; ruc: string; user: string; message: string };
  sunat?: {
    entorno: 'beta' | 'produccion';
    endpoint: string;
    reachable: boolean;
    http_code: number | null;
    latency_ms: number | null;
    message: string;
  };
}

export interface CertificateUploadResult {
  ok: boolean;
  message: string;
  certificate?: {
    filename: string;
    valid: boolean;
    is_expired: boolean;
    expires_at: string | null;
    days_left: number | null;
    issuer: string | null;
    subject_cn: string | null;
  };
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el certificado.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadCertificate(file: File, certPassword: string): Promise<CertificateUploadResult> {
  const callable = httpsCallable<
    { filename: string; base64: string; certPassword: string },
    CertificateUploadResult
  >(functions, 'uploadSunatCertificate');
  const response = await callable({
    filename: file.name,
    base64: await fileAsBase64(file),
    certPassword
  });
  return response.data;
}

export async function activateDemoMode(): Promise<{ ok: boolean; message: string }> {
  const callable = httpsCallable<Record<string, never>, { ok: boolean; message: string }>(
    functions,
    'activateSunatDemoMode'
  );
  return (await callable({})).data;
}

export async function saveSunatCredentials(data: {
  ruc: string;
  razonSocial: string;
  solUser: string;
  solPassword: string;
  entorno: 'beta' | 'produccion';
}): Promise<{ ok: boolean; message: string }> {
  const callable = httpsCallable<typeof data, { ok: boolean; message: string }>(
    functions,
    'saveSunatCredentials'
  );
  return (await callable(data)).data;
}

export async function testSunatConnection(): Promise<HealthCheckResult> {
  const callable = httpsCallable<Record<string, never>, HealthCheckResult>(functions, 'taxHealthCheck');
  try {
    return (await callable({})).data;
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'No se pudo conectar con el motor tributario.'
    };
  }
}

export async function sendDailySummary(fecha: string): Promise<{ ok: boolean; message: string }> {
  const callable = httpsCallable<
    { fecha: string },
    { ok: boolean; message: string }
  >(functions, 'sendDailySummaryToSunat');
  try {
    return (await callable({ fecha })).data;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Error al enviar el resumen diario.'
    };
  }
}
