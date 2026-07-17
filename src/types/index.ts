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
  source?: 'ticketmaster' | 'curated' | 'habit' | 'library' | 'todo' | 'fallback' | 'gemini' | 'business' | 'community' | 'ad';
  habitId?: string;
  businessId?: string;  // Link to business if business-promoted
  title: string;
  /** Short action-oriented call-to-action displayed as headline */
  cta?: string;
  /** Short, catchy label shown at the top of the card front */
  hook?: string;
  description: string;
  durationMin: number;
  /** Optional mood fit returned by AI suggestions */
  moodFit?: Array<'low' | 'okay' | 'good' | 'high' | 'anxious' | 'bored' | 'surprise'>;
  /** Indicates this activity is suitable for repetition/habit formation */
  isRepetitionFriendly?: boolean;
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
  timeZone?: string | null;
  distanceKm?: number;
  etaMin?: number;
  leaveBy?: string;
  startInMin?: number;
  /** Due date for smart to-do suggestions. */
  todoDeadlineAt?: string | null;
  /** Human-readable due text when no precise timestamp is available. */
  todoDueDate?: string | null;
  /** Atomized to-do progress in minutes when this card represents a chunk. */
  todoAtomizedProgressMin?: number;
  todoAtomizedTotalMin?: number;
  todoAtomizedRemainingMin?: number;
  socialProofCount?: number;
  openStatus?: 'open_now' | 'opens_soon' | 'unknown';
  opensInMin?: number;
  closesInMin?: number;
  /** Suggested slot when planning into an existing day schedule */
  planStartAt?: string;
  planEndAt?: string;
  planBeforeTitle?: string;
  planBeforeEndsAt?: string;
  planAfterTitle?: string;
  planAfterStartsAt?: string;
};

export type DeckSuggestion = Suggestion & {
  meta?: SuggestionMeta;
  /** Native ad targeting keywords — only present when source === 'ad'. */
  adKeywords?: string[];
};

export type DayEventInfo = {
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
};

export type Availability = {
  start: string;
  end: string;
  durationMin: number;
  nextEventTitle?: string | null;
  /** Optional start time for the next event after this free window */
  nextEventStartAt?: string | null;
  /** Optional title for the event immediately before this free window */
  previousEventTitle?: string | null;
  /** Optional end time for the event immediately before this free window */
  previousEventEndAt?: string | null;
  /** Titles of known commitments in the planned period for prompt personalization */
  contextEventTitles?: string[];
  /** Full known events for the planned day (with times) to build an earlier/ahead day arc in prompts */
  dayEvents?: DayEventInfo[];
  /** Calendar event ID of the currently-happening event (for deep-linking) */
  currentEventId?: string | null;
};

export type UserPrefs = {
  openToGoingOut: boolean;
  allowSerendipity: boolean;
  radiusKm: number;
  interestTags: string[];
  customInterests?: string[];
  lifestyle?: 'active' | 'moderate' | 'chill' | 'mixed';
  selfDescription?: string;
  wakeStartTime?: string;
  wakeEndTime?: string;
  themeMode: 'light' | 'dark';
};

export type SavedSuggestion = {
  id: string;
  savedAt: string;
  source: 'saved_later' | 'interest_signal';
  suggestion: DeckSuggestion;
};

export type SmartTodoItem = {
  id: string;
  title: string;
  notes?: string;
  /** Total estimated work minutes for atomized to-dos. */
  atomizedTotalMin?: number | null;
  /** Completed work minutes for atomized to-dos. */
  atomizedProgressMin?: number;
  deadlineAt?: string | null;
  dueDate?: string | null;
  hasFixedSchedule?: boolean;
  scheduledAt?: string | null;
  scheduledEndAt?: string | null;
  scheduledMode?: 'manual' | 'smart' | 'fixed' | null;
  linkedScheduledActivityId?: string | null;
  completionPromptedAt?: string | null;
  /** Human-readable rationale for why this was scheduled at its time (shown on tap). */
  planReason?: string | null;
  done: boolean;
  createdAt: string;
};

export type PermissionsState = {
  calendarGranted: boolean;
  locationGranted: boolean;
};

export type LocationState = {
  lat: number | null;
  lng: number | null;
  areaLabel: string | null;
  timeZone?: string | null;
};

export type HistoryState = {
  lastAcceptedIds: string[];
  lastRejectedIds: string[];
  /** IDs of all cards ever shown across decks — used to prevent repeats */
  lastShownIds: string[];
  /** Track when specific activities were last shown (for habit repetition) */
  lastShownDates?: Record<string, string>; // activityId -> ISO timestamp
  /** Track which activities user has completed (for habit conversion learning) */
  completedActivityIds?: Record<string, number>; // activityId -> count
};

export type Habit = {
  id: string;
  name: string;
  type: HabitType;
  lengthMin: number;
  description: string;
  frequency: HabitFrequency;
  timeOfDay: HabitTimeOfDay;
  /** Optional weekdays (0=Sun...6=Sat). If set, habit is only due on these days. */
  scheduledWeekdays?: number[];
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
  activityMode?: 'all' | 'productive' | 'tomorrow' | 'at_home' | 'challenge_me';
  source?: 'ticketmaster' | 'curated' | 'habit' | 'library' | 'todo' | 'fallback' | 'gemini' | 'business' | 'community';
  isHabit?: boolean;
  habitId?: string;
  tags?: string[];
  suggestionType?: SuggestionType;
  movementKm?: number;
  chatThreadId?: string;
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
  activityMode?: 'all' | 'productive' | 'tomorrow' | 'at_home' | 'challenge_me';
  tags?: string[];
  calendarEventId?: string;
  /** Serialised DeckSuggestion + Commitment so we can open PlanScreen */
  suggestion: DeckSuggestion;
  commitment: Commitment;
  /** Tracks if calendar sync failed and activity was rescheduled */
  calendarWriteFailed?: boolean;
  /** Human-readable rationale for why the smart planner placed this here (shown on tap). */
  planReason?: string | null;
  /** Source that produced this activity when generated by the week planner. */
  planSource?: 'todo' | 'habit' | 'smart' | 'challenge' | 'event';
};

/** Persisted in-progress PlanScreen state so users can resume exactly where they left off. */
export type InProgressPlanSession = {
  key: string;
  commitment: Commitment;
  suggestion: DeckSuggestion;
  manualStartAt: string | null;
  guideChecks: boolean[];
  activityLogged: boolean;
  movementKm: number;
  challengeFailed?: boolean;
  challengeFailedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

// ============ BUSINESS INTEGRATION TYPES ============

export type BusinessType = 'gym' | 'cafe' | 'restaurant' | 'studio' | 'venue' | 'other';

export type Business = {
  id: string;
  type: BusinessType;
  name: string;
  description: string;  // e.g., "Premium gym with morning classes"
  place: Place;  // address + coordinates
  rating?: number;
  ratingCount?: number;
  openingHours?: Record<string, string>;  // "Mo": "09:00-21:00"
  phone?: string;
  website?: string;
  targetTags: string[];  // e.g., ["fitness", "wellness"]
  promotionTags?: string[];  // e.g., ["free_trial", "morning_special"]
  createdAt: string;
  isVerified: boolean;  // Admin-verified business
  monthlyBudget?: number;
  conversionGoal?: 'visits' | 'booking' | 'signup' | 'awareness';
  metrics?: {
    impressions: number;
    clicks: number;
    conversions: number;
  };
};

export type ActivityToHabitRecord = {
  id: string;
  activityId: string;  // Suggestion ID
  title: string;
  tags: string[];
  completedAt: string;  // ISO timestamp
  habitSuggestionId?: string;  // If converted to habit
  userFeedback?: {
    liked: boolean;
    wouldRepeat: boolean;
    businessId?: string;  // If from a business
  };
};

export type HabitBusinessAlignment = {
  habitId: string;
  businessIds: string[];
  alignmentScore: number;  // 0–1
  matchReason: string;
  lastUpdated: string;
};

export type UserBusinessProfile = {
  userId: string;
  businessImpressions: Record<string, number>;  // businessId -> count
  businessInteractions: Record<string, {
    clicked: number;
    visited: number;
    booked: number;
  }>;
  habitsActivelyBuilding: Record<string, number>;  // habitId -> strength (0-1)
  lastUpdated: string;
};

export type BusinessSubmissionStatus = 'pending' | 'approved' | 'rejected';

export type BusinessSubmission = {
  id: string;
  business: Business;
  submittedBy: string;
  submittedByEmail?: string | null;
  status: BusinessSubmissionStatus;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewerId?: string | null;
  reviewNote?: string | null;
};

export type CommunityIdeaStatus = 'pending' | 'approved' | 'rejected';

export type CommunityIdeaSubmission = {
  id: string;
  title: string;
  hook: string;
  description: string;
  type: SuggestionType;
  durationMin: number;
  cta?: string;
  timeOfDay?: HabitTimeOfDay;
  tags?: string[];
  emojis?: string[];
  place?: Place;
  event?: EventDetails;
  imageUrl?: string | null;
  submittedBy: string;
  submittedByEmail?: string | null;
  status: CommunityIdeaStatus;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewerId?: string | null;
  reviewNote?: string | null;
  /** How many times other people completed this activity */
  completionCount?: number;
  /** Cumulative minutes other people spent doing this activity (help contributed) */
  helpMinutes?: number;
};

export type CommunityIdeaSubmissionInput = {
  title: string;
  hook: string;
  description: string;
  type: SuggestionType;
  durationMin: number;
  cta?: string;
  timeOfDay?: HabitTimeOfDay;
  tags?: string[];
  emojis?: string[];
  place?: Place;
  event?: EventDetails;
  imageUrl?: string | null;
  localImageUri?: string | null;
};
