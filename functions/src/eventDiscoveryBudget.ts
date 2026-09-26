import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

/** Each cache miss reserves at most two searches, shared globally across function instances. */
export async function reserveEventDiscovery(db: Firestore, uid: string): Promise<boolean> {
  if (!uid) return false;
  const globalRef = db.doc('web_discovery_quotas/global');
  const userRef = db.doc(`web_discovery_quotas/user_${createHash('sha256').update(uid).digest('hex')}`);
  return db.runTransaction(async transaction => {
    const [globalSnapshot, userSnapshot] = await Promise.all([transaction.get(globalRef), transaction.get(userRef)]);
    const global = globalSnapshot.data() || {};
    const user = userSnapshot.data() || {};
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const globalCount = global.day === day ? Number(global.searches) || 0 : 0;
    const userCount = user.day === day ? Number(user.searches) || 0 : 0;
    // Conservative defaults cap paid discovery independently of AI-generation quotas.
    if (globalCount + 2 > 1000 || userCount + 2 > 40 || now - (Number(user.lastAt) || 0) < 10000) return false;
    transaction.set(globalRef, { day, searches: globalCount + 2 });
    transaction.set(userRef, { day, searches: userCount + 2, lastAt: now });
    return true;
  });
}
