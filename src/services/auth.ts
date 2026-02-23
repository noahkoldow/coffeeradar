import {
  User,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { auth, firebaseEnabled } from './firebase';

// Complete any pending auth sessions (needed for web-based OAuth redirects)
WebBrowser.maybeCompleteAuthSession();

// ── Constants ────────────────────────────────────────────
const GOOGLE_WEB_CLIENT_ID =
  '1056804480515-ohhlhbaohvuqpaqj3eipeah09hg59gj8.apps.googleusercontent.com';

// Static Google discovery doc — avoids useAutoDiscovery hook
const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// Apple web-OAuth discovery
const APPLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
  tokenEndpoint: 'https://appleid.apple.com/auth/token',
};

// Firebase redirect handler for Apple web OAuth
const FIREBASE_REDIRECT_URI =
  'https://coffeeradar-415f2.firebaseapp.com/__/auth/handler';

export const isAuthReady = (): boolean => firebaseEnabled && !!auth;

export const subscribeAuthState = (
  callback: (user: User | null) => void,
): (() => void) => {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
};

export const signInWithEmail = async (
  email: string,
  password: string,
): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');
  await signInWithEmailAndPassword(auth, email.trim(), password);
};

export const signUpWithEmail = async (
  email: string,
  password: string,
): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');
  await createUserWithEmailAndPassword(auth, email.trim(), password);
};

export const signOutUser = async (): Promise<void> => {
  if (!auth) return;
  await signOut(auth);
};

/* ── Google Sign-In ────────────────────────────────────── */
export const signInWithGoogle = async (): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'bits' });

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    redirectUri,
    scopes: ['openid', 'profile', 'email'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);

  if (result.type !== 'success' || !result.params?.code) {
    throw new Error('Google sign-in was cancelled');
  }

  // Exchange the authorization code for tokens
  const tokenResult = await AuthSession.exchangeCodeAsync(
    {
      clientId: GOOGLE_WEB_CLIENT_ID,
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: request.codeVerifier!,
      },
    },
    GOOGLE_DISCOVERY,
  );

  const credential = GoogleAuthProvider.credential(tokenResult.idToken);
  await signInWithCredential(auth, credential);
};

/* ── Apple Sign-In ─────────────────────────────────────── */

/**
 * Generate a cryptographically-random nonce (hex string).
 */
const generateNonce = async () => {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Try native Apple Sign-In first (works in production builds).
 * Falls back to a web-based OAuth flow that works inside Expo Go
 * (where the native audience doesn't match your Firebase project).
 */
export const signInWithApple = async (): Promise<void> => {
  if (!auth) throw new Error('Firebase not configured');

  const rawNonce = await generateNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  /* ---- Attempt 1: Native flow (works in prod builds) ---- */
  try {
    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!appleCredential.identityToken) {
      throw new Error('No identity token from Apple');
    }

    const oauthCredential = new OAuthProvider('apple.com').credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });
    await signInWithCredential(auth, oauthCredential);
    return; // success — done!
  } catch (nativeErr: any) {
    // If the user cancelled, just re-throw
    if (nativeErr?.code === 'ERR_REQUEST_CANCELED') throw nativeErr;
    // Otherwise (audience mismatch in Expo Go, etc.) fall through to web flow
    console.log('Native Apple sign-in failed, trying web flow…', nativeErr?.message);
  }

  /* ---- Attempt 2: Web-based flow (Expo Go compatible) ---- */
  const redirectUri = FIREBASE_REDIRECT_URI;

  const request = new AuthSession.AuthRequest({
    clientId: 'com.coffeeradar.auth', // Apple Services ID (not the App/Bundle ID!)
    redirectUri,
    scopes: ['name', 'email'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: false,
    extraParams: {
      nonce: hashedNonce,
      response_mode: 'query',
    },
  });

  const result = await request.promptAsync(APPLE_DISCOVERY);

  if (result.type !== 'success') {
    throw new Error('Apple sign-in was cancelled');
  }

  // The id_token comes back from the redirect
  const idToken = result.params?.id_token;
  if (idToken) {
    const oauthCredential = new OAuthProvider('apple.com').credential({
      idToken,
      rawNonce,
    });
    await signInWithCredential(auth, oauthCredential);
  } else {
    throw new Error(
      'Apple web sign-in did not return an identity token. ' +
        'Make sure Apple Sign-In is enabled in the Firebase Console ' +
        'and the Services ID (com.coffeeradar.app) is configured.',
    );
  }
};

export const isAppleSignInAvailable = async (): Promise<boolean> => {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
};
