import { Availability, LocationState, Suggestion, SuggestionType, UserPrefs } from '../types';
import { addDebugMessage } from './debug';
import { WeatherInfo } from './weather';
import { formatLocalDateTime, getTimeZoneParts, resolveTimeZone } from '../utils/time';
import { loadGeminiUsage, saveGeminiUsage } from '../utils/storage';

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
const GEMINI_CALL_LIMIT = 50; // Very permissive during development; tighten after validation works
const cache = new Map<string, CacheEntry>();
const MAX_GEMINI_ATTEMPTS = 3;
let usageQueue: Promise<void> = Promise.resolve();

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

const reserveGeminiCall = async (): Promise<boolean> => withUsageLock(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const usage = await loadGeminiUsage().catch(() => null);
  // Reset counter automatically each new calendar day
  const callCount = (!usage?.date || usage.date !== today) ? 0 : (usage?.callCount ?? 0);
  if (callCount >= GEMINI_CALL_LIMIT) return false;
  await saveGeminiUsage({ callCount: callCount + 1, date: today }).catch(() => undefined);
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

const buildCacheKey = (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
): string => JSON.stringify({
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
      if (!Array.isArray(suggestion?.instructions) || !suggestion.instructions.some((line) => /\b([01]?\d|2[0-3]):[0-5]\d\b/.test(line))) {
        issues.push(`${prefix}.instructions must include a departure time for GO_OUT.`);
      }
    }

    if (type === 'EVENT') {
      if (!suggestion?.eventStartAt) issues.push(`${prefix}.eventStartAt is required for EVENT.`);
      if (!suggestion?.eventVenue?.trim()) issues.push(`${prefix}.eventVenue is required for EVENT.`);
      if (!suggestion?.eventTicketUrl?.trim()) issues.push(`${prefix}.eventTicketUrl is required for EVENT.`);
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
  }

  return [
    'You are a REAL-TIME activity recommendation engine that specializes in things happening NOW, TODAY, and SOON.',
    'Do on-demand web research and return SPECIFIC, TIME-SENSITIVE activity suggestions.',
    'User is deciding what to do in the NEXT 2 HOURS. Be urgency-focused.',
    '',
    filterContext ? `RUBRIC CONTEXT: ${filterContext}` : '',
    typeConstraint ? `${typeConstraint}` : '',
    tagConstraint ? `${tagConstraint}` : '',
    durationConstraint ? `${durationConstraint}` : '',
    styleGuide ? `TONE: ${styleGuide}` : '',
    '',
    `⏰ CRITICAL TIMING CONSTRAINTS:`,
    `Current local datetime: ${localNowLabel}`,
    `Current timezone: ${timeZone}`,
    `Current UTC datetime for reference only: ${now.toISOString()}`,
    `Current time of day: ${timeOfDay}`,
    `User wake window: ${prefs.wakeStartTime ?? '07:00'} - ${prefs.wakeEndTime ?? '23:00'}`,
    `Available window local start: ${localNowLabel}`,
    `Available time window: ONLY NEXT ${availability.durationMin} MINUTES (until ${localWindowEndLabel})`,
    `Available window UTC end for reference only: ${availability.end}`,
    `Must be able to START and COMPLETE within ${availability.durationMin} minutes from NOW.`,
    `Schedule context before this window: ${beforeWindow}`,
    `Schedule context after this window: ${afterWindow}`,
    `Known preexisting commitments today/tomorrow: ${scheduleTitleSummary}`,
    '',
    `📍 Location & Travel:`,
    `User location: ${area}${hasCoords && location.lat != null && location.lng != null ? ` (${location.lat.toFixed(2)}, ${location.lng.toFixed(2)})` : ''}`,
    `Search radius: max ${prefs.radiusKm}km (prefer within 2km for FAST access)`,
    `Travel time matters: pick NEARBY venues you can reach in ${Math.min(15, Math.floor(availability.durationMin / 4))} minutes MAX.`,
    '',
    `User Profile:`,
    `Open to going out: ${prefs.openToGoingOut}`,
    `Interests: ${interests}`,
    `Custom interests: ${customInterests}`,
    `Learned favorite tags: ${topPositiveTags}`,
    `Lifestyle: ${lifestyle}`,
    `Self-description: ${selfDescription}`,
    '',
    `Environment:`,
    `Weather: ${weather ? `${weather.label}; indoorBias=${weather.indoorBias.toFixed(2)}` : 'unknown'}`,
    '',
    '=== RESPONSE OBJECTIVE ===',
    'Optimize for a deck that is both fitting and varied.',
    'Use the user profile to stay relevant, but do not repeat the same kind of idea across all suggestions.',
    'Prefer 5-7 excellent suggestions over a longer list of near-duplicates.',
    'Mix quick wins, deeper options, and one or two adjacent-novelty ideas when they still fit the user.',
    'If the user has location access and is open to going out, include exactly one low-barrier local micro-challenge when feasible.',
    'A micro-challenge should be the easiest meaningful thing the user can do right now in their area: short, concrete, and slightly motivating, not a stunt or a fitness test.',
    'Encode that micro-challenge as a GO_OUT or EVENT suggestion, never as a new type.',
    'If location is unavailable, weather is bad, or the user is not open to going out, omit the micro-challenge rather than forcing it.',
    '',
    'DIVERSITY RULES:',
    '1. Include at least one energizing option, one calming option, and one progress-oriented option.',
    '2. Include at least one quick win (10-30 minutes) and one deeper option (45-90 minutes) when they fit the window.',
    '3. At most two suggestions should share the same core action or venue category.',
    '4. Avoid near-duplicates of saved titles or top saved patterns unless the new suggestion is materially different.',
    '5. Do not let the micro-challenge crowd out the best-fit suggestions; it is one slot in a balanced set, not the whole deck.',
    '',
    '=== GOLDEN RULES FOR THIS REQUEST ===',
    '1. NEVER suggest generic ideas like "go to a cafe" or "visit a museum".',
    '   Instead, ALWAYS name the SPECIFIC venue/event with address and times.',
    '   Example: "Grab espresso at Prater Garten, Gendarmenmarkt 5, opens in 5 min" (NOT "go to a cafe")',
    '',
    '2. For EVENTS: MUST include REAL upcoming event with EXACT START TIME.',
    '   Research real events happening TODAY in the user\'s area.',
    '   Example: "Trivia Night at Tony\'s Bar, 8:30 PM, €2 entry" (NOT generic "go to a bar")',
    '',
    '3. TIME URGENCY IS EVERYTHING:',
    '   - Events/activities starting in 15-30 min: HUGE PRIORITY (mention "in X min")',
    '   - Events starting in 30-60 min: STRONG PRIORITY',
    '   - Events starting beyond 2 hours: DO NOT INCLUDE',
    `   User has ${availability.durationMin} minutes total — don't suggest anything that won't fit.`,
    '   Activities should explicitly fit between the surrounding commitments, not conflict with them.',
    '   - Do NOT move or reinterpret a real event time. If the real event start time does not fit the available window plus travel buffer, exclude it.',
    '   - Do NOT return events that overlap the schedule context before/after this window.',
    '   - For non-event GO_OUT suggestions, set the first instruction to a concrete local departure time that is inside the available window.',
    '',
    '4. For GO_OUT suggestions:',
    '   - Include: PLACE NAME, FULL ADDRESS, COORDINATES, opening status, how long to get there',
    '   - Include: START TIME in first instruction (e.g., "14:45: Leave now, 10-min walk to...")',
    '   - Only suggest if they can GET THERE and ENJOY IT within available time',
    '',
    '5. For EVENT suggestions:',
    `   - MUST have: eventStartAt (ISO timestamp with timezone offset for ${timeZone}), eventVenue, eventTicketUrl`,
    '   - MUST include: place coordinates, address, how long to travel there',
    '   - Only suggest if user can ARRIVE before start + have TRAVEL BUFFER',
    '',
    '6. Be RUTHLESSLY SPECIFIC:',
    '   - NO: "Find a coffee shop nearby"',
    '   - YES: "Espresso at Prater Mitte, Potsdamer Str. 45, open 8am-8pm, 7-min walk, 52.51°N 13.38°E"',
    '   - NO: "Check out a local gallery"',
    '   - YES: "Neuer Nationalgalerie exhibition: "Gerhard Richter Retrospective", opens at 3pm, 20min transit, €12"',
    '',
    '7. Time-of-day must match the idea:',
    '   - Do NOT describe sunset, sunrise, brunch, dinner, late-night, or morning-specific activities unless the current local time actually fits that window.',
    '   - Example: never suggest a "sunset walk" for midday; only use sunset-themed ideas close to sunset or in the evening.',
    '   - Keep titles, hooks, and whyNow text consistent with the current local hour and the available time window.',
    '',
    'Each suggestion must include:',
    '  - type: AT_HOME (no location needed) | GO_OUT (specific venue) | EVENT (specific event + time)',
    '  - title: SHORT, SPECIFIC (not generic category)',
    '  - hook: catchy label for card front',
    '  - description: WHY NOW + WHAT specifically (1-2 sentences, actionable)',
    '  - whyNow: urgency explanation (e.g., "Starts in 25 min, your favorite genre")',
    '  - durationMin: actual activity length in minutes',
    '  - tags: relevant interest tags',
    '  - instructions: step-by-step (include departure time for GO_OUT, e.g., "14:30: Leave now")',
    '  - confidence: 0.65-0.95 (lower if generic, higher if specific + matches learned interests)',
    '',
    'For GO_OUT and EVENT:',
    '  - placeName: REAL venue name (not "a nearby cafe")',
    '  - placeAddress: FULL address with street number',
    '  - placeLat/placeLng: ACTUAL coordinates',
    `  - eventStartAt (EVENT only): ISO timestamp of when it starts TODAY in ${timeZone}, including timezone offset`,
    '  - eventVenue: venue name',
    '  - eventTicketUrl: link to book/get info',
    '',
    'FORMAT EXAMPLES ONLY - use these to mirror structure, not content:',
    '{',
    '  "suggestions": [',
    '    {',
    '      "type": "AT_HOME",',
    '      "title": "15-minute focus reset",',
    '      "hook": "Start now",',
    '      "cta": "Begin a focus block",',
    '      "description": "A short, practical activity that fits the current window.",',
    '      "whyNow": "You have enough time for a clean, useful start.",',
    '      "durationMin": 15,',
    '      "tags": ["focus"],',
    '      "instructions": ["14:00: Start", "14:15: Review briefly"],',
    '      "confidence": 0.78',
    '    },',
    '    {',
    '      "type": "GO_OUT",',
    '      "title": "Nearby place with a concrete reason to go",',
    '      "hook": "Leave soon",',
    '      "cta": "Head out now",',
    '      "description": "A specific nearby venue with a clear fit for the user.",',
    '      "whyNow": "It fits the current window and can be started immediately.",',
    '      "durationMin": 45,',
    '      "tags": ["explore"],',
    '      "instructions": ["14:10: Leave now", "14:25: Arrive and start"],',
    '      "confidence": 0.81,',
    '      "placeName": "Specific venue name",',
    '      "placeAddress": "Street 12, City",',
    '      "placeLat": 52.5,',
    '      "placeLng": 13.4',
    '    }',
    '  ]',
    '}',
    '',
    'Output STRICT JSON only, no markdown, no prose:',
    '{',
    '  "suggestions": [',
    '    {',
    '      "type": "AT_HOME|GO_OUT|EVENT",',
    '      "title": "string",',
    '      "hook": "short catchy top label",',
    '      "cta": "short action headline",',
    '      "description": "1-2 sentence practical why/what",',
    '      "whyNow": "1 sentence urgency (e.g. starts in 30min)",',
    '      "durationMin": 25,',
    '      "tags": ["string"],',
    '      "instructions": ["time: action", "step 2", "step 3"],',
    '      "confidence": 0.75,',
    '      "moodFit": ["low|okay|good|high|anxious|bored|surprise"],',
    '      "placeName": "specific real venue",',
    '      "placeAddress": "full street address with number",',
    '      "placeLat": 52.51,',
    '      "placeLng": 13.38,',
    '      "eventStartAt": "ISO timestamp with timezone offset for EVENT type",',
    '      "eventVenue": "specific real venue name",',
    '      "eventTicketUrl": "https://..."',
    '    }',
    '  ]',
    '}',
    '',
    `Return 6-${MAX_SUGGESTIONS} suggestions ONLY if they meet ALL criteria above.`,
    'Prefer RECENT/UPCOMING events over distant ones.',
    'Prefer NEARBY venues (< 2km) over distant ones.',
    'Quality over quantity: return 4 SPECIFIC suggestions over 8 generic ones.',
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

  const confidence = Number.isFinite(raw.confidence)
    ? Math.max(0.35, Math.min(0.95, Number(raw.confidence)))
    : 0.66;

  const suggestion: Suggestion = {
    id: `gemini_${Date.now()}_${index}`,
    type,
    source: 'gemini',
    title,
    hook: stripRelativeTimingCopy(raw.hook) || stripRelativeTimingCopy(raw.cta),
    cta: stripRelativeTimingCopy(raw.cta),
    description,
    whyNow: stripRelativeTimingCopy(raw.whyNow),
    durationMin,
    tags,
    instructions: Array.isArray(raw.instructions)
      ? raw.instructions.map((step) => step.trim()).filter(Boolean).slice(0, 6)
      : undefined,
    confidence,
    moodFit: moodFit.length ? moodFit : undefined,
  };

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
): Promise<Suggestion[]> => {
  if (!GEMINI_KEY) {
    console.warn('[Gemini] No API key — set EXPO_PUBLIC_GEMINI_API_KEY');
    addDebugMessage('gemini', 'Missing API key - skipping Gemini source.');
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const usage = await loadGeminiUsage().catch(() => null);
  // Treat a missing date or a different date as a fresh day (count = 0)
  const effectiveCount = (!usage?.date || usage.date !== today) ? 0 : (usage?.callCount ?? 0);
  console.log(`[Gemini] usage: ${effectiveCount}/${GEMINI_CALL_LIMIT} calls today (${today}), stored:`, usage);
  if (effectiveCount >= GEMINI_CALL_LIMIT) {
    console.warn('[Gemini] Daily call limit reached');
    addDebugMessage('gemini', 'Gemini call limit reached - using database-backed sources only.');
    return [];
  }

  const cacheKey = buildCacheKey(location, prefs, availability, weather, learning);
  const cached = cache.get(cacheKey);
  if (cached?.data && cached.ts && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached?.promise) {
    return cached.promise;
  }

  const promise = (async () => {
    const canUseGemini = await reserveGeminiCall();
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
        const suggestions = raw
          .map((item, index) => toSuggestion(item, index))
          .filter((item): item is Suggestion => item != null)
          .slice(0, MAX_SUGGESTIONS);
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
): Promise<Suggestion[]> => {
  return runGeminiSuggestions(location, prefs, availability, weather, learning);
};

export const prefetchGeminiSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  weather: WeatherInfo | null,
  learning?: GeminiLearningContext,
): Promise<Suggestion[]> => runGeminiSuggestions(location, prefs, availability, weather, learning);
