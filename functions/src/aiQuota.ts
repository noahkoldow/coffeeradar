import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { randomUUID } from 'crypto';
import { hasPremiumAiBudget, reserveAiQuota, type AiQuotaState } from './aiQuotaPolicy';

/** Atomic per-identity budget; both records are server-authoritative top-level collections. */
export async function acquireAiBudget(db: Firestore, uid: string): Promise<() => Promise<void>> {
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication required.');
  const id = randomUUID();
  const quotaRef = db.collection('ai_quotas').doc(uid);
  const environment = process.env.APPLE_IAP_ENVIRONMENT === 'Sandbox' ? 'Sandbox' : 'Production';
  const entitlementCollection = environment === 'Sandbox' ? 'sandbox_entitlements' : 'entitlements';
  await db.runTransaction(async (transaction) => {
    const [quota, entitlement] = await Promise.all([
      transaction.get(quotaRef), transaction.get(db.collection(entitlementCollection).doc(uid)),
    ]);
    const now = Date.now();
    const decision = reserveAiQuota((quota.data() || {}) as AiQuotaState, now, hasPremiumAiBudget(entitlement.data(), now, environment), id);
    if (!decision.allowed) throw new HttpsError('resource-exhausted', 'Generation budget unavailable.', { reason: decision.reason, retryAfterMs: decision.retryAfterMs });
    transaction.set(quotaRef, decision.state);
  });
  return async () => {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(quotaRef);
      const state = (snapshot.data() || {}) as AiQuotaState;
      const active = { ...(state.active || {}) };
      delete active[id];
      transaction.set(quotaRef, { ...state, active });
    }).catch(() => undefined); // A crashed/released request's lease expires even if cleanup fails.
  };
}
