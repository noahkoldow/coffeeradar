import { User, createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, firebaseEnabled } from './firebase';

export const isAuthReady = (): boolean => firebaseEnabled && !!auth;

export const subscribeAuthState = (callback: (user: User | null) => void): (() => void) => {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
};

export const signInWithEmail = async (email: string, password: string): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');
  await signInWithEmailAndPassword(auth, email.trim(), password);
};

export const signUpWithEmail = async (email: string, password: string): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');
  await createUserWithEmailAndPassword(auth, email.trim(), password);
};

export const signOutUser = async (): Promise<void> => {
  if (!auth) return;
  await signOut(auth);
};
