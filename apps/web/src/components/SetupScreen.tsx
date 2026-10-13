import { FirebaseLogo } from './FirebaseLogo';

/** Se muestra cuando falta configurar las credenciales de Firebase en .env */
export function SetupScreen() {
  const missing = [
    ['VITE_FIREBASE_API_KEY', 'Clave API web'],
    ['VITE_FIREBASE_AUTH_DOMAIN', 'Dominio de autenticación'],
    ['VITE_FIREBASE_PROJECT_ID', 'ID del proyecto'],
    ['VITE_FIREBASE_STORAGE_BUCKET', 'Bucket de Storage'],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'ID del remitente'],
    ['VITE_FIREBASE_APP_ID', 'ID de la app']
  ];

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-4">
      <div className="card w-full max-w-xl p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <FirebaseLogo />
          <span className="price-tag rounded px-2.5 py-1 font-display text-xl tracking-wide">
            TuTiendaOS
          </span>
        </div>

        <h1 className="mt-5 font-display text-2xl uppercase tracking-wide">
          Configura tu proyecto Firebase
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          La app arrancó sin credenciales, por eso no puede conectarse. Tómate 3 minutos:
        </p>

        <ol className="mt-4 space-y-2.5 text-sm">
          {[
            <>
              Abre la{' '}
              <a
                className="font-semibold text-critical underline underline-offset-2"
                href="https://console.firebase.google.com"
                target="_blank"
                rel="noreferrer"
              >
                consola de Firebase
              </a>{' '}
              y crea (o entra a) tu proyecto.
            </>,
            <>
              En <b>Configuración del proyecto → Tus apps</b>, registra una app{' '}
              <b>Web</b> y copia el objeto <code className="font-mono text-xs">firebaseConfig</code>.
            </>,
            <>
              En <b>Authentication → Sign-in method</b>, habilita{' '}
              <b>Correo/contraseña</b>.
            </>,
            <>
              En <b>Firestore Database</b>, crea la base de datos (modo producción; ya
              tienes reglas en el repo).
            </>
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-critical text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-sm font-semibold">Luego completa apps/web/.env:</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3.5 font-mono text-xs leading-relaxed text-slate-50">
{`VITE_FIREBASE_API_KEY=AIza…
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc…`}
        </pre>
        <p className="mt-2 text-xs text-slate-500">
          Guarda el archivo y reinicia <code className="font-mono">npm run dev</code>. Variables que faltan:{' '}
          <span className="font-semibold">{missing.filter(([k]) => !import.meta.env[k]).map(([k]) => k).join(', ')}</span>
        </p>
      </div>
    </div>
  );
}
