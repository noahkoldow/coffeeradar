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
exports.setCoreAiConsent = exports.getCoreAiConsent = exports.CORE_AI_CONSENT_PROVIDERS = exports.CORE_AI_CONSENT_VERSION = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
exports.CORE_AI_CONSENT_VERSION = 'multi-provider-v1';
exports.CORE_AI_CONSENT_PROVIDERS = ['gemini', 'groq'];
function requireConsentUser(request) {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    // Bind a displayed notice to the account that opened it, even if authentication
    // changes while the user is reading the notice.
    if (request.data?.userId !== request.auth.uid) {
        throw new https_1.HttpsError('permission-denied', 'The account changed. Please try again.');
    }
    return request.auth.uid;
}
exports.getCoreAiConsent = (0, https_1.onCall)({ timeoutSeconds: 15 }, async (request) => {
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
exports.setCoreAiConsent = (0, https_1.onCall)({ timeoutSeconds: 15 }, async (request) => {
    const userId = requireConsentUser(request);
    const { allowed, version } = request.data ?? {};
    if (typeof allowed !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'Choose whether to allow AI processing.');
    }
    // Revocation must remain available to older app versions.
    if (allowed && version !== exports.CORE_AI_CONSENT_VERSION) {
        throw new https_1.HttpsError('failed-precondition', 'Please read the current AI notice before enabling AI.');
    }
    const providers = allowed ? exports.CORE_AI_CONSENT_PROVIDERS : [];
    await admin.firestore().doc(`users/${userId}/consents/coreAI`).set({
        allowed,
        version: exports.CORE_AI_CONSENT_VERSION,
        aiNoticeVersion: exports.CORE_AI_CONSENT_VERSION,
        providers,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(allowed
            ? { acceptedAt: admin.firestore.FieldValue.serverTimestamp(), revokedAt: null }
            : { revokedAt: admin.firestore.FieldValue.serverTimestamp() }),
    }, { merge: true });
    return { userId, allowed, version: exports.CORE_AI_CONSENT_VERSION, providers };
});
