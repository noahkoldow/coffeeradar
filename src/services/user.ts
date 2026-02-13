import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Availability } from '../types';
import { db, ensureAuth, firebaseEnabled } from './firebase';

export const upsertUserData = async (payload: {
  availability?: Availability | null;
  areaLabel?: string | null;
}): Promise<void> => {
  if (!firebaseEnabled || !db) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db, 'users', uid),
      {
        availability: payload.availability
          ? {
              start: payload.availability.start,
              end: payload.availability.end,
              durationMin: payload.availability.durationMin,
            }
          : null,
        areaLabel: payload.areaLabel ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('User sync error', error);
  }
};

export const deleteUserData = async (): Promise<void> => {
  if (!firebaseEnabled || !db) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    console.warn('User delete error', error);
  }
};
