import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db, ensureAuth, firebaseEnabled } from './firebase';

export type AnalyticsParams = Record<string, string | number | boolean | null>;

export const logEvent = async (name: string, params: AnalyticsParams = {}): Promise<void> => {
  try {
    if (!firebaseEnabled || !db || !auth) return;
    // Skip Firestore analytics for anonymous users (no permissions)
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    const uid = await ensureAuth();
    if (!uid) return;
    await addDoc(collection(db, 'analytics_events'), {
      name,
      params,
      uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.warn('Analytics error', error);
  }
};
