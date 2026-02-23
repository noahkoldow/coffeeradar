import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Availability, Habit, LocationProfile, TagAffinities } from '../types';
import { auth, db, ensureAuth, firebaseEnabled } from './firebase';

/** Skip Firestore writes for anonymous users — they have no server-side
 *  profile and default security rules reject the request. */
const canSync = (): boolean => {
  if (!firebaseEnabled || !db || !auth) return false;
  const user = auth.currentUser;
  return !!user && !user.isAnonymous;
};

export const upsertUserData = async (payload: {
  availability?: Availability | null;
  areaLabel?: string | null;
}): Promise<void> => {
  if (!canSync()) return;
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
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    console.warn('User delete error', error);
  }
};

// ── Tag affinities (Firestore) ──────────────────────────────────────────

/** Save tag affinities to Firestore under users/{uid}/learning/affinities */
export const syncTagAffinities = async (affinities: TagAffinities): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db!, 'users', uid, 'learning', 'affinities'),
      { tags: affinities, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn('Tag affinities sync error', error);
  }
};

/** Load tag affinities from Firestore */
export const loadFirebaseAffinities = async (): Promise<TagAffinities | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const snap = await getDoc(doc(db!, 'users', uid, 'learning', 'affinities'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return (data?.tags as TagAffinities) ?? null;
  } catch (error) {
    console.warn('Tag affinities load error', error);
    return null;
  }
};

// ── Location profile (Firestore) ────────────────────────────────────────

/** Save location profile to Firestore under users/{uid}/learning/locationProfile */
export const syncLocationProfile = async (profile: LocationProfile): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db!, 'users', uid, 'learning', 'locationProfile'),
      { ...profile, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn('Location profile sync error', error);
  }
};

/** Load location profile from Firestore */
export const loadFirebaseLocationProfile = async (): Promise<LocationProfile | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const snap = await getDoc(doc(db!, 'users', uid, 'learning', 'locationProfile'));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data?.label || !data?.lat || !data?.lng) return null;
    return {
      label: data.label,
      boosts: data.boosts ?? {},
      lat: data.lat,
      lng: data.lng,
      detectedAt: data.detectedAt ?? new Date().toISOString(),
    };
  } catch (error) {
    console.warn('Location profile load error', error);
    return null;
  }
};

// ── Habits (Firestore) ──────────────────────────────────────────────────

/** Save habits to Firestore under users/{uid}/learning/habits */
export const syncHabits = async (habits: Habit[]): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db!, 'users', uid, 'learning', 'habits'),
      { items: habits, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn('Habits sync error', error);
  }
};

/** Load habits from Firestore */
export const loadFirebaseHabits = async (): Promise<Habit[] | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const snap = await getDoc(doc(db!, 'users', uid, 'learning', 'habits'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return (data?.items as Habit[]) ?? null;
  } catch (error) {
    console.warn('Habits load error', error);
    return null;
  }
};
