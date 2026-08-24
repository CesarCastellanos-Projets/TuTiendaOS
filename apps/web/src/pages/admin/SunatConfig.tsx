import { useState, useRef } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  Activity,
  CheckCircle,
  AlertTriangle,
  XCircle,
  RefreshCw,
  UploadCloud,
  FileKey,
  KeyRound,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldCheck
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { useCompany } from '../../hooks/useCompany';
import { clean, num } from '../../lib/utils';
import { DEFAULT_COMPANY } from '../../types';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import {
  testSunatConnection,
  uploadCertificate,
  activateDemoMode,
  SUNAT_DEMO_CREDENTIALS,
  type HealthCheckResult
} from '../../services/sunat';

export function SunatConfigPage() {
  const cfg = useCompany();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<HealthCheckResult | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { msg, flash } = useFlash();

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await testSunatConnection(cfg?.apiFactUrl, cfg?.apiFactToken);
      setTestResult(res);
      if (res.ok && res.status === 'listo') {
        flash('Diagnóstico exitoso: Motor y SUNAT operativos');
      } else if (res.ok) {
        flash('Atención: Revisa el estado del certificado o credenciales SOL');
      } else {
        flash(`Error de conexión: ${res.error || 'No responde el motor'}`);
      }
    } catch {
      flash('Error al ejecutar la prueba de conexión');
    } finally {
      setTesting(false);
    }
  };

  const handleApplyDemoCredentials = async () => {
    setBusy(true);
    try {
      // 1. Activar modo demo en el microservicio Laravel
      await activateDemoMode(cfg?.apiFactUrl, cfg?.apiFactToken).catch(() => null);

      // 2. Guardar credenciales demo oficiales en Firestore
      const demoData = {
        ...(cfg ?? DEFAULT_COMPANY),
        ...SUNAT_DEMO_CREDENTIALS,
        certFileName: 'certificado_demo_sunat.pfx',
        certExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        certIssuer: 'SUNAT Demo CA (Autofirmado)',
        updatedAt: Date.now()
      };
      await setDoc(doc(db, 'company', 'main'), demoData);

      flash('Credenciales de prueba oficiales SUNAT (MODDATOS) aplicadas.');
      void runTest();
    } catch (err) {
      console.error('Error al aplicar demo:', err);
      flash(err instanceof Error ? `Error: ${err.message}` : 'Error al aplicar credenciales de prueba');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadCertDirect = async () => {
    if (!certFile) {
      flash('Selecciona un archivo de certificado (.pfx o .p12)');
      return;
    }
    if (!certPassword) {
      flash('Ingresa la contraseña del certificado digital');
      return;
    }

    setUploadingCert(true);
    try {
      const res = await uploadCertificate(certFile, certPassword, {
        solUser: cfg?.solUser,
        solPassword: cfg?.solPassword,
        ruc: cfg?.ruc,
        razonSocial: cfg?.razonSocial,
        entorno: cfg?.entornoSunat,
        apiFactUrl: cfg?.apiFactUrl,
        apiFactToken: cfg?.apiFactToken
      });

      if (res.ok && res.certificate) {
        await setDoc(
          doc(db, 'company', 'main'),
          {
            ...(cfg ?? DEFAULT_COMPANY),
            certFileName: res.certificate.filename,
            certExpiresAt: res.certificate.expires_at ?? undefined,
            certIssuer: res.certificate.issuer ?? undefined,
            isDemoMode: false,
            updatedAt: Date.now()
          },
          { merge: true }
        );
        flash('Certificado digital verificado y guardado con éxito');
        setCertFile(null);
        setCertPassword('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        void runTest();
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Error al subir el certificado');
    } finally {
      setUploadingCert(false);
    }
  };

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const ruc = clean(fd.get('ruc'));
    if (ruc && !/^\d{11}$/.test(ruc)) {
      flash('Error: el RUC debe tener 11 dígitos');
      return;
    }

    setBusy(true);
    try {
      let certMeta = {
        certFileName: cfg?.certFileName,
        certExpiresAt: cfg?.certExpiresAt,
        certIssuer: cfg?.certIssuer
      };

      // Si el usuario adjuntó un nuevo archivo .pfx en el formulario, lo subimos
      if (certFile && certPassword) {
        try {
          const certRes = await uploadCertificate(certFile, certPassword, {
            solUser: clean(fd.get('solUser')),
            solPassword: clean(fd.get('solPassword')),
            ruc,
            razonSocial: clean(fd.get('razonSocial')),
            entorno: clean(fd.get('entornoSunat')),
            apiFactUrl: clean(fd.get('apiFactUrl')),
            apiFactToken: clean(fd.get('apiFactToken'))
          });
          if (certRes.ok && certRes.certificate) {
            certMeta = {
              certFileName: certRes.certificate.filename,
              certExpiresAt: certRes.certificate.expires_at ?? undefined,
              certIssuer: certRes.certificate.issuer ?? undefined
            };
          }
        } catch (certErr) {
          flash(`Aviso: ${certErr instanceof Error ? certErr.message : 'No se pudo subir el archivo de firma'}`);
        }
      }

      const data = {
        ...(cfg ?? DEFAULT_COMPANY),
        ruc,
        razonSocial: clean(fd.get('razonSocial')) || DEFAULT_COMPANY.razonSocial,
        direccion: clean(fd.get('direccion')),
        regimen: clean(fd.get('regimen')),
        serieFactura: (clean(fd.get('serieFactura')) || 'F001').toUpperCase(),
        serieBoleta: (clean(fd.get('serieBoleta')) || 'B001').toUpperCase(),
        entornoSunat: clean(fd.get('entornoSunat')) === 'produccion' ? ('produccion' as const) : ('beta' as const),
        solUser: clean(fd.get('solUser')),
        solPassword: clean(fd.get('solPassword')),
        igvRate: Math.min(1, Math.max(0.01, num(fd.get('igvRate')) / 100 || 0.18)),
        minBoletaSinDni: Math.trunc(num(fd.get('minBoletaSinDni'))),
        umbralConsolidacion: num(fd.get('umbralConsolidacion')),
        apiFactUrl: clean(fd.get('apiFactUrl')),
        apiFactToken: clean(fd.get('apiFactToken')),
        ...certMeta,
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'company', 'main'), data);
      flash('Configuración tributaria guardada');
    } catch {
      flash('Error al guardar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabecera Principal */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">SUNAT y Facturación Electrónica</h1>
          <p className="text-xs text-slate-500">
            Configura los datos de tu empresa, certificado digital (.pfx), credenciales SOL y prueba la conexión.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleApplyDemoCredentials()}
            className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100"
            title="Cargar usuario oficial de pruebas MODDATOS de SUNAT"
          >
            <Sparkles size={15} className="text-amber-600" />
            Usar credenciales Demo SUNAT (MODDATOS)
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className="btn-sol flex items-center gap-2 font-semibold"
          >
            <RefreshCw size={15} className={testing ? 'animate-spin' : ''} />
            {testing ? 'Probando conexión…' : 'Probar conexión con SUNAT'}
          </button>
        </div>
      </div>

      {/* Panel de Diagnóstico en Vivo */}
      {testResult && (
        <section
          className={`card border-l-4 p-4 ${
            testResult.ok && testResult.status === 'listo'
              ? 'border-l-verde bg-emerald-50/20'
              : 'border-l-acento bg-amber-50/20'
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
              <Activity size={16} className="text-blue-600" />
              Diagnóstico en Vivo ({testResult.sunat?.entorno?.toUpperCase() ?? 'BETA'})
            </h2>
            <span className="font-mono text-xs text-slate-500">
              Tiempo: {testResult.execution_time_ms ?? 0} ms
            </span>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {/* 1. Servidor de Facturación */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-500">Motor de Emisión</span>
                {testResult.laravel?.status === 'online' ? (
                  <CheckCircle size={16} className="text-success" />
                ) : (
                  <XCircle size={16} className="text-critical" />
                )}
              </div>
              <p className="mt-1 font-semibold text-sm">
                {testResult.laravel?.status === 'online' ? 'Conectado (Online)' : 'Sin respuesta'}
              </p>
              <p className="text-xs text-slate-500">PHP {testResult.laravel?.php_version ?? '—'}</p>
            </div>

            {/* 2. Certificado Digital */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-500">Certificado Digital</span>
                {testResult.certificate?.valid ? (
                  <CheckCircle size={16} className="text-success" />
                ) : testResult.certificate?.exists ? (
                  <AlertTriangle size={16} className="text-sol" />
                ) : (
                  <XCircle size={16} className="text-critical" />
                )}
              </div>
              <p className="mt-1 font-semibold text-sm truncate" title={testResult.certificate?.message}>
                {testResult.certificate?.message ?? 'No configurado'}
              </p>
              {testResult.certificate?.expires_at && (
                <p className="text-xs text-slate-500">
                  Expira: {testResult.certificate.expires_at.slice(0, 10)} ({testResult.certificate.days_left} días)
                </p>
              )}
            </div>

            {/* 3. Conexión SUNAT */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-500">Servidores SUNAT</span>
                {testResult.sunat?.reachable ? (
                  <CheckCircle size={16} className="text-success" />
                ) : (
                  <XCircle size={16} className="text-critical" />
                )}
              </div>
              <p className="mt-1 font-semibold text-sm">
                {testResult.sunat?.reachable ? `Responde (${testResult.sunat.latency_ms} ms)` : 'Inaccesible'}
              </p>
              <p className="truncate text-xs text-slate-500" title={testResult.sunat?.message}>
                {testResult.sunat?.message ?? 'Sin respuesta'}
              </p>
            </div>
          </div>

          {testResult.error && (
            <p className="mt-3 rounded bg-red-50 p-2 text-xs font-semibold text-critical">
              {testResult.error}
            </p>
          )}
        </section>
      )}

      {/* Formulario Principal de Configuración */}
      <form ref={formRef} onSubmit={save} className="space-y-5">
        {/* Bloque 1: Datos de la Empresa */}
        <div className="card p-5 space-y-4">
          <h2 className="flex items-center gap-2 border-b border-slate-100 pb-2 text-base font-bold text-slate-900">
            <ShieldCheck size={18} className="text-primary" />
            1. Datos Tributarios del Negocio
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">RUC de la Empresa *</label>
              <input
                name="ruc"
                required
                defaultValue={cfg?.ruc}
                inputMode="numeric"
                maxLength={11}
                placeholder="11 dígitos (Ej: 20601234567)"
                className="field font-mono text-base font-semibold"
              />
            </div>
            <div>
              <label className="label">Razón Social *</label>
              <input
                name="razonSocial"
                required
                defaultValue={cfg?.razonSocial}
                placeholder="Ej: D'ENZOZ S.A.C."
                className="field"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Dirección Fiscal</label>
              <input
                name="direccion"
                defaultValue={cfg?.direccion}
                placeholder="Ej: Jr. Real 123, Huancayo, Junín"
                className="field"
              />
            </div>
            <div>
              <label className="label">Régimen Tributario</label>
              <select name="regimen" defaultValue={cfg?.regimen ?? 'RMT'} className="field">
                <option value="RMT">Régimen MYPE Tributario (RMT)</option>
                <option value="RER">Régimen Especial de Renta (RER)</option>
                <option value="RG">Régimen General (RG)</option>
              </select>
            </div>
            <div>
              <label className="label">Tasa de IGV (%)</label>
              <input
                name="igvRate"
                type="number"
                step="0.5"
                min="1"
                max="100"
                defaultValue={(cfg?.igvRate ?? 0.18) * 100}
                className="field font-mono"
              />
            </div>
          </div>
        </div>

        {/* Bloque 2: Entorno, Certificado Digital y Credenciales SOL */}
        <div className="card p-5 space-y-4">
          <h2 className="flex items-center gap-2 border-b border-slate-100 pb-2 text-base font-bold text-slate-900">
            <FileKey size={18} className="text-primary" />
            2. Firma Digital y Credenciales SUNAT
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Entorno de Emisión SUNAT</label>
              <select
                name="entornoSunat"
                defaultValue={cfg?.entornoSunat ?? 'beta'}
                className="field font-semibold"
              >
                <option value="beta">Beta / Pruebas (Usa MODDATOS - Sin valor legal)</option>
                <option value="produccion">Producción (En vivo SUNAT - Validez tributaria)</option>
              </select>
            </div>

            <div>
              <label className="label">DNI obligatorio en boletas desde</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-slate-400">S/</span>
                <input
                  name="minBoletaSinDni"
                  type="number"
                  min="0"
                  step="50"
                  defaultValue={cfg?.minBoletaSinDni ?? 700}
                  className="field !pl-8 font-mono"
                />
              </div>
            </div>

            {/* Subida de Certificado Digital (.pfx / .p12) */}
            <div className="sm:col-span-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <UploadCloud size={16} className="text-primary" />
                    Cargar Certificado Digital (.pfx o .p12)
                  </p>
                  <p className="text-xs text-slate-500">
                    Archivo de firma digital proporcionado por tu entidad certificadora (Llama.pe, Reniec, etc.).
                  </p>
                </div>
                {cfg?.certFileName && (
                  <span className="badge bg-emerald-100 text-emerald-800 font-semibold text-xs flex items-center gap-1">
                    <CheckCircle size={12} /> {cfg.certFileName}
                    {cfg.certExpiresAt && ` (Vence: ${cfg.certExpiresAt.slice(0, 10)})`}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label !mb-1 text-xs">Seleccionar archivo .pfx / .p12</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pfx,.p12"
                    onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                    className="field !p-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-900 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white"
                  />
                </div>
                <div>
                  <label className="label !mb-1 text-xs">Contraseña del Certificado Digital</label>
                  <input
                    type="password"
                    placeholder="Contraseña del archivo .pfx"
                    value={certPassword}
                    onChange={(e) => setCertPassword(e.target.value)}
                    className="field font-mono text-sm"
                  />
                </div>
              </div>

              {certFile && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={uploadingCert || !certPassword}
                    onClick={() => void handleUploadCertDirect()}
                    className="btn-primary !min-h-9 !px-3 text-xs"
                  >
                    {uploadingCert ? 'Verificando y subiendo…' : 'Subir y validar certificado ahora'}
                  </button>
                </div>
              )}
            </div>

            {/* Credenciales SOL */}
            <div>
              <label className="label flex items-center gap-1">
                <KeyRound size={14} className="text-slate-400" />
                Usuario Secundario SOL (SUNAT)
              </label>
              <input
                name="solUser"
                defaultValue={cfg?.solUser ?? 'MODDATOS'}
                placeholder="Ej: MODDATOS o USUAR01"
                className="field font-mono uppercase"
              />
              <p className="mt-0.5 text-[11px] text-slate-500">En pruebas usa: <b>MODDATOS</b></p>
            </div>

            <div>
              <label className="label flex items-center gap-1">
                <KeyRound size={14} className="text-slate-400" />
                Clave SOL (SUNAT)
              </label>
              <input
                name="solPassword"
                type="password"
                defaultValue={cfg?.solPassword ?? 'MODDATOS'}
                placeholder="Clave de tu usuario secundario"
                className="field font-mono"
              />
              <p className="mt-0.5 text-[11px] text-slate-500">En pruebas usa: <b>MODDATOS</b></p>
            </div>

            {/* Series de Comprobantes */}
            <div>
              <label className="label">Serie de Facturas</label>
              <input
                name="serieFactura"
                defaultValue={cfg?.serieFactura ?? 'F001'}
                className="field font-mono uppercase font-bold"
                placeholder="F001"
              />
            </div>
            <div>
              <label className="label">Serie de Boletas</label>
              <input
                name="serieBoleta"
                defaultValue={cfg?.serieBoleta ?? 'B001'}
                className="field font-mono uppercase font-bold"
                placeholder="B001"
              />
            </div>
          </div>
        </div>

        {/* Bloque 3: Configuración Técnica Avanzada (Opcional) */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between p-4 text-left font-semibold text-sm text-slate-700 hover:bg-slate-50"
          >
            <span>⚙️ Configuración técnica del servidor (Opcional para TI / Desarrolladores)</span>
            {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showAdvanced && (
            <div className="border-t border-slate-200 p-4 space-y-3 bg-slate-50/50">
              <p className="text-xs text-slate-500">
                Por defecto, la plataforma se comunica automáticamente con el motor tributario local o configurado en el servidor. Solo modifica estos valores si usas un microservicio independiente.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label !mb-1 text-xs">URL del Motor Tributario (Laravel)</label>
                  <input
                    name="apiFactUrl"
                    defaultValue={cfg?.apiFactUrl ?? 'http://localhost:8000'}
                    placeholder="http://localhost:8000"
                    className="field font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="label !mb-1 text-xs">Token API de Seguridad (X-API-TOKEN)</label>
                  <input
                    name="apiFactToken"
                    defaultValue={cfg?.apiFactToken}
                    type="password"
                    placeholder="Token del microservicio"
                    className="field font-mono text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label !mb-1 text-xs">Ventas menores a S/ se agrupan en resumen diario:</label>
                  <input
                    name="umbralConsolidacion"
                    type="number"
                    min="0"
                    step="0.5"
                    defaultValue={cfg?.umbralConsolidacion ?? 5}
                    className="field font-mono text-xs w-32"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Botones de Acción */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button disabled={busy} className="btn-primary text-sm px-6 py-2.5">
            {busy ? 'Guardando cambios…' : 'Guardar toda la configuración'}
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className="btn-ghost text-sm"
          >
            Probar conexión ahora
          </button>
        </div>
      </form>

      <FlashBar msg={msg} />
    </div>
  );
}


