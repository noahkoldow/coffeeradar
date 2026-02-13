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
  description: string;
  durationMin: number;
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
};

export type Habit = {
  id: string;
  name: string;
  type: HabitType;
  lengthMin: number;
  description: string;
  frequency: HabitFrequency;
  timeOfDay: HabitTimeOfDay;
  tags?: string[];
  createdAt: string;
  lastCompletedAt?: string | null;
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
