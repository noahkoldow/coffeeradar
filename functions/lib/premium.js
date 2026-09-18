"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.appStoreNotifications = exports.refreshPremiumEntitlement = exports.verifyPremiumPurchase = exports.getPremiumBillingConfiguration = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const app_store_server_library_1 = require("@apple/app-store-server-library");
const premiumPolicy_1 = require("./premiumPolicy");
const fs_1 = require("fs");
const path_1 = require("path");
const privateKey = (0, params_1.defineSecret)('APP_STORE_PRIVATE_KEY');
const PRODUCT_ID = process.env.PREMIUM_MONTHLY_PRODUCT_ID || 'bits_premium_monthly';
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.bitsapp.404';
const STORE_ENVIRONMENT = process.env.APPLE_IAP_ENVIRONMENT === 'Sandbox' ? app_store_server_library_1.Environment.SANDBOX : app_store_server_library_1.Environment.PRODUCTION;
const ENTITLEMENTS = STORE_ENVIRONMENT === app_store_server_library_1.Environment.SANDBOX ? 'sandbox_entitlements' : 'entitlements';
const TRANSACTIONS = STORE_ENVIRONMENT === app_store_server_library_1.Environment.SANDBOX ? 'sandbox_store_transactions' : 'store_transactions';
const options = { secrets: [privateKey], timeoutSeconds: 45, maxInstances: 10 };
const roots = ['AppleRootCA-G2.cer', 'AppleRootCA-G3.cer'].map((name) => (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '..', 'certs', name)));
function environmentFor(value) {
    if (value === 'Sandbox')
        return app_store_server_library_1.Environment.SANDBOX;
    if (value === 'Production')
        return app_store_server_library_1.Environment.PRODUCTION;
    throw new https_1.HttpsError('invalid-argument', 'Unsupported store environment.');
}
function configured() {
    return !!(privateKey.value() && process.env.APPLE_KEY_ID && process.env.APPLE_ISSUER_ID && process.env.APPLE_APP_ID);
}
function verifier(environment) {
    return new app_store_server_library_1.SignedDataVerifier(roots, true, environment, BUNDLE_ID, Number(process.env.APPLE_APP_ID));
}
async function bounded(operation) {
    let timer;
    try {
        return await Promise.race([operation, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new https_1.HttpsError('deadline-exceeded', 'Store verification timed out. Restore purchases to retry.')), 25_000);
            })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
exports.getPremiumBillingConfiguration = (0, https_1.onCall)(options, (request) => {
    if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') {
        throw new https_1.HttpsError('unauthenticated', 'Sign in before purchasing so your purchase belongs to your account.');
    }
    return { available: configured(), platform: 'ios', productId: PRODUCT_ID, environment: STORE_ENVIRONMENT,
        appAccountToken: (0, premiumPolicy_1.accountTokenForUid)(request.auth.uid) };
});
async function reconcileApple(uid, transactionId, environmentHint) {
    if (!configured())
        throw new https_1.HttpsError('failed-precondition', 'Store verification is not configured yet.');
    const checkedAtMs = Date.now();
    const client = (environment) => new app_store_server_library_1.AppStoreServerAPIClient(privateKey.value(), process.env.APPLE_KEY_ID, process.env.APPLE_ISSUER_ID, BUNDLE_ID, environment);
    const lookup = await (0, premiumPolicy_1.lookupAppleEnvironment)(environmentHint, value => bounded(client(environmentFor(value)).getTransactionInfo(transactionId)));
    const environment = environmentFor(lookup.environment);
    if (environment !== STORE_ENVIRONMENT)
        throw new https_1.HttpsError('failed-precondition', 'This store environment is not enabled on this server. Use the matching TestFlight staging build or production app.');
    const verify = verifier(environment);
    if (!lookup.response.signedTransactionInfo)
        throw new https_1.HttpsError('failed-precondition', 'Store transaction is missing.');
    const anchor = await bounded(verify.verifyAndDecodeTransaction(lookup.response.signedTransactionInfo));
    if (!anchor.originalTransactionId)
        throw new https_1.HttpsError('failed-precondition', 'Store transaction has no subscription chain.');
    if (anchor.transactionId !== transactionId && anchor.originalTransactionId !== transactionId)
        throw new https_1.HttpsError('permission-denied', 'Store transaction does not match the request.');
    if (anchor.productId !== PRODUCT_ID || anchor.appAccountToken?.toLowerCase() !== (0, premiumPolicy_1.accountTokenForUid)(uid)) {
        throw new https_1.HttpsError('permission-denied', 'This purchase belongs to another account or product.');
    }
    const response = await bounded(client(environment).getAllSubscriptionStatuses(anchor.originalTransactionId));
    const items = response.data?.flatMap(group => group.lastTransactions || []) || [];
    const candidates = [];
    let foundAnchor = false;
    for (const item of items) {
        if (!item.signedTransactionInfo)
            continue;
        const transaction = await bounded(verify.verifyAndDecodeTransaction(item.signedTransactionInfo));
        if (transaction.productId !== PRODUCT_ID || transaction.appAccountToken?.toLowerCase() !== (0, premiumPolicy_1.accountTokenForUid)(uid))
            continue;
        if (transaction.originalTransactionId === anchor.originalTransactionId)
            foundAnchor = true;
        let graceExpiresAt;
        if (item.status === app_store_server_library_1.Status.BILLING_GRACE_PERIOD && item.signedRenewalInfo) {
            const renewal = await bounded(verify.verifyAndDecodeRenewalInfo(item.signedRenewalInfo));
            if (renewal.originalTransactionId !== transaction.originalTransactionId)
                throw new https_1.HttpsError('failed-precondition', 'Store renewal does not match this subscription.');
            graceExpiresAt = renewal.gracePeriodExpiresDate;
        }
        candidates.push((0, premiumPolicy_1.evaluateVerifiedSubscription)(transaction, item.status, uid, PRODUCT_ID, checkedAtMs, graceExpiresAt));
    }
    if (!foundAnchor || !candidates.length)
        throw new https_1.HttpsError('not-found', 'The submitted subscription chain is not present in store status.');
    // An unrelated expired/refunded chain cannot shadow a current purchase.
    candidates.sort((a, b) => Number(b.active) - Number(a.active) || b.expiresAtMs - a.expiresAtMs || a.originalTransactionId.localeCompare(b.originalTransactionId));
    const selected = candidates[0];
    const db = admin.firestore();
    const entitlementRef = db.collection(ENTITLEMENTS).doc(uid);
    const refs = candidates.map(candidate => db.collection(TRANSACTIONS).doc(`apple_${candidate.originalTransactionId}`));
    const entitlement = { ...selected, productId: PRODUCT_ID, platform: 'ios', environment, checkedAtMs };
    return db.runTransaction(async (tx) => {
        const [current, ...owners] = await Promise.all([tx.get(entitlementRef), ...refs.map(ref => tx.get(ref))]);
        if (owners.some(owner => owner.exists && owner.data()?.uid !== uid))
            throw new https_1.HttpsError('permission-denied', 'Purchase already belongs to another account.');
        if ((current.data()?.checkedAtMs || 0) > checkedAtMs && current.data()?.environment === STORE_ENVIRONMENT)
            return current.data();
        candidates.forEach((candidate, index) => tx.set(refs[index], { uid, environment, originalTransactionId: candidate.originalTransactionId }));
        tx.set(entitlementRef, entitlement);
        return entitlement;
    });
}
exports.verifyPremiumPurchase = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous')
        throw new https_1.HttpsError('unauthenticated', 'Sign in to verify your purchase.');
    const { transactionId, environment } = request.data || {};
    if (typeof transactionId !== 'string' || !/^\d{1,40}$/.test(transactionId))
        throw new https_1.HttpsError('invalid-argument', 'A store transaction is required.');
    if (environment != null && !['Production', 'Sandbox'].includes(environment))
        throw new https_1.HttpsError('invalid-argument', 'Unsupported store environment.');
    return reconcileApple(request.auth.uid, transactionId, environment);
});
exports.refreshPremiumEntitlement = (0, https_1.onCall)(options, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in required.');
    const entitlement = (await admin.firestore().collection(ENTITLEMENTS).doc(request.auth.uid).get()).data();
    if (!entitlement?.originalTransactionId || entitlement.environment !== STORE_ENVIRONMENT)
        return { active: false };
    return reconcileApple(request.auth.uid, entitlement.originalTransactionId, environmentFor(entitlement.environment));
});
// Configure each environment notification URL on its matching server deployment.
exports.appStoreNotifications = (0, https_1.onRequest)(options, async (request, response) => {
    if (request.method !== 'POST') {
        response.status(405).send('POST required');
        return;
    }
    const signed = request.body?.signedPayload;
    if (typeof signed !== 'string' || signed.length > 100_000) {
        response.status(400).send('Invalid payload');
        return;
    }
    try {
        // A claimed environment is never trusted: each verifier authenticates it.
        let notification;
        try {
            notification = await bounded(verifier(STORE_ENVIRONMENT).verifyAndDecodeNotification(signed));
        }
        catch {
            response.status(401).send('Invalid signature or store environment');
            return;
        }
        if (!notification.data?.signedTransactionInfo) {
            response.status(200).send('No transaction');
            return;
        }
        const environment = environmentFor(notification.data.environment);
        const transaction = await bounded(verifier(environment).verifyAndDecodeTransaction(notification.data.signedTransactionInfo));
        const owner = (await admin.firestore().collection(TRANSACTIONS).doc(`apple_${transaction.originalTransactionId}`).get()).data();
        if (owner?.uid)
            await reconcileApple(owner.uid, transaction.originalTransactionId, environment);
        response.status(200).send('OK');
    }
    catch {
        // Ask Apple to retry; never log transaction payloads, account tokens, or keys.
        console.warn('[billing] Notification reconciliation unavailable');
        response.status(503).send('Retry later');
    }
});
