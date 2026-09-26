import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

export const CORE_AI_CONSENT_VERSION = 'multi-provider-v1';
export const CORE_AI_CONSENT_PROVIDERS = ['gemini', 'groq'];

function requireConsentUser(request: { auth?: { uid: string }; data?: { userId?: unknown } }): string {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  // Bind a displayed notice to the account that opened it, even if authentication
  // changes while the user is reading the notice.
  if (request.data?.userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'The account changed. Please try again.');
  }
  return request.auth.uid;
}

export const getCoreAiConsent = onCall({ timeoutSeconds: 15 }, async request => {
  const userId = requireConsentUser(request);
  const snapshot = await admin.firestore().doc(`users/${userId}/consents/coreAI`).get();
  const receipt = snapshot.data();
  return {
    userId,
    allowed: receipt ? receipt.allowed === true : null,
    version: typeof receipt?.version === 'string' ? receipt.version : null,
    providers: Array.isArray(receipt?.providers) ? receipt.providers : [],
  };
});

export const setCoreAiConsent = onCall({ timeoutSeconds: 15 }, async request => {
  const userId = requireConsentUser(request);
  const { allowed, version } = request.data ?? {};
  if (typeof allowed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Choose whether to allow AI processing.');
  }
  // Revocation must remain available to older app versions.
  if (allowed && version !== CORE_AI_CONSENT_VERSION) {
    throw new HttpsError('failed-precondition', 'Please read the current AI notice before enabling AI.');
  }
  const providers = allowed ? CORE_AI_CONSENT_PROVIDERS : [];
  await admin.firestore().doc(`users/${userId}/consents/coreAI`).set({
    allowed,
    version: CORE_AI_CONSENT_VERSION,
    aiNoticeVersion: CORE_AI_CONSENT_VERSION,
    providers,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(allowed
      ? { acceptedAt: admin.firestore.FieldValue.serverTimestamp(), revokedAt: null }
      : { revokedAt: admin.firestore.FieldValue.serverTimestamp() }),
  }, { merge: true });
  return { userId, allowed, version: CORE_AI_CONSENT_VERSION, providers };
});
