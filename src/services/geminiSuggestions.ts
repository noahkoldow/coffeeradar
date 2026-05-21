import { Availability, LocationState, Suggestion, SuggestionType, UserPrefs } from '../types';
import { addDebugMessage } from './debug';
import { WeatherInfo } from './weather';
import { getTimeZoneParts, getPreferredTimeZone } from '../utils/time';

const GEMINI_KEY = (globalThis as any).process?.env?.EXPO_PUBLIC_GEMINI_API_KEY;
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_SUGGESTIONS = 10;

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

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

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
  radiusKm: prefs.radiusKm,
  openToGoingOut: prefs.openToGoingOut,
  allowSerendipity: prefs.allowSerendipity,
  interests: [...prefs.interestTags].sort(),
  durationMin: availability.durationMin,
  start: availability.start,
  end: availability.end,
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
  
  // Use timezone-aware hour calculation instead of UTC getHours()
  const tzParts = getTimeZoneParts(now, getPreferredTimeZone() ?? location.timeZone);
  const localHour = tzParts.hour;
  const timeOfDay = localHour < 12 ? 'morning' : localHour < 17 ? 'afternoon' : localHour < 21 ? 'evening' : 'night';
  const area = location.areaLabel ?? 'unknown area';
  const hasCoords = location.lat != null && location.lng != null;
  const interests = prefs.interestTags.length ? prefs.interestTags.join(', ') : 'no explicit interest tags';
  const customInterests = (learning?.customInterests ?? prefs.customInterests ?? []).join(', ') || 'none provided';
  const topPositiveTags = (learning?.topPositiveTags ?? []).join(', ') || 'none yet';
  const topSavedTitles = (learning?.topSavedTitles ?? []).join(' | ') || 'none yet';
  const scheduleTitles = (availability.contextEventTitles ?? []).slice(0, 8);
  const scheduleTitleSummary = scheduleTitles.length ? scheduleTitles.join(' | ') : 'none provided';
  const beforeWindow = availability.previousEventTitle
    ? `${availability.previousEventTitle}${availability.previousEventEndAt ? ` (ends ${availability.previousEventEndAt})` : ''}`
    : 'none';
  const afterWindow = availability.nextEventTitle
    ? `${availability.nextEventTitle}${availability.nextEventStartAt ? ` (starts ${availability.nextEventStartAt})` : ''}`
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
    `Current datetime: ${now.toISOString()}`,
    `Current time of day: ${timeOfDay}`,
    `User wake window: ${prefs.wakeStartTime ?? '07:00'} - ${prefs.wakeEndTime ?? '23:00'}`,
    `Available time window: ONLY NEXT ${availability.durationMin} MINUTES (until ${availability.end})`,
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
    '',
    '4. For GO_OUT suggestions:',
    '   - Include: PLACE NAME, FULL ADDRESS, COORDINATES, opening status, how long to get there',
    '   - Include: START TIME in first instruction (e.g., "14:45: Leave now, 10-min walk to...")',
    '   - Only suggest if they can GET THERE and ENJOY IT within available time',
    '',
    '5. For EVENT suggestions:',
    '   - MUST have: eventStartAt (ISO timestamp), eventVenue, eventTicketUrl',
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
    '  - eventStartAt (EVENT only): ISO timestamp of when it starts TODAY',
    '  - eventVenue: venue name',
    '  - eventTicketUrl: link to book/get info',
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
    '      "eventStartAt": "ISO timestamp for EVENT type",',
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

const fetchGeminiText = async (model: string, prompt: string): Promise<string> => {
  const response = await fetch(buildUrl(model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.7,
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
};

const toSuggestion = (raw: GeminiRawSuggestion, index: number): Suggestion | null => {
  const title = raw.title?.trim();
  const description = raw.description?.trim();
  if (!title || !description) return null;

  const hasLocationDetail =
    !!raw.placeAddress?.trim() &&
    (Number.isFinite(raw.placeLat) && Number.isFinite(raw.placeLng));
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
    hook: raw.hook?.trim() || raw.cta?.trim() || undefined,
    cta: raw.cta?.trim() || undefined,
    description,
    whyNow: raw.whyNow?.trim() || undefined,
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
    if (!hasSpecificPlaceName(placeName) || !hasLocationDetail || !hasTimeInInstructions(raw.instructions)) return null;

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
    const ticketUrl = raw.eventTicketUrl?.trim();
    const venue = (raw.eventVenue?.trim() || raw.placeName?.trim() || '');
    if (!ticketUrl || !start || !hasSpecificPlaceName(venue) || !hasLocationDetail) return null;

    suggestion.event = {
      startAt: start,
      venue,
      ticketUrl,
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
    addDebugMessage('gemini', 'Missing API key - skipping Gemini source.');
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
    const prompt = buildPrompt(location, prefs, availability, weather, learning);
    let lastError = '';

    for (const model of GEMINI_MODELS) {
      try {
        const text = await fetchGeminiText(model, prompt);
        const payload = safeJsonParse(text);
        const suggestions = (payload?.suggestions ?? [])
          .map((raw, index) => toSuggestion(raw, index))
          .filter((item): item is Suggestion => item != null)
          .slice(0, MAX_SUGGESTIONS);

        if (!suggestions.length) {
          addDebugMessage('gemini', `Model ${model} returned no usable suggestions.`);
          continue;
        }

        addDebugMessage('gemini', `Model ${model} returned ${suggestions.length} suggestions.`);
        return suggestions;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown Gemini error';
        addDebugMessage('gemini', `Model ${model} failed: ${lastError}`);
      }
    }

    if (lastError) addDebugMessage('gemini', `All Gemini models failed: ${lastError}`);
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
