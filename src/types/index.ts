export type SuggestionType = 'AT_HOME' | 'GO_OUT' | 'EVENT';

export type HabitFrequency = 'daily' | 'weekly' | 'fortnightly' | 'monthly';

export type HabitTimeOfDay = 'any' | 'morning' | 'afternoon' | 'evening';

export type HabitType = 'AT_HOME' | 'GO_OUT';

export type Step = {
  label: string;
  minutes: number;
};

export type Place = {
  name: string;
  lat?: number;
  lng?: number;
  address?: string;
  costHint?: string;
};

export type EventDetails = {
  startAt: string;
  venue: string;
  ticketUrl: string;
  priceRange?: string;
};

export type Suggestion = {
  id: string;
  type: SuggestionType;
  source?: 'ticketmaster' | 'curated' | 'habit' | 'fallback';
  habitId?: string;
  title: string;
  /** Short action-oriented call-to-action displayed as headline */
  cta?: string;
  description: string;
  durationMin: number;
  /** Preferred time of day — used to filter curated suggestions */
  timeOfDay?: HabitTimeOfDay;
  steps?: Step[];
  equipment?: string[];
  tags?: string[];
  emojis?: string[];
  openStatus?: 'open_now' | 'opens_soon' | 'unknown';
  opensInMin?: number;
  closesInMin?: number;
  rating?: number;
  ratingCount?: number;
  instructions?: string[];
  whyNow?: string;
  place?: Place;
  event?: EventDetails;
  confidence: number;
};

export type SuggestionMeta = {
  distanceKm?: number;
  etaMin?: number;
  leaveBy?: string;
  startInMin?: number;
  openStatus?: 'open_now' | 'opens_soon' | 'unknown';
  opensInMin?: number;
  closesInMin?: number;
};

export type DeckSuggestion = Suggestion & {
  meta?: SuggestionMeta;
};

export type Availability = {
  start: string;
  end: string;
  durationMin: number;
  nextEventTitle?: string | null;
  /** Calendar event ID of the currently-happening event (for deep-linking) */
  currentEventId?: string | null;
};

export type UserPrefs = {
  openToGoingOut: boolean;
  allowSerendipity: boolean;
  radiusKm: number;
  interestTags: string[];
  themeMode: 'light' | 'dark';
};

export type PermissionsState = {
  calendarGranted: boolean;
  locationGranted: boolean;
};

export type LocationState = {
  lat: number | null;
  lng: number | null;
  areaLabel: string | null;
};

export type HistoryState = {
  lastAcceptedIds: string[];
  lastRejectedIds: string[];
  /** IDs of all cards ever shown across decks — used to prevent repeats */
  lastShownIds: string[];
};

export type Habit = {
  id: string;
  name: string;
  type: HabitType;
  lengthMin: number;
  description: string;
  frequency: HabitFrequency;
  timeOfDay: HabitTimeOfDay;
  /** Optional exact preferred time as HH:MM (24h). Overrides timeOfDay for scheduling. */
  preferredTime?: string;
  tags?: string[];
  createdAt: string;
  lastCompletedAt?: string | null;
  /** Current consecutive streak count */
  currentStreak: number;
  /** All-time longest streak */
  longestStreak: number;
  /** ISO timestamps of each completion (most recent first, max 90) */
  completionHistory: string[];
};

export type ActivityLog = {
  id: string;
  suggestionId: string;
  title: string;
  durationMin: number;
  timestamp: string;
  source?: 'ticketmaster' | 'curated' | 'habit' | 'fallback';
  isHabit?: boolean;
  habitId?: string;
  tags?: string[];
  suggestionType?: SuggestionType;
};

export type SessionState = {
  sessionId: string;
  deck: DeckSuggestion[];
  index: number;
  acceptedSuggestion?: DeckSuggestion;
};

export type Commitment = {
  suggestionId: string;
  type: SuggestionType;
  title: string;
  startAt: string;
  endAt: string;
  leaveBy?: string;
  ticketUrl?: string;
  calendarEventId?: string;
  calendarWriteFailed?: boolean;
};

/** A "schedule for later" entry persisted so HomeScreen can show it */
export type ScheduledActivity = {
  id: string;
  suggestionId: string;
  title: string;
  description: string;
  durationMin: number;
  startAt: string;
  endAt: string;
  type: SuggestionType;
  tags?: string[];
  calendarEventId?: string;
  /** Serialised DeckSuggestion + Commitment so we can open PlanScreen */
  suggestion: DeckSuggestion;
  commitment: Commitment;
};

/** Per-tag affinity score learned from swipes & completions */
export type TagAffinities = Record<string, number>;

/** Detected location profile */
export type LocationProfile = {
  label: 'coastal' | 'urban' | 'suburban' | 'unknown';
  /** Tag boosts derived from the profile (e.g. coastal → beaches +0.15) */
  boosts: Record<string, number>;
  /** Lat/lng used for detection — re-detect when user moves significantly */
  lat: number;
  lng: number;
  /** ISO timestamp of last detection */
  detectedAt: string;
};
