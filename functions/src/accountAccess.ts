import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Only the server maps verified identity to authority. Never trust a client email.
const ADMIN_EMAILS = new Set(['bitsapp.admin@gmail.com']);
export const isTestingProject = () => process.env.FUNCTIONS_EMULATOR === 'true' || process.env.GCLOUD_PROJECT === 'bits-staging-6801029604';
export const qualifiesForEmailAdmin = (user: { email?: string; emailVerified: boolean; disabled?: boolean }) =>
  !user.disabled && user.emailVerified && ADMIN_EMAILS.has((user.email || '').trim().toLowerCase());

async function policy() {
  const testing = isTestingProject();
  if (!testing) return { testing, requireEmailVerification: true };
  const snap = await admin.firestore().doc('app_config/onboarding').get();
  return { testing, requireEmailVerification: snap.data()?.requireEmailVerification !== false };
}

export const getAccountAccess = onCall({ timeoutSeconds: 30 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = await admin.auth().getUser(request.auth.uid);
  const claims = { ...user.customClaims };
  const managedAdmin = qualifiesForEmailAdmin(user);
  let claimsChanged = false;
  if (managedAdmin && (claims.admin !== true || claims.bitsEmailAdmin !== true)) {
    claims.admin = true; claims.bitsEmailAdmin = true; claimsChanged = true;
  } else if (!managedAdmin && claims.bitsEmailAdmin === true) {
    delete claims.admin; delete claims.bitsEmailAdmin; claimsChanged = true;
  }
  if (claimsChanged) await admin.auth().setCustomUserClaims(user.uid, claims);
  const consent = await admin.firestore().doc(`users/${user.uid}/consents/coreAI`).get();
  const receipt = consent.data();
  return { ...await policy(), emailVerified: user.emailVerified, admin: claims.admin === true, claimsChanged, consent: receipt ? { allowed: receipt.allowed === true, termsVersion: receipt.termsVersion ?? null, aiNoticeVersion: receipt.aiNoticeVersion ?? null, acceptedAt: receipt.acceptedAt?.toDate?.().toISOString() ?? null } : null };
});

export const setEmailVerificationPolicy = onCall({ timeoutSeconds: 30 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = await admin.auth().getUser(request.auth.uid);
  if (!user.emailVerified || user.disabled || user.customClaims?.admin !== true) throw new HttpsError('permission-denied', 'A verified administrator is required.');
  if (!isTestingProject()) throw new HttpsError('failed-precondition', 'This switch is only available in staging.');
  if (typeof request.data?.requireEmailVerification !== 'boolean') throw new HttpsError('invalid-argument', 'Choose whether verification is required.');
  await admin.firestore().doc('app_config/onboarding').set({ requireEmailVerification: request.data.requireEmailVerification, updatedBy: user.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return policy();
});
