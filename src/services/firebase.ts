import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';

const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};

const firebaseConfig = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'AIzaSyAXbxWOx55fcf2b2dA03SCuHVbfeBxKrmc',
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'coffeeradar-415f2.firebaseapp.com',
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'coffeeradar-415f2',
  storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'coffeeradar-415f2.firebasestorage.app',
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '1056804480515',
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '1:1056804480515:web:fe0e0e62f6ba0c4b50d036',
  measurementId: env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? 'G-DF02468X9W',
};

export const firebaseEnabled =
  firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
  firebaseConfig.projectId !== 'YOUR_PROJECT_ID' &&
  firebaseConfig.appId !== 'YOUR_APP_ID';

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;

if (firebaseEnabled) {
  firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  firebaseAuth = getAuth(firebaseApp);
  firestoreDb = getFirestore(firebaseApp);
}

export const auth = firebaseAuth;
export const db = firestoreDb;

export const ensureAuth = async (): Promise<string | null> => {
  if (!firebaseEnabled || !auth) return null;
  return auth.currentUser?.uid ?? null;
};
