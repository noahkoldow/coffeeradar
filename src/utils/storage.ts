import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityLog, Habit, HistoryState, LocationProfile, SavedSuggestion, ScheduledActivity, TagAffinities, UserPrefs } from '../types';

const KEYS = {
  prefs: 'prefs',
  history: 'history',
  calendars: 'enabled_calendars',
  onboarding: 'onboarding_complete',
  habits: 'habits',
  activity: 'activity_log',
  tagAffinities: 'tag_affinities',
  locationProfile: 'location_profile',
  scheduledActivities: 'scheduled_activities',
  savedSuggestions: 'saved_suggestions',
  isBusinessOnly: 'is_business_only',
  swipeBank: 'swipe_bank',
  geminiUsage: 'gemini_usage',
  profileAvatar: 'profile_avatar_uri',
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

export const loadWeatherCondition = async (): Promise<string | null> => {
  return AsyncStorage.getItem('last_weather');
};

export const saveWeatherCondition = async (condition: string): Promise<void> => {
  await AsyncStorage.setItem('last_weather', condition);
};

// ── Tag affinities (learned taste profile) ──────────────────────────────
export const loadTagAffinities = async (userId?: string | null): Promise<TagAffinities | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.tagAffinities, userId));
  return raw ? (JSON.parse(raw) as TagAffinities) : null;
};

export const saveTagAffinities = async (affinities: TagAffinities, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.tagAffinities, userId), JSON.stringify(affinities));
};

// ── Location profile (coastal / urban / suburban) ───────────────────────
export const loadLocationProfile = async (userId?: string | null): Promise<LocationProfile | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.locationProfile, userId));
  return raw ? (JSON.parse(raw) as LocationProfile) : null;
};

export const saveLocationProfile = async (profile: LocationProfile, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.locationProfile, userId), JSON.stringify(profile));
};

// ── Scheduled activities ("schedule for later" entries) ───────────────────
export const loadScheduledActivities = async (userId?: string | null): Promise<ScheduledActivity[] | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.scheduledActivities, userId));
  return raw ? (JSON.parse(raw) as ScheduledActivity[]) : null;
};

export const saveScheduledActivities = async (items: ScheduledActivity[], userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.scheduledActivities, userId), JSON.stringify(items));
};

export const loadSavedSuggestions = async (userId?: string | null): Promise<SavedSuggestion[] | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.savedSuggestions, userId));
  return raw ? (JSON.parse(raw) as SavedSuggestion[]) : null;
};

export const saveSavedSuggestions = async (items: SavedSuggestion[], userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.savedSuggestions, userId), JSON.stringify(items));
};

export const loadIsBusinessOnly = async (userId?: string | null): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.isBusinessOnly, userId));
  return raw ? JSON.parse(raw) === true : false;
};

export const saveIsBusinessOnly = async (isBusinessOnly: boolean, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.isBusinessOnly, userId), JSON.stringify(isBusinessOnly));
};

export type SwipeBankStorage = { current: number; max: number; lastUpdated?: string };

export type GeminiUsageStorage = { callCount: number; date?: string };

export const loadSwipeBank = async (userId?: string | null): Promise<SwipeBankStorage | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.swipeBank, userId));
  return raw ? (JSON.parse(raw) as SwipeBankStorage) : null;
};

export const saveSwipeBank = async (bank: SwipeBankStorage, userId?: string | null): Promise<void> => {
  await AsyncStorage.setItem(keyFor(KEYS.swipeBank, userId), JSON.stringify(bank));
};

export const loadGeminiUsage = async (): Promise<GeminiUsageStorage | null> => {
  const raw = await AsyncStorage.getItem(KEYS.geminiUsage);
  return raw ? (JSON.parse(raw) as GeminiUsageStorage) : null;
};

export const saveGeminiUsage = async (usage: GeminiUsageStorage): Promise<void> => {
  await AsyncStorage.setItem(KEYS.geminiUsage, JSON.stringify(usage));
};

export const loadProfileAvatarUri = async (userId?: string | null): Promise<string | null> => {
  const raw = await AsyncStorage.getItem(keyFor(KEYS.profileAvatar, userId));
  return raw ? String(raw) : null;
};

export const saveProfileAvatarUri = async (uri: string | null, userId?: string | null): Promise<void> => {
  const key = keyFor(KEYS.profileAvatar, userId);
  if (uri) {
    await AsyncStorage.setItem(key, uri);
  } else {
    await AsyncStorage.removeItem(key);
  }
};

export const clearStorage = async (userId?: string | null): Promise<void> => {
  const keys = Object.values(KEYS).map((key) => keyFor(key, userId));
  await AsyncStorage.multiRemove(keys);
};
