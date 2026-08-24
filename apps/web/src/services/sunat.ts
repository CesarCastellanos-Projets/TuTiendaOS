import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CompanyConfig, Sale } from '../types';

interface SunatResponse {
  ok: boolean;
  status?: 'aceptado' | 'rechazado' | 'observado';
  message?: string;
}

export const DEFAULT_API_FACT_URL = 'https://denzoz-api-fact.onrender.com';
export const DEFAULT_API_FACT_TOKEN = 'cambia-este-token-largo-y-seguro';

export const SUNAT_DEMO_CREDENTIALS = {
  ruc: '20000000001',
  razonSocial: 'EMPRESA DEMO S.A.C.',
  direccion: 'AV. DE PRUEBA 123 - LIMA',
  regimen: 'RMT',
  entornoSunat: 'beta' as const,
  solUser: 'MODDATOS',
  solPassword: 'MODDATOS',
  serieFactura: 'F001',
  serieBoleta: 'B001',
  apiFactUrl: DEFAULT_API_FACT_URL,
  apiFactToken: DEFAULT_API_FACT_TOKEN,
  isDemoMode: true
};

export function getApiFactUrl(cfg?: CompanyConfig | null): string {
  const url = cfg?.apiFactUrl?.trim();
  if (url && url !== 'http://localhost:8000' && !url.includes('localhost')) {
    return url.replace(/\/$/, '');
  }
  const envUrl = (import.meta.env.VITE_API_FACT_URL as string | undefined)?.trim();
  if (envUrl && !envUrl.includes('localhost')) {
    return envUrl.replace(/\/$/, '');
  }
  return DEFAULT_API_FACT_URL;
}

export function getApiFactToken(cfg?: CompanyConfig | null): string {
  return cfg?.apiFactToken?.trim() || (import.meta.env.VITE_API_FACT_TOKEN as string | undefined)?.trim() || DEFAULT_API_FACT_TOKEN;
}

/**
 * ÚNICO punto de contacto con el microservicio Laravel/Greenter.
 * Falla siempre soft: la venta nunca se bloquea; queda `pendiente`.
 */
export async function sendToSunat(saleId: string, sale: Sale): Promise<void> {
  try {
    const cfgSnap = await getDoc(doc(db, 'company', 'main'));
    const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
    const apiUrl = getApiFactUrl(cfg);
    const apiToken = getApiFactToken(cfg);

    await updateDoc(doc(db, 'sales', saleId), { sunatStatus: 'pendiente' });

    const res = await fetch(`${apiUrl}/api/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-TOKEN': apiToken
      },
      body: JSON.stringify({
        ref: saleId,
        tipo: sale.type,
        serie: sale.serie,
        correlativo: sale.correlativo,
        fecha: new Date(sale.createdAt).toISOString(),
        cliente: sale.clientDoc,
        items: sale.items.map((i) => ({
          codigo: i.productId,
          descripcion: i.name,
          cantidad: i.qty,
          precio: i.unitPrice
        })),
        totals: { subtotal: sale.subtotal, igv: sale.igv, total: sale.total }
      }),
      signal: AbortSignal.timeout(15000)
    });

    const data = (await res.json()) as SunatResponse;
    if (data.ok && data.status === 'aceptado') {
      await updateDoc(doc(db, 'sales', saleId), {
        sunatStatus: 'aceptado',
        sunatMessage: data.message ?? 'Aceptado por SUNAT'
      });
    } else if (data.ok && data.status === 'observado') {
      await updateDoc(doc(db, 'sales', saleId), {
        sunatStatus: 'observado',
        sunatMessage: data.message ?? 'Observado por SUNAT'
      });
    } else {
      await updateDoc(doc(db, 'sales', saleId), {
        sunatStatus: 'rechazado',
        sunatMessage: data.message ?? 'Rechazado por SUNAT'
      });
    }
  } catch {
    await safeMarkPending(saleId);
  }
}

/** Nota de crédito por anulación autorizada. También soft-fail. */
export async function sendCreditNote(saleId: string, sale: Sale): Promise<void> {
  try {
    const cfgSnap = await getDoc(doc(db, 'company', 'main'));
    const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
    const apiUrl = getApiFactUrl(cfg);
    const apiToken = getApiFactToken(cfg);

    await fetch(`${apiUrl}/api/credit-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-TOKEN': apiToken },
      body: JSON.stringify({
        ref: saleId,
        serie: sale.serie,
        correlativo: sale.correlativo,
        motivo: sale.anulationRequest?.reason ?? 'Anulación'
      }),
      signal: AbortSignal.timeout(15000)
    }).then(async (res) => {
      const data = (await res.json()) as SunatResponse;
      await updateDoc(doc(db, 'sales', saleId), {
        sunatStatus: data.ok && data.status === 'aceptado' ? 'aceptado' : 'pendiente',
        sunatMessage: data.message ?? null
      });
    });
  } catch {
    // queda pendiente; el Admin puede reenviar
  }
}

export interface HealthCheckResult {
  ok: boolean;
  status: 'listo' | 'requiere_atencion' | 'error';
  timestamp?: string;
  execution_time_ms?: number;
  error?: string;
  laravel?: {
    status: string;
    php_version: string;
    timezone: string;
  };
  certificate?: {
    configured: boolean;
    exists: boolean;
    valid: boolean;
    expires_at: string | null;
    days_left: number | null;
    issuer: string | null;
    message: string;
  };
  sol?: {
    configured: boolean;
    ruc: string;
    user: string;
    message: string;
  };
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

/**
 * Sube y valida el archivo .pfx/.p12 con su contraseña en el microservicio Laravel.
 */
export async function uploadCertificate(
  file: File,
  certPassword: string,
  extraData?: {
    solUser?: string;
    solPassword?: string;
    ruc?: string;
    razonSocial?: string;
    entorno?: string;
    apiFactUrl?: string;
    apiFactToken?: string;
  }
): Promise<CertificateUploadResult> {
  const cfgSnap = await getDoc(doc(db, 'company', 'main'));
  const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
  const apiUrl = extraData?.apiFactUrl?.trim() || getApiFactUrl(cfg);
  const apiToken = extraData?.apiFactToken?.trim() || getApiFactToken(cfg);

  const fd = new FormData();
  fd.append('certificate', file);
  fd.append('cert_password', certPassword);
  if (extraData?.solUser) fd.append('sol_user', extraData.solUser);
  if (extraData?.solPassword) fd.append('sol_password', extraData.solPassword);
  if (extraData?.ruc) fd.append('ruc', extraData.ruc);
  if (extraData?.razonSocial) fd.append('razon_social', extraData.razonSocial);
  if (extraData?.entorno) fd.append('entorno', extraData.entorno);

  const res = await fetch(`${apiUrl}/api/config/certificate`, {
    method: 'POST',
    headers: {
      'X-API-TOKEN': apiToken
    },
    body: fd,
    signal: AbortSignal.timeout(15000)
  });

  const json = (await res.json()) as CertificateUploadResult;
  if (!res.ok) {
    throw new Error(json.message || 'Error al validar el certificado en el servidor');
  }
  return json;
}

/**
 * Habilita el modo demo oficial en el backend con certificado de prueba autofirmado.
 */
export async function activateDemoMode(apiFactUrl?: string, apiFactToken?: string): Promise<{ ok: boolean; message: string }> {
  const cfgSnap = await getDoc(doc(db, 'company', 'main'));
  const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
  const apiUrl = apiFactUrl?.trim() || getApiFactUrl(cfg);
  const apiToken = apiFactToken?.trim() || getApiFactToken(cfg);

  const res = await fetch(`${apiUrl}/api/config/demo-mode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-TOKEN': apiToken
    },
    signal: AbortSignal.timeout(10000)
  });

  const json = (await res.json()) as { ok: boolean; message: string };
  if (!res.ok) {
    throw new Error(json.message || 'Error al activar modo demo');
  }
  return json;
}

/**
 * Prueba la conectividad con el microservicio Laravel y con el entorno SUNAT (Beta/Prod).
 */
export async function testSunatConnection(url?: string, token?: string): Promise<HealthCheckResult> {
  let targetUrl = url ?? '';
  try {
    let targetToken = token;
    if (!targetUrl) {
      const cfgSnap = await getDoc(doc(db, 'company', 'main'));
      const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
      targetUrl = getApiFactUrl(cfg);
      targetToken = getApiFactToken(cfg);
    }

    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/health-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-TOKEN': targetToken ?? ''
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return {
        ok: false,
        status: 'error',
        error: `El servidor respondió con código ${res.status}: ${txt.slice(0, 100) || 'Token incorrecto o error interno'}`
      };
    }

    return (await res.json()) as HealthCheckResult;
  } catch (err) {
    const isConnRefused = err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('fetch'));
    return {
      ok: false,
      status: 'error',
      error: isConnRefused
        ? `No se pudo conectar con el motor tributario en ${targetUrl || 'http://localhost:8000'}. Para desarrollo local inicia el servidor con 'php artisan serve' en apps/api-fact. En producción coloca la URL pública en Configuración Técnica.`
        : (err instanceof Error ? err.message : 'Error desconocido al conectar con el motor tributario')
    };
  }
}

/** Resumen diario de boletas (para cierre diario y ventas < S/5). */
export async function sendDailySummary(
  fecha: string,
  boletas: { serie: string; correlativo: number; total: number }[]
): Promise<{ ok: boolean; message: string }> {
  try {
    const cfgSnap = await getDoc(doc(db, 'company', 'main'));
    const cfg = cfgSnap.exists() ? (cfgSnap.data() as CompanyConfig) : null;
    const apiUrl = getApiFactUrl(cfg);
    const apiToken = getApiFactToken(cfg);

    const res = await fetch(`${apiUrl}/api/summaries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-TOKEN': apiToken
      },
      body: JSON.stringify({ fecha, boletas }),
      signal: AbortSignal.timeout(15000)
    });
    const data = (await res.json()) as { ok: boolean; message: string };
    return { ok: data.ok, message: data.message ?? 'Resumen registrado' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Error al enviar resumen diario' };
  }
}

async function safeMarkPending(saleId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'sales', saleId), {
      sunatStatus: 'pendiente',
      sunatMessage: 'Motor tributario no disponible; se reintentará'
    });
  } catch {
    // offline total: la cola local reintentará al reconectar
  }
}


