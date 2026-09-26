import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

export const getFirebaseAuth = (app: FirebaseApp) => getAuth(app);
