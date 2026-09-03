import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDh5lYWZsM1jNTEiq9mJzph1BaRkj49-tM',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'denzozsaas.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'denzozsaas',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'denzozsaas.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '685893382879',
  appId: env.VITE_FIREBASE_APP_ID || '1:685893382879:web:941125e771d729925cef6a',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-CGH76ZQPH0'
};

/** true solo si hay credenciales reales */
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
export const db = initializeFirestore(firebaseApp, {
  ignoreUndefinedProperties: true
});
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
