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
  SavedSuggestion,
  ScheduledActivity,
  TagAffinities,
  UserPrefs,
} from '../types';
import { BusinessProfile } from '../types/business';
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
  loadSavedSuggestions,
  saveScheduledActivities,
  saveSavedSuggestions,
} from '../utils/storage';
import { getCalendarPermissionStatus, getUpcomingEvents } from '../services/calendar';
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
  loadFirebaseSavedSuggestions,
  loadFirebaseProfileContext,
  syncSavedSuggestions,
  syncUserProfileContext,
} from '../services/user';
import { setPreferredTimeZone } from '../utils/time';

const defaultPrefs: UserPrefs = {
  openToGoingOut: true,
  allowSerendipity: false,
  radiusKm: 5,
  interestTags: [],
  wakeStartTime: '07:00',
  wakeEndTime: '23:00',
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
  enabledCalendars: string[];
  preloadedDeck: { deck: DeckSuggestion[]; usedFallback: boolean } | null;
  deckLoading: boolean;
  tagAffinities: TagAffinities;
  locationProfile: LocationProfile | null;
  scheduledActivities: ScheduledActivity[];
  savedSuggestions: SavedSuggestion[];
  accountType: 'consumer' | 'business';
  businessProfile: BusinessProfile | null;
  businessMode: boolean;
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
  saveSuggestion: (item: SavedSuggestion) => void;
  removeSavedSuggestion: (id: string) => void;
  resetData: () => Promise<void>;
  switchToBusinessMode: (profile: BusinessProfile) => void;
  switchToConsumerMode: () => void;
  setBusinessProfile: (profile: BusinessProfile | null) => void;
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
  const [savedSuggestions, setSavedSuggestionsState] = useState<SavedSuggestion[]>([]);
  const [accountType, setAccountType] = useState<'consumer' | 'business'>('consumer');
  const [businessProfile, setBusinessProfileState] = useState<BusinessProfile | null>(null);
  const [businessMode, setBusinessMode] = useState(false);

  // Refs for preloadDeck so it always reads the latest values without
  // being a useMemo dependency (which would cause infinite re-renders).
  const preloadRef = useRef({ location, prefs, history, habits, tagAffinities, locationProfile, savedSuggestions });
  useEffect(() => {
    preloadRef.current = { location, prefs, history, habits, tagAffinities, locationProfile, savedSuggestions };
  }, [location, prefs, history, habits, tagAffinities, locationProfile, savedSuggestions]);
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

        const [
          storedPrefs,
          storedHistory,
          storedCalendars,
          storedOnboarding,
          storedHabits,
          storedActivity,
          storedAffinities,
          storedScheduled,
          storedSaved,
          guestPrefs,
          guestHistory,
          guestCalendars,
          guestOnboarding,
          guestHabits,
          guestActivity,
          guestAffinities,
          guestScheduled,
          guestSaved,
        ] = await Promise.all([
          loadPrefs(userId),
          loadHistory(userId),
          loadEnabledCalendars(userId),
          loadOnboardingComplete(userId),
          loadHabits(userId),
          loadActivityLog(userId),
          loadTagAffinities(userId),
          loadScheduledActivities(userId),
          loadSavedSuggestions(userId),
          loadPrefs(null),
          loadHistory(null),
          loadEnabledCalendars(null),
          loadOnboardingComplete(null),
          loadHabits(null),
          loadActivityLog(null),
          loadTagAffinities(null),
          loadScheduledActivities(null),
          loadSavedSuggestions(null),
        ]);
        // Try loading from Firestore (cloud-first for cross-device sync)
        const [fbAffinities, fbLocProfile, fbSaved, fbProfileContext] = await Promise.all([
          loadFirebaseAffinities().catch(() => null),
          loadFirebaseLocationProfile().catch(() => null),
          loadFirebaseSavedSuggestions().catch(() => null),
          loadFirebaseProfileContext().catch(() => null),
        ]);
        if (!active) return;

        const hasStoredProfile = !!(
          storedPrefs || storedHistory || storedCalendars || storedOnboarding ||
          (storedHabits && storedHabits.length) ||
          (storedActivity && storedActivity.length) ||
          (storedAffinities && Object.keys(storedAffinities).length) ||
          (storedScheduled && storedScheduled.length) ||
          (storedSaved && storedSaved.length)
        );
        const hasGuestProfile = !!(
          guestPrefs || guestHistory || guestCalendars || guestOnboarding ||
          (guestHabits && guestHabits.length) ||
          (guestActivity && guestActivity.length) ||
          (guestAffinities && Object.keys(guestAffinities).length) ||
          (guestScheduled && guestScheduled.length) ||
          (guestSaved && guestSaved.length)
        );

        if (storedPrefs) {
          setPrefsState({
            ...defaultPrefs,
            ...storedPrefs,
            ...fbProfileContext,
            interestTags: storedPrefs.interestTags ?? [],
            themeMode: storedPrefs.themeMode ?? 'light',
          });
        } else {
          const sourcePrefs = guestPrefs ?? defaultPrefs;
          setPrefsState({
            ...defaultPrefs,
            ...sourcePrefs,
            ...fbProfileContext,
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
        if (storedCalendars) setEnabledCalendarsState(storedCalendars);
        else setEnabledCalendarsState(guestCalendars ?? []);
        // Merge: prefer Firebase habits, fall back to local, migrate legacy fields
        const fbHabits = await loadFirebaseHabits().catch(() => null);
        const rawHabits = fbHabits ?? storedHabits ?? guestHabits ?? [];
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
        const mergedSaved = fbSaved ?? storedSaved ?? guestSaved ?? [];
        setSavedSuggestionsState(mergedSaved);
        if (fbSaved && !storedSaved) {
          saveSavedSuggestions(fbSaved, userId).catch(() => undefined);
        }

        const hasCloudProfile = !!(fbAffinities || fbLocProfile || fbSaved || fbProfileContext || (fbHabits && fbHabits.length));
        // For authenticated users logging in: if they have NO local data but have cloud profile,
        // they're a returning user and should skip onboarding. If they're brand-new, they'll have neither.
        const isReturningUserWithCloudData = userId && !hasStoredProfile && hasCloudProfile;
        const shouldSkipOnboarding = storedOnboarding || guestOnboarding || hasStoredProfile || hasGuestProfile || hasCloudProfile || isReturningUserWithCloudData;
        setOnboardingComplete(shouldSkipOnboarding);

        // If we detected a returning user via cloud data, cache the onboarding flag locally so future logins are faster
        if (isReturningUserWithCloudData && !storedOnboarding) {
          saveOnboardingComplete(true, userId).catch(() => undefined);
        }

        if (userId && !hasStoredProfile && hasGuestProfile) {
          await Promise.all([
            savePrefs(guestPrefs ?? defaultPrefs, userId),
            saveHistory(guestHistory ?? defaultHistory, userId),
            saveEnabledCalendars(guestCalendars ?? [], userId),
            saveOnboardingComplete(true, userId),
            saveHabits(migratedHabits, userId),
            saveActivityLog(guestActivity ?? [], userId),
            saveTagAffinities(mergedAffinities, userId),
            saveScheduledActivities(guestScheduled ?? [], userId),
            saveSavedSuggestions(mergedSaved, userId),
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
  }, [authChecked, userId]);

  const actions = useMemo<AppActions>(() => ({
    setPermissions: (value) => setPermissions(value),
    setPrefs: (value) => {
      setPrefsState(value);
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
    setLocation: (value) => {
      setLocationState(value);
      setPreferredTimeZone(value.timeZone);
    },
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
      const {
        location: loc,
        prefs: p,
        history: h,
        habits: hb,
        tagAffinities: ta,
        locationProfile: lp,
        savedSuggestions: ss,
      } = preloadRef.current;
      // Background preload gets a generous 15 s API timeout
      // (the user isn't waiting — they're on HomeScreen or swiping)
      buildDeck(finalAvail, loc, p, h, hb, 15000, ta, lp, undefined, ss)
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
        const id = ++deckBuildId.current;
        setDeckLoading(true);
        setPreloadedDeck(null);
        const {
          location: loc,
          prefs: p,
          history: h,
          habits: hb,
          tagAffinities: ta,
          locationProfile: lp,
          savedSuggestions: ss,
        } = preloadRef.current;
        // Background preload gets a generous 15 s API timeout
        buildDeck(finalAvail, loc, p, h, hb, 15000, ta, lp, undefined, ss)
          .then((result) => {
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
        const id = ++deckBuildId.current;
        setDeckLoading(true);
        setPreloadedDeck(null);
        const {
          location: loc,
          prefs: p,
          history: h,
          habits: hb,
          tagAffinities: ta,
          locationProfile: lp,
          savedSuggestions: ss,
        } = preloadRef.current;
        buildDeck(finalAvail, loc, p, h, hb, 15000, ta, lp, undefined, ss)
          .then((result) => {
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
      } catch (err) {
        // ignore
      }
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
      setPreferredTimeZone(null);
      setTagAffinitiesState({});
      setLocationProfileState(null);
      setScheduledActivitiesState([]);
      setSavedSuggestionsState([]);
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
    savedSuggestions,
    accountType,
    businessProfile,
    businessMode,
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
