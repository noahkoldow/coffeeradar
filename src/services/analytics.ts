import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, ensureAuth, firebaseEnabled } from './firebase';

export type AnalyticsParams = Record<string, string | number | boolean | null>;

export const logEvent = async (name: string, params: AnalyticsParams = {}): Promise<void> => {
  try {
    if (!firebaseEnabled || !db) {
      return;
    }
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
