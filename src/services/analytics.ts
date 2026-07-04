import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAuth, firebaseEnabled } from './firebase';

export type AnalyticsParams = Record<string, string | number | boolean | null>;

let analyticsDisabledForSession = false;

export const logEvent = async (name: string, params: AnalyticsParams = {}): Promise<void> => {
  try {
    if (analyticsDisabledForSession || !firebaseEnabled || !db || !auth) return;
    // Skip Firestore analytics for anonymous users (no permissions)
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    const uid = await ensureAuth();
    if (!uid) return;
    const cleanParams = Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined),
    ) as AnalyticsParams;
    await addDoc(collection(db, 'analytics_events'), {
      name,
      params: cleanParams,
      uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    if ((error as any)?.code === 'permission-denied') {
      analyticsDisabledForSession = true;
      return;
    }
    console.warn('Analytics error', error);
  }
};
