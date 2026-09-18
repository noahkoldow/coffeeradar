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
exports.setEmailVerificationPolicy = exports.getAccountAccess = exports.qualifiesForEmailAdmin = exports.isTestingProject = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
// Only the server maps verified identity to authority. Never trust a client email.
const ADMIN_EMAILS = new Set(['bitsapp.admin@gmail.com']);
const isTestingProject = () => process.env.FUNCTIONS_EMULATOR === 'true' || process.env.GCLOUD_PROJECT === 'bits-staging-6801029604';
exports.isTestingProject = isTestingProject;
const qualifiesForEmailAdmin = (user) => !user.disabled && user.emailVerified && ADMIN_EMAILS.has((user.email || '').trim().toLowerCase());
exports.qualifiesForEmailAdmin = qualifiesForEmailAdmin;
async function policy() {
    const testing = (0, exports.isTestingProject)();
    if (!testing)
        return { testing, requireEmailVerification: true };
    const snap = await admin.firestore().doc('app_config/onboarding').get();
    return { testing, requireEmailVerification: snap.data()?.requireEmailVerification !== false };
}
exports.getAccountAccess = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    const user = await admin.auth().getUser(request.auth.uid);
    const claims = { ...user.customClaims };
    const managedAdmin = (0, exports.qualifiesForEmailAdmin)(user);
    let claimsChanged = false;
    if (managedAdmin && (claims.admin !== true || claims.bitsEmailAdmin !== true)) {
        claims.admin = true;
        claims.bitsEmailAdmin = true;
        claimsChanged = true;
    }
    else if (!managedAdmin && claims.bitsEmailAdmin === true) {
        delete claims.admin;
        delete claims.bitsEmailAdmin;
        claimsChanged = true;
    }
    if (claimsChanged)
        await admin.auth().setCustomUserClaims(user.uid, claims);
    const consent = await admin.firestore().doc(`users/${user.uid}/consents/coreAI`).get();
    const receipt = consent.data();
    return { ...await policy(), emailVerified: user.emailVerified, admin: claims.admin === true, claimsChanged, consent: receipt ? { allowed: receipt.allowed === true, termsVersion: receipt.termsVersion ?? null, aiNoticeVersion: receipt.aiNoticeVersion ?? null, acceptedAt: receipt.acceptedAt?.toDate?.().toISOString() ?? null } : null };
});
exports.setEmailVerificationPolicy = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in first.');
    const user = await admin.auth().getUser(request.auth.uid);
    if (!user.emailVerified || user.disabled || user.customClaims?.admin !== true)
        throw new https_1.HttpsError('permission-denied', 'A verified administrator is required.');
    if (!(0, exports.isTestingProject)())
        throw new https_1.HttpsError('failed-precondition', 'This switch is only available in staging.');
    if (typeof request.data?.requireEmailVerification !== 'boolean')
        throw new https_1.HttpsError('invalid-argument', 'Choose whether verification is required.');
    await admin.firestore().doc('app_config/onboarding').set({ requireEmailVerification: request.data.requireEmailVerification, updatedBy: user.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return policy();
});
