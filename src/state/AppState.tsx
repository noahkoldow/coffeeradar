import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityLog,
  Availability,
  DeckSuggestion,
  Habit,
  HistoryState,
  LocationProfile,
  LocationState,
  PermissionsState,
  ScheduledActivity,
  TagAffinities,
  UserPrefs,
} from '../types';
import {
  clearStorage,
  loadActivityLog,
  loadEnabledCalendars,
  loadHabits,
  loadHistory,
  loadOnboardingComplete,
  loadPrefs,
  loadTagAffinities,
  saveActivityLog,
  saveEnabledCalendars,
  saveHabits,
  saveHistory,
  saveOnboardingComplete,
  savePrefs,
  saveTagAffinities,
  loadScheduledActivities,
  saveScheduledActivities,
} from '../utils/storage';
import { getCalendarPermissionStatus } from '../services/calendar';
import { getLocationPermissionStatus } from '../services/location';
import { subscribeAuthState } from '../services/auth';
import { firebaseEnabled } from '../services/firebase';
import { buildDeck } from '../services/suggestions';
import { recordComplete, recordTypeAccept, decayAffinities } from '../services/affinity';
import { completeHabitEntry, uncompleteHabitEntry, migrateHabit } from '../utils/habits';
import { rescheduleHabitReminders } from '../services/notifications';
import {
  loadFirebaseAffinities,
  loadFirebaseLocationProfile,
  syncTagAffinities,
  syncLocationProfile,
  syncHabits,
  loadFirebaseHabits,
} from '../services/user';

const defaultPrefs: UserPrefs = {
  openToGoingOut: true,
  allowSerendipity: false,
  radiusKm: 5,
  interestTags: [],
  themeMode: 'light',
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
  enabledCalendars: string[];
  preloadedDeck: { deck: DeckSuggestion[]; usedFallback: boolean } | null;
  deckLoading: boolean;
  tagAffinities: TagAffinities;
  locationProfile: LocationProfile | null;
  scheduledActivities: ScheduledActivity[];
};

type AppActions = {
  setPermissions: (value: PermissionsState) => void;
  setPrefs: (value: UserPrefs) => void;
  setHistory: (value: HistoryState) => void;
  setHabits: (value: Habit[]) => void;
  addHabit: (habit: Habit) => void;
  updateHabit: (habit: Habit) => void;
  removeHabit: (habitId: string) => void;
  completeHabit: (habitId: string) => void;
  uncompleteHabit: (habitId: string) => void;
  recordActivity: (entry: ActivityLog) => void;
  removeLatestActivityForHabit: (habitId: string) => void;
  setLocation: (value: LocationState) => void;
  setAvailability: (value: Availability | null) => void;
  setEnabledCalendars: (value: string[]) => void;
  completeOnboarding: () => void;
  preloadDeck: (availability: Availability, durationOverride?: number | null) => void;
  consumeDeck: () => { deck: DeckSuggestion[]; usedFallback: boolean } | null;
  setTagAffinities: (value: TagAffinities) => void;
  setLocationProfile: (value: LocationProfile | null) => void;
  addScheduledActivity: (item: ScheduledActivity) => void;
  removeScheduledActivity: (id: string) => void;
  resetData: () => Promise<void>;
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
  const [enabledCalendars, setEnabledCalendarsState] = useState<string[]>([]);
  const [preloadedDeck, setPreloadedDeck] = useState<{ deck: DeckSuggestion[]; usedFallback: boolean } | null>(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [tagAffinities, setTagAffinitiesState] = useState<TagAffinities>({});
  const [locationProfile, setLocationProfileState] = useState<LocationProfile | null>(null);
  const [scheduledActivities, setScheduledActivitiesState] = useState<ScheduledActivity[]>([]);

  // Refs for preloadDeck so it always reads the latest values without
  // being a useMemo dependency (which would cause infinite re-renders).
  const preloadRef = useRef({ location, prefs, history, habits, tagAffinities, locationProfile });
  useEffect(() => {
    preloadRef.current = { location, prefs, history, habits, tagAffinities, locationProfile };
  }, [location, prefs, history, habits, tagAffinities, locationProfile]);
  const preloadedDeckRef = useRef(preloadedDeck);
  useEffect(() => { preloadedDeckRef.current = preloadedDeck; }, [preloadedDeck]);
  const deckBuildId = useRef(0);

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
          setEnabledCalendarsState([]);
          setOnboardingComplete(false);
          setAvailabilityState(null);
          setLocationState(defaultLocation);
          return;
        }

        const [storedPrefs, storedHistory, storedCalendars, storedOnboarding, storedHabits, storedActivity, storedAffinities, storedScheduled] = await Promise.all([
          loadPrefs(userId),
          loadHistory(userId),
          loadEnabledCalendars(userId),
          loadOnboardingComplete(userId),
          loadHabits(userId),
          loadActivityLog(userId),
          loadTagAffinities(userId),
          loadScheduledActivities(userId),
        ]);
        // Try loading from Firestore (cloud-first for cross-device sync)
        const [fbAffinities, fbLocProfile] = await Promise.all([
          loadFirebaseAffinities().catch(() => null),
          loadFirebaseLocationProfile().catch(() => null),
        ]);
        if (!active) return;
        if (storedPrefs) {
          setPrefsState({
            ...defaultPrefs,
            ...storedPrefs,
            interestTags: storedPrefs.interestTags ?? [],
            themeMode: storedPrefs.themeMode ?? 'light',
          });
        } else {
          setPrefsState(defaultPrefs);
        }
        if (storedHistory) {
          setHistoryState({
            ...defaultHistory,
            ...storedHistory,
            lastShownIds: storedHistory.lastShownIds ?? [],
          });
        } else {
          setHistoryState(defaultHistory);
        }
        if (storedCalendars) setEnabledCalendarsState(storedCalendars);
        else setEnabledCalendarsState([]);
        setOnboardingComplete(storedOnboarding);
        // Merge: prefer Firebase habits, fall back to local, migrate legacy fields
        const fbHabits = await loadFirebaseHabits().catch(() => null);
        const rawHabits = fbHabits ?? storedHabits ?? [];
        const migratedHabits = rawHabits.map(migrateHabit);
        setHabitsState(migratedHabits);
        // Sync migrated back to local cache
        if (migratedHabits.length) saveHabits(migratedHabits, userId).catch(() => undefined);
        setActivityLogState(storedActivity ?? []);
        // Prefer Firestore data, fall back to AsyncStorage
        const mergedAffinities = fbAffinities ?? storedAffinities ?? {};
        setTagAffinitiesState(mergedAffinities);
        // If we got cloud affinities, sync them back to local cache
        if (fbAffinities && !storedAffinities) {
          saveTagAffinities(fbAffinities, userId).catch(() => undefined);
        }
        if (fbLocProfile) {
          setLocationProfileState(fbLocProfile);
        }
        // Load scheduled activities
        setScheduledActivitiesState(storedScheduled ?? []);
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
  }, [authChecked, userId]);

  const actions = useMemo<AppActions>(() => ({
    setPermissions: (value) => setPermissions(value),
    setPrefs: (value) => {
      setPrefsState(value);
      savePrefs(value, userId).catch(() => undefined);
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
    completeHabit: (habitId) => {
      setHabitsState((prev) => {
        const updated = prev.map((item) => (
          item.id === habitId ? completeHabitEntry(item) : item
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
    setLocation: (value) => setLocationState(value),
    setAvailability: (value) => setAvailabilityState(value),
    setEnabledCalendars: (value) => {
      setEnabledCalendarsState(value);
      saveEnabledCalendars(value, userId).catch(() => undefined);
    },
    completeOnboarding: () => {
      setOnboardingComplete(true);
      saveOnboardingComplete(true, userId).catch(() => undefined);
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
      const id = ++deckBuildId.current;
      setDeckLoading(true);
      setPreloadedDeck(null);
      const { location: loc, prefs: p, history: h, habits: hb, tagAffinities: ta, locationProfile: lp } = preloadRef.current;
      // Background preload gets a generous 15 s API timeout
      // (the user isn't waiting — they're on HomeScreen or swiping)
      buildDeck(finalAvail, loc, p, h, hb, 15000, ta, lp)
        .then((result) => {
          // Only apply if this is still the latest build request
          if (deckBuildId.current === id) {
            setPreloadedDeck(result);
          }
        })
        .catch(() => {
          if (deckBuildId.current === id) setPreloadedDeck(null);
        })
        .finally(() => {
          if (deckBuildId.current === id) setDeckLoading(false);
        });
    },
    consumeDeck: () => {
      const result = preloadedDeckRef.current;
      preloadedDeckRef.current = null;
      setPreloadedDeck(null);
      return result;
    },
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
    addScheduledActivity: (item) => {
      setScheduledActivitiesState((prev) => {
        const updated = [item, ...prev];
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
    },
    resetData: async () => {
      await clearStorage(userId);
      setPrefsState(defaultPrefs);
      setHistoryState(defaultHistory);
      setHabitsState([]);
      setActivityLogState([]);
      setEnabledCalendarsState([]);
      setOnboardingComplete(false);
      setAvailabilityState(null);
      setLocationState(defaultLocation);
      setTagAffinitiesState({});
      setLocationProfileState(null);
      setScheduledActivitiesState([]);
    },
  }), [userId]);

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
    enabledCalendars,
    preloadedDeck,
    deckLoading,
    tagAffinities,
    locationProfile,
    scheduledActivities,
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
