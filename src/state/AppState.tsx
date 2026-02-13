import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityLog,
  Availability,
  Habit,
  HistoryState,
  LocationState,
  PermissionsState,
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
  saveActivityLog,
  saveEnabledCalendars,
  saveHabits,
  saveHistory,
  saveOnboardingComplete,
  savePrefs,
} from '../utils/storage';
import { getCalendarPermissionStatus } from '../services/calendar';
import { getLocationPermissionStatus } from '../services/location';
import { subscribeAuthState } from '../services/auth';
import { firebaseEnabled } from '../services/firebase';

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
};

type AppActions = {
  setPermissions: (value: PermissionsState) => void;
  setPrefs: (value: UserPrefs) => void;
  setHistory: (value: HistoryState) => void;
  setHabits: (value: Habit[]) => void;
  addHabit: (habit: Habit) => void;
  updateHabit: (habit: Habit) => void;
  completeHabit: (habitId: string) => void;
  recordActivity: (entry: ActivityLog) => void;
  setLocation: (value: LocationState) => void;
  setAvailability: (value: Availability | null) => void;
  setEnabledCalendars: (value: string[]) => void;
  completeOnboarding: () => void;
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

        const [storedPrefs, storedHistory, storedCalendars, storedOnboarding, storedHabits, storedActivity] = await Promise.all([
          loadPrefs(userId),
          loadHistory(userId),
          loadEnabledCalendars(userId),
          loadOnboardingComplete(userId),
          loadHabits(userId),
          loadActivityLog(userId),
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
        if (storedHistory) setHistoryState(storedHistory);
        else setHistoryState(defaultHistory);
        if (storedCalendars) setEnabledCalendarsState(storedCalendars);
        else setEnabledCalendarsState([]);
        setOnboardingComplete(storedOnboarding);
        setHabitsState(storedHabits ?? []);
        setActivityLogState(storedActivity ?? []);
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
    },
    addHabit: (habit) => {
      setHabitsState((prev) => {
        const updated = [habit, ...prev];
        saveHabits(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    updateHabit: (habit) => {
      setHabitsState((prev) => {
        const updated = prev.map((item) => (item.id === habit.id ? habit : item));
        saveHabits(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    completeHabit: (habitId) => {
      setHabitsState((prev) => {
        const now = new Date().toISOString();
        const updated = prev.map((item) => (
          item.id === habitId ? { ...item, lastCompletedAt: now } : item
        ));
        saveHabits(updated, userId).catch(() => undefined);
        return updated;
      });
    },
    recordActivity: (entry) => {
      setActivityLogState((prev) => {
        const updated = [entry, ...prev].slice(0, 200);
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
