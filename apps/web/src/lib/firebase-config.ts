const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyBTfv5ASVJ1dGxM6JnghGlNdYNLXf9cQjU',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'tutiendaos.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'tutiendaos',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'tutiendaos.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '141765892945',
  appId: env.VITE_FIREBASE_APP_ID || '1:141765892945:web:9bf75ffc8420de80c55170',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-D73T8FSD3J'
};
