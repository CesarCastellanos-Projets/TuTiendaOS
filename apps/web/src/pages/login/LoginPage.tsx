import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
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
  AlertCircle
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { useAuth, homeFor } from '../../lib/auth';

export function LoginPage() {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user && profile) return <Navigate to={homeFor(profile.role)} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !pass) return;
    setBusy(true);
    setError(null);
    signInWithEmailAndPassword(auth, email.trim(), pass)
      .then(() => undefined)
      .catch((err) => {
        const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found'
          ? 'Correo o contraseña incorrectos. Verifica tus credenciales.'
          : 'Error al iniciar sesión. Intenta nuevamente.';
        setError(msg);
      })
      .finally(() => setBusy(false));
  };

  const fillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPass(demoPass);
    setError(null);
  };

  return (
    <div className="flex min-h-dvh bg-slate-950 text-white">
      {/* ─── LADO IZQUIERDO: BRANDING & HIGHLIGHTS (Visible en Desktop) ──────── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 p-12 lg:flex border-r border-slate-800/60">
        {/* Glow ambient background effect */}
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />

        {/* Brand Header */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary to-indigo-400 text-white shadow-lg shadow-primary/30">
            <Sparkles size={24} />
          </div>
          <div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight text-white">
              D'ENZOZ
            </h1>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300">
              SaaS Comercial & Facturación SUNAT
            </p>
          </div>
        </div>

        {/* Center Value Proposition */}
        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 backdrop-blur-md">
            <Zap size={14} className="text-amber-400" />
            <span>Sistema POS Ultrarrápido & Offline Ready</span>
          </div>

          <h2 className="font-display text-4xl font-extrabold leading-tight text-white">
            El control total de tus tiendas, stock y comprobantes en una sola plataforma.
          </h2>

          <p className="text-sm leading-relaxed text-slate-300">
            Diseñado para agilizar la atención en mostrador, gestionar almacenes múltiples y emitir
            boletas y facturas electrónicas oficiales a SUNAT en milisegundos.
          </p>

          {/* Features Highlights */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur-xs">
              <ShieldCheck size={18} className="text-emerald-400 shrink-0" />
              <span className="text-xs font-medium text-slate-200">Facturación UBL 2.1 Directa</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur-xs">
              <Receipt size={18} className="text-indigo-400 shrink-0" />
              <span className="text-xs font-medium text-slate-200">Control de Caja & Tickets Z</span>
            </div>
          </div>
        </div>

        {/* Footer Note */}
        <div className="relative z-10 text-xs text-slate-500">
          © {new Date().getFullYear()} D'ENZOZ SaaS. Desarrollado para el comercio peruano.
        </div>
      </div>

      {/* ─── LADO DERECHO: FORMULARIO DE ACCESO PREMIUM ────────────────────────── */}
      <div className="flex flex-1 flex-col justify-center bg-slate-900/40 px-6 py-12 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-md space-y-6">
          {/* Mobile Brand Header */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm shadow-primary/30">
              <Sparkles size={20} />
            </div>
            <div>
              <span className="font-display font-extrabold text-xl tracking-tight text-white block leading-tight">
                D'ENZOZ
              </span>
              <span className="text-xs font-medium text-indigo-300 block">
                SaaS Punto de Venta
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Bienvenido de nuevo
            </h2>
            <p className="text-sm text-slate-400">
              Ingresa tus credenciales de tienda para acceder al sistema.
            </p>
          </div>

          {/* Tarjeta de Formulario */}
          <form onSubmit={submit} className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 sm:p-8 shadow-2xl space-y-4">
            {/* Input Correo */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 font-display flex items-center gap-1.5" htmlFor="email">
                <Mail size={14} className="text-slate-400" /> Correo Electrónico
              </label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="usuario@denzoz.pe"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Input Contraseña con Toggle Show/Hide */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 font-display flex items-center gap-1.5" htmlFor="pass">
                <Lock size={14} className="text-slate-400" /> Contraseña
              </label>
              <div className="relative">
                <input
                  id="pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-11 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors p-1"
                  aria-label={showPass ? 'Ocultar clave' : 'Mostrar clave'}
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Mensaje de Error */}
            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-300 animate-in fade-in">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Botón Principal */}
            <button
              disabled={busy}
              className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary via-indigo-600 to-indigo-500 py-3.5 text-sm font-display font-bold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:opacity-95 hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? (
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
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4 backdrop-blur-xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 text-center">
              Accesos Rápidos de Prueba (1 Clic)
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => fillDemo('admin@denzoz.pe', 'admin123')}
                className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-center transition-all hover:border-indigo-500/50 hover:bg-slate-800 active:scale-95"
              >
                <span className="text-xs font-bold text-indigo-300">Admin</span>
                <span className="text-[10px] text-slate-500">Panel total</span>
              </button>
              <button
                type="button"
                onClick={() => fillDemo('cajero@denzoz.pe', 'cajero123')}
                className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-center transition-all hover:border-emerald-500/50 hover:bg-slate-800 active:scale-95"
              >
                <span className="text-xs font-bold text-emerald-300">Cajero</span>
                <span className="text-[10px] text-slate-500">Punto de venta</span>
              </button>
              <button
                type="button"
                onClick={() => fillDemo('piso@denzoz.pe', 'piso123')}
                className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/80 p-2 text-center transition-all hover:border-amber-500/50 hover:bg-slate-800 active:scale-95"
              >
                <span className="text-xs font-bold text-amber-300">Trabajador</span>
                <span className="text-[10px] text-slate-500">Consultas/Piso</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
