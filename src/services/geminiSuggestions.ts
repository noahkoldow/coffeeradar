import { Availability, LocationState, Suggestion, SuggestionType, UserPrefs } from '../types';
import { addDebugMessage } from './debug';
import { WeatherInfo } from './weather';
import { formatLocalDateTime, getTimeZoneParts, resolveTimeZone } from '../utils/time';
import { loadGeminiUsage, loadPremiumActive, saveGeminiUsage } from '../utils/storage';
import { selectChallengeCandidates } from '../utils/challengeMode';

const GEMINI_KEY = (globalThis as any).process?.env?.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_SUGGESTIONS = 15; // Grab more from Gemini during this permissive phase

// Debug: log if API key is present (without exposing it)
if (typeof window === 'undefined' && !GEMINI_KEY) {
  console.warn('[Gemini] API key not found. Set EXPO_PUBLIC_GEMINI_API_KEY in .env.local');
}

type GeminiRawSuggestion = {
  type?: string;
  title?: string;
  hook?: string;
  cta?: string;
  description?: string;
  whyNow?: string;
  durationMin?: number;
  tags?: string[];
  instructions?: string[];
  confidence?: number;
  moodFit?: string[];
  /** 2-3 emojis that represent the SPECIFIC activity (for the card crown). */
  emojis?: string[];
  /** Whether this is a healthy activity worth repeating into a habit. */
  isRepetitionFriendly?: boolean;
  /** Realistic open-status assessment for GO_OUT/EVENT venues. */
  openStatus?: string;
  opensInMin?: number;
  closesInMin?: number;
  placeName?: string;
  placeAddress?: string;
  placeLat?: number;
  placeLng?: number;
  eventStartAt?: string;
  eventVenue?: string;
  eventTicketUrl?: string;
};

type GeminiPayload = {
  suggestions?: GeminiRawSuggestion[];
};

export type GeminiLearningContext = {
  filter?: string;
  lifestyle?: UserPrefs['lifestyle'];
  selfDescription?: string;
  customInterests?: string[];
  topPositiveTags?: string[];
  topSavedTitles?: string[];
};

type CacheEntry = {
  ts?: number;
  promise?: Promise<Suggestion[]>;
  data?: Suggestion[];
};

type GeminiGenerationConfig = {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
};

type ValidationResult = {
  ok: boolean;
  issues: string[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const GEMINI_FREE_CALL_LIMIT = 13;
const GEMINI_PREMIUM_CALL_LIMIT = 25;
const cache = new Map<string, CacheEntry>();
const MAX_GEMINI_ATTEMPTS = 3;
let usageQueue: Promise<void> = Promise.resolve();

const resolveGeminiDailyCallLimit = (isPremium: boolean): number => (
  isPremium ? GEMINI_PREMIUM_CALL_LIMIT : GEMINI_FREE_CALL_LIMIT
);

const withUsageLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
  let release: (() => void) | undefined;
  const waitForTurn = usageQueue;
  usageQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await waitForTurn;
  try {
    return await fn();
  } finally {
    if (release) release();
  }
};

const reserveGeminiCall = async (dailyCallLimit: number, userId?: string | null): Promise<boolean> => withUsageLock(async () => {
  if (!userId) return false;
  const today = new Date().toISOString().slice(0, 10);
  const usage = await loadGeminiUsage(userId).catch(() => null);
  // Reset counter automatically each new calendar day
  const callCount = (!usage?.date || usage.date !== today) ? 0 : (usage?.callCount ?? 0);
  if (callCount >= dailyCallLimit) return false;
  await saveGeminiUsage({ callCount: callCount + 1, date: today }, userId).catch(() => undefined);
  return true;
});

const buildUrl = (model: string) =>
  `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_KEY ?? '')}`;

const sanitizeTag = (tag: string): string =>
  tag
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

// Keep only genuine emoji glyphs (drop text, ascii, or empty entries).
const sanitizeEmoji = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Emoji live outside the basic ASCII/Latin range; reject plain text tokens.
  const hasEmojiGlyph = /[\u203C-\u3299\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u.test(trimmed);
  if (!hasEmojiGlyph) return null;
  // Take the first grapheme-ish cluster so we don't keep long strings.
  const chars = Array.from(trimmed);
  return chars.slice(0, 3).join('');
};

type MoodLabel = 'low' | 'okay' | 'good' | 'high' | 'anxious' | 'bored' | 'surprise';

const normalizeMood = (value: string): MoodLabel | null => {
  const lower = value.toLowerCase().trim();
  if (lower === 'low' || lower === 'okay' || lower === 'good' || lower === 'high' || lower === 'anxious' || lower === 'bored' || lower === 'surprise') {
    return lower as MoodLabel;
  }
  return null;
};

const normalizeType = (value?: string): SuggestionType => {
  const lower = (value ?? '').toLowerCase().trim();
  if (lower === 'at_home' || lower === 'athome' || lower === 'home') return 'AT_HOME';
  if (lower === 'event') return 'EVENT';
  return 'GO_OUT';
};

const normalizeOpenStatus = (value?: string): 'open_now' | 'opens_soon' | 'unknown' | undefined => {
  const lower = (value ?? '').toLowerCase().trim();
  if (!lower) return undefined;
  if (lower === 'open_now' || lower === 'open' || lower === 'opennow') return 'open_now';
  if (lower === 'opens_soon' || lower === 'opening_soon' || lower === 'openssoon') return 'opens_soon';
  if (lower === 'unknown' || lower === 'closed') return 'unknown';
  return undefined;
};

const stripRelativeTimingCopy = (value?: string): string | undefined => {
  const cleaned = value
    ?.replace(/\b(?:in|within)\s+\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/gi, '')
    .replace(/\bstarts?\s+\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\s+from\s+now\b/gi, '')
    .replace(/\bstarts?\s+soon\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  return cleaned && cleaned.length >= 3 ? cleaned : undefined;
};

const wordCount = (value: string): number =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

const isGenericActivityHeader = (value: string): boolean => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (/\b(now|soon|asap|today|tonight|immediately)\b/.test(normalized)) return true;
  const exactGeneric = new Set([
    'head out',
    'head out now',
    'start now',
    'start here',
    'leave now',
    'leave soon',
    'go now',
    'do this now',
    'do it now',
    'try this',
    'make a move',
    'begin now',
  ]);
  if (exactGeneric.has(normalized)) return true;
  return /^(go|head|start|do|try|begin|leave)\b/.test(normalized) && wordCount(normalized) <= 3;
};

const toCondensedActivityHeader = (cta: string | undefined, title: string): string | undefined => {
  const cleanCta = cta
    ?.replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanCta) {
    const ctaWords = wordCount(cleanCta);
    if (ctaWords >= 2 && ctaWords <= 4 && !isGenericActivityHeader(cleanCta)) {
      return cleanCta;
    }
  }

  const titleWords = title
    .replace(/["“”]/g, '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (titleWords.length >= 2) {
    return titleWords.slice(0, 4).join(' ');
  }
  return cleanCta;
};

const buildCacheKey = (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
  userId?: string | null,
): string => JSON.stringify({
  userId: userId ?? 'guest',
  lat: location.lat,
  lng: location.lng,
  areaLabel: location.areaLabel,
  timeZone: location.timeZone,
  radiusKm: prefs.radiusKm,
  openToGoingOut: prefs.openToGoingOut,
  allowSerendipity: prefs.allowSerendipity,
  interests: [...prefs.interestTags].sort(),
  durationBucket: Math.floor(availability.durationMin / 15) * 15,
  startBucket: Math.floor(new Date(availability.start).getTime() / (15 * 60 * 1000)),
  contextEventTitles: (availability.contextEventTitles ?? []).slice(0, 12),
  weather: weather ? { label: weather.label, indoorBias: Math.round(weather.indoorBias * 100) } : null,
  learning: {
    filter: learning?.filter ?? null,
    lifestyle: learning?.lifestyle ?? null,
    selfDescription: learning?.selfDescription?.slice(0, 140) ?? null,
    customInterests: (learning?.customInterests ?? []).slice(0, 8),
    topPositiveTags: (learning?.topPositiveTags ?? []).slice(0, 8),
    topSavedTitles: (learning?.topSavedTitles ?? []).slice(0, 5),
  },
});

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const buildGenerationConfig = (
  prefs: UserPrefs,
  learning?: GeminiLearningContext,
  weather: WeatherInfo | null = null,
): GeminiGenerationConfig => {
  let temperature = 0.58;

  if (learning?.filter === 'productive') temperature = 0.38;
  else if (learning?.filter === 'at_home') temperature = 0.44;
  else if (learning?.filter === 'go_out') temperature = 0.62;
  else if (learning?.filter === 'challenge_me') temperature = 0.66;

  if (prefs.allowSerendipity) temperature += 0.08;
  if ((learning?.topPositiveTags?.length ?? 0) >= 4) temperature -= 0.04;
  if ((learning?.topSavedTitles?.length ?? 0) === 0) temperature += 0.03;
  if ((weather?.indoorBias ?? 0) > 0.45) temperature -= 0.03;
  if ((weather?.indoorBias ?? 0) < 0.2) temperature += 0.02;

  return {
    temperature: clampNumber(temperature, 0.25, 0.78),
    topP: 0.92,
    topK: 32,
    maxOutputTokens: 2400,
  };
};

const validatePayload = (payload: GeminiPayload | null): ValidationResult => {
  if (!payload) {
    return { ok: false, issues: ['Response was not valid JSON.'] };
  }

  const suggestions = payload.suggestions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return { ok: false, issues: ['Missing suggestions array.'] };
  }

  const issues: string[] = [];
  if (suggestions.length > MAX_SUGGESTIONS) {
    issues.push(`Too many suggestions (${suggestions.length}); cap at ${MAX_SUGGESTIONS}.`);
  }

  suggestions.forEach((suggestion, index) => {
    const prefix = `suggestions[${index}]`;
    const type = normalizeType(suggestion?.type);
    const title = suggestion?.title?.trim();
    const description = suggestion?.description?.trim();

    if (!title) issues.push(`${prefix}.title is required.`);
    if (!description) issues.push(`${prefix}.description is required.`);

    if (type === 'GO_OUT') {
      if (!suggestion?.placeName?.trim()) issues.push(`${prefix}.placeName is required for GO_OUT.`);
      if (!suggestion?.placeAddress?.trim()) issues.push(`${prefix}.placeAddress is required for GO_OUT.`);
      if (!Number.isFinite(suggestion?.placeLat) || !Number.isFinite(suggestion?.placeLng)) {
        issues.push(`${prefix}.placeLat/placeLng are required for GO_OUT.`);
      }
    }

    if (type === 'EVENT') {
      if (!suggestion?.eventStartAt) issues.push(`${prefix}.eventStartAt is required for EVENT.`);
      if (!suggestion?.eventVenue?.trim()) issues.push(`${prefix}.eventVenue is required for EVENT.`);
      if (!suggestion?.placeName?.trim()) issues.push(`${prefix}.placeName is required for EVENT.`);
      if (!suggestion?.placeAddress?.trim()) issues.push(`${prefix}.placeAddress is required for EVENT.`);
      if (!Number.isFinite(suggestion?.placeLat) || !Number.isFinite(suggestion?.placeLng)) {
        issues.push(`${prefix}.placeLat/placeLng are required for EVENT.`);
      }
    }
  });

  return { ok: issues.length === 0, issues };
};

const extractText = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
};

const safeJsonParse = (text: string): GeminiPayload | null => {
  if (!text) return null;
  const trimmed = text.trim();
  const direct = (() => {
    try {
      return JSON.parse(trimmed) as GeminiPayload;
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as GeminiPayload;
    } catch {
      // continue
    }
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as GeminiPayload;
    } catch {
      return null;
    }
  }

  return null;
};

const buildPrompt = (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
): string => {
  const refNow = new Date(availability.start || new Date().toISOString());
  const now = Number.isNaN(refNow.getTime()) ? new Date() : refNow;
  const end = new Date(availability.end);
  const windowEnd = Number.isNaN(end.getTime()) ? null : end;
  
  // Prefer the user's physical-location timezone over the device fallback.
  const timeZone = resolveTimeZone(location.timeZone);
  const tzParts = getTimeZoneParts(now, timeZone);
  const localHour = tzParts.hour;
  const timeOfDay = localHour < 12 ? 'morning' : localHour < 17 ? 'afternoon' : localHour < 21 ? 'evening' : 'night';
  const localNowLabel = formatLocalDateTime(now, timeZone);
  const localWindowEndLabel = windowEnd ? formatLocalDateTime(windowEnd, timeZone) : availability.end;
  const area = location.areaLabel ?? 'unknown area';
  const hasCoords = location.lat != null && location.lng != null;
  const interests = prefs.interestTags.length ? prefs.interestTags.join(', ') : 'no explicit interest tags';
  const customInterests = (learning?.customInterests ?? prefs.customInterests ?? []).join(', ') || 'none provided';
  const topPositiveTags = (learning?.topPositiveTags ?? []).join(', ') || 'none yet';
  const topSavedTitles = (learning?.topSavedTitles ?? []).join(' | ') || 'none yet';
  const scheduleTitles = (availability.contextEventTitles ?? []).slice(0, 8);
  const scheduleTitleSummary = scheduleTitles.length ? scheduleTitles.join(' | ') : 'none provided';

  // --- Full-day arc: what they've already done vs. what's still ahead -------
  const fmtHm = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    const parts = getTimeZoneParts(parsed, timeZone);
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  };
  const timedDayEvents = (availability.dayEvents ?? []).filter((event) => !event.allDay && !!event.title && event.title.trim().length > 0);
  const allDayEventNames = (availability.dayEvents ?? [])
    .filter((event) => !!event.allDay && !!event.title && event.title.trim().length > 0)
    .map((event) => event.title.trim());
  const earlierTodayEvents = timedDayEvents
    .filter((event) => new Date(event.endAt).getTime() <= now.getTime())
    .map((event) => `${event.title} (${fmtHm(event.startAt)}–${fmtHm(event.endAt)})`);
  const ongoingNowEvents = timedDayEvents
    .filter((event) => new Date(event.startAt).getTime() <= now.getTime() && new Date(event.endAt).getTime() > now.getTime())
    .map((event) => `${event.title} (until ${fmtHm(event.endAt)})`);
  const laterTodayEvents = timedDayEvents
    .filter((event) => new Date(event.startAt).getTime() > now.getTime())
    .map((event) => `${event.title} (${fmtHm(event.startAt)})`);
  const hasDayArc = timedDayEvents.length > 0 || allDayEventNames.length > 0;
  const earlierTodaySummary = earlierTodayEvents.length ? earlierTodayEvents.join(' | ') : 'nothing logged yet';
  const laterTodaySummary = laterTodayEvents.length ? laterTodayEvents.join(' | ') : 'nothing else scheduled';
  const ongoingNowSummary = ongoingNowEvents.join(' | ');
  const allDaySummary = allDayEventNames.join(' | ');
  const previousEventEnd = availability.previousEventEndAt ? new Date(availability.previousEventEndAt) : null;
  const nextEventStart = availability.nextEventStartAt ? new Date(availability.nextEventStartAt) : null;
  const previousEventEndLabel = previousEventEnd && !Number.isNaN(previousEventEnd.getTime())
    ? formatLocalDateTime(previousEventEnd, timeZone)
    : availability.previousEventEndAt;
  const nextEventStartLabel = nextEventStart && !Number.isNaN(nextEventStart.getTime())
    ? formatLocalDateTime(nextEventStart, timeZone)
    : availability.nextEventStartAt;
  const beforeWindow = availability.previousEventTitle
    ? `${availability.previousEventTitle}${previousEventEndLabel ? ` (ends ${previousEventEndLabel})` : ''}`
    : 'none';
  const afterWindow = availability.nextEventTitle
    ? `${availability.nextEventTitle}${nextEventStartLabel ? ` (starts ${nextEventStartLabel})` : ''}`
    : 'none';
  const lifestyle = learning?.lifestyle ?? prefs.lifestyle ?? 'mixed';
  const selfDescription = learning?.selfDescription ?? prefs.selfDescription ?? 'not provided';

  // --- Situational awareness signals ---------------------------------------
  const dayOfWeek = tzParts.weekday || 'Unknown';
  const isWeekend = /saturday|sunday/i.test(dayOfWeek);
  const dayKind = isWeekend ? 'weekend' : 'weekday';
  const minutesUntilNext = nextEventStart && !Number.isNaN(nextEventStart.getTime())
    ? Math.max(0, Math.round((nextEventStart.getTime() - now.getTime()) / 60000))
    : null;
  const minutesSincePrev = previousEventEnd && !Number.isNaN(previousEventEnd.getTime())
    ? Math.max(0, Math.round((now.getTime() - previousEventEnd.getTime()) / 60000))
    : null;
  const wakeStart = prefs.wakeStartTime ?? '07:00';
  const bedtime = prefs.wakeEndTime ?? '23:00';
  const parseHm = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const nowMinuteOfDay = localHour * 60 + tzParts.minute;
  const bedtimeMinuteOfDay = parseHm(bedtime);
  const wakeStartMinuteOfDay = parseHm(wakeStart);
  // Is `x` inside the [start, end) window, accounting for wrap past midnight?
  const inWrappedWindow = (start: number, end: number, x: number): boolean =>
    start <= end ? (x >= start && x < end) : (x >= start || x < end);
  // "Past bedtime" = current time falls inside the sleep window (bedtime -> wake).
  const pastBedtime = bedtimeMinuteOfDay != null && wakeStartMinuteOfDay != null
    && inWrappedWindow(bedtimeMinuteOfDay, wakeStartMinuteOfDay, nowMinuteOfDay);
  const minutesPastBedtime = pastBedtime && bedtimeMinuteOfDay != null
    ? ((nowMinuteOfDay - bedtimeMinuteOfDay + 1440) % 1440)
    : null;
  const minutesUntilBed = !pastBedtime && bedtimeMinuteOfDay != null
    ? ((bedtimeMinuteOfDay - nowMinuteOfDay + 1440) % 1440)
    : null;
  const windDownSoon = minutesUntilBed != null && minutesUntilBed <= 120;
  // Heuristic hint about where the user likely is / their headspace right now.
  const situationHint = (() => {
    const clues: string[] = [];
    if (availability.currentEventId) {
      clues.push('a calendar event is happening around now, so they are likely mid-commitment or just wrapping one up');
    }
    if (minutesSincePrev != null && minutesSincePrev <= 30 && availability.previousEventTitle) {
      clues.push(`they just finished "${availability.previousEventTitle}" about ${minutesSincePrev} min ago`);
    }
    if (minutesUntilNext != null && minutesUntilNext <= 180 && availability.nextEventTitle) {
      clues.push(`their next commitment "${availability.nextEventTitle}" is in ${minutesUntilNext} min, so this is an in-between gap`);
    }
    if (localHour >= 6 && localHour < 9) {
      clues.push('it is early morning — they are likely just starting their day, getting ready, or easing in');
    }
    if (!isWeekend && localHour >= 9 && localHour < 17) {
      clues.push('it is a weekday during typical work/school hours');
    }
    if (isWeekend && localHour >= 9 && localHour < 17) {
      clues.push('it is weekend daytime — open, self-directed leisure time good for errands, hobbies, or going out');
    }
    if (localHour >= 17 && localHour < 22) {
      clues.push('it is after-work / evening free time');
    }
    if (localHour >= 22 || localHour < 6) {
      clues.push('it is late night — they are either winding down for bed, catching up on due tasks, or out late; keep ideas short and lean sleep-friendly');
    }
    return clues.length ? clues.join('; ') : 'no strong schedule signals — treat this as open, self-directed free time';
  })();

  if (learning?.filter === 'challenge_me') {
    return [
      'You are generating CHALLENGE MODE cards only.',
      'Output ONLY real challenges. Never output normal activities disguised as challenges.',
      '',
      'USER PROFILE',
      `- Interests/preferences: ${interests}.`,
      `- Extra interests: ${customInterests}.`,
      `- Historically liked tags: ${topPositiveTags}.`,
      `- Saved titles: ${topSavedTitles}.`,
      `- Lifestyle: ${lifestyle}.`,
      `- Self-description: ${selfDescription}.`,
      `- Open to going out now: ${prefs.openToGoingOut}.`,
      '',
      'CURRENT CONTEXT (USE THIS EXPLICITLY)',
      `- Local time: ${localNowLabel}.`,
      `- Time window available: ${availability.durationMin} minutes (must finish by ${localWindowEndLabel}).`,
      `- Location: ${area}${hasCoords && location.lat != null && location.lng != null ? ` (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})` : ''}.`,
      `- What they already did today: ${earlierTodaySummary}.`,
      ongoingNowSummary ? `- What they are doing right now: ${ongoingNowSummary}.` : '',
      `- What they will do later: ${laterTodaySummary}.`,
      `- Last commitment before this window: ${beforeWindow}.`,
      `- Next commitment after this window: ${afterWindow}.`,
      `- Situation hint: ${situationHint}.`,
      `- Weather: ${weather ? `${weather.label}; indoorBias=${weather.indoorBias.toFixed(2)}` : 'unknown'}.`,
      '',
      'NON-NEGOTIABLE CHALLENGE RULES',
      '- Every card MUST be a challenge mission with a discomfort/stretch component.',
      '- Stretch component must be at least one of: social exposure, unfamiliar environment, physical strain, strict focus discipline, or creative risk.',
      '- Every card MUST include measurable success criteria (numbers, reps, distance, count, or explicit pass/fail objective).',
      '- Every card MUST be realistic in the current time window including travel.',
      '- Prefer challenges just outside the user comfort zone based on profile and history; do not stay only in comfort interests.',
      '- Do not produce generic lifestyle suggestions (coffee, walk, tidy up, read) unless they are transformed into explicit challenge missions with measurable targets and stretch.',
      '- If a suggestion does not feel clearly like a challenge mission, do not include it.',
      '- No fabricated events, no fake ticket links, no impossible travel times.',
      '',
      'DIVERSITY REQUIREMENTS',
      '- Return 5 to 8 challenge missions.',
      '- Include mixed intensity: at least 1 easy, at least 3 medium, at least 1 hard challenge.',
      '- Avoid duplicates in action type or venue type.',
      '',
      'TAG REQUIREMENTS (MANDATORY)',
      '- Each suggestion tags must include at least one of: challenge, mission, quest, sprint.',
      '- Each suggestion tags must include at least one stretch-domain tag from: social, explore, fitness, learning, creative, public.',
      '',
      'OUTPUT FIELDS (STRICT JSON ONLY)',
      '{',
      '  "suggestions": [',
      '    {',
      '      "type": "AT_HOME|GO_OUT|EVENT",',
      '      "title": "string",',
      '      "hook": "short mission label",',
      '      "cta": "2-4 word challenge headline",',
      '      "description": "1-2 sentences; why this challenge fits this user now",',
      '      "whyNow": "1 sentence grounded in their today-schedule context",',
      '      "durationMin": 25,',
      '      "tags": ["challenge", "social"],',
      '      "emojis": ["🎯", "🔥"],',
      '      "instructions": ["step 1", "step 2", "step 3"],',
      '      "confidence": 0.8,',
      '      "moodFit": ["good"],',
      '      "isRepetitionFriendly": true,',
      '      "openStatus": "open_now",',
      '      "opensInMin": 0,',
      '      "closesInMin": 180,',
      '      "placeName": "specific real venue",',
      '      "placeAddress": "full street address",',
      '      "placeLat": 52.51,',
      '      "placeLng": 13.38,',
      '      "eventStartAt": "ISO timestamp with timezone offset for EVENT",',
      '      "eventVenue": "specific venue"',
      '    }',
      '  ]',
      '}',
      '',
      'Return STRICT JSON only. No markdown, no commentary.',
    ].filter(Boolean).join('\n');
  }

  let filterContext = '';
  let typeConstraint = '';
  let tagConstraint = '';
  let durationConstraint = '';
  let styleGuide = '';

  if (learning?.filter === 'go_out') {
    filterContext = 'The user wants to GO OUT NOW — they are looking for social, exploratory, movement-based activities.';
    typeConstraint = 'Prefer GO_OUT and EVENT types. Avoid AT_HOME unless it\'s a location-dependent activity (coworking space, library).';
    tagConstraint = 'Prioritize tags: go_out, social, explore, fitness, experience, outdoor. Avoid indoor-only relaxation tags.';
    durationConstraint = 'Suggest quick trips: 30–120 minutes. Make activities that can start immediately.';
    styleGuide = 'Make activities feel adventurous and energizing. Even in bad weather, suggest creative indoor alternatives (museum, café, arcade).';
  } else if (learning?.filter === 'productive') {
    filterContext = 'The user wants to BE PRODUCTIVE — they are looking for learning, skill-building, focus work, and personal growth.';
    typeConstraint = 'Prefer AT_HOME type. Can include GO_OUT for structured learning spaces (library, coworking, class). Avoid events unless skill-building.';
    tagConstraint = 'Prioritize tags: productivity, learning, creative, focus, planning, work, study, reading. Suppress entertainment entirely.';
    durationConstraint = 'Suggest uninterrupted blocks: 45–240 minutes. Assume user wants deep work time.';
    styleGuide = 'Make activities feel structured and goal-oriented. Suggest Pomodoro techniques, sprints, or skill development. Avoid anything distracting.';
  } else if (learning?.filter === 'at_home') {
    filterContext = 'The user wants to HOMEBODY IT — they are looking for cozy, creative, relaxing, or self-care activities at home.';
    typeConstraint = 'ONLY AT_HOME type. No going outside. Focus on indoor comfort and personal space activities.';
    tagConstraint = 'Prioritize tags: relaxation, creative, self_care, entertainment, cooking, craft, wellness, comfort.';
    durationConstraint = 'Flexible duration: 20–180 minutes. Mix quick wins with longer immersive activities.';
    styleGuide = 'Make activities feel cozy, nurturing, and creative. Celebrate staying in. Avoid anything that requires leaving home.';
  } else if (learning?.filter === 'challenge_me') {
    filterContext = 'The user explicitly asked for CHALLENGES — not regular activities with a new label. Every idea must feel like a real mission.';
    typeConstraint = 'Use AT_HOME and GO_OUT depending on fit. EVENT is allowed only if truly plausible and immediately relevant. Never invent ticketed events.';
    tagConstraint = 'Every challenge must include challenge-specific tags (challenge/mission/quest/sprint) plus one stretch domain tag (social/explore/fitness/learning/creative/public).';
    durationConstraint = 'Each challenge must be tightly time-bounded and finish inside the current window. Include clear measurable constraints (numbers, reps, countdowns, or objective criteria).';
    styleGuide = 'Write like a coach setting concrete missions that push the user slightly outside comfort based on their profile: specific, measurable, motivating, safe, and doable now.';
  }

  return [
    'You are the user\'s sharp, well-informed friend who is great at deciding what to do when they can\'t.',
    'They are a little bored or uninspired and want you to take the decision off their hands.',
    'Think like a real person answering: "I\'m in this situation right now, with this much time, this is my life and personality — what should I actually do that fits?"',
    'Do NOT list generic filler. Give specific, doable, well-fitted ideas that a thoughtful friend would actually recommend.',
    '',
    filterContext ? `WHAT THEY ASKED FOR: ${filterContext}` : '',
    typeConstraint ? `${typeConstraint}` : '',
    tagConstraint ? `${tagConstraint}` : '',
    durationConstraint ? `${durationConstraint}` : '',
    styleGuide ? `TONE: ${styleGuide}` : '',
    '',
    '=== WHERE THEY ARE RIGHT NOW (infer, then tailor) ===',
    `Read their schedule and time, then infer their situation and headspace before suggesting anything.`,
    `Situation read: ${situationHint}.`,
    `Local time: ${localNowLabel} (${dayOfWeek}, a ${dayKind}).`,
    `Time of day: ${timeOfDay}.`,
    `Just before this window: ${beforeWindow}.`,
    `Right after this window: ${afterWindow}.`,
    minutesSincePrev != null ? `Minutes since their last commitment ended: ${minutesSincePrev}.` : '',
    minutesUntilNext != null ? `Minutes until their next commitment starts: ${minutesUntilNext}.` : '',
    hasDayArc ? `Earlier in their day (already done): ${earlierTodaySummary}.` : `Other known commitments today/tomorrow: ${scheduleTitleSummary}.`,
    hasDayArc && ongoingNowSummary ? `Happening right around now: ${ongoingNowSummary}.` : '',
    hasDayArc ? `Still ahead in their day: ${laterTodaySummary}.` : '',
    hasDayArc && allDaySummary ? `All-day markers today: ${allDaySummary}.` : '',
    hasDayArc ? 'Read the shape of their day so far — how full or empty it has been — to judge whether they need energy, calm, or momentum, and do not re-suggest something they already did today.' : '',
    'Use this to guess whether they are at work/school, commuting, on a break, or in real free time — and match the vibe.',
    'If they are likely at work/school or on a short break, prefer low-effort, discreet, restorative ideas; do NOT suggest activities that require leaving for a long time.',
    'If this is genuine free time (evening/weekend), you can suggest richer or going-out ideas.',
    '',
    '=== TIME & SLEEP (hard limits) ===',
    `They have ONLY the next ${availability.durationMin} minutes free (until ${localWindowEndLabel}). Every idea must fully START and FINISH inside that window, including travel there and back.`,
    `Their day runs roughly ${wakeStart} (wake) to ${bedtime} (bed).`,
    pastBedtime
      ? `It is ~${minutesPastBedtime} min PAST their target bedtime (${bedtime}) — they are up late. Do not assume why. Offer a small MIX that covers the likely reasons: (a) they want to wind down and get to bed soon — calm, screen-light, sleep-promoting ideas; (b) they have due tasks/to-dos they stayed up to finish — focused, get-it-done ideas that end quickly; and, ONLY if they are clearly out or explicitly asked to go out, (c) one low-key late-night social/nightlife option. Lean toward (a) and (b); gently favour anything that helps them wrap up and sleep, and avoid heavy caffeine or long commitments that dig deeper into the night.`
      : (windDownSoon
        ? `Bedtime is ~${minutesUntilBed} min away — only suggest calm, wind-down activities. NO caffeine, intense exercise, or stimulating outings that would wreck their sleep.`
        : (minutesUntilBed != null ? `About ${minutesUntilBed} min until their target bedtime — do not push activities that would run past it or jeopardise a healthy sleep schedule.` : '')),
    pastBedtime
      ? 'Since it is already past bedtime, prefer short activities; do not suggest things that would realistically keep them up much longer unless they clearly chose to go out.'
      : 'Never suggest something that would realistically end after their bedtime.',
    '',
    '=== LOCATION & REALISTIC TRAVEL ===',
    `They are in ${area}${hasCoords && location.lat != null && location.lng != null ? ` (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})` : ''}.`,
    `Only suggest going out within ${prefs.radiusKm}km, and strongly prefer places within a realistic short trip of the time they have.`,
    'For any GO_OUT/EVENT place: give the MOST ACCURATE coordinates you can for a real, plausible venue of that kind in that area. The app computes real distance and travel time from your coordinates, so wrong coordinates create wrong ETAs — be careful.',
    'Do NOT claim a place is "5 min away" in the text; let the coordinates speak. Just make sure the place is genuinely near the user.',
    'Use realistic travel times: walking ~4.5 km/h, transit door-to-door ~20-25 km/h with waiting. Never imply a trip is faster than physically possible.',
    '',
    '=== OPENING HOURS & VENUE VIBE (must match the clock) ===',
    `It is currently ${String(localHour).padStart(2, '0')}:${String(tzParts.minute).padStart(2, '0')} local (${timeOfDay}). A venue must be BOTH plausibly OPEN and socially APPROPRIATE for this exact hour, for the whole time they'd be there.`,
    'Think about what a normal person would actually do at this hour. If either the opening hours OR the social vibe does not fit the clock, DO NOT suggest it — pick something else.',
    'Typical windows (use judgement, these are the norm):',
    '  - Cafés / coffee / brunch / bakeries: ~07:00–18:00. NEVER suggest a café or coffee run late at night (after ~20:00) or in the middle of the night — it is closed and makes no sense.',
    '  - Bars / pubs / cocktails / clubs / nightlife: evening and night only (~18:00 onward). NEVER suggest going for drinks, a pub, or a club at breakfast, noon, or the afternoon — wrong hours and wrong vibe.',
    '  - Restaurants: lunch ~12:00–15:00 and dinner ~18:00–22:00; do not push a big dinner outing at 15:00 or breakfast food at midnight.',
    '  - Museums / galleries / shops / markets: daytime, typically close by ~18:00–20:00. Never suggest them late at night.',
    '  - Parks / walks / outdoor spots: fine in daylight; only suggest after dark if it is genuinely pleasant and safe (e.g. a lit promenade), never a dark park at 02:00.',
    '  - Gyms/pools: check plausible hours; many close by ~22:00.',
    'Late night (roughly 22:00–06:00): almost nothing normal is open except some bars/clubs/24h spots and home activities. Strongly prefer AT_HOME ideas at these hours and do not invent open cafés, museums, or shops.',
    'For GO_OUT/EVENT set openStatus to "open_now" if it is plausibly open right now, "opens_soon" if it opens within the window, or "unknown" if you truly cannot tell. If you set "opens_soon", set opensInMin realistically. Set closesInMin if closing time is relevant to fitting the activity.',
    'If you are not confident a specific place fits both the hours and the vibe for this exact time, choose a different, safer idea rather than guessing.',
    '',
    '=== WHO THEY ARE ===',
    `Interests: ${interests}.`,
    `Extra interests they told us: ${customInterests}.`,
    `Learned favourites (they liked these before): ${topPositiveTags}.`,
    `Things they saved before: ${topSavedTitles}.`,
    `Lifestyle energy: ${lifestyle}.`,
    `How they describe themselves / character traits: ${selfDescription}.`,
    `Open to going out right now: ${prefs.openToGoingOut}.`,
    'Match their character and energy. A chill person does not want a bootcamp; an active person does not want to just sit.',
    '',
    '=== WEATHER ===',
    `Weather: ${weather ? `${weather.label}; indoorBias=${weather.indoorBias.toFixed(2)} (higher = prefer indoor)` : 'unknown'}.`,
    'Respect the weather: do not send them on a long outdoor activity in rain/cold; lean indoors when indoorBias is high.',
    '',
    '=== BUILD GOOD HABITS ===',
    'Favour ideas that are healthy, doable, and repeatable — the kind of thing that, done regularly, becomes a good habit (a walk, reading, a tidy-up, a short workout, journaling, calling someone, a skill rep).',
    'Avoid junk suggestions that promote unhealthy or pointless consumption. Prefer actions that leave them better off afterward.',
    'Set isRepetitionFriendly=true for activities that would make a good recurring habit at this time of day; false for one-off or novelty ideas.',
    '',
    '=== VARIETY (so the deck does not feel repetitive) ===',
    '1. Include a mix: at least one energising, one calming, and one productive/progress option.',
    '2. Include at least one quick win (10-30 min) and, if the window allows, one deeper option (45-90 min).',
    '3. At most two suggestions may share the same core action or venue category — no near-duplicates.',
    '4. Do not repeat their saved titles unless the new idea is meaningfully different.',
    '5. Prefer 5-7 genuinely good, distinct ideas over a long list of similar ones.',
    '',
    '=== HARD RULES ===',
    '- Be SPECIFIC and time-appropriate. Never suggest sunrise/brunch/sunset/late-night themed activities unless the current local hour actually fits.',
    '- Keep titles, hooks, whyNow, and descriptions consistent with the real current time and window. Do NOT write relative-time claims like "starts in 20 min" — the app renders live timing itself.',
    '- Prefer AT_HOME and GO_OUT. Only use EVENT for a genuinely plausible, regularly-occurring happening (e.g. a well-known weekly market, a cinema showing). Do NOT fabricate specific ticketed events, exact sold-event times, or fake ticket URLs — real ticketed events come from another source.',
    '- For GO_OUT: name a specific, plausible real venue with placeName, placeAddress, and accurate placeLat/placeLng.',
    '- durationMin must be realistic for the activity (a proper museum visit is not 15 min; a coffee is not 3 hours).',
    '- cta is the big headline: a condensed 2-4 word description of the specific activity (e.g. "Riverside Sunset Walk", "Neighborhood Espresso Run", "20-Min Declutter"). Avoid generic copy like "Head out now" or "Try this".',
    '',
    'Each suggestion must include:',
    '  - type: AT_HOME (no location) | GO_OUT (specific venue) | EVENT (plausible regular happening)',
    '  - title: short, specific (not a generic category)',
    '  - hook: short catchy top label',
    '  - cta: 2-4 word activity descriptor (the headline)',
    '  - description: 1-2 sentences — what it is and why it fits THEM right now',
    '  - whyNow: 1 sentence on why it fits this moment/their situation (no relative-time countdowns)',
    '  - durationMin: realistic activity length in minutes',
    '  - tags: relevant interest tags',
    '  - emojis: 2-3 emojis that depict the SPECIFIC activity itself, not just its category. Pick the object/action a person would picture (e.g. bouldering -> ["🧗","🪨"], ramen -> ["🍜","🥢"], sketching in a park -> ["✏️","🌳"], vinyl record shopping -> ["💿","🛒"]). Avoid generic ✨/⭐ filler.',
    '  - instructions: 2-4 short, plain steps. Do NOT prefix steps with clock times or countdowns — that looks pushy. Only include a time inside a step if the activity has a genuinely fixed start (e.g. an event start time).',
    '  - confidence: 0.6-0.95 (higher when specific and well-matched)',
    '  - moodFit: subset of ["low","okay","good","high","anxious","bored","surprise"]',
    '  - isRepetitionFriendly: true if this is a healthy habit-worthy activity for this time of day',
    '',
    'For GO_OUT and EVENT also include:',
    '  - placeName, placeAddress, placeLat, placeLng (accurate coordinates for a real, near venue)',
    '  - openStatus: "open_now" | "opens_soon" | "unknown"; opensInMin/closesInMin when relevant',
    `  - EVENT only: eventStartAt (ISO timestamp with ${timeZone} offset), eventVenue`,
    '',
    'Output STRICT JSON only, no markdown, no prose:',
    '{',
    '  "suggestions": [',
    '    {',
    '      "type": "AT_HOME|GO_OUT|EVENT",',
    '      "title": "string",',
    '      "hook": "short catchy top label",',
    '      "cta": "2-4 word activity descriptor",',
    '      "description": "1-2 sentence why/what for this person now",',
    '      "whyNow": "1 sentence on why it fits this moment",',
    '      "durationMin": 25,',
    '      "tags": ["string"],',
      '      "emojis": ["🎯", "🧠"],',
      '      "instructions": ["step 1", "step 2", "step 3"],',
    '      "confidence": 0.8,',
    '      "moodFit": ["good"],',
    '      "isRepetitionFriendly": true,',
    '      "openStatus": "open_now",',
    '      "opensInMin": 0,',
    '      "closesInMin": 180,',
    '      "placeName": "specific real venue",',
    '      "placeAddress": "full street address with number",',
    '      "placeLat": 52.51,',
    '      "placeLng": 13.38,',
    '      "eventStartAt": "ISO timestamp with timezone offset for EVENT type",',
    '      "eventVenue": "specific real venue name"',
    '    }',
    '  ]',
    '}',
    '',
    `Return 5-${MAX_SUGGESTIONS} suggestions, ONLY ones that truly fit their situation, time, sleep, weather, and opening hours.`,
    'Quality over quantity: 5 excellent, well-fitted ideas beat 10 generic ones.',
    learning?.filter === 'challenge_me'
      ? 'CHALLENGE MODE EXTRA RULES: At least 80% of suggestions must read as explicit missions (not generic activities). Each mission must include one discomfort lever (social exposure, unfamiliar environment, physical effort, strict focus, or creative risk) and one measurable success condition.'
      : '',
  ].filter(Boolean).join('\n');
};

const GEMINI_FETCH_TIMEOUT_MS = 20000; // Gemini 2.5 Flash can take 10-15s; 20s gives headroom

const fetchGeminiText = async (model: string, prompt: string, generationConfig: GeminiGenerationConfig): Promise<string> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        generationConfig: {
          ...generationConfig,
          responseMimeType: 'application/json',
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const errorMsg = `Gemini ${response.status}: ${body.slice(0, 220)}`;
      console.error('[Gemini]', errorMsg);
      throw new Error(errorMsg);
    }

    const data = await response.json();
    const text = extractText(data);
    if (!text) throw new Error('Gemini returned empty content.');
    return text;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Gemini request timeout after ${GEMINI_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  }
};

const toSuggestion = (raw: GeminiRawSuggestion, index: number): Suggestion | null => {
  const title = raw.title?.trim();
  const description = raw.description?.trim();
  if (!title || !description) {
    console.log('[Gemini] Suggestion rejected: missing title or description');
    return null;
  }

  const hasLocationDetail =
    !!raw.placeAddress?.trim() &&
    (Number.isFinite(raw.placeLat) && Number.isFinite(raw.placeLng));
  // Optional: time in instructions is nice but not required for basic feasibility
  const hasTimeInInstructions = (instructions: string[] | undefined): boolean => {
    if (!Array.isArray(instructions) || !instructions.length) return false;
    return instructions.some((line) => /\b([01]?\d|2[0-3]):[0-5]\d\b/.test(line));
  };
  const hasSpecificPlaceName = (value?: string): boolean => {
    const name = value?.trim();
    if (!name || name.length < 4) return false;
    const lower = name.toLowerCase();
    const generic = [
      /nearby\s+(cafe|coffee|restaurant|bar|museum|gallery|park)/,
      /local\s+(cafe|coffee|restaurant|bar|museum|gallery|park|venue)/,
      /a\s+(cafe|coffee|restaurant|bar|museum|gallery|park|event)/,
      /some\s+(cafe|coffee|restaurant|bar|museum|gallery|park|event)/,
      /coffee\s+shop\s+near\s+you/,
      /restaurant\s+near\s+you/,
      /place\s+near\s+you/,
    ];
    return !generic.some((pattern) => pattern.test(lower));
  };

  const type = normalizeType(raw.type);
  const durationMin = Number.isFinite(raw.durationMin)
    ? Math.max(10, Math.min(240, Math.round(raw.durationMin as number)))
    : 45;

  const tags = (raw.tags ?? [])
    .map((tag) => sanitizeTag(tag))
    .filter((tag) => !!tag)
    .slice(0, 6);

  const moodFit = (raw.moodFit ?? [])
    .map((value) => normalizeMood(value))
    .filter((value): value is MoodLabel => value != null)
    .slice(0, 4);

  const emojis = (Array.isArray(raw.emojis) ? raw.emojis : [])
    .map((value) => sanitizeEmoji(value))
    .filter((value): value is string => value != null)
    .filter((value, idx, arr) => arr.indexOf(value) === idx)
    .slice(0, 3);

  const confidence = Number.isFinite(raw.confidence)
    ? Math.max(0.35, Math.min(0.95, Number(raw.confidence)))
    : 0.66;

  const openStatus = normalizeOpenStatus(raw.openStatus);
  const opensInMin = Number.isFinite(raw.opensInMin)
    ? Math.max(0, Math.round(raw.opensInMin as number))
    : undefined;
  const closesInMin = Number.isFinite(raw.closesInMin)
    ? Math.max(0, Math.round(raw.closesInMin as number))
    : undefined;
  const isRepetitionFriendly = typeof raw.isRepetitionFriendly === 'boolean'
    ? raw.isRepetitionFriendly
    : undefined;

  const suggestion: Suggestion = {
    id: `gemini_${Date.now()}_${index}`,
    type,
    source: 'gemini',
    title,
    hook: stripRelativeTimingCopy(raw.hook) || stripRelativeTimingCopy(raw.cta),
    cta: toCondensedActivityHeader(stripRelativeTimingCopy(raw.cta), title),
    description,
    whyNow: stripRelativeTimingCopy(raw.whyNow),
    durationMin,
    tags,
    instructions: Array.isArray(raw.instructions)
      ? raw.instructions.map((step) => step.trim()).filter(Boolean).slice(0, 6)
      : undefined,
    confidence,
    moodFit: moodFit.length ? moodFit : undefined,
    ...(emojis.length ? { emojis } : {}),
    ...(isRepetitionFriendly != null ? { isRepetitionFriendly } : {}),
  };

  if (type === 'GO_OUT' || type === 'EVENT') {
    if (openStatus) suggestion.openStatus = openStatus;
    if (opensInMin != null) suggestion.opensInMin = opensInMin;
    if (closesInMin != null) suggestion.closesInMin = closesInMin;
  }

  if (type === 'GO_OUT') {
    const placeName = raw.placeName?.trim() ?? '';
    // More lenient: just need a place name (can be generic), location details and time are optional
    if (!placeName || placeName.length < 3) {
      console.log('[Gemini] GO_OUT rejected: missing place name');
      return null;
    }

    suggestion.place = {
      name: placeName,
      address: raw.placeAddress?.trim() || undefined,
      lat: Number.isFinite(raw.placeLat) ? Number(raw.placeLat) : undefined,
      lng: Number.isFinite(raw.placeLng) ? Number(raw.placeLng) : undefined,
    };
  }

  if (type === 'EVENT') {
    const start = raw.eventStartAt && !Number.isNaN(new Date(raw.eventStartAt).getTime())
      ? new Date(raw.eventStartAt).toISOString()
      : null;
    const venue = (raw.eventVenue?.trim() || raw.placeName?.trim() || '');
    // More lenient: require only start time and venue name (both required for event)
    if (!start || !venue || venue.length < 3) {
      console.log('[Gemini] EVENT rejected: missing start time or venue', { start: !!start, venue: venue?.length ?? 0 });
      return null;
    }

    suggestion.event = {
      startAt: start,
      venue,
      ticketUrl: raw.eventTicketUrl?.trim() || 'https://tickets.example.com', // fallback URL if not provided
    };
    suggestion.place = {
      name: venue,
      address: raw.placeAddress?.trim() || undefined,
      lat: Number.isFinite(raw.placeLat) ? Number(raw.placeLat) : undefined,
      lng: Number.isFinite(raw.placeLng) ? Number(raw.placeLng) : undefined,
    };
  }

  return suggestion;
};

const runGeminiSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
  userId?: string | null,
): Promise<Suggestion[]> => {
  if (!userId) {
    addDebugMessage('gemini', 'Skipping Gemini source - no user id available for per-user quota.');
    return [];
  }

  if (!GEMINI_KEY) {
    console.warn('[Gemini] No API key — set EXPO_PUBLIC_GEMINI_API_KEY');
    addDebugMessage('gemini', 'Missing API key - skipping Gemini source.');
    return [];
  }

  const isPremium = await loadPremiumActive(userId).catch(() => false);
  const dailyCallLimit = resolveGeminiDailyCallLimit(isPremium);
  const today = new Date().toISOString().slice(0, 10);
  const usage = await loadGeminiUsage(userId).catch(() => null);
  // Treat a missing date or a different date as a fresh day (count = 0)
  const effectiveCount = (!usage?.date || usage.date !== today) ? 0 : (usage?.callCount ?? 0);
  console.log(`[Gemini] usage: ${effectiveCount}/${dailyCallLimit} calls today (${today}), premium=${isPremium}, stored:`, usage);
  if (effectiveCount >= dailyCallLimit) {
    console.warn('[Gemini] Daily call limit reached');
    addDebugMessage('gemini', 'Gemini call limit reached - using database-backed sources only.');
    return [];
  }

  const cacheKey = buildCacheKey(location, prefs, availability, weather, learning, userId);
  const cached = cache.get(cacheKey);
  if (cached?.data && cached.ts && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = (async () => {
    const canUseGemini = await reserveGeminiCall(dailyCallLimit, userId);
    if (!canUseGemini) {
      console.warn('[Gemini] reserveGeminiCall denied (limit)');
      addDebugMessage('gemini', 'Gemini call limit reached - using database-backed sources only.');
      return [];
    }
    console.log('[Gemini] Starting API call, location:', location.areaLabel, 'durationMin:', availability.durationMin);

    const prompt = buildPrompt(location, prefs, availability, weather, learning);
    const generationConfig = buildGenerationConfig(prefs, learning, weather);
    let lastError = '';
    let validationFeedback = '';

    for (let attempt = 0; attempt < MAX_GEMINI_ATTEMPTS; attempt++) {
      const model = GEMINI_MODELS[attempt % GEMINI_MODELS.length];
      const attemptPrompt = validationFeedback
        ? `${prompt}\n\nVALIDATION FEEDBACK:\n${validationFeedback}\nReturn corrected STRICT JSON only.`
        : prompt;
      try {
        const text = await fetchGeminiText(model, attemptPrompt, generationConfig);
        console.log(`[Gemini] ${model} raw text length:`, text?.length ?? 0);
        const payload = safeJsonParse(text);
        const validation = validatePayload(payload);
        if (!validation.ok) {
          validationFeedback = validation.issues.slice(0, 6).join(' ');
          lastError = validationFeedback;
          console.warn(`[Gemini] ${model} validation failed:`, validationFeedback);
          addDebugMessage('gemini', `Model ${model} validation failed: ${validationFeedback}`);
          continue;
        }

        const raw = payload?.suggestions ?? [];
        let suggestions = raw
          .map((item, index) => toSuggestion(item, index))
          .filter((item): item is Suggestion => item != null)
          .slice(0, MAX_SUGGESTIONS);

        if (learning?.filter === 'challenge_me') {
          const challengeSuggestions = selectChallengeCandidates(
            suggestions,
            {
              interestTags: prefs.interestTags,
              customInterests: learning.customInterests ?? prefs.customInterests,
              topPositiveTags: learning.topPositiveTags,
            },
            { minStrict: 3, minReturn: 3 },
          );

          if (challengeSuggestions.length < 3) {
            validationFeedback = 'Challenge mode requires explicit mission-style outputs with measurable constraints and discomfort/stretch elements. Re-generate with stronger challenge specificity.';
            lastError = validationFeedback;
            addDebugMessage('gemini', `Model ${model} returned weak challenge suggestions.`);
            continue;
          }

          suggestions = challengeSuggestions.slice(0, MAX_SUGGESTIONS);
        }

        console.log(`[Gemini] ${model} raw=${raw.length} → valid=${suggestions.length}`);

        if (!suggestions.length) {
          validationFeedback = 'The response parsed but contained no usable suggestions after sanitization.';
          lastError = validationFeedback;
          addDebugMessage('gemini', `Model ${model} returned no usable suggestions.`);
          continue;
        }

        console.log(`[Gemini] ${model} success: returning ${suggestions.length} suggestions`);
        addDebugMessage('gemini', `Model ${model} returned ${suggestions.length} suggestions.`);
        return suggestions;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown Gemini error';
        console.error(`[Gemini] ${model} error:`, lastError);
        addDebugMessage('gemini', `Model ${model} failed: ${lastError}`);
        // Don't retry on timeout — subsequent attempts will also time out
        if (lastError.includes('timeout') || lastError.includes('abort') || lastError.includes('AbortError')) {
          break;
        }
        validationFeedback = lastError;
      }
    }

    if (lastError) {
      console.error('[Gemini] All models failed:', lastError);
      addDebugMessage('gemini', `All Gemini models failed: ${lastError}`);
    }
    return [];
  })();

  cache.set(cacheKey, { promise });
  const data = await promise;
  cache.set(cacheKey, { ts: Date.now(), data });
  return data;
};

export const fetchGeminiSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
  userId?: string | null,
): Promise<Suggestion[]> => {
  return runGeminiSuggestions(location, prefs, availability, weather, learning, userId);
};

export const prefetchGeminiSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
  userId?: string | null,
): Promise<Suggestion[]> => runGeminiSuggestions(location, prefs, availability, weather, learning, userId);
