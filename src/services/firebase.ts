import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { Functions, getFunctions } from 'firebase/functions';
import { FirebaseStorage, getStorage } from 'firebase/storage';

const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};
const isDevBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

const devFirebaseFallback = {
  apiKey: 'AIzaSyAXbxWOx55fcf2b2dA03SCuHVbfeBxKrmc',
  authDomain: 'coffeeradar-415f2.firebaseapp.com',
  projectId: 'coffeeradar-415f2',
  storageBucket: 'coffeeradar-415f2.firebasestorage.app',
  messagingSenderId: '1056804480515',
  appId: '1:1056804480515:web:fe0e0e62f6ba0c4b50d036',
  measurementId: 'G-DF02468X9W',
};

const resolveFirebaseValue = (key: keyof typeof devFirebaseFallback): string | undefined => {
  const envValue = String(env[`EXPO_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}`] ?? '').trim();
  if (envValue) return envValue;
  return isDevBuild ? devFirebaseFallback[key] : undefined;
};

const firebaseConfig = {
  apiKey: resolveFirebaseValue('apiKey'),
  authDomain: resolveFirebaseValue('authDomain'),
  projectId: resolveFirebaseValue('projectId'),
  storageBucket: resolveFirebaseValue('storageBucket'),
  messagingSenderId: resolveFirebaseValue('messagingSenderId'),
  appId: resolveFirebaseValue('appId'),
  measurementId: resolveFirebaseValue('measurementId'),
};

const hasRequiredFirebaseConfig = Boolean(
  firebaseConfig.apiKey
    && firebaseConfig.projectId
    && firebaseConfig.appId
);

export const firebaseEnabled = hasRequiredFirebaseConfig;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firestoreDb: Firestore | null = null;
let firebaseStorage: FirebaseStorage | null = null;
let firebaseFunctions: Functions | null = null;

const appCheckSiteKey = String(env.EXPO_PUBLIC_FIREBASE_APPCHECK_SITE_KEY ?? '').trim();

if (firebaseEnabled) {
  firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig as Record<string, string>);
  firebaseAuth = getAuth(firebaseApp);
  firestoreDb = getFirestore(firebaseApp);
  firebaseStorage = getStorage(firebaseApp);
  firebaseFunctions = getFunctions(firebaseApp);

  // App Check is initialized for web builds when a reCAPTCHA key is configured.
  if (typeof window !== 'undefined' && appCheckSiteKey) {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (isDevBuild && typeof window !== 'undefined') {
    console.warn('[Firebase] App Check not initialized: missing EXPO_PUBLIC_FIREBASE_APPCHECK_SITE_KEY.');
  }
} else if (isDevBuild) {
  console.warn('[Firebase] Disabled: missing required Expo public Firebase env vars.');
}

export const app = firebaseApp;
export const auth = firebaseAuth;
export const db = firestoreDb;
export const storage = firebaseStorage;
export const functionsClient = firebaseFunctions;
export const appCheckEnabled = Boolean(typeof window !== 'undefined' && appCheckSiteKey && firebaseEnabled);

export const ensureAuth = async (): Promise<string | null> => {
  if (!firebaseEnabled || !auth) return null;
  return auth.currentUser?.uid ?? null;
};
