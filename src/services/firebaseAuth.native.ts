import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';

// Metro selects Firebase's React Native entry, whose persistence export is not
// included in the package's default TypeScript declarations.
const { getReactNativePersistence } = FirebaseAuth as typeof FirebaseAuth & {
  getReactNativePersistence(storage: typeof AsyncStorage): FirebaseAuth.Persistence;
};

export const getFirebaseAuth = (app: FirebaseApp): FirebaseAuth.Auth => {
  try {
    return FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    // Fast Refresh may evaluate this module after Auth has already initialized.
    if ((error as { code?: string })?.code === 'auth/already-initialized') {
      return FirebaseAuth.getAuth(app);
    }
    throw error;
  }
};
