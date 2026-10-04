import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Sparkles,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Zap,
  Receipt,
  Loader2,
  AlertCircle,
  Store
} from 'lucide-react';
import { useAuth, homeFor } from '../../lib/auth';

export function LoginPage() {
  const { user, profile, loading, error: sessionError, login } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user && profile) {
    const calendar = new URLSearchParams(window.location.search).get('calendar') === '1' && profile.canManageCalendar;
    const replenishment = new URLSearchParams(window.location.search).get('replenishment') === '1'
      && (profile.role === 'admin' || (profile.role === 'pos' && profile.storeAccess === 'all'));
    if (replenishment) return <Navigate to={profile.role === 'admin' ? '/admin/reposiciones' : '/pos/aprobar-reposiciones'} replace />;
    return <Navigate to={calendar ? profile.role === 'admin' ? '/admin/calendario' : '/pos/calendario' : homeFor(profile.role)} replace />;
  }

  const authenticate = async (targetEmail: string, targetPass: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(targetEmail.trim(), targetPass);
    } catch (loginError) {
      const code = typeof loginError === 'object' && loginError !== null && 'code' in loginError
        ? String(loginError.code)
        : '';
      setError(code === 'auth/invalid-credential' || code === 'auth/user-not-found'
        ? 'Correo o contraseña incorrectos. Verifica tus credenciales.'
        : loginError instanceof Error
          ? loginError.message
          : 'Error al iniciar sesión. Intenta nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !pass) return;
    void authenticate(email, pass);
  };

  const loginDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPass(demoPass);
    void authenticate(demoEmail, demoPass);
  };

  return (
    <div className="flex min-h-dvh bg-slate-50 text-slate-900">
      {/* ─── LADO IZQUIERDO: BRANDING & VALOR AGREGADO (Visible en Desktop) ─── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 p-12 text-white lg:flex border-r border-indigo-800/40">
        {/* Glow ambient background effect */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary/30 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-400 text-white shadow-lg shadow-primary/30">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight text-white">
              D'ENZOZ
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-300">
              SaaS Comercial & Facturación SUNAT
            </p>
          </div>
        </div>

        {/* Center Value Proposition */}
        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3.5 py-1.5 text-xs font-semibold text-indigo-200 backdrop-blur-md">
            <Zap size={14} className="text-amber-400" />
            <span>Sistema POS Ultrarrápido & Offline Ready</span>
          </div>

          <h2 className="font-display text-4xl font-extrabold leading-tight text-white">
            El control total de tus tiendas, stock y comprobantes en una sola plataforma.
          </h2>

          <p className="text-sm leading-relaxed text-indigo-100/90">
            Diseñado para agilizar la atención en mostrador, gestionar almacenes múltiples y emitir
            boletas y facturas electrónicas oficiales a SUNAT en milisegundos.
          </p>

          {/* Features Highlights */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
              <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-100">Facturación UBL 2.1 Directa</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
              <Receipt size={20} className="text-indigo-300 shrink-0" />
              <span className="text-xs font-semibold text-slate-100">Control de Caja & Tickets Z</span>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="relative z-10 text-xs text-indigo-300/60">
          © {new Date().getFullYear()} D'ENZOZ SaaS. Desarrollado para el comercio peruano.
        </div>
      </div>

      {/* ─── LADO DERECHO: FORMULARIO DE ACCESO PREMIUM & LUMINOSO ─────────────── */}
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 bg-gradient-to-b from-slate-50 via-white to-slate-50">
        <div className="mx-auto w-full max-w-md space-y-6">
          {/* Mobile Brand Header */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-sm shadow-primary/30">
              <Sparkles size={22} />
            </div>
            <div>
              <span className="font-display font-extrabold text-xl tracking-tight text-slate-900 block leading-tight">
                D'ENZOZ
              </span>
              <span className="text-xs font-semibold text-primary block">
                SaaS Punto de Venta & Inventarios
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              Bienvenido de nuevo
            </h2>
            <p className="text-sm text-slate-500 font-medium">
              Ingresa tus credenciales de tienda para acceder al sistema.
            </p>
          </div>

          {/* Tarjeta de Formulario Luminosa */}
          <form onSubmit={submit} className="rounded-3xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xl shadow-slate-900/5 space-y-4">
            {/* Input Correo */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5" htmlFor="email">
                <Mail size={14} className="text-slate-400" /> Correo Electrónico
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="usuario@denzoz.pe"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 focus:outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Input Contraseña con Toggle Show/Hide */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5" htmlFor="pass">
                <Lock size={14} className="text-slate-400" /> Contraseña
              </label>
              <div className="relative">
                <input
                  id="pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 pr-11 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 focus:outline-none transition-all"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors p-1"
                  aria-label={showPass ? 'Ocultar clave' : 'Mostrar clave'}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Mensaje de Error */}
            {(error || sessionError) && (
              <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-critical animate-in fade-in">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <span>{error || sessionError}</span>
              </div>
            )}

            {/* Botón Principal de Ingreso */}
            <button
              disabled={busy || loading}
              className="group relative flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary via-indigo-600 to-indigo-500 py-3.5 text-sm font-display font-extrabold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-50"
            >
              {busy || loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Verificando acceso…</span>
                </>
              ) : (
                <>
                  <span>Ingresar al Sistema</span>
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          {/* ─── BOTONES DE ACCESO RÁPIDO PARA TESTING / DEMO ──────────────── */}
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5 text-center flex items-center justify-center gap-1.5">
              <Store size={13} className="text-slate-400" /> Accesos Rápidos de Prueba (1 Clic)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => loginDemo('admin@denzoz.pe', 'admin123')}
                className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 text-center transition-all hover:border-primary hover:bg-indigo-50/60 active:scale-95"
              >
                <span className="text-xs font-bold text-primary font-display">Admin</span>
                <span className="text-[10px] text-slate-400">Panel total</span>
              </button>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => loginDemo('caja1@denzoz.pe', 'caja123')}
                className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 text-center transition-all hover:border-emerald-500 hover:bg-emerald-50/60 active:scale-95"
              >
                <span className="text-xs font-bold text-emerald-700 font-display">Cajero</span>
                <span className="text-[10px] text-slate-400">Punto de venta</span>
              </button>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => loginDemo('piso1@denzoz.pe', 'piso123')}
                className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5 text-center transition-all hover:border-amber-500 hover:bg-amber-50/60 active:scale-95"
              >
                <span className="text-xs font-bold text-amber-700 font-display">Trabajador</span>
                <span className="text-[10px] text-slate-400">Consultas/Piso</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
