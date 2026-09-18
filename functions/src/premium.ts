import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { AppStoreServerAPIClient, Environment, SignedDataVerifier, Status } from '@apple/app-store-server-library';
import { accountTokenForUid, evaluateVerifiedSubscription, lookupAppleEnvironment } from './premiumPolicy';
import { readFileSync } from 'fs';
import { join } from 'path';

const privateKey = defineSecret('APP_STORE_PRIVATE_KEY');
const PRODUCT_ID = process.env.PREMIUM_MONTHLY_PRODUCT_ID || 'bits_premium_monthly';
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.bitsapp.404';
const STORE_ENVIRONMENT = process.env.APPLE_IAP_ENVIRONMENT === 'Sandbox' ? Environment.SANDBOX : Environment.PRODUCTION;
const ENTITLEMENTS = STORE_ENVIRONMENT === Environment.SANDBOX ? 'sandbox_entitlements' : 'entitlements';
const TRANSACTIONS = STORE_ENVIRONMENT === Environment.SANDBOX ? 'sandbox_store_transactions' : 'store_transactions';
const options = { secrets: [privateKey], timeoutSeconds: 45, maxInstances: 10 };
const roots = ['AppleRootCA-G2.cer', 'AppleRootCA-G3.cer'].map((name) =>
  readFileSync(join(__dirname, '..', 'certs', name)));

function environmentFor(value: unknown): Environment {
  if (value === 'Sandbox') return Environment.SANDBOX;
  if (value === 'Production') return Environment.PRODUCTION;
  throw new HttpsError('invalid-argument', 'Unsupported store environment.');
}

function configured(): boolean {
  return !!(privateKey.value() && process.env.APPLE_KEY_ID && process.env.APPLE_ISSUER_ID && process.env.APPLE_APP_ID);
}

function verifier(environment: Environment): SignedDataVerifier {
  return new SignedDataVerifier(roots, true, environment, BUNDLE_ID, Number(process.env.APPLE_APP_ID));
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HttpsError('deadline-exceeded', 'Store verification timed out. Restore purchases to retry.')), 25_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export const getPremiumBillingConfiguration = onCall(options, (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('unauthenticated', 'Sign in before purchasing so your purchase belongs to your account.');
  }
  return { available: configured(), platform: 'ios', productId: PRODUCT_ID, environment: STORE_ENVIRONMENT,
    appAccountToken: accountTokenForUid(request.auth.uid) };
});

async function reconcileApple(uid: string, transactionId: string, environmentHint: unknown) {
  if (!configured()) throw new HttpsError('failed-precondition', 'Store verification is not configured yet.');
  const checkedAtMs = Date.now();
  const client = (environment: Environment) => new AppStoreServerAPIClient(privateKey.value(), process.env.APPLE_KEY_ID!, process.env.APPLE_ISSUER_ID!, BUNDLE_ID, environment);
  const lookup = await lookupAppleEnvironment(environmentHint, value => bounded(client(environmentFor(value)).getTransactionInfo(transactionId)));
  const environment = environmentFor(lookup.environment);
  if (environment !== STORE_ENVIRONMENT) throw new HttpsError('failed-precondition', 'This store environment is not enabled on this server. Use the matching TestFlight staging build or production app.');
  const verify = verifier(environment);
  if (!lookup.response.signedTransactionInfo) throw new HttpsError('failed-precondition', 'Store transaction is missing.');
  const anchor = await bounded(verify.verifyAndDecodeTransaction(lookup.response.signedTransactionInfo));
  if (!anchor.originalTransactionId) throw new HttpsError('failed-precondition', 'Store transaction has no subscription chain.');
  if (anchor.transactionId !== transactionId && anchor.originalTransactionId !== transactionId) throw new HttpsError('permission-denied', 'Store transaction does not match the request.');
  if (anchor.productId !== PRODUCT_ID || anchor.appAccountToken?.toLowerCase() !== accountTokenForUid(uid)) {
    throw new HttpsError('permission-denied', 'This purchase belongs to another account or product.');
  }
  const response = await bounded(client(environment).getAllSubscriptionStatuses(anchor.originalTransactionId!));
  const items = response.data?.flatMap(group => group.lastTransactions || []) || [];
  const candidates: Array<ReturnType<typeof evaluateVerifiedSubscription>> = [];
  let foundAnchor = false;
  for (const item of items) {
    if (!item.signedTransactionInfo) continue;
    const transaction = await bounded(verify.verifyAndDecodeTransaction(item.signedTransactionInfo));
    if (transaction.productId !== PRODUCT_ID || transaction.appAccountToken?.toLowerCase() !== accountTokenForUid(uid)) continue;
    if (transaction.originalTransactionId === anchor.originalTransactionId) foundAnchor = true;
    let graceExpiresAt: number | undefined;
    if (item.status === Status.BILLING_GRACE_PERIOD && item.signedRenewalInfo) {
      const renewal = await bounded(verify.verifyAndDecodeRenewalInfo(item.signedRenewalInfo));
      if (renewal.originalTransactionId !== transaction.originalTransactionId) throw new HttpsError('failed-precondition', 'Store renewal does not match this subscription.');
      graceExpiresAt = renewal.gracePeriodExpiresDate;
    }
    candidates.push(evaluateVerifiedSubscription(transaction, item.status, uid, PRODUCT_ID, checkedAtMs, graceExpiresAt));
  }
  if (!foundAnchor || !candidates.length) throw new HttpsError('not-found', 'The submitted subscription chain is not present in store status.');
  // An unrelated expired/refunded chain cannot shadow a current purchase.
  candidates.sort((a, b) => Number(b.active) - Number(a.active) || b.expiresAtMs - a.expiresAtMs || a.originalTransactionId.localeCompare(b.originalTransactionId));
  const selected = candidates[0];
  const db = admin.firestore();
  const entitlementRef = db.collection(ENTITLEMENTS).doc(uid);
  const refs = candidates.map(candidate => db.collection(TRANSACTIONS).doc(`apple_${candidate.originalTransactionId}`));
  const entitlement = { ...selected, productId: PRODUCT_ID, platform: 'ios', environment, checkedAtMs };
  return db.runTransaction(async tx => {
    const [current, ...owners] = await Promise.all([tx.get(entitlementRef), ...refs.map(ref => tx.get(ref))]);
    if (owners.some(owner => owner.exists && owner.data()?.uid !== uid)) throw new HttpsError('permission-denied', 'Purchase already belongs to another account.');
    if ((current.data()?.checkedAtMs || 0) > checkedAtMs && current.data()?.environment === STORE_ENVIRONMENT) return current.data();
    candidates.forEach((candidate, index) => tx.set(refs[index], { uid, environment, originalTransactionId: candidate.originalTransactionId }));
    tx.set(entitlementRef, entitlement);
    return entitlement;
  });
}

export const verifyPremiumPurchase = onCall(options, async (request) => {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in to verify your purchase.');
  const { transactionId, environment } = request.data || {};
  if (typeof transactionId !== 'string' || !/^\d{1,40}$/.test(transactionId)) throw new HttpsError('invalid-argument', 'A store transaction is required.');
  if (environment != null && !['Production', 'Sandbox'].includes(environment)) throw new HttpsError('invalid-argument', 'Unsupported store environment.');
  return reconcileApple(request.auth.uid, transactionId, environment);
});

export const refreshPremiumEntitlement = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const entitlement = (await admin.firestore().collection(ENTITLEMENTS).doc(request.auth.uid).get()).data();
  if (!entitlement?.originalTransactionId || entitlement.environment !== STORE_ENVIRONMENT) return { active: false };
  return reconcileApple(request.auth.uid, entitlement.originalTransactionId, environmentFor(entitlement.environment));
});

// Configure each environment notification URL on its matching server deployment.
export const appStoreNotifications = onRequest(options, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).send('POST required'); return; }
  const signed = request.body?.signedPayload;
  if (typeof signed !== 'string' || signed.length > 100_000) { response.status(400).send('Invalid payload'); return; }
  try {
    // A claimed environment is never trusted: each verifier authenticates it.
    let notification;
    try { notification = await bounded(verifier(STORE_ENVIRONMENT).verifyAndDecodeNotification(signed)); }
    catch { response.status(401).send('Invalid signature or store environment'); return; }
    if (!notification.data?.signedTransactionInfo) { response.status(200).send('No transaction'); return; }
    const environment = environmentFor(notification.data.environment);
    const transaction = await bounded(verifier(environment).verifyAndDecodeTransaction(notification.data.signedTransactionInfo));
    const owner = (await admin.firestore().collection(TRANSACTIONS).doc(`apple_${transaction.originalTransactionId}`).get()).data();
    if (owner?.uid) await reconcileApple(owner.uid, transaction.originalTransactionId!, environment);
    response.status(200).send('OK');
  } catch {
    // Ask Apple to retry; never log transaction payloads, account tokens, or keys.
    console.warn('[billing] Notification reconciliation unavailable');
    response.status(503).send('Retry later');
  }
});
