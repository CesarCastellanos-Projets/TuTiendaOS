import { useEffect, useState, useRef } from 'react';
import { setDoc } from 'firebase/firestore';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  UploadCloud,
  FileKey,
  KeyRound,
  ShieldCheck,
  Building2,
  Server
} from 'lucide-react';
import { tenantDoc } from '../../lib/tenant-firestore';
import { useCompany } from '../../hooks/useCompany';
import { clean, num } from '../../lib/utils';
import { DEFAULT_COMPANY, type CompanyConfig } from '../../types';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import {
  testSunatConnection,
  uploadCertificate,
  activateDemoMode,
  saveSunatCredentials,
  SUNAT_DEMO_CREDENTIALS,
  type HealthCheckResult
} from '../../services/sunat';

function publicCompanyConfig(current: CompanyConfig | null, patch: Partial<CompanyConfig> = {}): CompanyConfig {
  const source = { ...DEFAULT_COMPANY, ...(current ?? {}), ...patch };
  return {
    ruc: source.ruc,
    razonSocial: source.razonSocial,
    direccion: source.direccion,
    regimen: source.regimen,
    serieFactura: source.serieFactura,
    serieBoleta: source.serieBoleta,
    serieNota: source.serieNota,
    entornoSunat: source.entornoSunat,
    igvRate: source.igvRate,
    minBoletaSinDni: source.minBoletaSinDni,
    umbralConsolidacion: source.umbralConsolidacion,
    certFileName: source.certFileName,
    certExpiresAt: source.certExpiresAt,
    certIssuer: source.certIssuer,
    isDemoMode: source.isDemoMode,
    logoUrl: source.logoUrl,
    slogan: source.slogan,
    phone: source.phone,
    footerText: source.footerText,
    ticketWidth: source.ticketWidth,
    customUnits: source.customUnits,
    updatedAt: Date.now()
  };
}

export function SunatConfigPage() {
  const loadedConfig = useCompany();
  const [cfg, setCfg] = useState<CompanyConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'estado' | 'empresa' | 'sol'>('estado');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [testResult, setTestResult] = useState<HealthCheckResult | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { msg, flash } = useFlash();

  useEffect(() => {
    if (loadedConfig) setCfg(loadedConfig);
  }, [loadedConfig]);

  const isDemo = cfg?.isDemoMode ?? (cfg?.entornoSunat === 'beta');

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await testSunatConnection();
      setTestResult(res);
      if (res.ok && res.status === 'listo') {
        flash('Diagnóstico exitoso: Motor y SUNAT 100% operativos');
      } else if (res.ok) {
        flash('Atención: Revisa el estado del certificado o credenciales SOL');
      } else {
        flash(`Error de conexión: ${res.error || 'No responde el motor de facturación'}`);
      }
    } catch {
      flash('Error al ejecutar la prueba de conexión');
    } finally {
      setTesting(false);
    }
  };

  const handleToggleDemoMode = async (targetDemo: boolean) => {
    setBusy(true);
    try {
      if (targetDemo) {
        await activateDemoMode();
        const demoData = publicCompanyConfig(cfg, {
          ...SUNAT_DEMO_CREDENTIALS,
          isDemoMode: true,
          entornoSunat: 'beta',
          certFileName: 'certificado_demo_sunat.pfx',
          certExpiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
          certIssuer: 'SUNAT Demo CA (Autofirmado)'
        });
        await setDoc(tenantDoc('config', 'company'), demoData);
        setCfg(demoData);
        flash('Modo de prueba (BETA SUNAT) activado.');
      } else {
        const prodData = publicCompanyConfig(cfg, {
          isDemoMode: false,
          entornoSunat: 'produccion'
        });
        await setDoc(tenantDoc('config', 'company'), prodData);
        setCfg(prodData);
        flash('Modo Producción (EN VIVO CON SUNAT) activado. Ingresa tu RUC y claves SOL reales.');
      }
      void runTest();
    } catch (err) {
      flash(err instanceof Error ? `Error: ${err.message}` : 'Error al cambiar entorno');
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
      const res = await uploadCertificate(certFile, certPassword);
      if (!res.ok) {
        flash(`Error al procesar certificado: ${res.message || 'Fallo desconocido'}`);
        return;
      }

      await setDoc(
        tenantDoc('config', 'company'),
        publicCompanyConfig(cfg, {
          certFileName: certFile.name,
          certExpiresAt: res.certificate?.expires_at ?? undefined,
          certIssuer: res.certificate?.issuer ?? undefined
        })
      );
      setCfg(publicCompanyConfig(cfg, {
        certFileName: certFile.name,
        certExpiresAt: res.certificate?.expires_at ?? undefined,
        certIssuer: res.certificate?.issuer ?? undefined
      }));

      flash('Certificado digital instalado y verificado exitosamente');
      setCertFile(null);
      setCertPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      void runTest();
    } catch (err) {
      flash(err instanceof Error ? `Error: ${err.message}` : 'Fallo en la carga del certificado');
    } finally {
      setUploadingCert(false);
    }
  };

  const saveCompanySettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = publicCompanyConfig(cfg, {
      ruc: clean(fd.get('ruc')),
      razonSocial: clean(fd.get('razonSocial')),
      direccion: clean(fd.get('direccion')),
      regimen: clean(fd.get('regimen')),
      serieFactura: clean(fd.get('serieFactura')) || 'F001',
      serieBoleta: clean(fd.get('serieBoleta')) || 'B001',
      entornoSunat: cfg?.entornoSunat ?? 'beta',
      isDemoMode: cfg?.isDemoMode ?? true,
      igvRate: num(fd.get('igvRate')) || 0.18,
      minBoletaSinDni: Math.trunc(num(fd.get('minBoletaSinDni'))) || 700,
      umbralConsolidacion: cfg?.umbralConsolidacion ?? 5,
    });

    if (!data.razonSocial) {
      flash('Error: La razón social es obligatoria');
      return;
    }

    setBusy(true);
    try {
      await setDoc(tenantDoc('config', 'company'), data);
      setCfg(data);
      flash('Configuración de la empresa guardada exitosamente');
    } catch {
      flash('Error al guardar la configuración');
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const solUser = clean(fd.get('solUser'));
    const solPassword = clean(fd.get('solPassword'));
    if (!cfg?.ruc || !cfg.razonSocial || !solUser || !solPassword) {
      flash('Error: completa los datos de empresa, usuario y clave SOL');
      return;
    }
    setBusy(true);
    try {
      await saveSunatCredentials({
        ruc: cfg.ruc,
        razonSocial: cfg.razonSocial,
        solUser,
        solPassword,
        entorno: cfg.entornoSunat
      });
      e.currentTarget.reset();
      flash('Credenciales SOL guardadas de forma segura en el motor tributario');
    } catch (error) {
      flash(error instanceof Error ? `Error: ${error.message}` : 'Error al guardar credenciales');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ─── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">SUNAT & Facturación Electrónica</h1>
          <p className="text-xs text-slate-500">
            Control de comprobantes electrónicos UBL 2.1, certificado digital y claves SOL.
          </p>
        </div>
        <button
          onClick={runTest}
          disabled={testing}
          className="btn-primary !min-h-[40px] text-xs font-bold"
        >
          <RefreshCw size={15} className={testing ? 'animate-spin' : ''} />
          {testing ? 'Diagnosticando…' : 'Probar conexión con SUNAT'}
        </button>
      </div>

      {/* ─── BANNER DESTACADO DE ESTADO: MODO DEMO vs MODO REAL ─────────────── */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 shadow-xs transition-colors ${
          isDemo
            ? 'border-amber-200 bg-gradient-to-r from-amber-50 via-brand-50/40 to-amber-50/30'
            : 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50/40 to-emerald-50/30'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
                isDemo ? 'bg-amber-500 text-white shadow-amber-500/25' : 'bg-emerald-600 text-white shadow-emerald-600/25'
              }`}
            >
              {isDemo ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`badge font-bold text-xs ${
                    isDemo ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                  }`}
                >
                  {isDemo ? 'MODO DE PRUEBA (SUNAT BETA)' : 'MODO EN VIVO / PRODUCCIÓN'}
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  RUC Activo: <b className="font-mono text-slate-800">{cfg?.ruc || '20000000001'}</b>
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1 max-w-xl">
                {isDemo
                  ? 'Estás utilizando credenciales de prueba oficiales (MODDATOS). Puedes emitir todas las boletas y facturas que desees sin consecuencias tributarias reales.'
                  : 'Estás conectado con tus credenciales SOL oficiales de SUNAT. Todos los comprobantes emitidos tienen validez tributaria legal.'}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {isDemo ? (
              <button
                disabled={busy}
                onClick={() => handleToggleDemoMode(false)}
                className="btn-ghost !border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold shadow-xs"
              >
                Pasar a datos reales (Producción)
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => handleToggleDemoMode(true)}
                className="btn-ghost !border-amber-300 bg-amber-100/60 hover:bg-amber-100 text-amber-900 text-xs font-bold shadow-xs"
              >
                Volver a modo de prueba
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── NAVEGACIÓN POR PESTAÑAS ─────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('estado')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-colors border-b-2 ${
            activeTab === 'estado'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Activity size={16} /> Estado & Diagnóstico
        </button>
        <button
          onClick={() => setActiveTab('empresa')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-colors border-b-2 ${
            activeTab === 'empresa'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 size={16} /> Datos de la Empresa
        </button>
        <button
          onClick={() => setActiveTab('sol')}
          className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-colors border-b-2 ${
            activeTab === 'sol'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <KeyRound size={16} /> Certificado & Claves SOL
        </button>
      </div>

      {/* ─── PESTAÑA 1: ESTADO & DIAGNÓSTICO ─────────────────────────────────── */}
      {activeTab === 'estado' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Tarjeta 1: Motor API Facturación */}
            <div className="card p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Motor de Facturación</span>
                <Server size={18} className="text-primary" />
              </div>
              <p className="text-lg font-extrabold text-slate-900">
                {testResult ? (testResult.ok ? 'En Línea' : 'Desconectado') : 'Listo para probar'}
              </p>
              <p className="text-xs text-slate-400 font-mono truncate">
                Proxy seguro de Cloud Functions
              </p>
            </div>

            {/* Tarjeta 2: Certificado Digital */}
            <div className="card p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Certificado Digital</span>
                <FileKey size={18} className="text-brand-500" />
              </div>
              <p className="text-lg font-extrabold text-slate-900">
                {cfg?.certFileName ? 'Instalado' : 'No configurado'}
              </p>
              <p className="text-xs text-slate-400 truncate">
                {cfg?.certIssuer || (cfg?.certFileName ? 'Certificado activo' : 'Requiere archivo .pfx')}
              </p>
            </div>

            {/* Tarjeta 3: Servidor SUNAT */}
            <div className="card p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500">Servicio SUNAT</span>
                <ShieldCheck size={18} className="text-emerald-500" />
              </div>
              <p className="text-lg font-extrabold text-slate-900">
                {isDemo ? 'Servidor Beta (Demo)' : 'Servidor Producción'}
              </p>
              <p className="text-xs text-slate-400">
                {isDemo ? 'Pruebas habilitadas' : 'Comprobantes oficiales'}
              </p>
            </div>
          </div>

          {/* Resultado de Diagnóstico Detallado */}
          {testResult && (
            <div
              className={`rounded-2xl border p-4 space-y-3 ${
                testResult.ok && testResult.status === 'listo'
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : testResult.ok
                  ? 'border-amber-200 bg-amber-50/50'
                  : 'border-red-200 bg-red-50/50'
              }`}
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                {testResult.ok && testResult.status === 'listo' ? (
                  <CheckCircle2 size={16} className="text-emerald-600" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-600" />
                )}
                Diagnóstico del Sistema
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <span className="text-slate-400 block text-xs uppercase font-bold">Estado del Motor</span>
                  <span className="font-bold text-slate-800">{testResult.status}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-slate-200">
                  <span className="text-slate-400 block text-xs uppercase font-bold">Entorno Detectado</span>
                  <span className="font-bold text-slate-800">{testResult.sunat?.entorno ?? (isDemo ? 'Beta / Pruebas' : 'Producción')}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── PESTAÑA 2: DATOS DE LA EMPRESA & SERIES ─────────────────────────── */}
      {activeTab === 'empresa' && (
        <form ref={formRef} onSubmit={saveCompanySettings} className="card p-5 space-y-5 shadow-xs">
          <div>
            <h3 className="text-sm font-bold text-slate-900 font-display">Datos Tributarios del Emisor</h3>
            <p className="text-xs text-slate-500">
              Información que aparecerá en el encabezado de las boletas y facturas electrónicas.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <label className="label">RUC de la Empresa *</label>
              <input
                name="ruc"
                required
                maxLength={11}
                defaultValue={cfg?.ruc}
                placeholder="Ej.: 20601234567"
                className="field font-mono font-bold"
              />
            </div>
            <div>
              <label className="label">Razón Social o Nombre Comercial *</label>
              <input
                name="razonSocial"
                required
                defaultValue={cfg?.razonSocial}
                placeholder="Ej.: INVERSIONES D'ENZOZ S.A.C."
                className="field font-bold"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Dirección Fiscal</label>
              <input
                name="direccion"
                defaultValue={cfg?.direccion}
                placeholder="Ej.: Av. Principal 123, Urb. Los Jardines, Lima"
                className="field"
              />
            </div>
            <div>
              <label className="label">Régimen Tributario</label>
              <input
                name="regimen"
                defaultValue={cfg?.regimen}
                placeholder="Ej.: Régimen MYPE Tributario / General"
                className="field"
              />
            </div>
            <div>
              <label className="label">Tasa de IGV (Decimal)</label>
              <input
                name="igvRate"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={cfg?.igvRate ?? 0.18}
                className="field font-mono"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display mb-3">
              Series de Comprobantes & Umbrales
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Serie Boletas (Ej. B001)</label>
                <input
                  name="serieBoleta"
                  required
                  defaultValue={cfg?.serieBoleta ?? 'B001'}
                  className="field font-mono font-bold uppercase"
                />
              </div>
              <div>
                <label className="label">Serie Facturas (Ej. F001)</label>
                <input
                  name="serieFactura"
                  required
                  defaultValue={cfg?.serieFactura ?? 'F001'}
                  className="field font-mono font-bold uppercase"
                />
              </div>
              <div>
                <label className="label">Mínimo Boleta sin DNI (S/)</label>
                <input
                  name="minBoletaSinDni"
                  type="number"
                  defaultValue={cfg?.minBoletaSinDni ?? 700}
                  className="field font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={busy} className="btn-primary !min-h-[42px] px-6 font-bold">
              {busy ? 'Guardando…' : 'Guardar Datos de la Empresa'}
            </button>
          </div>
        </form>
      )}

      {/* ─── PESTAÑA 3: CERTIFICADO & CLAVES SOL ─────────────────────────────── */}
      {activeTab === 'sol' && (
        <div className="space-y-4">
          {/* Subida de Certificado */}
          <div className="card p-5 space-y-4 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-display">Certificado Digital Tributario (.pfx / .p12)</h3>
              <p className="text-xs text-slate-500">
                Utilizado para firmar electrónicamente los XML de boletas y facturas antes de enviarlos a SUNAT.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="label">Archivo del Certificado (.pfx o .p12)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pfx,.p12"
                  onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                  className="field !h-11 !py-2 text-xs"
                />
              </div>
              <div>
                <label className="label">Contraseña del Certificado Digital</label>
                <input
                  type="password"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                  placeholder="••••••••"
                  className="field"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleUploadCertDirect}
                disabled={uploadingCert || !certFile || !certPassword}
                className="btn-primary !min-h-[40px] text-xs font-bold"
              >
                <UploadCloud size={16} />
                {uploadingCert ? 'Instalando certificado…' : 'Subir e Instalar Certificado'}
              </button>
            </div>
          </div>

          {/* Formulario de Claves SOL */}
          <form onSubmit={saveCredentials} className="card p-5 space-y-4 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900 font-display">Credenciales SOL de SUNAT</h3>
              <p className="text-xs text-slate-500">
                Usuario secundario de SUNAT con permisos de facturación electrónica.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label className="label">Usuario Secundario SOL</label>
                <input
                  name="solUser"
                  placeholder="Ej.: MODDATOS o USERFACT01"
                  className="field font-mono uppercase"
                />
              </div>
              <div>
                <label className="label">Clave SOL</label>
                <input
                  name="solPassword"
                  type="password"
                  placeholder="••••••••"
                  className="field"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" disabled={busy} className="btn-brand !min-h-[42px] px-6 font-bold">
                {busy ? 'Guardando…' : 'Guardar Credenciales SOL'}
              </button>
            </div>
          </form>
        </div>
      )}

      <FlashBar msg={msg} />
    </div>
  );
}
