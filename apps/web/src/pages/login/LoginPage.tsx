import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Loader2, AlertCircle, Store, Package, Receipt } from 'lucide-react';
import { Brand } from '../../components/Brand';
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

  return <div className="login-page">
    <section className="login-brand"><Brand subtitle="Sistema de tienda" />
      <div className="login-statement"><span className="eyebrow">TuTiendaOS · Operación diaria</span><h1>Tu tienda,<br /><em>en orden.</em></h1><p>Todo listo para atender, vender y seguir creciendo.</p>
        <div className="login-capabilities"><span><Receipt size={18} /> Ventas</span><span><Package size={18} /> Mercadería</span><span><Store size={18} /> Tiendas</span></div>
      </div>
      <div className="login-signature" aria-hidden="true"><img src="/branding/TuTiendaOS.png" alt="TuTiendaOS" width="220" height="220" /><span>TuTiendaOS</span></div>
      <p className="login-footer">Cada producto, cada venta, en su lugar.</p>
    </section>
    <main className="login-form-side"><div className="login-form-wrap">
      <div className="lg:hidden mb-10"><Brand /></div><span className="eyebrow">Bienvenido</span><h2>Inicia tu jornada.</h2><p>Ingresa con tu cuenta de trabajo.</p>
      <form onSubmit={submit} className="space-y-5 mt-8">
        <label className="block"><span className="label">Correo electrónico</span><input id="email" type="email" autoComplete="username" required placeholder="usuario@tutiendaos.pe" className="field" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block"><span className="label">Contraseña</span><span className="relative block"><input id="pass" type={showPass ? 'text' : 'password'} autoComplete="current-password" required className="field pr-14" value={pass} onChange={(e) => setPass(e.target.value)} /><button type="button" className="icon-button absolute right-1 top-0" aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPass(!showPass)}>{showPass ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
        {(error || sessionError) && <p role="alert" className="flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-critical"><AlertCircle size={18} className="shrink-0" />{error || sessionError}</p>}
        <button disabled={busy || loading} className="btn-primary w-full min-h-12">{busy || loading ? <><Loader2 size={18} className="animate-spin" /> Verificando acceso…</> : <>Ingresar <ArrowRight size={18} /></>}</button>
      </form>
      <details className="login-demo"><summary>Accesos de prueba</summary><div className="grid grid-cols-3 gap-2 pt-3"><button className="btn-secondary" disabled={busy || loading} onClick={() => loginDemo('admin@tutiendaos.pe', 'admin123')}>Admin</button><button className="btn-secondary" disabled={busy || loading} onClick={() => loginDemo('caja1@tutiendaos.pe', 'caja123')}>Cajero</button><button className="btn-secondary" disabled={busy || loading} onClick={() => loginDemo('piso1@tutiendaos.pe', 'piso123')}>Trabajador</button></div></details>
    </div></main>
  </div>;
}
