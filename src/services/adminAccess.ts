import type { User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, ensureAuth, functions } from './firebase';

type VerifiedRole = { user: User; admin: boolean; expiresAt: number };
let verifiedRole: VerifiedRole | null = null;
let pending: { user: User; promise: Promise<boolean> } | null = null;
const listeners = new Set<() => void>();

const currentEmail = (user: User): string => (user.email
  ?? user.providerData.find(profile => !!profile.email)?.email ?? '').trim().toLowerCase();

/** Display state only. Server rules/callables still enforce the signed admin claim. */
export const getCachedAdminAccess = (email?: string | null): boolean => {
  const user = auth.currentUser;
  return !!user && !user.isAnonymous && verifiedRole?.user === user
    && verifiedRole.admin && verifiedRole.expiresAt > Date.now()
    && (email == null || currentEmail(user) === email.trim().toLowerCase());
};

export const subscribeAdminAccess = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const remember = (user: User, admin: boolean, tokenExpiresAt?: string): boolean => {
  if (auth.currentUser !== user) return false;
  const tokenExpiry = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN;
  // Display authority lasts as long as the signed token. Refresh cadence belongs
  // to the screen hook, so a minute passing cannot silently remove admin controls.
  verifiedRole = { user, admin, expiresAt: Number.isFinite(tokenExpiry) ? tokenExpiry : Date.now() };
  listeners.forEach(listener => listener());
  return admin;
};

/** Reconcile the account on the server and then refresh the token used by Firestore/callables. */
export const resolveAdminAccess = async (): Promise<boolean> => {
  try { await ensureAuth(); } catch { return false; }
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return false;
  if (pending?.user === user) return pending.promise;
  const promise = (async () => {
    try {
      const getAccess = httpsCallable<void, { admin?: boolean; claimsChanged?: boolean }>(
        functions, 'getAccountAccess', { timeout: 15000 },
      );
      const response = await getAccess();
      if (auth.currentUser !== user) return false;
      if (response.data?.admin !== true) {
        remember(user, false);
        await user.getIdTokenResult(true).catch(() => undefined);
        return false;
      }
      // Always refresh: claims may already exist server-side while this session's
      // cached token still lacks them, even when claimsChanged is false.
      const token = await user.getIdTokenResult(true);
      if (auth.currentUser !== user) return false;
      return remember(user, response.data?.admin === true && token.claims.admin === true, token.expirationTime);
    } catch (error) {
      if (auth.currentUser !== user) return false;
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      if (code === 'functions/permission-denied' || code === 'functions/unauthenticated'
        || code === 'auth/user-disabled' || code === 'auth/user-token-expired') return remember(user, false);
      // A signed, freshly refreshed claim is sufficient if the reconciliation
      // callable is temporarily unavailable. Email/config alone never grants access.
      try {
        const token = await user.getIdTokenResult(true);
        return remember(user, token.claims.admin === true, token.expirationTime);
      } catch {
        return auth.currentUser === user && getCachedAdminAccess();
      }
    }
  })();
  pending = { user, promise };
  try { return await promise; }
  finally { if (pending?.promise === promise) pending = null; }
};
