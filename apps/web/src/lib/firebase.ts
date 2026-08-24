import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? ''
};

/** true solo si hay credenciales reales en .env */
export const firebaseReady = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

/**
 * Nunca lanza en import-time: si falta configuración creamos una app "demo"
 * para que la UI pueda arrancar y mostrar la pantalla de configuración.
 */
export const firebaseApp: FirebaseApp = initializeApp(
  firebaseReady
    ? firebaseConfig
    : {
        apiKey: 'demo-key',
        authDomain: 'demo.firebaseapp.com',
        projectId: 'demo',
        storageBucket: 'demo.appspot.com',
        messagingSenderId: '0',
        appId: 'demo-app'
      }
);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');
export const storage = getStorage(firebaseApp);

if (env.DEV && env.VITE_USE_EMULATORS === '1' && firebaseReady) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

/** Analytics opcional: chunk separado, silencioso si el navegador no lo soporta. */
export async function initAnalytics(): Promise<void> {
  if (!firebaseConfig.measurementId || typeof window === 'undefined') return;
  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics');
    if (await isSupported()) getAnalytics(firebaseApp);
  } catch {
    // nunca bloquea la app
  }
}
