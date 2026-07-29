import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityLog,
  Availability,
  DeckSuggestion,
  Suggestion,
  Habit,
  HistoryState,
  InProgressPlanSession,
  LocationProfile,
  LocationState,
  PermissionsState,
  SavedSuggestion,
  ScheduledActivity,
  SmartTodoItem,
  TagAffinities,
  UserPrefs,
} from '../types';
import { BusinessProfile } from '../types/business';
import {
  clearStorage,
  loadActivityLog,
  loadDisabledCalendars,
  loadHabits,
  loadHistory,
  loadOnboardingComplete,
  loadPrefs,
  loadIgnoredExternalEventKeys,
  loadTagAffinities,
  saveActivityLog,
  saveDisabledCalendars,
  saveHabits,
  saveHistory,
  saveOnboardingComplete,
  savePrefs,
  saveIgnoredExternalEventKeys,
  saveTagAffinities,
  loadInProgressPlanSession,
  loadScheduledActivities,
  loadSavedSuggestions,
  saveInProgressPlanSession,
  saveScheduledActivities,
  saveSavedSuggestions,
  loadIsBusinessOnly,
  loadSmartTodos,
  saveIsBusinessOnly,
  saveSmartTodos,
  loadSwipeBank,
  saveSwipeBank,
  loadPremiumActive,
  savePremiumActive,
  loadPreloadedDeck,
  savePreloadedDeck,
} from '../utils/storage';
import { getCalendarPermissionStatus, getUpcomingEvents } from '../services/calendar';
import { getLocationPermissionStatus } from '../services/location';
import { subscribeAuthState } from '../services/auth';
import { auth, firebaseEnabled } from '../services/firebase';
import { buildDeck } from '../services/suggestions';
import { recordComplete, recordTypeAccept, decayAffinities } from '../services/affinity';
import { completeHabitEntry, uncompleteHabitEntry, migrateHabit } from '../utils/habits';
import { rescheduleHabitReminders } from '../services/notifications';
import { recordCommunityIdeaCompletion } from '../services/communityIdeas';import {
  loadFirebaseAffinities,
  loadFirebaseLocationProfile,
  loadFirebaseOnboardingComplete,
  syncTagAffinities,
  syncLocationProfile,
  syncHabits,
  loadFirebaseHabits,
  loadFirebaseSavedSuggestions,
  loadFirebaseProfileContext,
  syncSavedSuggestions,
  syncUserProfileContext,
  persistOnboardingComplete,
  isBusinessPremium,
} from '../services/user';
import { setPreferredLocale, setPreferredTimeZone, initializeDeviceTimeZone } from '../utils/time';
import { applyIgnoredEventsToAvailability } from '../utils/availabilityIgnore';

// Swipe bank config
const SWIPE_BANK_DEFAULT = 20;
const SWIPE_BANK_PREMIUM_BONUS = 10;
const RECHARGE_INTERVAL_MIN = 10; // minutes per credit
const RECHARGE_PER_INTERVAL = 1; // credits per interval
const OVERFLOW_DECAY_PER_HOUR = 0.5; // unchanged decay behaviour
const BONUS_PER_MIN = 1 / 30; // y swipes per minute of completed task (1 swipe per 30m)
const PRELOADED_DECK_TTL_MS = 60 * 60 * 1000;

const isNewlyCreatedFirebaseAccountSession = (): boolean => {
  const metadata = auth?.currentUser?.metadata;
  if (!metadata?.creationTime || !metadata?.lastSignInTime) return false;
  const createdAt = new Date(metadata.creationTime).getTime();
  const lastSignInAt = new Date(metadata.lastSignInTime).getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) return false;
  // Firebase metadata timestamps may be rounded; keep a small tolerance window.
  return Math.abs(lastSignInAt - createdAt) <= 60_000;
};

const resolveSwipeBankMax = (email: string | null, premiumActive: boolean): number => {
  return SWIPE_BANK_DEFAULT + ((premiumActive || isBusinessPremium(email)) ? SWIPE_BANK_PREMIUM_BONUS : 0);
};

const defaultPrefs: UserPrefs = {
  openToGoingOut: true,
  allowSerendipity: false,
  radiusKm: 5,
  interestTags: [],
  wakeStartTime: '07:00',
  wakeEndTime: '23:00',
  themeMode: 'light',
  language: 'en',
};

const defaultHistory: HistoryState = {
  lastAcceptedIds: [],
  lastRejectedIds: [],
  lastShownIds: [],
};

const defaultPermissions: PermissionsState = {
  calendarGranted: false,
  locationGranted: false,
};

const defaultLocation: LocationState = {
  lat: null,
  lng: null,
  areaLabel: null,
  timeZone: null,
};

type AppState = {
  loading: boolean;
  authChecked: boolean;
  userId: string | null;
  userEmail: string | null;
  onboardingComplete: boolean;
  permissions: PermissionsState;
  prefs: UserPrefs;
  history: HistoryState;
  habits: Habit[];
  activityLog: ActivityLog[];
  location: LocationState;
  availability: Availability | null;
  ignoredExternalEventKeys: string[];
  disabledCalendars: string[];
  preloadedDeck: { deck: DeckSuggestion[]; usedFallback: boolean } | null;
  deckLoading: boolean;
  geminiPool: Suggestion[];
  deckIndex: number;
  tagAffinities: TagAffinities;
  locationProfile: LocationProfile | null;
  sessionActivityIntent: string;
  scheduledActivities: ScheduledActivity[];
  inProgressPlanSession: InProgressPlanSession | null;
  savedSuggestions: SavedSuggestion[];
  smartTodos: SmartTodoItem[];
  swipeBank: { current: number; max: number };
  swipeBankLastUpdated: number;
  bankTimerRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  accountType: 'consumer' | 'business';
  businessProfile: BusinessProfile | null;
  businessMode: boolean;
  isBusinessOnly: boolean;
  isPremium: boolean;
};

type AppActions = {
  setPermissions: (value: PermissionsState) => void;
  setPrefs: (value: UserPrefs) => void;
  setHistory: (value: HistoryState) => void;
  setHabits: (value: Habit[]) => void;
  addHabit: (habit: Habit) => void;
  updateHabit: (habit: Habit) => void;
  removeHabit: (habitId: string) => void;
  completeHabit: (habitId: string, completedAt?: Date | string) => void;
  uncompleteHabit: (habitId: string) => void;
  recordActivity: (entry: ActivityLog) => void;
  removeLatestActivityForHabit: (habitId: string) => void;
  setLocation: (value: LocationState) => void;
  setAvailability: (value: Availability | null) => void;
  setIgnoredExternalEventKeys: (value: string[]) => void;
  addIgnoredExternalEventKey: (value: string) => void;
  removeIgnoredExternalEventKey: (value: string) => void;
  setDisabledCalendars: (value: string[]) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  preloadDeck: (availability: Availability, durationOverride?: number | null) => void;
  consumeDeck: () => { deck: DeckSuggestion[]; usedFallback: boolean } | null;
  consumeGeminiForDeck: () => { suggestions: Suggestion[]; max: number; isFirstDeck: boolean };
  initGeminiPool: (allGemini: Suggestion[], usedIds: Set<string>) => void;
  setTagAffinities: (value: TagAffinities) => void;
  setLocationProfile: (value: LocationProfile | null) => void;
  setSessionActivityIntent: (value: string) => void;
  addScheduledActivity: (item: ScheduledActivity) => void;
  updateScheduledActivity: (id: string, item: ScheduledActivity) => void;
  removeScheduledActivity: (id: string) => void;
  setInProgressPlanSession: (session: InProgressPlanSession | null) => void;
  saveSuggestion: (item: SavedSuggestion) => void;
  removeSavedSuggestion: (id: string) => void;
  addSmartTodo: (item: SmartTodoItem) => void;
  updateSmartTodo: (item: SmartTodoItem) => void;
  removeSmartTodo: (id: string) => void;
  toggleSmartTodoDone: (id: string) => void;
  spendSwipe: () => boolean;
  addSwipes: (n: number) => void;
  resetData: () => Promise<void>;
  switchToBusinessMode: (profile: BusinessProfile) => void;
  switchToConsumerMode: () => void;
  setBusinessProfile: (profile: BusinessProfile | null) => void;
  setIsBusinessOnly: (value: boolean) => void;
  setPremiumActive: (value: boolean) => void;
};

const AppStateContext = createContext<{ state: AppState; actions: AppActions } | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(!firebaseEnabled);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [permissions, setPermissions] = useState<PermissionsState>(defaultPermissions);
  const [prefs, setPrefsState] = useState<UserPrefs>(defaultPrefs);
  const [history, setHistoryState] = useState<HistoryState>(defaultHistory);
  const [habits, setHabitsState] = useState<Habit[]>([]);
  const [activityLog, setActivityLogState] = useState<ActivityLog[]>([]);
  const [location, setLocationState] = useState<LocationState>(defaultLocation);
  const [availability, setAvailabilityState] = useState<Availability | null>(null);
  const [ignoredExternalEventKeys, setIgnoredExternalEventKeysState] = useState<string[]>([]);
  const [disabledCalendars, setDisabledCalendarsState] = useState<string[]>([]);
  const [preloadedDeck, setPreloadedDeck] = useState<{ deck: DeckSuggestion[]; usedFallback: boolean } | null>(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [tagAffinities, setTagAffinitiesState] = useState<TagAffinities>({});
  const [locationProfile, setLocationProfileState] = useState<LocationProfile | null>(null);
  const [sessionActivityIntent, setSessionActivityIntentState] = useState('');
  const [scheduledActivities, setScheduledActivitiesState] = useState<ScheduledActivity[]>([]);
  const [inProgressPlanSession, setInProgressPlanSessionState] = useState<InProgressPlanSession | null>(null);
  const [savedSuggestions, setSavedSuggestionsState] = useState<SavedSuggestion[]>([]);
  const [smartTodos, setSmartTodosState] = useState<SmartTodoItem[]>([]);
  const [swipeBank, setSwipeBank] = useState<{ current: number; max: number }>({ current: 20, max: 20 });
  const [swipeBankLastUpdated, setSwipeBankLastUpdated] = useState<number>(Date.now());
  const [geminiPool, setGeminiPool] = useState<Suggestion[]>([]);
  const [deckIndex, setDeckIndex] = useState(0);
  const [accountType, setAccountType] = useState<'consumer' | 'business'>('consumer');
  const [businessProfile, setBusinessProfileState] = useState<BusinessProfile | null>(null);
  const [businessMode, setBusinessMode] = useState(false);
  const [isBusinessOnly, setIsBusinessOnlyState] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const emailHasPremium = useMemo(() => isBusinessPremium(userEmail), [userEmail]);
  const swipeBankMax = useMemo(() => resolveSwipeBankMax(userEmail, isPremium), [isPremium, userEmail]);

  // Refs for preloadDeck so it always reads the latest values without
  // being a useMemo dependency (which would cause infinite re-renders).
  const preloadRef = useRef({ location, prefs, history, habits, smartTodos, tagAffinities, locationProfile, savedSuggestions, sessionActivityIntent });
  useEffect(() => {
    preloadRef.current = { location, prefs, history, habits, smartTodos, tagAffinities, locationProfile, savedSuggestions, sessionActivityIntent };
  }, [location, prefs, history, habits, smartTodos, tagAffinities, locationProfile, savedSuggestions, sessionActivityIntent]);

  useEffect(() => {
    setPreferredLocale((prefs.language ?? 'en') === 'de' ? 'de-DE' : 'en-US');
  }, [prefs.language]);

  const preloadedDeckRef = useRef(preloadedDeck);
  useEffect(() => { preloadedDeckRef.current = preloadedDeck; }, [preloadedDeck]);
  const geminiPoolRef = useRef<Suggestion[]>([]);
  const deckIndexRef = useRef(0);
  useEffect(() => { geminiPoolRef.current = geminiPool; }, [geminiPool]);
  useEffect(() => { deckIndexRef.current = deckIndex; }, [deckIndex]);
  const deckBuildId = useRef(0);
  const deckBuildKeyRef = useRef<string | null>(null);

  const buildDeckRequestKey = useCallback((avail: Availability) => JSON.stringify({
    start: avail.start,
    end: avail.end,
    durationMin: avail.durationMin,
    nextEventTitle: avail.nextEventTitle ?? null,
    previousEventTitle: avail.previousEventTitle ?? null,
    currentEventId: avail.currentEventId ?? null,
    locationLat: preloadRef.current.location.lat ?? null,
    locationLng: preloadRef.current.location.lng ?? null,
    locationArea: preloadRef.current.location.areaLabel ?? null,
    sessionActivityIntent,
  }), [sessionActivityIntent]);

  const runDeckPreload = useCallback((avail: Availability) => {
    const requestKey = buildDeckRequestKey(avail);
    if (deckLoading && deckBuildKeyRef.current === requestKey) {
      return;
    }
    deckBuildKeyRef.current = requestKey;
    const id = ++deckBuildId.current;
    setDeckLoading(true);
    setPreloadedDeck(null);
    savePreloadedDeck(null, userId).catch(() => undefined);
    const {
      location: loc,
      prefs: p,
      history: h,
      habits: hb,
      smartTodos: todos,
      tagAffinities: ta,
      locationProfile: lp,
      savedSuggestions: ss,
    } = preloadRef.current;
    buildDeck(avail, loc, p, h, hb, todos, 15000, ta, lp, undefined, ss, sessionActivityIntent, userId)
      .then((result) => {
        if (deckBuildId.current === id) {
          setPreloadedDeck(result);
          savePreloadedDeck(result, userId).catch(() => undefined);
        }
      })
      .catch(() => {
        if (deckBuildId.current === id) {
          setPreloadedDeck(null);
          savePreloadedDeck(null, userId).catch(() => undefined);
        }
      })
      .finally(() => {
        if (deckBuildId.current === id) setDeckLoading(false);
        if (deckBuildKeyRef.current === requestKey) deckBuildKeyRef.current = null;
      });
  }, [buildDeckRequestKey, deckLoading, sessionActivityIntent, userId]);

  const invalidatePreloadedDeck = useCallback(() => {
    deckBuildId.current += 1;
    deckBuildKeyRef.current = null;
    setDeckLoading(false);
    setPreloadedDeck(null);
    savePreloadedDeck(null, userId).catch(() => undefined);
  }, [userId]);

  /**
   * Consume Gemini budget for the current deck.
   * Deck 0 (first ever): signal caller to use the API; subsequent decks draw from cached pool.
   * Distribution: deck1 ≈ 2/3 of pool, deck2 = rest, deck3+ = none (e.g. 5 total → 2,2,1,0).
   */
  const computeGeminiForDeck = useCallback((): { suggestions: Suggestion[]; max: number; isFirstDeck: boolean } => {
    const idx = deckIndexRef.current;
    if (idx === 0) {
      deckIndexRef.current = 1;
      setDeckIndex(1);
      return { suggestions: [], max: 2, isFirstDeck: true };
    }
    const pool = geminiPoolRef.current;
    const n = idx === 1
      ? Math.ceil(pool.length * 2 / 3)
      : (idx === 2 ? pool.length : 0);
    const toUse = pool.slice(0, n);
    const remaining = pool.slice(n);
    geminiPoolRef.current = remaining;
    deckIndexRef.current = idx + 1;
    setGeminiPool(remaining);
    setDeckIndex(idx + 1);
    return { suggestions: toUse, max: n, isFirstDeck: false };
  }, []);

  /** Store unused Gemini suggestions after deck 0 for distribution across later decks. */
  const storeGeminiPool = useCallback((allGemini: Suggestion[], usedIds: Set<string>) => {
    const unused = allGemini.filter((g) => !usedIds.has(g.id));
    geminiPoolRef.current = unused;
    setGeminiPool(unused);
  }, []);
  // Swipe bank timing refs
  const lastUpdatedRef = useRef<number>(Date.now());
  const bankTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize device timezone on app startup
  useEffect(() => {
    initializeDeviceTimeZone();
  }, []);

  useEffect(() => {
    if (!firebaseEnabled) {
      setAuthChecked(true);
      return undefined;
    }
    return subscribeAuthState((user) => {
      setUserId(user?.uid ?? null);
      setUserEmail(user?.email ?? null);
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!authChecked) {
      setLoading(true);
      return;
    }
    let active = true;
    const init = async () => {
      setLoading(true);
      try {
        const [calendarGranted, locationGranted] = await Promise.all([
          getCalendarPermissionStatus(),
          getLocationPermissionStatus(),
        ]);
        if (!active) return;
        setPermissions({
          calendarGranted,
          locationGranted,
        });

        if (firebaseEnabled && !userId) {
          setPrefsState(defaultPrefs);
          setHistoryState(defaultHistory);
          setHabitsState([]);
          setActivityLogState([]);
          setDisabledCalendarsState([]);
          setInProgressPlanSessionState(null);
          setSessionActivityIntentState('');
          setSmartTodosState([]);
          setIgnoredExternalEventKeysState([]);
          setOnboardingComplete(false);
          setAvailabilityState(null);
          setLocationState(defaultLocation);
          return;
        }

        const [
          storedPrefs,
          storedHistory,
          storedCalendars,
          storedOnboarding,
          storedHabits,
          storedActivity,
          storedAffinities,
          storedScheduled,
          storedPlanSession,
          storedSaved,
          storedSmartTodos,
          storedIgnoredExternalEventKeys,
          storedIsBusinessOnly,
          storedPreloadedDeck,
          guestPrefs,
          guestHistory,
          guestCalendars,
          guestOnboarding,
          guestHabits,
          guestActivity,
          guestAffinities,
          guestScheduled,
          guestPlanSession,
          guestSaved,
          guestSmartTodos,
          guestIgnoredExternalEventKeys,
          guestIsBusinessOnly,
          guestPreloadedDeck,
        ] = await Promise.all([
          loadPrefs(userId),
          loadHistory(userId),
          loadDisabledCalendars(userId),
          loadOnboardingComplete(userId),
          loadHabits(userId),
          loadActivityLog(userId),
          loadTagAffinities(userId),
          loadScheduledActivities(userId),
          loadInProgressPlanSession(userId),
          loadSavedSuggestions(userId),
          loadSmartTodos(userId),
          loadIgnoredExternalEventKeys(userId),
          loadIsBusinessOnly(userId),
          loadPreloadedDeck(userId),
          loadPrefs(null),
          loadHistory(null),
          loadDisabledCalendars(null),
          loadOnboardingComplete(null),
          loadHabits(null),
          loadActivityLog(null),
          loadTagAffinities(null),
          loadScheduledActivities(null),
          loadInProgressPlanSession(null),
          loadSavedSuggestions(null),
          loadSmartTodos(null),
          loadIgnoredExternalEventKeys(null),
          loadIsBusinessOnly(null),
          loadPreloadedDeck(null),
        ]);
        // Try loading from Firestore (cloud-first for cross-device sync)
        const [fbAffinities, fbLocProfile, fbSaved, fbProfileContext] = await Promise.all([
          loadFirebaseAffinities().catch(() => null),
          loadFirebaseLocationProfile().catch(() => null),
          loadFirebaseSavedSuggestions().catch(() => null),
          loadFirebaseProfileContext().catch(() => null),
        ]);
        const firebaseOnboardingComplete = await loadFirebaseOnboardingComplete().catch(() => null);
        if (!active) return;

        const hasStoredProfile = !!(
          storedPrefs || storedHistory || storedCalendars || storedOnboarding ||
          (storedHabits && storedHabits.length) ||
          (storedActivity && storedActivity.length) ||
          (storedAffinities && Object.keys(storedAffinities).length) ||
          (storedScheduled && storedScheduled.length) ||
          !!storedPlanSession ||
          (storedSaved && storedSaved.length) ||
          (storedSmartTodos && storedSmartTodos.length)
        );
        if (storedPrefs) {
          setPrefsState({
            ...defaultPrefs,
            ...storedPrefs,
            ...fbProfileContext,
            interestTags: storedPrefs.interestTags ?? [],
            themeMode: storedPrefs.themeMode ?? 'light',
            language: storedPrefs.language ?? 'en',
          });
        } else {
          const sourcePrefs = guestPrefs ?? defaultPrefs;
          setPrefsState({
            ...defaultPrefs,
            ...sourcePrefs,
            ...fbProfileContext,
            language: sourcePrefs.language ?? 'en',
          });
        }
        if (storedHistory) {
          setHistoryState({
            ...defaultHistory,
            ...storedHistory,
            lastShownIds: storedHistory.lastShownIds ?? [],
          });
        } else {
          setHistoryState(guestHistory ? { ...defaultHistory, ...guestHistory, lastShownIds: guestHistory.lastShownIds ?? [] } : defaultHistory);
        }
        if (storedCalendars) setDisabledCalendarsState(storedCalendars);
        else setDisabledCalendarsState(guestCalendars ?? []);
        // Merge: prefer Firebase habits, fall back to local, migrate legacy fields.
        // Be defensive: older/corrupted payloads may be objects instead of arrays.
        const fbHabits = await loadFirebaseHabits().catch(() => null);
        const habitsSource = fbHabits ?? storedHabits ?? guestHabits;
        const rawHabits = Array.isArray(habitsSource)
          ? habitsSource
          : (Array.isArray((habitsSource as any)?.items) ? (habitsSource as any).items : []);
        const migratedHabits = rawHabits.map(migrateHabit);
        setHabitsState(migratedHabits);
        // Sync migrated back to local cache
        if (migratedHabits.length) saveHabits(migratedHabits, userId).catch(() => undefined);
        setActivityLogState(storedActivity ?? guestActivity ?? []);
        // Prefer Firestore data, fall back to AsyncStorage
        const mergedAffinities = fbAffinities ?? storedAffinities ?? guestAffinities ?? {};
        setTagAffinitiesState(mergedAffinities);
        // If we got cloud affinities, sync them back to local cache
        if (fbAffinities && !storedAffinities) {
          saveTagAffinities(fbAffinities, userId).catch(() => undefined);
        }
        if (fbLocProfile) {
          setLocationProfileState(fbLocProfile);
        }
        // Load scheduled activities
        setScheduledActivitiesState(storedScheduled ?? guestScheduled ?? []);
        setInProgressPlanSessionState(storedPlanSession ?? guestPlanSession ?? null);
        const mergedSaved = fbSaved ?? storedSaved ?? guestSaved ?? [];
        setSavedSuggestionsState(mergedSaved);
        setSmartTodosState(storedSmartTodos ?? guestSmartTodos ?? []);
        setIgnoredExternalEventKeysState(storedIgnoredExternalEventKeys ?? guestIgnoredExternalEventKeys ?? []);
        if (fbSaved && !storedSaved) {
          saveSavedSuggestions(fbSaved, userId).catch(() => undefined);
        }

        // Load business only mode preference
        const isBusinessOnly = storedIsBusinessOnly ?? guestIsBusinessOnly ?? false;
        setIsBusinessOnlyState(isBusinessOnly);

        // Restore queued deck (if still fresh) so Home can reuse it without a new Gemini call.
        const restoredPreloadedDeck = storedPreloadedDeck ?? guestPreloadedDeck;
        if (restoredPreloadedDeck?.deck?.length) {
          const savedAt = new Date(restoredPreloadedDeck.savedAt).getTime();
          const isFresh = Number.isFinite(savedAt) && (Date.now() - savedAt) <= PRELOADED_DECK_TTL_MS;
          if (isFresh) {
            setPreloadedDeck({
              deck: restoredPreloadedDeck.deck,
              usedFallback: restoredPreloadedDeck.usedFallback,
            });
          } else {
            savePreloadedDeck(null, userId).catch(() => undefined);
            if (userId) savePreloadedDeck(null, null).catch(() => undefined);
            setPreloadedDeck(null);
          }
        } else {
          setPreloadedDeck(null);
        }

        const hasFirebaseOnboardingComplete = firebaseOnboardingComplete === true;
        const hasMeaningfulCloudLearningData = !!(
          fbLocProfile ||
          (fbHabits && fbHabits.length > 0) ||
          (fbSaved && fbSaved.length > 0) ||
          (fbAffinities && Object.keys(fbAffinities).length > 0)
        );
        const isNewAccountSession = !!(userId && isNewlyCreatedFirebaseAccountSession());
        const isReturningRegisteredAccount = !!(userId && !isNewAccountSession);

        // Hard rule: never skip onboarding for newly created Firebase accounts.
        // Only returning accounts can auto-skip via stored/cloud completion signals.
        const shouldSkipOnboarding =
          !isNewAccountSession && (
            storedOnboarding ||
            hasFirebaseOnboardingComplete ||
            (isReturningRegisteredAccount && hasMeaningfulCloudLearningData)
          );
          
        setOnboardingComplete(shouldSkipOnboarding);

        // If we detected a returning account via cloud data, cache onboarding completion locally.
        if (!isNewAccountSession && (hasMeaningfulCloudLearningData || hasFirebaseOnboardingComplete) && !storedOnboarding) {
          saveOnboardingComplete(true, userId).catch(() => undefined);
        }

        const hasGuestProfile = !!(
          guestPrefs || guestHistory || guestCalendars || guestOnboarding ||
          (guestHabits && guestHabits.length) ||
          (guestActivity && guestActivity.length) ||
          (guestAffinities && Object.keys(guestAffinities).length) ||
          (guestScheduled && guestScheduled.length) ||
          !!guestPlanSession ||
          (guestSaved && guestSaved.length) ||
          (guestSmartTodos && guestSmartTodos.length)
        );

        if (userId && !hasStoredProfile && hasGuestProfile) {
          await Promise.all([
            savePrefs(guestPrefs ?? defaultPrefs, userId),
            saveHistory(guestHistory ?? defaultHistory, userId),
            saveDisabledCalendars(guestCalendars ?? [], userId),
            saveHabits(migratedHabits, userId),
            saveActivityLog(guestActivity ?? [], userId),
            saveTagAffinities(mergedAffinities, userId),
            saveScheduledActivities(guestScheduled ?? [], userId),
            saveInProgressPlanSession(guestPlanSession ?? null, userId),
            saveSavedSuggestions(mergedSaved, userId),
            saveSmartTodos(guestSmartTodos ?? [], userId),
            savePreloadedDeck(
              guestPreloadedDeck?.deck?.length
                ? { deck: guestPreloadedDeck.deck, usedFallback: guestPreloadedDeck.usedFallback }
                : null,
              userId,
            ),
          ]).catch(() => undefined);
        }
      } catch (error) {
        console.warn('Init error', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    init();
    return () => {
      active = false;
    };
  }, [authChecked, userId, swipeBankMax]);

  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      const storedPremium = await loadPremiumActive(userId).catch(() => false);
      const effectivePremium = Boolean(storedPremium || emailHasPremium);
      setIsPremium(effectivePremium);
      if (effectivePremium !== storedPremium) {
        savePremiumActive(effectivePremium, userId).catch(() => undefined);
      }
    })();
  }, [authChecked, userId, emailHasPremium]);

  // Load swipe bank from storage when auth state is ready
  useEffect(() => {
    if (!authChecked) return;
    (async () => {
      try {
        const stored = await loadSwipeBank(userId).catch(() => null);
        const now = Date.now();
        if (stored) {
          const last = stored.lastUpdated ? new Date(stored.lastUpdated).getTime() : now;
          const elapsedMin = Math.max(0, Math.floor((now - last) / 60000));
          let current = stored.current;
          const max = swipeBankMax;
          if (current <= max) {
            const toAdd = Math.floor(elapsedMin / RECHARGE_INTERVAL_MIN) * RECHARGE_PER_INTERVAL;
            current = Math.min(max, current + toAdd);
          } else {
            const elapsedHours = Math.max(0, (now - last) / 3600000);
            current = current - elapsedHours * OVERFLOW_DECAY_PER_HOUR;
            current = Math.max(max, current);
          }
          const bank = { current: Math.round(current), max };
          setSwipeBank(bank);
          lastUpdatedRef.current = last + Math.floor(elapsedMin / RECHARGE_INTERVAL_MIN) * RECHARGE_INTERVAL_MIN * 60000;
          setSwipeBankLastUpdated(lastUpdatedRef.current);
          saveSwipeBank({ ...bank, lastUpdated: new Date(lastUpdatedRef.current).toISOString() }, userId).catch(() => undefined);
        } else {
          const bank = { current: swipeBankMax, max: swipeBankMax };
          setSwipeBank(bank);
          lastUpdatedRef.current = now;
          setSwipeBankLastUpdated(now);
          saveSwipeBank({ ...bank, lastUpdated: new Date(now).toISOString() }, userId).catch(() => undefined);
        }
      } catch {
        const bank = { current: swipeBankMax, max: swipeBankMax };
        setSwipeBank(bank);
        lastUpdatedRef.current = Date.now();
        setSwipeBankLastUpdated(lastUpdatedRef.current);
      }
    })();
  }, [authChecked, userId, swipeBankMax]);

  // Periodic tick: recharge or decay overflow gradually
  useEffect(() => {
    if (!authChecked) return;
    if (bankTimerRef.current) clearInterval(bankTimerRef.current);
    bankTimerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsedMin = Math.max(0, Math.floor((now - lastUpdatedRef.current) / 60000));
      if (elapsedMin < RECHARGE_INTERVAL_MIN) return;
      const intervals = Math.floor(elapsedMin / RECHARGE_INTERVAL_MIN);
      setSwipeBank((prev) => {
        let current = prev.current;
        const max = prev.max;
        if (current <= max) {
          current = Math.min(max, current + intervals * RECHARGE_PER_INTERVAL);
        } else {
          const elapsedHours = Math.max(0, (now - lastUpdatedRef.current) / 3600000);
          current = Math.max(max, current - elapsedHours * OVERFLOW_DECAY_PER_HOUR);
        }
        const updated = { current: Math.round(current), max };
        // advance lastUpdated by applied intervals
        lastUpdatedRef.current = lastUpdatedRef.current + intervals * RECHARGE_INTERVAL_MIN * 60000;
        setSwipeBankLastUpdated(lastUpdatedRef.current);
        saveSwipeBank({ ...updated, lastUpdated: new Date(lastUpdatedRef.current).toISOString() }, userId).catch(() => undefined);
        return updated;
      });
    }, 60 * 1000);
    return () => { if (bankTimerRef.current) clearInterval(bankTimerRef.current); };
  }, [authChecked, userId]);

  const actions = useMemo<AppActions>(() => ({
    setPermissions: (value) => setPermissions(value),
    setPrefs: (value) => {
      setPrefsState(value);
      setPreferredLocale(value.language === 'de' ? 'de-DE' : 'en-US');
      savePrefs(value, userId).catch(() => undefined);
      syncUserProfileContext(value).catch(() => undefined);
    },
    setHistory: (value) => {
      setHistoryState(value);
      saveHistory(value, userId).catch(() => undefined);
    },
    setHabits: (value) => {
      setHabitsState(value);
      saveHabits(value, userId).catch(() => undefined);
      syncHabits(value).catch(() => undefined);
      rescheduleHabitReminders(value).catch(() => undefined);
    },
    addHabit: (habit) => {
      setHabitsState((prev) => {
        const updated = [habit, ...prev];
        saveHabits(updated, userId).catch(() => undefined);
        syncHabits(updated).catch(() => undefined);
        rescheduleHabitReminders(updated).catch(() => undefined);
        return updated;
      });
    },
    updateHabit: (habit) => {
      setHabitsState((prev) => {
        const updated = prev.map((item) => (item.id === habit.id ? habit : item));
        saveHabits(updated, userId).catch(() => undefined);
        syncHabits(updated).catch(() => undefined);
        rescheduleHabitReminders(updated).catch(() => undefined);
        return updated;
      });
    },
    removeHabit: (habitId) => {
      setHabitsState((prev) => {
        const updated = prev.filter((item) => item.id !== habitId);
        saveHabits(updated, userId).catch(() => undefined);
        syncHabits(updated).catch(() => undefined);
        rescheduleHabitReminders(updated).catch(() => undefined);
        return updated;
      });
    },
    completeHabit: (habitId, completedAt) => {
      const completionDate = completedAt instanceof Date
        ? completedAt
        : completedAt
          ? new Date(completedAt)
          : new Date();
      setHabitsState((prev) => {
        const updated = prev.map((item) => (
          item.id === habitId ? completeHabitEntry(item, completionDate) : item
        ));
        saveHabits(updated, userId).catch(() => undefined);
        syncHabits(updated).catch(() => undefined);
        rescheduleHabitReminders(updated).catch(() => undefined);
        return updated;
      });
    },
    uncompleteHabit: (habitId) => {
      setHabitsState((prev) => {
        const updated = prev.map((item) => (
          item.id === habitId ? uncompleteHabitEntry(item) : item
        ));
        saveHabits(updated, userId).catch(() => undefined);
        syncHabits(updated).catch(() => undefined);
        rescheduleHabitReminders(updated).catch(() => undefined);
        return updated;
      });
    },
    recordActivity: (entry) => {
      setActivityLogState((prev) => {
        const updated = [entry, ...prev].slice(0, 200);
        saveActivityLog(updated, userId).catch(() => undefined);
        return updated;
      });
      // Community activities: track how many people did it + minutes contributed.
      if (entry.source === 'community') {
        recordCommunityIdeaCompletion(entry.suggestionId, entry.durationMin).catch(() => undefined);
      }
      // Strongest affinity signal: user completed the activity
      if (entry.tags?.length) {
        setTagAffinitiesState((prev) => {
          let aff = decayAffinities(prev, new Date().toISOString());
          aff = recordComplete(aff, entry.tags!);
          if (entry.suggestionType) {
            aff = recordTypeAccept(aff, entry.suggestionType);
          }
          saveTagAffinities(aff, userId).catch(() => undefined);
          syncTagAffinities(aff).catch(() => undefined);
          return aff;
        });
      }
    },
    removeLatestActivityForHabit: (habitId) => {
      setActivityLogState((prev) => {
        const idx = prev.findIndex((entry) => entry.habitId === habitId);
        if (idx === -1) return prev;
        const updated = [...prev];
        updated.splice(idx, 1);
        saveActivityLog(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    setLocation: (value) => {
      setLocationState(value);
      setPreferredTimeZone(value.timeZone);
    },
    setAvailability: (value) => {
      const next = value
        ? applyIgnoredEventsToAvailability(value, ignoredExternalEventKeys)
        : value;
      setAvailabilityState(next);
    },
    setIgnoredExternalEventKeys: (value) => {
      setIgnoredExternalEventKeysState(value);
      saveIgnoredExternalEventKeys(value, userId).catch(() => undefined);
    },
    addIgnoredExternalEventKey: (value) => {
      setIgnoredExternalEventKeysState((prev) => {
        if (prev.includes(value)) return prev;
        const updated = [...prev, value];
        saveIgnoredExternalEventKeys(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    removeIgnoredExternalEventKey: (value) => {
      setIgnoredExternalEventKeysState((prev) => {
        const updated = prev.filter((item) => item !== value);
        saveIgnoredExternalEventKeys(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    setDisabledCalendars: (value) => {
      setDisabledCalendarsState(value);
      saveDisabledCalendars(value, userId).catch(() => undefined);
    },
    completeOnboarding: () => {
      setOnboardingComplete(true);
      persistOnboardingComplete(true).catch(() => undefined);
    },
    resetOnboarding: () => {
      setOnboardingComplete(false);
      persistOnboardingComplete(false).catch(() => undefined);
    },
    preloadDeck: (avail, durationOverride) => {
      const finalAvail = durationOverride
        ? (() => {
            const now = new Date();
            return {
              start: now.toISOString(),
              end: new Date(now.getTime() + durationOverride * 60000).toISOString(),
              durationMin: durationOverride,
              nextEventTitle: null,
            };
          })()
        : avail;
      const sanitizedAvail = applyIgnoredEventsToAvailability(finalAvail, ignoredExternalEventKeys);
        runDeckPreload(sanitizedAvail);
    },
    consumeDeck: () => {
      const result = preloadedDeckRef.current;
      preloadedDeckRef.current = null;
      setPreloadedDeck(null);
      savePreloadedDeck(null, userId).catch(() => undefined);
      return result;
    },
    consumeGeminiForDeck: computeGeminiForDeck,
    initGeminiPool: (allGemini, usedIds) => storeGeminiPool(allGemini, usedIds),
    setTagAffinities: (value) => {
      setTagAffinitiesState(value);
      saveTagAffinities(value, userId).catch(() => undefined);
      syncTagAffinities(value).catch(() => undefined);
    },
    setLocationProfile: (value) => {
      setLocationProfileState(value);
      if (value) {
        syncLocationProfile(value).catch(() => undefined);
      }
    },
    setSessionActivityIntent: (value) => {
      setSessionActivityIntentState(value);
      invalidatePreloadedDeck();
    },
    addScheduledActivity: (item) => {
      setScheduledActivitiesState((prev) => {
        const updated = [item, ...prev];
        saveScheduledActivities(updated, userId).catch(() => undefined);
        return updated;
      });

      // Rebuild the preloaded deck so suggestions adapt to the new occupied time.
      try {
        const finalAvail = availability ?? (() => {
          const now = new Date();
          return {
            start: now.toISOString(),
            end: new Date(now.getTime() + 120 * 60000).toISOString(),
            durationMin: 120,
            nextEventTitle: null,
          } as any;
        })();
        const sanitizedAvail = applyIgnoredEventsToAvailability(finalAvail, ignoredExternalEventKeys);
        runDeckPreload(sanitizedAvail);
      } catch (err) {
        // ignore
      }

      // Also attempt to detect overlaps and try to re-fit overlapping scheduled activities
      (async () => {
        try {
          const newStart = new Date(item.startAt).getTime();
          const newEnd = new Date(item.endAt).getTime();
          const dayStart = new Date(item.startAt);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(item.startAt);
          dayEnd.setHours(23, 59, 59, 999);

          // Fetch external calendar events for that day
          const calendarEvents = await getUpcomingEvents(dayStart, dayEnd).catch(() => []);

          // Build occupied intervals: calendar events + current scheduled activities (including the newly added one)
          const currentScheduled = (preloadRef.current.savedSuggestions ? [] : []); // placeholder to satisfy TS
          const scheduled = (scheduledActivitiesRef()?.slice() ?? []);

          // helper to get latest scheduledActivities state safely
          function scheduledActivitiesRef() {
            return preloadRef.current && (preloadRef.current as any).savedSuggestions === undefined ? state.scheduledActivities : state.scheduledActivities;
          }

          const occupied: { start: number; end: number }[] = [];
          for (const ev of calendarEvents) {
            const s = Math.max(dayStart.getTime(), ev.startDate.getTime());
            const e = Math.min(dayEnd.getTime(), ev.endDate.getTime());
            if (e > s) occupied.push({ start: s, end: e });
          }
          // include the newly added item as occupied
          occupied.push({ start: newStart, end: newEnd });

          // include other scheduled activities
          for (const s of state.scheduledActivities) {
            // skip the one we just added (it will be in state.scheduledActivities already)
            if (s.id === item.id) continue;
            const sStart = Math.max(dayStart.getTime(), new Date(s.startAt).getTime());
            const sEnd = Math.min(dayEnd.getTime(), new Date(s.endAt).getTime());
            if (sEnd > sStart) occupied.push({ start: sStart, end: sEnd });
          }

          // Merge occupied intervals
          occupied.sort((a, b) => a.start - b.start);
          const merged: { start: number; end: number }[] = [];
          for (const iv of occupied) {
            const last = merged[merged.length - 1];
            if (!last || iv.start > last.end) merged.push({ ...iv });
            else last.end = Math.max(last.end, iv.end);
          }

          // For each scheduled activity (other than new), if it overlaps the new item, attempt to find a gap
          const updatedScheduled = state.scheduledActivities.map((s) => ({ ...s }));
          let changed = false;
          for (let i = 0; i < updatedScheduled.length; i++) {
            const s = updatedScheduled[i];
            if (s.id === item.id) continue;
            const sStart = new Date(s.startAt).getTime();
            const sEnd = new Date(s.endAt).getTime();
            const overlaps = sStart < newEnd && sEnd > newStart;
            if (!overlaps) continue;

            const duration = sEnd - sStart;

            // find gap using merged occupied intervals
            let cursor = dayStart.getTime();
            let foundSlot: { start: number; end: number } | null = null;
            for (const iv of merged) {
              if (iv.start - cursor >= duration) {
                foundSlot = { start: cursor, end: cursor + duration };
                break;
              }
              cursor = Math.max(cursor, iv.end);
            }
            if (!foundSlot && dayEnd.getTime() - cursor >= duration) {
              foundSlot = { start: cursor, end: cursor + duration };
            }

            if (foundSlot) {
              // update scheduled item to new slot and mark calendarWriteFailed so UI can reconcile
              s.startAt = new Date(foundSlot.start).toISOString();
              s.endAt = new Date(foundSlot.end).toISOString();
              s.calendarWriteFailed = true;
              changed = true;

              // mark this new slot as occupied to avoid collisions with subsequent items
              merged.push({ start: foundSlot.start, end: foundSlot.end });
              merged.sort((a, b) => a.start - b.start);
              // re-merge
              const tmp: { start: number; end: number }[] = [];
              for (const iv of merged) {
                const last = tmp[tmp.length - 1];
                if (!last || iv.start > last.end) tmp.push({ ...iv });
                else last.end = Math.max(last.end, iv.end);
              }
              merged.length = 0;
              merged.push(...tmp);
            }
          }

          if (changed) {
            setScheduledActivitiesState((prev) => {
              saveScheduledActivities(updatedScheduled, userId).catch(() => undefined);
              return updatedScheduled;
            });
          }
        } catch (err) {
          // ignore background reschedule errors
        }
      })();
    },
    updateScheduledActivity: (id, item) => {
      setScheduledActivitiesState((prev) => {
        const updated = prev.map((existing) => (existing.id === id ? item : existing));
        saveScheduledActivities(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    removeScheduledActivity: (id) => {
      setScheduledActivitiesState((prev) => {
        const updated = prev.filter((i) => i.id !== id);
        saveScheduledActivities(updated, userId).catch(() => undefined);
        return updated;
      });

      // Rebuild deck so suggestions adapt to freed up time slots
      try {
        const finalAvail = availability ?? (() => {
          const now = new Date();
          return {
            start: now.toISOString(),
            end: new Date(now.getTime() + 120 * 60000).toISOString(),
            durationMin: 120,
            nextEventTitle: null,
          } as any;
        })();
        const sanitizedAvail = applyIgnoredEventsToAvailability(finalAvail, ignoredExternalEventKeys);
        runDeckPreload(sanitizedAvail);
      } catch (err) {
        // ignore
      }
    },
    setInProgressPlanSession: (session) => {
      setInProgressPlanSessionState(session);
      saveInProgressPlanSession(session, userId).catch(() => undefined);
    },
    saveSuggestion: (item) => {
      setSavedSuggestionsState((prev) => {
        const existingIdx = prev.findIndex((x) => x.suggestion.id === item.suggestion.id);
        const updated = existingIdx >= 0
          ? prev.map((x, idx) => (idx === existingIdx ? { ...x, ...item } : x))
          : [item, ...prev];
        const capped = updated.slice(0, 300);
        saveSavedSuggestions(capped, userId).catch(() => undefined);
        syncSavedSuggestions(capped).catch(() => undefined);
        return capped;
      });
    },
    removeSavedSuggestion: (id) => {
      setSavedSuggestionsState((prev) => {
        const updated = prev.filter((x) => x.id !== id);
        saveSavedSuggestions(updated, userId).catch(() => undefined);
        syncSavedSuggestions(updated).catch(() => undefined);
        return updated;
      });
    },
    addSmartTodo: (item) => {
      invalidatePreloadedDeck();
      setSmartTodosState((prev) => {
        const updated = [item, ...prev].slice(0, 500);
        saveSmartTodos(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    updateSmartTodo: (item) => {
      invalidatePreloadedDeck();
      setSmartTodosState((prev) => {
        const updated = prev.map((todo) => (todo.id === item.id ? item : todo));
        saveSmartTodos(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    removeSmartTodo: (id) => {
      invalidatePreloadedDeck();
      setSmartTodosState((prev) => {
        const updated = prev.filter((todo) => todo.id !== id);
        saveSmartTodos(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    toggleSmartTodoDone: (id) => {
      invalidatePreloadedDeck();
      setSmartTodosState((prev) => {
        const updated = prev.map((todo) => (
          todo.id === id ? { ...todo, done: !todo.done } : todo
        ));
        saveSmartTodos(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    spendSwipe: () => {
      let consumed = false;
      setSwipeBank((prev) => {
        if (prev.current <= 0) return prev;
        const updated = { ...prev, current: Math.max(0, prev.current - 1) };
        lastUpdatedRef.current = Date.now();
        setSwipeBankLastUpdated(lastUpdatedRef.current);
        saveSwipeBank({ ...updated, lastUpdated: new Date(lastUpdatedRef.current).toISOString() }, userId).catch(() => undefined);
        consumed = true;
        return updated;
      });
      return consumed;
    },
    addSwipes: (n: number) => {
      setSwipeBank((prev) => {
        const updated = { ...prev, current: prev.current + n };
        lastUpdatedRef.current = Date.now();
        setSwipeBankLastUpdated(lastUpdatedRef.current);
        saveSwipeBank({ ...updated, lastUpdated: new Date(lastUpdatedRef.current).toISOString() }, userId).catch(() => undefined);
        return updated;
      });
    },
    resetData: async () => {
      await clearStorage(userId);
      setPrefsState(defaultPrefs);
      setHistoryState(defaultHistory);
      setHabitsState([]);
      setActivityLogState([]);
      setDisabledCalendarsState([]);
      setOnboardingComplete(false);
      setAvailabilityState(null);
      setLocationState(defaultLocation);
      setPreferredTimeZone(null);
      setPreferredLocale('en-US');
      setTagAffinitiesState({});
      setLocationProfileState(null);
      setSessionActivityIntentState('');
      setScheduledActivitiesState([]);
      setInProgressPlanSessionState(null);
      setSavedSuggestionsState([]);
      setSmartTodosState([]);
      setIgnoredExternalEventKeysState([]);
    },
    switchToBusinessMode: (profile) => {
      setBusinessProfileState(profile);
      setAccountType('business');
      setBusinessMode(true);
    },
    switchToConsumerMode: () => {
      setBusinessProfileState(null);
      setAccountType('consumer');
      setBusinessMode(false);
    },
    setBusinessProfile: (profile) => {
      setBusinessProfileState(profile);
      if (profile) {
        setAccountType('business');
      }
    },
    setIsBusinessOnly: (value) => {
      setIsBusinessOnlyState(value);
      saveIsBusinessOnly(value, userId).catch(() => undefined);
    },
    setPremiumActive: (value) => {
      const effectivePremium = Boolean(value || emailHasPremium);
      setIsPremium(effectivePremium);
      savePremiumActive(effectivePremium, userId).catch(() => undefined);
    },
  }), [userId, emailHasPremium, sessionActivityIntent, ignoredExternalEventKeys, availability]);

  const state: AppState = {
    loading,
    authChecked,
    userId,
    userEmail,
    onboardingComplete,
    permissions,
    prefs,
    history,
    habits,
    activityLog,
    location,
    availability,
    ignoredExternalEventKeys,
    disabledCalendars,
    preloadedDeck,
    deckLoading,
    geminiPool,
    deckIndex,
    tagAffinities,
    locationProfile,
    sessionActivityIntent,
    scheduledActivities,
    inProgressPlanSession,
    savedSuggestions,
    smartTodos,
    bankTimerRef,
    swipeBank,
    swipeBankLastUpdated,
    accountType,
    businessProfile,
    businessMode,
    isBusinessOnly,
    isPremium,
  };

  return (
    <AppStateContext.Provider value={{ state, actions }}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
};
