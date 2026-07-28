import { collection, doc, getDoc, getDocs, increment, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, ensureAuth, firebaseEnabled, storage, functions } from './firebase'; // Added 'functions'
import { CommunityIdeaSubmission, CommunityIdeaSubmissionInput, DeckSuggestion, HabitTimeOfDay, Suggestion } from '../types';
import { httpsCallable } from 'firebase/functions'; // Added httpsCallable

const communityIdeaCollection = 'community_ideas';
const approvalQueueCollection = 'approval_queue';
const COMMUNITY_POLISH_VERSION = 'v1';

const polishCommunityIdeaCallable = functions ? httpsCallable(functions, 'polishCommunityIdea') : null;

const canSync = (): boolean => {
  if (!firebaseEnabled || !db || !auth) return false;
  const user = auth.currentUser;
  return !!user && !user.isAnonymous;
};

const normalizeTags = (tags?: string[]): string[] => (tags ?? [])
  .map((tag) => tag.trim().toLowerCase())
  .filter((tag, index, arr) => tag.length > 0 && arr.indexOf(tag) === index);

const removeUndefinedValues = <T>(value: T): T | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedValues(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Timestamp)) {
    const cleanedEntries = Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
      const cleanedValue = removeUndefinedValues(item);
      if (cleanedValue !== undefined) {
        acc[key] = cleanedValue;
      }
      return acc;
    }, {});

    return cleanedEntries as T;
  }

  return value;
};

const getExtension = (uri?: string | null): string => {
  if (!uri) return 'jpg';
  const clean = uri.split('?')[0].split('#')[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? 'jpg';
};

const uploadCommunityIdeaImage = async (userId: string, ideaId: string, localImageUri?: string | null): Promise<string | null> => {
  if (!localImageUri || !storage) return null;
  const response = await fetch(localImageUri);
  const blob = await response.blob();
  const ext = getExtension(localImageUri);
  const imageRef = ref(storage, `community_ideas/${userId}/${ideaId}/cover.${ext}`);
  await uploadBytes(imageRef, blob, {
    contentType: blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg'),
  });
  return getDownloadURL(imageRef);
};

// Removed isCommunityIdeaPolishEnabled as it's now handled by the cloud function

const normalizeSingleLine = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
};

type CommunityIdeaPolishResult = {
  hook: string;
  description: string;
  cta?: string;
  tags?: string[];
  emojis?: string[];
  timeOfDay?: HabitTimeOfDay;
};

const normalizeEmojiList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 6);
};

const normalizeTimeOfDay = (value: unknown): HabitTimeOfDay | undefined => {
  if (value === 'any' || value === 'morning' || value === 'afternoon' || value === 'evening') {
    return value;
  }
  return undefined;
};

const polishCommunityIdeaCopy = async (idea: CommunityIdeaSubmission): Promise<CommunityIdeaPolishResult | null> => {
  if (!polishCommunityIdeaCallable) {
    console.warn('Firebase functions not available for polishing community idea.');
    return null;
  }

  try {
    const result = await polishCommunityIdeaCallable({ idea });
    const data = result.data as { payload: CommunityIdeaPolishResult };

    if (!data?.payload) {
      console.warn('Cloud function did not return a valid payload for polishing.');
      return null;
    }

    const parsed = data.payload;
    const hook = normalizeSingleLine(parsed.hook) || idea.hook;
    const description = normalizeSingleLine(parsed.description) || idea.description;
    const cta = normalizeSingleLine(parsed.cta);
    const tags = normalizeTags(parsed.tags);
    const emojis = normalizeEmojiList(parsed.emojis);
    const timeOfDay = normalizeTimeOfDay(parsed.timeOfDay);

    return {
      hook,
      description,
      ...(cta ? { cta } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(emojis.length > 0 ? { emojis } : {}),
      ...(timeOfDay ? { timeOfDay } : {}),
    };
  } catch (error) {
    console.error('Error calling polishCommunityIdea cloud function:', error);
    return null;
  }
};

const applyCommunityIdeaPolish = async (ideaId: string): Promise<void> => {
  // Removed isCommunityIdeaPolishEnabled check
  const ideaRef = doc(db!, communityIdeaCollection, ideaId);
  const ideaSnap = await getDoc(ideaRef);
  if (!ideaSnap.exists()) return;

  const current = { id: ideaSnap.id, ...(ideaSnap.data() as Omit<CommunityIdeaSubmission, 'id'>) } as CommunityIdeaSubmission & { aiPolish?: { version?: string } };
  if (current.status !== 'approved') return;
  if (current.aiPolish?.version === COMMUNITY_POLISH_VERSION) return;

  const polished = await polishCommunityIdeaCopy(current);
  if (!polished) return;

  const nextTags = polished.tags && polished.tags.length > 0 ? polished.tags : (current.tags ?? []);
  const nextEmojis = polished.emojis && polished.emojis.length > 0 ? polished.emojis : (current.emojis ?? []);
  const nextTimeOfDay = polished.timeOfDay ?? current.timeOfDay;

  const changed = polished.hook !== current.hook
    || polished.description !== current.description
    || (polished.cta ?? '') !== (current.cta ?? '')
    || JSON.stringify(nextTags) !== JSON.stringify(current.tags ?? [])
    || JSON.stringify(nextEmojis) !== JSON.stringify(current.emojis ?? [])
    || nextTimeOfDay !== current.timeOfDay;

  await updateDoc(ideaRef, {
    ...(changed
      ? {
        hook: polished.hook,
        description: polished.description,
        ...(polished.cta ? { cta: polished.cta } : {}),
        tags: nextTags,
        emojis: nextEmojis,
        ...(nextTimeOfDay ? { timeOfDay: nextTimeOfDay } : {}),
      }
      : {}),
    aiPolish: {
      version: COMMUNITY_POLISH_VERSION,
      model: 'gemini-pro', // Model is now handled on the server
      polishedAt: new Date().toISOString(),
      changed,
      original: {
        hook: current.hook,
        description: current.description,
        cta: current.cta ?? null,
        tags: current.tags ?? [],
        emojis: current.emojis ?? [],
        timeOfDay: current.timeOfDay ?? null,
      },
    },
  });
};

export const communityIdeaToSuggestion = (idea: CommunityIdeaSubmission): DeckSuggestion => {
  const suggestion: Suggestion = {
    id: `community_${idea.id}`,
    type: idea.type,
    source: 'community',
    title: idea.title,
    hook: idea.hook,
    cta: idea.cta ?? 'Try it now',
    description: idea.description,
    durationMin: idea.durationMin,
    tags: idea.tags ?? [],
    emojis: idea.emojis ?? [],
    place: idea.place,
    event: idea.event,
    timeOfDay: idea.timeOfDay,
    confidence: 0.78,
    isRepetitionFriendly: true,
  };

  return {
    ...suggestion,
    meta: {
      socialProofCount: Math.max(0, Math.floor(idea.completionCount ?? 0)),
    },
  };
};

export const submitCommunityIdea = async (
  idea: CommunityIdeaSubmissionInput,
): Promise<CommunityIdeaSubmission | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const current = auth?.currentUser;
    const id = doc(collection(db!, communityIdeaCollection)).id;
    const submittedAt = new Date().toISOString();
    const payload: CommunityIdeaSubmission = {
      id,
      title: idea.title.trim(),
      hook: idea.hook.trim(),
      description: idea.description.trim(),
      type: idea.type,
      durationMin: idea.durationMin,
      tags: normalizeTags(idea.tags),
      emojis: (idea.emojis ?? []).filter((emoji) => emoji.trim().length > 0),
      submittedBy: uid,
      submittedByEmail: current?.email ?? null,
      status: 'pending',
      submittedAt,
      reviewedAt: null,
      reviewerId: null,
      reviewNote: null,
    };

    const cleanCta = idea.cta?.trim();
    if (cleanCta) {
      payload.cta = cleanCta;
    }
    if (idea.timeOfDay) {
      payload.timeOfDay = idea.timeOfDay;
    }
    if (idea.place) {
      payload.place = idea.place;
    }
    if (idea.event) {
      payload.event = idea.event;
    }
    if (idea.imageUrl) {
      payload.imageUrl = idea.imageUrl;
    }

    const uploadedImageUrl = idea.localImageUri ? await uploadCommunityIdeaImage(uid, id, idea.localImageUri) : null;
    const finalImageUrl = uploadedImageUrl ?? payload.imageUrl ?? null;

    const savedPayload: CommunityIdeaSubmission = {
      ...payload,
      ...(finalImageUrl ? { imageUrl: finalImageUrl } : {}),
    };

    const docPayload = removeUndefinedValues({
      ...savedPayload,
      submittedAt: submittedAt,
      submittedAtTs: Timestamp.now(),
      createdAt: Timestamp.now(),
    });

    await setDoc(doc(db!, communityIdeaCollection, id), docPayload);

    await setDoc(doc(db!, approvalQueueCollection, id), {
      kind: 'community_idea',
      ideaId: id,
      status: 'pending',
      submittedAt: Timestamp.now(),
      submittedBy: uid,
      submittedByEmail: current?.email ?? null,
      title: savedPayload.title,
      hook: savedPayload.hook,
      description: savedPayload.description,
      type: savedPayload.type,
      durationMin: savedPayload.durationMin,
      tags: savedPayload.tags ?? [],
      hasLocation: !!savedPayload.place,
      hasImage: !!savedPayload.imageUrl,
    });

    return savedPayload;
  } catch (error) {
    console.error('Error submitting community idea:', error);
    throw error;
  }
};

export const loadApprovedCommunityIdeas = async (): Promise<CommunityIdeaSubmission[]> => {
  if (!canSync()) return [];
  try {
    const uid = await ensureAuth();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db!, communityIdeaCollection), where('status', '==', 'approved')));
    return snap.docs
      .map((item) => ({ id: item.id, ...(item.data() as Omit<CommunityIdeaSubmission, 'id'>) }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch (error) {
    console.warn('Community ideas load error', error);
    return [];
  }
};

/** Load the current user's own submitted community ideas (any status). */
export const loadMyCommunityIdeas = async (): Promise<CommunityIdeaSubmission[]> => {
  if (!canSync()) return [];
  try {
    const uid = await ensureAuth();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db!, communityIdeaCollection), where('submittedBy', '==', uid)));
    return snap.docs
      .map((item) => ({ id: item.id, ...(item.data() as Omit<CommunityIdeaSubmission, 'id'>) }))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch (error) {
    console.warn('My community ideas load error', error);
    return [];
  }
};

/** Prefix used when a community idea is turned into a deck suggestion id. */
const COMMUNITY_SUGGESTION_PREFIX = 'community_';

/** Extract the community idea id from a suggestion id, or null if not a community suggestion. */
export const getCommunityIdeaIdFromSuggestion = (suggestionId?: string | null): string | null => {
  if (!suggestionId || !suggestionId.startsWith(COMMUNITY_SUGGESTION_PREFIX)) return null;
  const ideaId = suggestionId.slice(COMMUNITY_SUGGESTION_PREFIX.length);
  return ideaId.length > 0 ? ideaId : null;
};

/**
 * Increment the completion stats for a community idea when someone does the activity.
 * Tracks how many people did it and the total minutes contributed.
 */
export const recordCommunityIdeaCompletion = async (
  suggestionId: string,
  durationMin: number,
): Promise<void> => {
  if (!canSync()) return;
  const ideaId = getCommunityIdeaIdFromSuggestion(suggestionId);
  if (!ideaId) return;
  const safeMinutes = Number.isFinite(durationMin) && durationMin > 0 ? Math.round(durationMin) : 0;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await updateDoc(doc(db!, communityIdeaCollection, ideaId), {
      completionCount: increment(1),
      helpMinutes: increment(safeMinutes),
    });
  } catch (error) {
    console.warn('Community idea completion tracking skipped', error);
  }
};

export const reviewCommunityIdea = async (
  ideaId: string,
  action: 'approve' | 'reject',
  reviewerId: string,
  note?: string,
): Promise<boolean> => {
  if (!canSync()) return false;
  try {
    const uid = await ensureAuth();
    if (!uid) return false;
    const reviewedAt = new Date().toISOString();
    const ideaRef = doc(db!, communityIdeaCollection, ideaId);
    const queueRef = doc(db!, approvalQueueCollection, ideaId);
    await updateDoc(ideaRef, {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt,
      reviewerId,
      reviewNote: note ?? null,
    });
    await updateDoc(queueRef, {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt: Timestamp.now(),
      reviewerId,
      reviewNote: note ?? null,
    });

    if (action === 'approve') {
      try {
        await applyCommunityIdeaPolish(ideaId);
      } catch (polishError) {
        console.warn('Community idea polish skipped:', polishError);
      }
    }

    return true;
  } catch (error) {
    console.error('Error reviewing community idea:', error);
    return false;
  }
};
