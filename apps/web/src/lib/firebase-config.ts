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
