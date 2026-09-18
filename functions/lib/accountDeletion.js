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
exports.requestAccountDeletion = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
/** A durable request, not a claim that every account-linked record was erased. */
exports.requestAccountDeletion = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to request deletion of your own account.');
    }
    if (request.data?.confirmation !== 'DELETE')
        throw new https_1.HttpsError('invalid-argument', 'Explicit confirmation is required.');
    const uid = request.auth.uid;
    if (request.data?.expectedUserId !== uid)
        throw new https_1.HttpsError('permission-denied', 'The signed-in account changed. Review the request again.');
    const db = admin.firestore();
    return db.runTransaction(async (transaction) => {
        const ref = db.collection('account_deletion_requests').doc(uid);
        const existing = await transaction.get(ref);
        if (existing.exists)
            return { status: existing.get('status'), alreadyRequested: true };
        transaction.create(ref, { userId: uid, status: 'requested', requestedAt: firestore_1.FieldValue.serverTimestamp() });
        return { status: 'requested', alreadyRequested: false };
    });
});
