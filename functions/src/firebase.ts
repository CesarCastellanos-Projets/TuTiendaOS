import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

if (getApps().length === 0) {
  initializeApp();
}

export const admin = { auth: getAuth, messaging: getMessaging };
export const db = getFirestore();
