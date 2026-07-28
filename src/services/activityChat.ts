import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, FieldValue } from 'firebase/firestore';
import { auth, db, firebaseEnabled } from './firebase';
import { DeckSuggestion } from '../types';

export type ActivityChatThread = {
  id: string;
  suggestionId: string;
  title: string;
  expiresAt: Timestamp;
  regionLabel?: string | null;
  participantCount?: number;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
};

export type ActivityChatMessage = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt?: Timestamp;
};

const THREADS = 'activity_chats';

const canUseActivityChat = (): boolean => {
  if (!firebaseEnabled || !db || !auth) return false;
  const user = auth.currentUser;
  return !!user && !user.isAnonymous;
};

export const makeActivityChatThreadId = (suggestionId: string, regionLabel?: string | null): string => {
  const region = String(regionLabel || 'global').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `${suggestionId}_${region || 'global'}`;
};

export const getActivityChatRegionLabel = (regionLabel?: string | null): string | null => {
  const clean = String(regionLabel ?? '').trim();
  return clean || null;
};

export const ensureActivityChatThread = async (thread: { threadId: string; suggestionId: string; title: string; expiresAt: string; regionLabel?: string | null }) => {
  if (!canUseActivityChat()) return;
  const threadRef = doc(db, THREADS, thread.threadId);
  const snap = await getDoc(threadRef);
  if (snap.exists()) {
    await updateDoc(threadRef, {
      title: thread.title,
      regionLabel: thread.regionLabel ?? null,
      participantCount: snap.data()?.participantCount ?? 0,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
    return;
  }
  await setDoc(threadRef, {
    id: thread.threadId,
    suggestionId: thread.suggestionId,
    title: thread.title,
    regionLabel: thread.regionLabel ?? null,
    participantCount: 0,
    expiresAt: Timestamp.fromDate(new Date(thread.expiresAt)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } satisfies Omit<ActivityChatThread, 'id'> & { id: string });
};

export const markActivityChatParticipant = async (threadId: string, displayName: string) => {
  if (!canUseActivityChat()) return;
  const user = auth?.currentUser;
  if (!user || user.isAnonymous) return;
  const cleanName = displayName.trim();
  if (!cleanName) return;

  const participantRef = doc(db, THREADS, threadId, 'participants', user.uid);
  const participantSnap = await getDoc(participantRef).catch(() => null);
  await setDoc(participantRef, {
    userId: user.uid,
    displayName: cleanName,
    joinedAt: participantSnap?.exists() ? participantSnap.data()?.joinedAt ?? serverTimestamp() : serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const participantsSnap = await getDocs(collection(db, THREADS, threadId, 'participants')).catch(() => null);
  if (participantsSnap) {
    await updateDoc(doc(db, THREADS, threadId), {
      participantCount: participantsSnap.size,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }
};

export const loadActivityChatSocialProofCounts = async (
  suggestions: DeckSuggestion[],
  regionLabel?: string | null,
): Promise<Record<string, number>> => {
  if (!canUseActivityChat() || suggestions.length === 0) return {};
  const region = getActivityChatRegionLabel(regionLabel);
  const entries = await Promise.all(suggestions.map(async (suggestion) => {
    const threadId = makeActivityChatThreadId(suggestion.id, region);
    const snap = await getDoc(doc(db, THREADS, threadId)).catch(() => null);
    if (!snap?.exists()) return [suggestion.id, 0] as const;
    const count = snap.data()?.participantCount;
    return [suggestion.id, Number.isFinite(count) ? Math.max(0, Math.floor(count as number)) : 0] as const;
  }));
  return Object.fromEntries(entries);
};

export const loadActivityChatThread = async (threadId: string): Promise<ActivityChatThread | null> => {
  if (!canUseActivityChat()) return null;
  const snap = await getDoc(doc(db, THREADS, threadId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<ActivityChatThread, 'id'>) };
};

export const subscribeActivityChatMessages = (
  threadId: string,
  onChange: (messages: ActivityChatMessage[]) => void,
) => {
  if (!canUseActivityChat()) {
    onChange([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, THREADS, threadId, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => {
      onChange(snap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<ActivityChatMessage, 'id'>) })));
    },
    () => onChange([]),
  );
};

export const sendActivityChatMessage = async (threadId: string, body: string, authorName: string) => {
  if (!canUseActivityChat()) return;
  const user = auth?.currentUser;
  const message = body.trim();
  const cleanAuthorName = authorName.trim();
  if (!user || user.isAnonymous || !message) return;
  await addDoc(collection(db, THREADS, threadId, 'messages'), {
    authorId: user?.uid ?? null,
    authorName: cleanAuthorName || 'CoffeeRadar user',
    body: message,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, THREADS, threadId), {
    updatedAt: serverTimestamp(),
  }).catch(() => undefined);
};
