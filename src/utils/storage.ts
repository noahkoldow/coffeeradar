import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityLog, Habit, HistoryState, UserPrefs } from '../types';

const KEYS = {
  prefs: 'prefs',
  history: 'history',
  calendars: 'enabled_calendars',
  onboarding: 'onboarding_complete',
  habits: 'habits',
  activity: 'activity_log',
};

const keyFor = (base: string, userId?: string | null): string => {
  if (!userId) return `${base}:guest`;
  return `${base}:${userId}`;
};

export const loadPrefs = async (userId?: string | null): Promise<UserPrefs | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.prefs, userId));
  return raw ? (JSON.parse(raw) as UserPrefs) : null;
};

export const savePrefs = async (prefs: UserPrefs, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.prefs, userId), JSON.stringify(prefs));
};

export const loadHistory = async (userId?: string | null): Promise<HistoryState | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.history, userId));
  return raw ? (JSON.parse(raw) as HistoryState) : null;
};

export const saveHistory = async (history: HistoryState, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.history, userId), JSON.stringify(history));
};

export const loadEnabledCalendars = async (userId?: string | null): Promise<string[] | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.calendars, userId));
  return raw ? (JSON.parse(raw) as string[]) : null;
};

export const saveEnabledCalendars = async (calendarIds: string[], userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.calendars, userId), JSON.stringify(calendarIds));
};

export const loadOnboardingComplete = async (userId?: string | null): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.onboarding, userId));
  return raw === 'true';
};

export const saveOnboardingComplete = async (value: boolean, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.onboarding, userId), value ? 'true' : 'false');
};

export const loadHabits = async (userId?: string | null): Promise<Habit[] | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.habits, userId));
  return raw ? (JSON.parse(raw) as Habit[]) : null;
};

export const saveHabits = async (habits: Habit[], userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.habits, userId), JSON.stringify(habits));
};

export const loadActivityLog = async (userId?: string | null): Promise<ActivityLog[] | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.activity, userId));
  return raw ? (JSON.parse(raw) as ActivityLog[]) : null;
};

export const saveActivityLog = async (log: ActivityLog[], userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.activity, userId), JSON.stringify(log));
};

export const clearStorage = async (userId?: string | null): Promise<void> => {
  const keys = Object.values(KEYS).map((key) => keyFor(key, userId));
  await AsyncStorage.multiRemove(keys);
};
