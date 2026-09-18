"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireAiBudget = acquireAiBudget;
const https_1 = require("firebase-functions/v2/https");
const crypto_1 = require("crypto");
const aiQuotaPolicy_1 = require("./aiQuotaPolicy");
/** Atomic per-identity budget; both records are server-authoritative top-level collections. */
async function acquireAiBudget(db, uid) {
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Authentication required.');
    const id = (0, crypto_1.randomUUID)();
    const quotaRef = db.collection('ai_quotas').doc(uid);
    const environment = process.env.APPLE_IAP_ENVIRONMENT === 'Sandbox' ? 'Sandbox' : 'Production';
    const entitlementCollection = environment === 'Sandbox' ? 'sandbox_entitlements' : 'entitlements';
    await db.runTransaction(async (transaction) => {
        const [quota, entitlement] = await Promise.all([
            transaction.get(quotaRef), transaction.get(db.collection(entitlementCollection).doc(uid)),
        ]);
        const now = Date.now();
        const decision = (0, aiQuotaPolicy_1.reserveAiQuota)((quota.data() || {}), now, (0, aiQuotaPolicy_1.hasPremiumAiBudget)(entitlement.data(), now, environment), id);
        if (!decision.allowed)
            throw new https_1.HttpsError('resource-exhausted', 'Generation budget unavailable.', { reason: decision.reason, retryAfterMs: decision.retryAfterMs });
        transaction.set(quotaRef, decision.state);
    });
    return async () => {
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(quotaRef);
            const state = (snapshot.data() || {});
            const active = { ...(state.active || {}) };
            delete active[id];
            transaction.set(quotaRef, { ...state, active });
        }).catch(() => undefined); // A crashed/released request's lease expires even if cleanup fails.
    };
}
