import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseEnabled } from './firebase';

export type ActivityChatThread = {
  id: string;
  suggestionId: string;
  title: string;
  expiresAt: Timestamp;
  regionLabel?: string | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type ActivityChatMessage = {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt?: Timestamp;
};

const THREADS = 'activity_chats';

export const makeActivityChatThreadId = (suggestionId: string, regionLabel?: string | null): string => {
  const region = String(regionLabel || 'global').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `${suggestionId}_${region || 'global'}`;
};

export const ensureActivityChatThread = async (thread: { threadId: string; suggestionId: string; title: string; expiresAt: string; regionLabel?: string | null }) => {
  if (!firebaseEnabled || !db) return;
  const threadRef = doc(db, THREADS, thread.threadId);
  const snap = await getDoc(threadRef);
  if (snap.exists()) {
    await updateDoc(threadRef, {
      title: thread.title,
      regionLabel: thread.regionLabel ?? null,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
    return;
  }
  await setDoc(threadRef, {
    id: thread.threadId,
    suggestionId: thread.suggestionId,
    title: thread.title,
    regionLabel: thread.regionLabel ?? null,
    expiresAt: Timestamp.fromDate(new Date(thread.expiresAt)),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } satisfies Omit<ActivityChatThread, 'id'> & { id: string });
};

export const loadActivityChatThread = async (threadId: string): Promise<ActivityChatThread | null> => {
  if (!firebaseEnabled || !db) return null;
  const snap = await getDoc(doc(db, THREADS, threadId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<ActivityChatThread, 'id'>) };
};

export const subscribeActivityChatMessages = (
  threadId: string,
  onChange: (messages: ActivityChatMessage[]) => void,
) => {
  if (!firebaseEnabled || !db) {
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

export const sendActivityChatMessage = async (threadId: string, body: string) => {
  if (!firebaseEnabled || !db) return;
  const user = auth?.currentUser;
  const message = body.trim();
  if (!message) return;
  await addDoc(collection(db, THREADS, threadId, 'messages'), {
    authorId: user?.uid ?? null,
    authorName: user?.displayName || user?.email || 'You',
    body: message,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, THREADS, threadId), {
    updatedAt: serverTimestamp(),
  }).catch(() => undefined);
};
