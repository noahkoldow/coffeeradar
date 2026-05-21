import { atHomeSuggestions } from '../data/atHome';
import { fallbackSuggestions } from '../data/fallback';
import { goOutSuggestions } from '../data/goOut';
import {
  Availability,
  Business,
  DeckSuggestion,
  Habit,
  HabitTimeOfDay,
  HistoryState,
  LocationProfile,
  LocationState,
  SavedSuggestion,
  Suggestion,
  SuggestionMeta,
  SuggestionType,
  TagAffinities,
  UserPrefs,
} from '../types';
import { addMinutes, clamp, fromISO, minutesBetween, isSameCalendarDayInTimeZone, getTimeZoneParts, getPreferredTimeZone } from '../utils/time';
import { chooseTravelMode, estimateDeparture, estimateEtaMinutes, haversineKm } from './travel';
import { fetchTicketmasterSuggestions } from './ticketmaster';
import { habitToSuggestion, isHabitDue, matchesTimeOfDay } from '../utils/habits';
import { fetchWeather, WeatherInfo } from './weather';
import { fetchGeminiSuggestions, GeminiLearningContext } from './geminiSuggestions';
import { generateWhyNow } from './whyNow';
import { affinityScore, typeAffinityScore } from './affinity';
import { loadFirebaseBusinesses } from './user';
import {
  filterForHabitRepetition,
  markRepetitionFriendly,
  shouldSuggestHabitConversion,
} from './activityRepetitionService';
import { calculateBusinessHabitAlignment, findAlignedBusinesses, businessToSuggestion } from './businessService';

const BUFFER_MIN = 10;
const GEMINI_SOURCE_BOOST = 0.08;
const MIN_GEMINI_IN_DECK = 2;

const buildLocalBusinessCatalog = (location: LocationState): Business[] => {
  if (!location.lat || !location.lng) return [];
  const { lat, lng } = location;
  const nowIso = new Date().toISOString();

  return [
    {
      id: 'seed_fit_studio',
      type: 'gym',
      name: 'Pulse Fit Studio',
      description: 'Functional training studio with short guided sessions and beginner-friendly coaching.',
      place: {
        name: 'Pulse Fit Studio',
        lat: lat + 0.006,
        lng: lng + 0.004,
        address: '12 Active Lane',
      },
      rating: 4.6,
      ratingCount: 241,
      targetTags: ['fitness', 'wellness', 'explore'],
      createdAt: nowIso,
      isVerified: true,
      conversionGoal: 'visits',
      metrics: { impressions: 0, clicks: 0, conversions: 0 },
    },
    {
      id: 'seed_focus_cafe',
      type: 'cafe',
      name: 'Focus Roast Lab',
      description: 'Quiet specialty cafe with strong Wi-Fi and productivity-friendly seating for deep work blocks.',
      place: {
        name: 'Focus Roast Lab',
        lat: lat - 0.004,
        lng: lng + 0.003,
        address: '38 Workday Street',
      },
      rating: 4.5,
      ratingCount: 189,
      targetTags: ['coffee', 'focus', 'study', 'productivity'],
      createdAt: nowIso,
      isVerified: true,
      conversionGoal: 'visits',
      metrics: { impressions: 0, clicks: 0, conversions: 0 },
    },
    {
      id: 'seed_recover_kitchen',
      type: 'restaurant',
      name: 'Nourish Kitchen',
      description: 'Healthy bowls and protein-forward meals ideal after workouts or evening recovery.',
      place: {
        name: 'Nourish Kitchen',
        lat: lat + 0.003,
        lng: lng - 0.005,
        address: '7 Green Table Ave',
      },
      rating: 4.4,
      ratingCount: 133,
      targetTags: ['food', 'wellness', 'social'],
      createdAt: nowIso,
      isVerified: true,
      conversionGoal: 'visits',
      metrics: { impressions: 0, clicks: 0, conversions: 0 },
    },
  ];
};

/** Auto-generate a CTA for suggestions that don't have one */
const generateCta = (suggestion: Suggestion): string => {
  if (suggestion.cta) return suggestion.cta;

  const title = suggestion.title.toLowerCase();

  if (suggestion.type === 'EVENT') {
    if (/jazz|concert|live|music|dj/.test(title)) return `Go see ${suggestion.title}`;
    if (/film|movie|screening|cinema/.test(title)) return `Watch ${suggestion.title}`;
    if (/gallery|exhibit|art/.test(title)) return `Check out ${suggestion.title}`;
    return `Go to ${suggestion.title}`;
  }

  if (suggestion.type === 'GO_OUT') {
    const place = suggestion.place?.name;
    if (/cafe|coffee/.test(title)) return place ? `Grab a coffee at ${place}` : 'Find a coffee spot nearby';
    if (/park|garden|walk|stroll/.test(title)) return place ? `Head to ${place} for a walk` : 'Go for a walk nearby';
    if (/museum|gallery|art/.test(title)) return place ? `Visit ${place}` : 'Visit something nearby';
    if (/food|eat|restaurant|bar/.test(title)) return place ? `Eat at ${place}` : 'Grab a bite nearby';
    if (/run|jog/.test(title)) return place ? `Go for a run at ${place}` : 'Go for a run';
    if (place) return `Head to ${place}`;
    return `Go: ${suggestion.title}`;
  }

  // AT_HOME
  if (/workout|exercise|cardio|dance/.test(title)) return 'Get moving right now';
  if (/cook|meal|prep/.test(title)) return 'Get cooking';
  if (/clean|tidy|declutter/.test(title)) return 'Make your space feel better';
  if (/read|journal|breathe/.test(title)) return 'Give yourself a break';
  if (/focus|sprint|learn|study/.test(title)) return 'Start a focused sprint';
  if (/stretch|yoga|meditat/.test(title)) return 'Loosen up and feel better';
  if (/draw|sketch|paint|craft|creative|write|music|play|knit|garden/.test(title)) return 'Get creative';
  if (/organiz|plan|sort|budget/.test(title)) return 'Get organized';
  if (/bath|shower|skincare|self.?care/.test(title)) return 'Treat yourself';
  if (/podcast|watch|movie|show|listen/.test(title)) return 'Sit back and enjoy';
  if (/puzzle|game|chess/.test(title)) return 'Challenge your brain';
  return `Start: ${suggestion.title}`;
};

/** Current time-of-day bucket */
const currentTimeOfDay = (now = new Date(), timeZone?: string | null): HabitTimeOfDay => {
  const tzParts = getTimeZoneParts(now, timeZone ?? getPreferredTimeZone());
  const hour = tzParts.hour;
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'any';
};

/** Is it currently late night (21:00–05:00)? */
const isLateNight = (now = new Date(), timeZone?: string | null): boolean => {
  const tzParts = getTimeZoneParts(now, timeZone ?? getPreferredTimeZone());
  const hour = tzParts.hour;
  return hour >= 21 || hour < 5;
};

/** Strict time-of-day rules for activity types to prevent poor recommendations like "coffee at 6pm" */
const isAppropriateTimeOfDay = (suggestion: Suggestion, now = new Date()): boolean => {
  const hour = now.getHours();
  const title = suggestion.title.toLowerCase();
  const tags = suggestion.tags?.map((t) => t.toLowerCase()) ?? [];
  
  // Coffee/café activities: only 9-17 (breakfast, mid-morning, lunch, afternoon)
  if (tags.includes('coffee') || /coffee|cafe|caffeine|espresso|latte/.test(title)) {
    return hour >= 9 && hour < 18;
  }
  
  // Breakfast activities: only morning (5-12)
  if (/breakfast|brunch|morning meal/.test(title)) {
    return hour >= 5 && hour < 12;
  }
  
  // Lunch activities: 11:30-15:00
  if (/lunch|midday meal|noon/.test(title)) {
    return hour >= 11 && hour < 15;
  }
  
  // Dinner activities: 17:00-22:00
  if (/dinner|supper|evening meal/.test(title)) {
    return hour >= 17 && hour < 22;
  }
  
  // Late-night social (bars, clubs): only 19:00-02:00
  if (/bar|pub|club|nightclub|nightlife|drinks/.test(title) || tags.includes('social')) {
    if (tags.includes('coffee') || tags.includes('wellness')) return false; // unless also marked as wellness
    return hour >= 19 || hour < 3;
  }
  
  // Workouts: morning (5-12) or evening (17-21)
  if (/workout|fitness|gym|exercise/.test(title) || tags.includes('fitness')) {
    return (hour >= 5 && hour < 12) || (hour >= 17 && hour < 21);
  }
  
  // All others pass (time-of-day is more flexible)
  return true;
};

/** Tags that indicate outdoor / going-out activities unsuitable for late night */
const NIGHT_UNFRIENDLY_TAGS = new Set([
  'fitness', 'running', 'cycling', 'hiking', 'swimming', 'nature',
  'explore', 'parks', 'beaches', 'coffee', 'food', 'street_food',
  'sports', 'outdoor',
]);

/** Filter curated suggestions to those matching the current time-of-day (or 'any') */
const filterByTimeOfDay = (suggestions: Suggestion[], now = new Date(), timeZone?: string | null): Suggestion[] => {
  const tod = currentTimeOfDay(now, timeZone);
  const lateNight = isLateNight(now, timeZone);

  const matched = suggestions.filter((s) => {
    // Basic time-of-day filtering
    const todMatch = !s.timeOfDay || s.timeOfDay === 'any' || s.timeOfDay === tod;
    if (!todMatch) return false;

    // Strict activity-type time-of-day rules (e.g., coffee only 9-18)
    if (!isAppropriateTimeOfDay(s, now)) return false;

    // Late-night filtering: exclude outdoor/café activities
    if (lateNight) {
      // GO_OUT activities are generally not appropriate at night,
      // except those explicitly tagged as evening (night walks, stargazing, etc.)
      if (s.type === 'GO_OUT') {
        if (s.timeOfDay === 'evening') return true;
        return false;
      }
      // Even AT_HOME activities with outdoor-ish tags should be filtered
      if (s.tags?.some((tag) => NIGHT_UNFRIENDLY_TAGS.has(tag))) return false;
    }

    return true;
  });

  // If too few match, fall back to all (but still exclude GO_OUT at night)
  if (matched.length >= 3) return matched;
  if (lateNight) {
    const relaxed = suggestions.filter((s) => s.type !== 'GO_OUT');
    return relaxed.length >= 3 ? relaxed : suggestions;
  }
  return suggestions;
};

const computeClosingBuffer = (arrivalDelay: number, durationMin: number) => {
  const total = arrivalDelay + durationMin;
  return Math.min(20, Math.max(5, Math.ceil(total * 0.1)));
};
const EMOJI_BY_TAG: Record<string, string[]> = {
  fitness: ['💪', '🏃'],
  cycling: ['🚴', '💪'],
  running: ['🏃', '💨'],
  swimming: ['🏊', '💦'],
  hiking: ['🥾', '⛰️'],
  wellness: ['🧘', '🌿'],
  nature: ['🌿', '🌤️'],
  beaches: ['🏖️', '🌊'],
  parks: ['🌳', '🌿'],
  art: ['🎨', '🖼️'],
  music: ['🎵', '🎤'],
  movies: ['🎬', '🍿'],
  food: ['🍽️', '🍜'],
  street_food: ['🌮', '🍢'],
  coffee: ['☕', '🧁'],
  learning: ['📚', '🧠'],
  focus: ['🎯', '🧘'],
  productivity: ['⚡', '📋'],
  social: ['🫶', '👥'],
  explore: ['🧭', '✨'],
};
const EMOJI_BY_TYPE: Record<SuggestionType, string[]> = {
  AT_HOME: ['🏠', '✨'],
  GO_OUT: ['🚶', '📍'],
  EVENT: ['🎟️', '🎉'],
};
const EMOJI_RULES: { regex: RegExp; emojis: string[] }[] = [
  { regex: /(coffee|cafe)/, emojis: ['☕'] },
  { regex: /(walk|stroll)/, emojis: ['🚶'] },
  { regex: /(run|jog)/, emojis: ['🏃'] },
  { regex: /(yoga|stretch|breath|meditation)/, emojis: ['🧘'] },
  { regex: /(cook|meal|recipe)/, emojis: ['🍳'] },
  { regex: /(gallery|museum|art)/, emojis: ['🎨'] },
  { regex: /(music|concert|dj|live)/, emojis: ['🎵'] },
  { regex: /(movie|cinema|film|screening)/, emojis: ['🎬'] },
  { regex: /(park|garden|beach|trail|reserve)/, emojis: ['🌿'] },
  { regex: /(sunset|view|lookout)/, emojis: ['🌅'] },
  { regex: /(workout|gym|fitness)/, emojis: ['💪'] },
  { regex: /(study|learn|read|focus)/, emojis: ['📚'] },
];

const inferTags = (suggestion: Suggestion): Suggestion => {
  if (suggestion.tags?.length) return suggestion;
  const text = `${suggestion.title} ${suggestion.description}`.toLowerCase();
  const tags: string[] = [];
  const add = (tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  if (/(walk|park|garden|beach|outdoor|view|reserve)/.test(text)) {
    add('nature');
    add('explore');
  }
  if (/(beach|surf|swim|ocean|coast|shore)/.test(text)) add('beaches');
  if (/(park|garden|trail|reserve)/.test(text)) add('parks');
  if (/(gallery|museum|art|exhibit)/.test(text)) add('art');
  if (/(coffee|cafe)/.test(text)) add('coffee');
  if (/(food|cook|meal|dining|restaurant)/.test(text)) add('food');
  if (/(street.?food|food.?truck|market|hawker)/.test(text)) add('street_food');
  if (/(workout|yoga|stretch|run|cardio|dance)/.test(text)) add('fitness');
  if (/(cycle|cycling|bike|biking)/.test(text)) add('cycling');
  if (/(run|jog|sprint)/.test(text)) add('running');
  if (/(swim|pool|laps)/.test(text)) add('swimming');
  if (/(hike|hiking|trek|trail)/.test(text)) add('hiking');
  if (/(meditation|breath|calm|wellness)/.test(text)) add('wellness');
  if (/(learn|lesson|class|study|focus)/.test(text)) {
    add('learning');
    add('focus');
  }
  if (/(music|jazz|concert|live)/.test(text)) add('music');
  if (/(film|cinema|screening|movie)/.test(text)) add('movies');
  if (/(social|community|meet)/.test(text)) add('social');
  if (tags.length) {
    return { ...suggestion, tags };
  }
  return suggestion;
};

const attachEmojis = (suggestion: Suggestion): Suggestion => {
  if (suggestion.emojis?.length) return suggestion;
  const emojis: string[] = [];
  const add = (emoji: string) => {
    if (!emojis.includes(emoji)) emojis.push(emoji);
  };
  const text = `${suggestion.title} ${suggestion.description}`.toLowerCase();
  EMOJI_RULES.forEach((rule) => {
    if (rule.regex.test(text)) {
      rule.emojis.forEach(add);
    }
  });
  (suggestion.tags || []).forEach((tag) => {
    (EMOJI_BY_TAG[tag] || []).forEach(add);
  });
  EMOJI_BY_TYPE[suggestion.type].forEach(add);
  if (emojis.length < 2) {
    ['✨', '⭐'].forEach(add);
  }
  return { ...suggestion, emojis: emojis.slice(0, 3) };
};

const withSource = (suggestion: Suggestion, source: Suggestion['source']): Suggestion => {
  if (suggestion.source) return suggestion;
  return { ...suggestion, source };
};

/* ── Venue enrichment ────────────────────────────────────────── */

/**
 * Content-aware keyword → venue-type mapping.
 * Instead of mapping broad activity tags ("fitness") to place categories,
 * we look at the activity's TITLE and DESCRIPTION to determine what kind
 * of venue it actually needs. This prevents e.g. "Park walk" (tagged fitness)
 * being matched to a gym.
 */
/** Sub-tag → parent mapping so selecting 'cycling' also matches 'fitness' cards */
const TAG_PARENTS: Record<string, string[]> = {
  cycling: ['fitness'],
  running: ['fitness'],
  swimming: ['fitness'],
  hiking: ['fitness', 'nature'],
  beaches: ['nature', 'explore'],
  parks: ['nature'],
  street_food: ['food'],
};

const matchesInterest = (suggestion: Suggestion, prefs: UserPrefs): boolean => {
  if (prefs.allowSerendipity) return true;
  if (!prefs.interestTags.length) return true;
  if (!suggestion.tags?.length) return false;
  // Build an expanded set of user interests including parent tags
  const expanded = new Set(prefs.interestTags);
  for (const tag of prefs.interestTags) {
    const parents = TAG_PARENTS[tag];
    if (parents) parents.forEach((p) => expanded.add(p));
  }
  return suggestion.tags.some((tag) => expanded.has(tag));
};

const enrichSuggestion = (
  suggestion: Suggestion,
  availability: Availability,
  location: LocationState,
): DeckSuggestion => {
  const meta: SuggestionMeta = {};
  const now = new Date();
  const availabilityEnd = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);

  if (location.lat && location.lng && suggestion.place?.lat && suggestion.place?.lng) {
    const distanceKm = haversineKm(location.lat, location.lng, suggestion.place.lat, suggestion.place.lng);
    const mode = chooseTravelMode(distanceKm);
    const etaMin = estimateEtaMinutes(distanceKm, mode);
    meta.distanceKm = distanceKm;
    meta.etaMin = etaMin;

    if (suggestion.type === 'EVENT' && suggestion.event?.startAt) {
      const startAt = new Date(suggestion.event.startAt);
      meta.startInMin = minutesBetween(now, startAt);
      const leaveBy = estimateDeparture(startAt, distanceKm);
      meta.leaveBy = leaveBy.toISOString();
    }

    if (suggestion.type === 'GO_OUT') {
      // For GO_OUT: user needs to arrive, spend time, and get back before availability ends.
      // Leave by = availability end - activity duration - return travel, clamped to now.
      const latestArrival = addMinutes(availabilityEnd, -(suggestion.durationMin + BUFFER_MIN));
      let leaveBy = estimateDeparture(latestArrival, distanceKm);
      if (leaveBy.getTime() < now.getTime()) {
        leaveBy = now;
      }
      meta.leaveBy = leaveBy.toISOString();
    }
  }

  if (suggestion.type === 'EVENT' && suggestion.event?.startAt && !meta.startInMin) {
    const startAt = new Date(suggestion.event.startAt);
    meta.startInMin = minutesBetween(now, startAt);
  }
  if (suggestion.openStatus) {
    meta.openStatus = suggestion.openStatus;
  }
  if (typeof suggestion.opensInMin === 'number') {
    meta.opensInMin = suggestion.opensInMin;
  }
  if (typeof suggestion.closesInMin === 'number') {
    meta.closesInMin = suggestion.closesInMin;
  }

  return { ...suggestion, meta };
};

const isFeasible = (
  suggestion: DeckSuggestion,
  availability: Availability,
  location: LocationState,
  now: Date = new Date(),
): boolean => {
  const availabilityEnd = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);
  
  // Check for upcoming event within next 10 minutes
  let effectiveDurationMin = availability.durationMin;
  if (availability.nextEventStartAt) {
    const nextEventStart = fromISO(availability.nextEventStartAt);
    if (nextEventStart) {
      const minutesUntilEvent = Math.round((nextEventStart.getTime() - now.getTime()) / 60000);
      if (minutesUntilEvent <= 10 && minutesUntilEvent > 0) {
        // Tight window: only allow very short activities (fit within remaining time)
        effectiveDurationMin = Math.max(3, minutesUntilEvent - 2);
      }
    }
  }
  
  const durationMin = suggestion.durationMin;

  if (suggestion.type === 'AT_HOME') {
    return durationMin <= effectiveDurationMin;
  }

  if (!location.lat || !location.lng) {
    if (suggestion.type === 'GO_OUT') {
      return durationMin <= effectiveDurationMin;
    }
    if (suggestion.type === 'EVENT' && suggestion.event?.startAt) {
      const startAt = new Date(suggestion.event.startAt);
      return startAt <= availabilityEnd && startAt >= now && !!suggestion.event.ticketUrl;
    }
    return false;
  }

  const eta = suggestion.meta?.etaMin ?? 0;

  if (suggestion.type === 'GO_OUT') {
    const openDelay = suggestion.meta?.openStatus === 'opens_soon' && suggestion.meta.opensInMin
      ? suggestion.meta.opensInMin
      : 0;
    const arrivalDelay = Math.max(eta, openDelay);
    const required = arrivalDelay + durationMin + BUFFER_MIN;
    if (required > effectiveDurationMin) return false;
    if (suggestion.meta?.closesInMin !== undefined) {
      const closingBuffer = computeClosingBuffer(arrivalDelay, durationMin);
      return arrivalDelay + durationMin + closingBuffer <= suggestion.meta.closesInMin;
    }
    return true;
  }

  if (suggestion.type === 'EVENT' && suggestion.event?.startAt) {
    const startAt = new Date(suggestion.event.startAt);
    const earliest = addMinutes(now, eta + BUFFER_MIN);
    
    // STRICT CHECK: Event must start in FUTURE, allow enough travel time, and end before availability
    if (startAt < earliest) return false; // Can't reach in time
    if (startAt > availabilityEnd) return false; // Event starts after available window
    if (!suggestion.event.ticketUrl) return false; // Must have booking link
    
    // Additional validation: event must be within the next 3 hours to feel "urgent"
    // unless user has a lot of time (>120 min) in which case we're more flexible
    const minutesUntilStart = minutesBetween(now, startAt);
    if (minutesUntilStart > Math.min(180, availability.durationMin + 30)) {
      // Event is too far away unless user specifically has time
      return availability.durationMin > 120;
    }
    
    return true;
  }

  return false;
};

const scoreSuggestion = (
  suggestion: DeckSuggestion,
  prefs: UserPrefs,
  availability: Availability,
  history: HistoryState,
  weather: WeatherInfo | null,
  tagAff: TagAffinities = {},
  locProfile: LocationProfile | null = null,
): number => {
  const feasibility = 1;

  // Weather-aware effort matching
  let effortMatch: number;
  if (weather && weather.indoorBias > 0.4) {
    // Bad weather: favour AT_HOME
    effortMatch = suggestion.type === 'AT_HOME' ? 1 : 0.4;
  } else if (weather && weather.indoorBias < 0.15) {
    // Great weather: favour going out (if user is open to it)
    effortMatch = suggestion.type === 'AT_HOME'
      ? (prefs.openToGoingOut ? 0.5 : 0.9)
      : (prefs.openToGoingOut ? 1 : 0.4);
  } else {
    effortMatch = suggestion.type === 'AT_HOME'
      ? (prefs.openToGoingOut ? 0.6 : 1)
      : (prefs.openToGoingOut ? 1 : 0.4);
  }

  const novelty = prefs.allowSerendipity
    ? 1
    : history.lastRejectedIds.includes(suggestion.id)
      ? 0.2
      : history.lastAcceptedIds.includes(suggestion.id)
        ? 0.1
        : 1;
  const distanceScore = suggestion.meta?.etaMin
    ? clamp(1 - suggestion.meta.etaMin / 60, 0.2, 1)
    : 0.6;
  const ratingScore = suggestion.rating
    ? clamp(suggestion.rating / 5, 0.2, 1)
    : 0.6;
  const convenience = suggestion.type === 'GO_OUT'
    ? clamp(distanceScore * 0.6 + ratingScore * 0.4, 0, 1)
    : distanceScore;
  const openNowBonus = suggestion.type === 'GO_OUT'
    ? suggestion.meta?.openStatus === 'open_now'
      ? 0.05
      : suggestion.meta?.openStatus === 'opens_soon'
        ? -0.03
        : 0
    : 0;
  const windowMinutes = Math.max(availability.durationMin, 1);
  const startImmediacy = suggestion.type === 'EVENT' && suggestion.meta?.startInMin
    ? clamp(1 - suggestion.meta.startInMin / windowMinutes, 0, 1)
    : 0.5;
  
  // ── URGENCY SCORING: Events starting very soon get massive boost ──
  // This ensures "Trivia at Tony's Bar TONIGHT at 8:30pm" beats generic "go to a bar" suggestions
  let urgencyBoost = 0;
  if (suggestion.type === 'EVENT' && suggestion.meta?.startInMin !== undefined) {
    const minutesUntil = suggestion.meta.startInMin;
    // Events in next 30 min: massive urgency boost
    if (minutesUntil <= 30) {
      urgencyBoost = 0.25;
    }
    // Events in next 60 min: strong boost
    else if (minutesUntil <= 60) {
      urgencyBoost = 0.15;
    }
    // Events in next 2 hours: moderate boost
    else if (minutesUntil <= 120) {
      urgencyBoost = 0.08;
    }
    // Events farther away: small boost based on proximity
    else {
      urgencyBoost = Math.max(0, 0.03 - (minutesUntil - 120) / 1000);
    }
  }
  
  const interestMatch = prefs.allowSerendipity
    ? 1
    : !prefs.interestTags.length
      ? 0.6
      : suggestion.tags?.some((tag) => prefs.interestTags.includes(tag))
        ? 1
        : 0.2;
  const confidence = suggestion.confidence;
  const habitBoost = suggestion.source === 'habit' ? 0.12 : 0;
  const geminiBoost = suggestion.source === 'gemini' ? GEMINI_SOURCE_BOOST : 0;

  // ── Late-night penalty for outdoor / go-out activities ──
  const now = new Date();
  let nightPenalty = 0;
  if (isLateNight(now)) {
    if (suggestion.type === 'GO_OUT' || suggestion.type === 'EVENT') {
      nightPenalty = -0.25;
    } else if (suggestion.tags?.some((tag) => NIGHT_UNFRIENDLY_TAGS.has(tag))) {
      nightPenalty = -0.15;
    }
  }

  // ── Learned affinity from swipe history ──
  const hasAffinityData = Object.keys(tagAff).length > 0;
  const learnedAffinity = hasAffinityData
    ? affinityScore(tagAff, suggestion.tags)
    : 0.5; // neutral when no data yet
  const typeAff = hasAffinityData
    ? typeAffinityScore(tagAff, suggestion.type)
    : 0.5;

  // ── Location profile boost ──
  let locationBoost = 0;
  if (locProfile && suggestion.tags) {
    for (const tag of suggestion.tags) {
      locationBoost += locProfile.boosts[tag] ?? 0;
    }
    locationBoost = Math.min(locationBoost, 0.15); // cap total boost
  }

  const weighted =
    feasibility * 0.25 +
    effortMatch * 0.15 +
    novelty * 0.12 +
    convenience * 0.10 +
    startImmediacy * 0.05 +
    confidence * 0.03 +
    interestMatch * 0.05 +
    learnedAffinity * 0.15 +
    typeAff * 0.05 +
    openNowBonus +
    habitBoost +
    geminiBoost +
    nightPenalty +
    locationBoost +
    urgencyBoost;

  return weighted;
};

/** Get the primary interest tag for a suggestion (first tag, or its type as fallback) */
const primaryTag = (s: DeckSuggestion): string =>
  s.tags?.[0] ?? s.type.toLowerCase();

/**
 * Build a variety-maximised deck by:
 * 1. Grouping scored candidates by their primary interest tag
 * 2. Within each group, sorting nearest → farthest (closeness first)
 * 3. Round-robin picking across groups so no single category dominates
 *
 * This ensures e.g. with interests [coffee, art, nature] you get:
 *   nearest café → nearest museum → nearest park → 2nd café → 2nd museum
 * instead of 5 cafés.
 */
const buildInterleavedDeck = (
  scored: { item: DeckSuggestion; score: number }[],
  deckSize: number,
): DeckSuggestion[] => {
  // ── 1. Group by primary tag ──
  const groups = new Map<string, { item: DeckSuggestion; score: number }[]>();
  for (const entry of scored) {
    const tag = primaryTag(entry.item);
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push(entry);
  }

  // ── 2. Within each group: sort by distance (nearest first), break ties by score ──
  for (const [, group] of groups) {
    group.sort((a, b) => {
      const distA = a.item.meta?.distanceKm ?? 999;
      const distB = b.item.meta?.distanceKm ?? 999;
      if (Math.abs(distA - distB) > 0.05) return distA - distB; // nearest first
      return b.score - a.score; // tie-break by score
    });
  }

  // ── 3. Order groups by their best score so the most relevant categories go first ──
  const sortedGroups = Array.from(groups.entries())
    .map(([tag, items]) => ({ tag, items, bestScore: Math.max(...items.map((i) => i.score)) }))
    .sort((a, b) => b.bestScore - a.bestScore);

  // ── 4. Round-robin pick across groups ──
  const deck: DeckSuggestion[] = [];
  const usedIds = new Set<string>();
  const cursors = new Map<string, number>();
  sortedGroups.forEach((g) => cursors.set(g.tag, 0));

  // Also enforce max 2 of same type (AT_HOME/GO_OUT/EVENT) for type variety
  const typeCounts = new Map<string, number>();
  const maxPerType = Math.min(3, deckSize);

  let stalled = 0;
  while (deck.length < deckSize && stalled < sortedGroups.length) {
    stalled = 0;
    for (const group of sortedGroups) {
      if (deck.length >= deckSize) break;
      const cursor = cursors.get(group.tag) ?? 0;

      // Find next unused candidate in this group
      let picked = false;
      for (let i = cursor; i < group.items.length; i++) {
        const candidate = group.items[i].item;
        if (usedIds.has(candidate.id)) continue;
        const tc = typeCounts.get(candidate.type) ?? 0;
        if (tc >= maxPerType) continue; // skip if type is saturated
        deck.push(candidate);
        usedIds.add(candidate.id);
        typeCounts.set(candidate.type, tc + 1);
        cursors.set(group.tag, i + 1);
        picked = true;
        break;
      }
      if (!picked) {
        stalled++;
        // Advance cursor past end so we don't retry
        cursors.set(group.tag, group.items.length);
      }
    }
  }

  return deck;
};

/** Race a promise against a timeout — returns fallback on timeout */
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

const API_TIMEOUT_MS = 2500; // keep total deck build under 3s

const seedSuggestions = async (
  availability: Availability,
  location: LocationState,
  prefs: UserPrefs,
  habits: Habit[],
  apiTimeoutMs = API_TIMEOUT_MS,
  nowOverride?: Date,
): Promise<Suggestion[]> => {
  const now = nowOverride ?? new Date();
  const habitSuggestions = habits
    .filter((habit) => isHabitDue(habit, now) && matchesTimeOfDay(habit, now))
    .map((habit) => attachEmojis(habitToSuggestion(habit)))
    .map((item) => markRepetitionFriendly(item)); // Mark habits as repetition-friendly

  const curated = prefs.openToGoingOut
    ? [...atHomeSuggestions, ...goOutSuggestions]
    : [...atHomeSuggestions];

  // Filter curated by time-of-day relevance
  const timeFiltered = filterByTimeOfDay(curated, now, location.timeZone);

  const inferredCurated = timeFiltered
    .map((item) => withSource(inferTags(item), 'curated'))
    .map((item) => attachEmojis(item))
    .map((item) => item.type === 'AT_HOME' ? markRepetitionFriendly(item) : item); // Mark AT_HOME as repetition-friendly
  const filteredCurated = inferredCurated.filter((item) => matchesInterest(item, prefs));
  const curatedResult = filteredCurated.length ? filteredCurated : inferredCurated;
  
  if (prefs.openToGoingOut && location.lat && location.lng) {
    // Fetch events from Ticketmaster only
    const ticketmaster = await withTimeout(
      fetchTicketmasterSuggestions(location, prefs, availability).catch(() => []),
      apiTimeoutMs,
      []
    );
    let inferredEvents = ticketmaster.map((item) => attachEmojis(inferTags(item)));
    const filteredEvents = inferredEvents.filter((item) => matchesInterest(item, prefs));
    let eventResult = filteredEvents.length ? filteredEvents : inferredEvents;

    // If the requested availability is for another calendar day (e.g., 'tomorrow'),
    // enforce strict day-locking: only include events that start on that same day.
    const planningForOtherDay = !isSameCalendarDayInTimeZone(now, new Date(), location.timeZone);
    if (planningForOtherDay) {
      eventResult = eventResult.filter((e) => {
        const start = e.event?.startAt ? new Date(e.event.startAt) : null;
        if (!start) return false;
        return isSameCalendarDayInTimeZone(start, now, location.timeZone);
      });
    }

    return [
      ...habitSuggestions,
      ...curatedResult,
      ...eventResult,
    ];
  }
  return [...habitSuggestions, ...curatedResult];
};

const DECK_SIZE = 5;

/**
 * Build a deck of DECK_SIZE suggestions.
 * @param apiTimeoutMs – timeout for external API calls.
 *   Defaults to 2.5 s for user-facing builds.
 *   Pass a higher value (e.g. 15 000) for background preloads
 *   so the APIs have time to respond.
 * @param filter – optional filter for rubric-specific suggestions
 *   ('go_out', 'productive', 'at_home')
 */
export const buildDeck = async (
  availability: Availability,
  location: LocationState,
  prefs: UserPrefs,
  history: HistoryState,
  habits: Habit[],
  apiTimeoutMs = API_TIMEOUT_MS,
  tagAff: TagAffinities = {},
  locProfile: LocationProfile | null = null,
  filter?: string,
  savedSuggestions: SavedSuggestion[] = [],
  nowOverride?: Date,
): Promise<{ deck: DeckSuggestion[]; usedFallback: boolean }> => {
  console.log('[buildDeck] START', { durationMin: availability.durationMin, apiTimeoutMs, filter });
  const now = nowOverride ?? new Date();
  // Fetch weather in parallel with suggestions (non-blocking, with timeout)
  const weatherPromise = location.lat && location.lng
    ? withTimeout(fetchWeather(location.lat, location.lng).catch(() => null), apiTimeoutMs, null)
    : Promise.resolve(null);
  const businessCatalogPromise = location.lat && location.lng
    ? withTimeout(loadFirebaseBusinesses(40).catch(() => []), Math.min(apiTimeoutMs, 1800), [] as Business[])
    : Promise.resolve([] as Business[]);

  const baseCandidatesPromise = seedSuggestions(availability, location, prefs, habits, apiTimeoutMs, now);
  const topPositiveTags = Object.entries(tagAff)
    .filter(([tag, score]) => !tag.startsWith('__type_') && score > 0.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);
  const topSavedTitles = savedSuggestions.slice(0, 6).map((s) => s.suggestion.title);
  const learning: GeminiLearningContext = {
    filter,
    lifestyle: prefs.lifestyle,
    selfDescription: prefs.selfDescription,
    customInterests: prefs.customInterests,
    topPositiveTags,
    topSavedTitles,
  };

  const geminiCandidatesPromise = weatherPromise.then((weather) => withTimeout(
    fetchGeminiSuggestions(location, prefs, availability, weather, learning).catch(() => []),
    apiTimeoutMs,
    [],
  ));

  const [baseCandidates, weather, geminiCandidates, firebaseBusinesses] = await Promise.all([
    baseCandidatesPromise,
    weatherPromise,
    geminiCandidatesPromise,
    businessCatalogPromise,
  ]);
  const candidates = [...baseCandidates, ...geminiCandidates];
  console.log('[buildDeck] candidates:', candidates.length, 'weather:', weather ? 'yes' : 'no');

  const enriched = candidates.map((item) => enrichSuggestion(item, availability, location));
  const uniqueMap = new Map<string, DeckSuggestion>();
  const normalize = (value?: string) => (value ?? '').trim().toLowerCase();
  for (const item of enriched) {
    let key = item.id;
    if (item.type === 'EVENT' && item.event?.startAt) {
      key = `${normalize(item.title)}_${normalize(item.event.venue)}_${item.event.startAt}`;
    } else if (item.place?.lat && item.place?.lng) {
      key = `${normalize(item.title)}_${item.place.lat.toFixed(4)}_${item.place.lng.toFixed(4)}`;
    }
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, item);
    }
  }
  const unique = Array.from(uniqueMap.values());
  const feasible = unique.filter((item) => isFeasible(item, availability, location, now));
  console.log('[buildDeck] unique:', unique.length, 'feasible:', feasible.length);

  // Smart repetition filter: allows habit-friendly activities to repeat every 72+ hours
  // This enables actual habit formation (was impossible with hard "never repeat" filter)
  const fresh = filterForHabitRepetition(feasible, history, now);
  console.log('[buildDeck] after repetition filter:', fresh.length);

  // Track originally-seen IDs for fallback pass (after smart filter is applied)
  const originallySeenIds = new Set([
    ...(history.lastShownIds ?? []),
    ...history.lastRejectedIds,
    ...history.lastAcceptedIds,
  ]);

  const scored = fresh
    .map((item) => ({ item, score: scoreSuggestion(item, prefs, availability, history, weather, tagAff, locProfile) }));

  // Build deck with category interleaving: groups by primary tag,
  // sorts nearest→farthest within each group, then round-robins
  // across categories for maximum variety.
  const deck: DeckSuggestion[] = buildInterleavedDeck(scored, DECK_SIZE);

  const ensureMinGemini = (target: DeckSuggestion[], allScored: { item: DeckSuggestion; score: number }[]) => {
    const currentGemini = target.filter((item) => item.source === 'gemini').length;
    if (currentGemini >= MIN_GEMINI_IN_DECK) return;

    const missing = MIN_GEMINI_IN_DECK - currentGemini;
    const targetIds = new Set(target.map((x) => x.id));
    const geminiPool = allScored
      .filter((entry) => entry.item.source === 'gemini' && !targetIds.has(entry.item.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, missing)
      .map((entry) => entry.item);

    if (!geminiPool.length) return;

    for (const geminiItem of geminiPool) {
      let replaceIdx = -1;
      let worstScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < target.length; i++) {
        const candidate = target[i];
        if (candidate.source === 'gemini') continue;
        const score = allScored.find((entry) => entry.item.id === candidate.id)?.score ?? 999;
        if (score < worstScore) {
          worstScore = score;
          replaceIdx = i;
        }
      }
      if (replaceIdx >= 0) {
        target[replaceIdx] = geminiItem;
      }
    }
  };
  ensureMinGemini(deck, scored);
  let usedFallback = false;
  console.log('[buildDeck] after interleaved build:', deck.length);

  // Pass 3: pull from fallback pool (also excluding originally-seen IDs)
  if (deck.length < DECK_SIZE) {
    const deckIds = new Set(deck.map((item) => item.id));
    const allExcluded = new Set([...originallySeenIds, ...deckIds]);
    const fallbackPool = fallbackSuggestions
      .map((item) => attachEmojis(inferTags(item)))
      .map((item) => enrichSuggestion(item, availability, location))
      .filter((item) => isFeasible(item, availability, location, now))
      .filter((item) => !allExcluded.has(item.id));
    console.log('[buildDeck] fallback pool size (pass 3):', fallbackPool.length);
    for (const candidate of fallbackPool) {
      if (deck.length >= DECK_SIZE) break;
      deck.push(candidate);
      usedFallback = true;
    }
  }
  console.log('[buildDeck] after pass 3:', deck.length);

  // Pass 4: if STILL under DECK_SIZE, allow previously-seen fallback cards
  // (absolute last resort — the pool is exhausted)
  if (deck.length < DECK_SIZE) {
    const deckIds = new Set(deck.map((item) => item.id));
    const lastResort = fallbackSuggestions
      .map((item) => attachEmojis(inferTags(item)))
      .map((item) => enrichSuggestion(item, availability, location))
      .filter((item) => isFeasible(item, availability, location, now))
      .filter((item) => !deckIds.has(item.id));
    console.log('[buildDeck] last resort pool (pass 4):', lastResort.length);
    for (const candidate of lastResort) {
      if (deck.length >= DECK_SIZE) break;
      deck.push(candidate);
      usedFallback = true;
    }
  }
  console.log('[buildDeck] after pass 4:', deck.length);

  // Pass 5: NUCLEAR fallback — skip feasibility entirely.
  // This guarantees the user ALWAYS gets a full deck.
  if (deck.length < DECK_SIZE) {
    const deckIds = new Set(deck.map((item) => item.id));
    const nuclear = fallbackSuggestions
      .filter((item) => item.type === 'AT_HOME') // AT_HOME never needs location/travel
      .map((item) => attachEmojis(inferTags(item)))
      .map((item) => enrichSuggestion(item, availability, location))
      .filter((item) => !deckIds.has(item.id));
    console.log('[buildDeck] nuclear fallback pool (pass 5):', nuclear.length);
    for (const candidate of nuclear) {
      if (deck.length >= DECK_SIZE) break;
      deck.push(candidate);
      usedFallback = true;
    }
  }
  console.log('[buildDeck] final deck size:', deck.length);

  // ── Business ad injection ──
  // Inject at most one aligned promoted business in lower deck positions.
  if (location.lat && location.lng && deck.length > 0) {
    const businessCatalog = firebaseBusinesses.length ? firebaseBusinesses : buildLocalBusinessCatalog(location);
    const aligned = findAlignedBusinesses(
      businessCatalog,
      location,
      habits,
      Math.max(2, prefs.radiusKm),
      0.45,
      2,
    );

    if (aligned.length) {
      const existingPlaces = new Set(
        deck
          .map((item) => `${(item.place?.name ?? '').toLowerCase()}_${(item.place?.address ?? '').toLowerCase()}`)
          .filter((value) => value !== '_'),
      );

      const candidate = aligned.find((biz) => {
        const key = `${biz.name.toLowerCase()}_${(biz.place.address ?? '').toLowerCase()}`;
        return !existingPlaces.has(key);
      });

      if (candidate) {
        let matchingHabit: Habit | undefined;
        let bestScore = 0;
        for (const habit of habits) {
          const score = calculateBusinessHabitAlignment(candidate, [habit]);
          if (score > bestScore) {
            bestScore = score;
            matchingHabit = habit;
          }
        }
        const promoted = enrichSuggestion(
          attachEmojis(inferTags(businessToSuggestion(candidate, matchingHabit, bestScore))),
          availability,
          location,
        );
        const insertAt = Math.min(3, Math.max(1, deck.length - 1));
        deck.splice(insertAt, 0, promoted);
        if (deck.length > DECK_SIZE) {
          deck.length = DECK_SIZE;
        }
      }
    }
  }

  // Apply dynamic whyNow and auto-generate CTA for every card in the final deck
  const whyNowCtx = { availability, weather, now, habits };
  const finalDeck = deck.slice(0, DECK_SIZE).map((item) => ({
    ...item,
    cta: item.cta ?? generateCta(item),
    whyNow: item.whyNow ?? generateWhyNow(item, whyNowCtx),
  }));

  return { deck: finalDeck, usedFallback };
};

/**
 * Build filter-matching fallback cards to pad a deck that didn’t reach DECK_SIZE.
 * Uses atHome, goOut, and fallback pools, filters them the same way DeckScreen’s
 * filterDeck does, then returns feasible, enriched, CTA-attached cards.
 */
export const buildFilteredFallbacks = (
  filter: string,
  availability: Availability,
  location: LocationState,
  excludeIds: Set<string>,
): DeckSuggestion[] => {
  const allPools: Suggestion[] = [
    ...atHomeSuggestions,
    ...goOutSuggestions,
    ...fallbackSuggestions,
  ];

  const enrichedPool = allPools
    .map((item) => attachEmojis(inferTags(item)))
    .map((item) => enrichSuggestion(item, availability, location))
    .filter((item) => !excludeIds.has(item.id))
    .filter((item) => isFeasible(item, availability, location, now));

  // Apply the same filter logic as DeckScreen.filterDeck
  let filtered: DeckSuggestion[];
  if (filter === 'go_out') {
    filtered = enrichedPool.filter((c) => c.type === 'GO_OUT' || c.type === 'EVENT');
  } else if (filter === 'at_home') {
    filtered = enrichedPool.filter((c) => c.type === 'AT_HOME');
  } else if (filter === 'productive') {
    const prodTags = new Set(['productivity', 'learning', 'creative', 'focus', 'planning', 'work', 'study', 'reading']);
    filtered = enrichedPool.filter((c) => c.tags?.some((t) => prodTags.has(t)));
  } else {
    filtered = enrichedPool;
  }

  // Shuffle so the user doesn’t see the same order every time
  for (let i = filtered.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
  }

  const now = new Date();
  return filtered.slice(0, DECK_SIZE).map((item) => ({
    ...item,
    cta: generateCta(item),
    whyNow: generateWhyNow(item, { availability, weather: null, now, habits: [] }),
  }));
};
