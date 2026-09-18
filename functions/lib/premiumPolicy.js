"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountTokenForUid = void 0;
exports.evaluateVerifiedSubscription = evaluateVerifiedSubscription;
exports.lookupAppleEnvironment = lookupAppleEnvironment;
const crypto_1 = require("crypto");
const accountTokenForUid = (uid) => {
    const hash = (0, crypto_1.createHash)('sha256').update(`bits-store-account:${uid}`).digest('hex');
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
exports.accountTokenForUid = accountTokenForUid;
/** Evaluate only Apple-verified payloads; never call this with client-supplied transaction fields. */
function evaluateVerifiedSubscription(transaction, status, uid, productId, now, graceExpiresAt) {
    if (transaction.productId !== productId)
        throw new Error('wrong-product');
    if (transaction.appAccountToken?.toLowerCase() !== (0, exports.accountTokenForUid)(uid))
        throw new Error('wrong-account');
    if (!transaction.originalTransactionId || !/^\d{1,40}$/.test(transaction.originalTransactionId))
        throw new Error('missing-transaction');
    const expiresAtMs = status === 4 ? (graceExpiresAt || transaction.expiresDate || 0) : (transaction.expiresDate || 0);
    return { active: transaction.revocationDate == null && Number.isFinite(expiresAtMs) && expiresAtMs > now && (status === 1 || status === 4),
        expiresAtMs, originalTransactionId: transaction.originalTransactionId };
}
async function lookupAppleEnvironment(hint, lookup) {
    // StoreKit may omit environmentIOS. Only a store transaction-not-found response permits fallback.
    const first = hint === 'Sandbox' ? 'Sandbox' : 'Production';
    try {
        return { environment: first, response: await lookup(first) };
    }
    catch (error) {
        const code = error.apiError;
        if (code !== 4040005 && code !== 4040010)
            throw error;
        const second = first === 'Production' ? 'Sandbox' : 'Production';
        return { environment: second, response: await lookup(second) };
    }
}
