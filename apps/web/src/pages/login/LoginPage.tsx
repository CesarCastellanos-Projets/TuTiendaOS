import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { useAuth, homeFor } from '../../lib/auth';

export function LoginPage() {
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user && profile) return <Navigate to={homeFor(profile.role)} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    signInWithEmailAndPassword(auth, email.trim(), pass)
      .then(() => undefined)
      .catch(() => setError('Usuario o clave incorrectos.'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="price-tag rounded-lg px-4 py-2 font-display text-3xl tracking-wide">
            D'ENZOZ
          </span>
          <p className="text-sm text-slate-500">Ingresa con tu cuenta de tienda</p>
        </div>

        <label className="label" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          className="field mb-3"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="label" htmlFor="pass">
          Clave
        </label>
        <input
          id="pass"
          type="password"
          required
          autoComplete="current-password"
          className="field mb-4"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />

        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-critical">
            {error}
          </p>
        )}

        <button disabled={busy} className="btn-primary w-full">
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
