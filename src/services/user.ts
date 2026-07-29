import Constants from 'expo-constants';
import { httpsCallable } from 'firebase/functions';
import { collection, deleteDoc, doc, getDoc, getDocs, increment, limit, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { Availability, Business, BusinessSubmission, BusinessSubmissionStatus, Habit, LocationProfile, SavedSuggestion, TagAffinities, UserPrefs } from '../types';
import { auth, db, ensureAuth, firebaseEnabled, functions } from './firebase';
import { validateBusinessSubmission } from './businessService';
import { saveOnboardingComplete } from '../utils/storage';

// Removed 'env' as it's no longer used for admin checks

/** Skip Firestore writes for anonymous users — they have no server-side
 *  profile and default security rules reject the request. */
const canSync = (): boolean => {
  if (!firebaseEnabled || !db || !auth) return false;
  const user = auth.currentUser;
  return !!user && !user.isAnonymous;
};

const normalizeAdminEmails = (value?: string | null): string[] =>
  String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};

const getExpoExtraConfig = (): Record<string, unknown> => {
  const extra = (Constants as any)?.expoConfig?.extra
    ?? (Constants as any)?.manifest?.extra
    ?? (Constants as any)?.manifest2?.extra
    ?? {};
  return typeof extra === 'object' && extra !== null ? (extra as Record<string, unknown>) : {};
};

const getConfiguredAdminEmails = (): string[] => {
  const extraConfig = getExpoExtraConfig();
  const candidateValues = [
    env.EXPO_PUBLIC_ADMIN_EMAILS,
    env.EXPO_PUBLIC_BUSINESS_ADMIN_EMAILS,
    env.EXPO_PUBLIC_SUPPORT_EMAILS,
    (globalThis as any).process?.env?.EXPO_PUBLIC_ADMIN_EMAILS,
    (globalThis as any).process?.env?.EXPO_PUBLIC_BUSINESS_ADMIN_EMAILS,
    (globalThis as any).process?.env?.EXPO_PUBLIC_SUPPORT_EMAILS,
    extraConfig.EXPO_PUBLIC_ADMIN_EMAILS as string | undefined,
    extraConfig.EXPO_PUBLIC_BUSINESS_ADMIN_EMAILS as string | undefined,
    extraConfig.EXPO_PUBLIC_SUPPORT_EMAILS as string | undefined,
  ];

  for (const candidate of candidateValues) {
    const emails = normalizeAdminEmails(candidate);
    if (emails.length > 0) return emails;
  }

  return normalizeAdminEmails((globalThis as any).process?.env?.ADMIN_EMAILS);
};

export const isBusinessAdmin = (email?: string | null): boolean => {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const configuredEmails = getConfiguredAdminEmails();
  return configuredEmails.includes(normalizedEmail);
};

const getCurrentUserEmail = (): string | null => {
  const user = auth.currentUser;
  return user?.email
    ?? user?.providerData?.find((profile) => !!profile.email)?.email
    ?? null;
};

export const isAdminUser = async (): Promise<boolean> => {
  try {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      return isBusinessAdmin(getCurrentUserEmail());
    }

    const email = getCurrentUserEmail();
    const callable = httpsCallable(functions, 'isAdmin');
    const result = await callable({ email, uid: auth.currentUser?.uid ?? null });
    const payload = result.data as { isAdmin?: boolean } | undefined;
    if (typeof payload?.isAdmin === 'boolean') {
      return payload.isAdmin;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown');
    if (!/unauthenticated/i.test(message)) {
      console.warn('Cloud admin check failed, falling back to local configuration:', error);
    }
  }

  return isBusinessAdmin(getCurrentUserEmail());
};

export const upsertUserData = async (payload: {
  availability?: Availability | null;
  areaLabel?: string | null;
}): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid || !db) return;
    const firestore = db!;
    await setDoc(
      doc(firestore, 'users', uid),
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

export const persistOnboardingComplete = async (value: boolean): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    const firestore = db!;
    await Promise.all([
      saveOnboardingComplete(value, uid),
      setDoc(
        doc(firestore, 'users', uid),
        {
          onboardingComplete: value,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ]);
  } catch (error) {
    console.warn('Onboarding sync error', error);
  }
};

export const loadFirebaseOnboardingComplete = async (): Promise<boolean | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const firestore = db!;
    const snap = await getDoc(doc(firestore, 'users', uid));
    if (!snap.exists()) return null;
    const value = snap.data()?.onboardingComplete;
    return typeof value === 'boolean' ? value : null;
  } catch (error) {
    console.warn('Onboarding load error', error);
    return null;
  }
};

export const deleteUserData = async (): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid || !db) return;
    const firestore = db!;
    await deleteDoc(doc(firestore, 'users', uid));
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
    const firestore = db!;
    await setDoc(
      doc(firestore, 'users', uid, 'learning', 'affinities'),
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
    const firestore = db!;
    const snap = await getDoc(doc(firestore, 'users', uid, 'learning', 'affinities'));
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
    if (!data?.label || typeof data?.lat !== 'number' || typeof data?.lng !== 'number') return null;
    return {
      label: data.label,
      boosts: data.boosts ?? {},
      lat: data.lat,
      lng: data.lng,
      detectedAt: data.detectedAt ?? new Date().toISOString(),
      homeBase: data.homeBase
        ? {
            lat: data.homeBase.lat,
            lng: data.homeBase.lng,
            establishedAt: data.homeBase.establishedAt ?? new Date().toISOString(),
            updatedAt: data.homeBase.updatedAt ?? new Date().toISOString(),
            sampleCount: Number(data.homeBase.sampleCount ?? 1),
          }
        : undefined,
      travelContext: data.travelContext
        ? {
            active: !!data.travelContext.active,
            inferredPurpose: (data.travelContext.inferredPurpose ?? 'unknown') as 'sightseeing' | 'business' | 'unknown',
            startedAt: data.travelContext.startedAt ?? new Date().toISOString(),
            expiresAt: data.travelContext.expiresAt ?? new Date().toISOString(),
            distanceFromHomeKm: Number(data.travelContext.distanceFromHomeKm ?? 0),
          }
        : undefined,
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

// ── Saved suggestions + profile context (Firestore) ───────────────────

export const syncSavedSuggestions = async (items: SavedSuggestion[]): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db!, 'users', uid, 'learning', 'savedSuggestions'),
      { items, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn('Saved suggestions sync error', error);
  }
};

export const loadFirebaseSavedSuggestions = async (): Promise<SavedSuggestion[] | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const snap = await getDoc(doc(db!, 'users', uid, 'learning', 'savedSuggestions'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return (data?.items as SavedSuggestion[]) ?? null;
  } catch (error) {
    console.warn('Saved suggestions load error', error);
    return null;
  }
};

export const syncUserProfileContext = async (prefs: UserPrefs): Promise<void> => {
  if (!canSync()) return;
  try {
    const uid = await ensureAuth();
    if (!uid) return;
    await setDoc(
      doc(db!, 'users', uid, 'learning', 'profileContext'),
      {
        customInterests: prefs.customInterests ?? [],
        lifestyle: prefs.lifestyle ?? null,
        selfDescription: prefs.selfDescription ?? null,
        wakeStartTime: prefs.wakeStartTime ?? null,
        wakeEndTime: prefs.wakeEndTime ?? null,
        chatDisplayName: prefs.chatDisplayName ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (error) {
    console.warn('Profile context sync error', error);
  }
};

export const loadFirebaseProfileContext = async (): Promise<Pick<UserPrefs, 'customInterests' | 'lifestyle' | 'selfDescription' | 'wakeStartTime' | 'wakeEndTime' | 'chatDisplayName'> | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const snap = await getDoc(doc(db!, 'users', uid, 'learning', 'profileContext'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      customInterests: (data?.customInterests as string[] | undefined) ?? [],
      lifestyle: data?.lifestyle as UserPrefs['lifestyle'] | undefined,
      selfDescription: (data?.selfDescription as string | undefined) ?? '',
      wakeStartTime: (data?.wakeStartTime as string | undefined) ?? '07:00',
      wakeEndTime: (data?.wakeEndTime as string | undefined) ?? '23:00',
      chatDisplayName: (data?.chatDisplayName as string | undefined) ?? '',
    };
  } catch (error) {
    console.warn('Profile context load error', error);
    return null;
  }
};

// ── Business catalog (Firestore) ───────────────────────────────────────

let cachedBusinesses: Business[] | null = null;
let cachedBusinessesAt = 0;
const BUSINESS_CACHE_TTL_MS = 5 * 60 * 1000;

const toBusiness = (id: string, data: any): Business | null => {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const description = typeof data?.description === 'string' ? data.description.trim() : '';
  const placeName = typeof data?.place?.name === 'string' ? data.place.name.trim() : '';
  const address = typeof data?.place?.address === 'string' ? data.place.address.trim() : '';
  const lat = typeof data?.place?.lat === 'number' ? data.place.lat : null;
  const lng = typeof data?.place?.lng === 'number' ? data.place.lng : null;
  const targetTags = Array.isArray(data?.targetTags)
    ? data.targetTags.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!name || !description || !placeName || lat == null || lng == null || targetTags.length === 0) {
    return null;
  }

  const createdAt = typeof data?.createdAt === 'string' && data.createdAt
    ? data.createdAt
    : new Date().toISOString();

  const type = typeof data?.type === 'string' && ['gym', 'cafe', 'restaurant', 'studio', 'venue', 'other'].includes(data.type)
    ? data.type
    : 'other';

  return {
    id,
    type,
    name,
    description,
    place: {
      name: placeName,
      address,
      lat,
      lng,
      costHint: typeof data?.place?.costHint === 'string' ? data.place.costHint : undefined,
    },
    rating: typeof data?.rating === 'number' ? data.rating : undefined,
    ratingCount: typeof data?.ratingCount === 'number' ? data.ratingCount : undefined,
    openingHours: data?.openingHours && typeof data.openingHours === 'object' ? data.openingHours as Record<string, string> : undefined,
    phone: typeof data?.phone === 'string' ? data.phone : undefined,
    website: typeof data?.website === 'string' ? data.website : undefined,
    targetTags,
    promotionTags: Array.isArray(data?.promotionTags)
      ? data.promotionTags.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : undefined,
    createdAt,
    isVerified: data?.isVerified !== false,
    monthlyBudget: typeof data?.monthlyBudget === 'number' ? data.monthlyBudget : undefined,
    conversionGoal: ['visits', 'booking', 'signup', 'awareness'].includes(data?.conversionGoal)
      ? data.conversionGoal
      : undefined,
    metrics: data?.metrics && typeof data.metrics === 'object'
      ? {
          impressions: typeof data.metrics.impressions === 'number' ? data.metrics.impressions : 0,
          clicks: typeof data.metrics.clicks === 'number' ? data.metrics.clicks : 0,
          conversions: typeof data.metrics.conversions === 'number' ? data.metrics.conversions : 0,
        }
      : undefined,
  };
};

export const loadFirebaseBusinesses = async (maxItems = 50): Promise<Business[]> => {
  if (!firebaseEnabled || !db) return [];
  const now = Date.now();
  if (cachedBusinesses && now - cachedBusinessesAt < BUSINESS_CACHE_TTL_MS) {
    return cachedBusinesses;
  }

  try {
    const q = query(
      collection(db, 'businesses'),
      where('isVerified', '==', true),
      limit(Math.max(1, maxItems)),
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => toBusiness(d.id, d.data()))
      .filter((item): item is Business => item != null);

    cachedBusinesses = items;
    cachedBusinessesAt = now;
    return items;
  } catch (error) {
    console.warn('Business catalog load error', error);
    return [];
  }
};

export const syncBusinessMetric = async (
  businessId: string | undefined,
  metric: 'impressions' | 'clicks' | 'conversions',
  amount = 1,
): Promise<void> => {
  if (!businessId || !canSync()) return;
  // Ignore synthetic/local IDs that are not Firestore business documents.
  if (businessId.startsWith('seed_') || businessId.startsWith('campaign_')) return;
  try {
    const businessRef = doc(db!, 'businesses', businessId);
    const snapshot = await getDoc(businessRef);

    if (!snapshot.exists()) {
      console.log('[BusinessMetric] missing business doc; skipping metric sync');
      return;
    }

    await updateDoc(businessRef, {
      [`metrics.${metric}`]: increment(Math.max(1, amount)),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === 'permission-denied') {
      // Expected in some environments where client users may not write business metrics.
      console.log('[BusinessMetric] permission denied; skipping metric sync');
      return;
    }
    console.warn('Business metric sync error', error);
  }
};

const businessSubmissionCollection = 'business_submissions';

const readIsoTimestamp = (value: any): string | null => {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
};


const getPremiumEmails = (): string[] => {
  const raw = String(env.EXPO_PUBLIC_BUSINESS_PREMIUM_EMAILS ?? '');
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
};

export const isBusinessPremium = (email?: string | null): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  // Admins should always inherit premium capabilities.
  return getPremiumEmails().includes(normalized) || isBusinessAdmin(normalized);
};


const toBusinessSubmission = (id: string, data: any): BusinessSubmission | null => {
  const business = data?.business as Business | undefined;
  if (!business?.name || !business?.type || !business?.description) return null;
  return {
    id,
    business,
    submittedBy: typeof data?.submittedBy === 'string' ? data.submittedBy : '',
    submittedByEmail: typeof data?.submittedByEmail === 'string' ? data.submittedByEmail : null,
    status: (data?.status as BusinessSubmissionStatus) ?? 'pending',
    submittedAt: readIsoTimestamp(data?.submittedAt) ?? new Date().toISOString(),
    reviewedAt: readIsoTimestamp(data?.reviewedAt),
    reviewerId: typeof data?.reviewerId === 'string' ? data.reviewerId : null,
    reviewNote: typeof data?.reviewNote === 'string' ? data.reviewNote : null,
  };
};

export const submitBusinessListing = async (
  business: Business,
  note?: string,
): Promise<BusinessSubmission | null> => {
  if (!canSync()) return null;
  try {
    const uid = await ensureAuth();
    if (!uid) return null;
    const current = auth?.currentUser;
    const validation = validateBusinessSubmission(business);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    const id = doc(collection(db!, businessSubmissionCollection)).id;
    const payloadBusiness: Business = {
      ...business,
      id,
      isVerified: false,
      metrics: business.metrics ?? { impressions: 0, clicks: 0, conversions: 0 },
      createdAt: business.createdAt || new Date().toISOString(),
    };

    await setDoc(doc(db!, businessSubmissionCollection, id), {
      business: payloadBusiness,
      submittedBy: uid,
      submittedByEmail: current?.email ?? null,
      status: 'pending',
      submittedAt: serverTimestamp(),
      reviewNote: note ?? null,
    });

    return {
      id,
      business: payloadBusiness,
      submittedBy: uid,
      submittedByEmail: current?.email ?? null,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewNote: note ?? null,
    };
  } catch (error) {
    console.warn('Business submission error', error);
    return null;
  }
};

export const loadPendingBusinessSubmissions = async (): Promise<BusinessSubmission[]> => {
  if (!canSync()) return [];
  try {
    const uid = await ensureAuth();
    if (!uid) return [];
    const snap = await getDocs(query(collection(db!, businessSubmissionCollection), where('status', '==', 'pending')));
    return snap.docs
      .map((item) => toBusinessSubmission(item.id, item.data()))
      .filter((item): item is BusinessSubmission => item != null)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch (error) {
    console.warn('Business submissions load error', error);
    return [];
  }
};

export const reviewBusinessSubmission = async (
  submissionId: string,
  action: 'approve' | 'reject',
  note?: string,
): Promise<boolean> => {
  if (!canSync()) return false;
  try {
    const uid = await ensureAuth();
    if (!uid) return false;
    // Use the server-side isAdminUser check
    if (!await isAdminUser()) return false;
    const submissionRef = doc(db!, businessSubmissionCollection, submissionId);
    const snap = await getDoc(submissionRef);
    if (!snap.exists()) return false;
    const submission = toBusinessSubmission(snap.id, snap.data());
    if (!submission) return false;

    const reviewedAt = new Date().toISOString();
    if (action === 'approve') {
      await setDoc(doc(db!, 'businesses', submission.business.id), {
        ...submission.business,
        isVerified: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    await setDoc(submissionRef, {
      ...snap.data(),
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt,
      reviewerId: uid,
      reviewNote: note ?? null,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return true;
  } catch (error) {
    console.warn('Business review error', error);
    return false;
  }
};
