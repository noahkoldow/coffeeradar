import { atHomeSuggestions } from '../data/atHome';
import { curatedEvents } from '../data/events';
import { fallbackSuggestions } from '../data/fallback';
import { goOutSuggestions } from '../data/goOut';
import {
  Availability,
  DeckSuggestion,
  Habit,
  HistoryState,
  LocationState,
  Suggestion,
  SuggestionMeta,
  SuggestionType,
  UserPrefs,
} from '../types';
import { addMinutes, clamp, fromISO, minutesBetween } from '../utils/time';
import { chooseTravelMode, estimateEtaMinutes, haversineKm } from './travel';
import { fetchTicketmasterSuggestions } from './ticketmaster';
import { fetchSeatGeekSuggestions } from './seatgeek';
import { fetchGooglePlacesSuggestions } from './googlePlaces';
import { habitToSuggestion, isHabitDue, matchesTimeOfDay } from '../utils/habits';

const BUFFER_MIN = 10;

const computeClosingBuffer = (arrivalDelay: number, durationMin: number) => {
  const total = arrivalDelay + durationMin;
  return Math.min(20, Math.max(5, Math.ceil(total * 0.1)));
};
const EMOJI_BY_TAG: Record<string, string[]> = {
  fitness: ['💪', '🏃'],
  wellness: ['🧘', '🌿'],
  nature: ['🌿', '🌤️'],
  art: ['🎨', '🖼️'],
  music: ['🎵', '🎤'],
  movies: ['🎬', '🍿'],
  food: ['🍽️', '🍜'],
  coffee: ['☕', '🧁'],
  learning: ['📚', '🧠'],
  focus: ['🎯', '🧘'],
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
  if (/(gallery|museum|art|exhibit)/.test(text)) add('art');
  if (/(coffee|cafe)/.test(text)) add('coffee');
  if (/(food|cook|meal|dining|restaurant)/.test(text)) add('food');
  if (/(workout|yoga|stretch|run|cardio|dance)/.test(text)) add('fitness');
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

const matchesInterest = (suggestion: Suggestion, prefs: UserPrefs): boolean => {
  if (prefs.allowSerendipity) return true;
  if (!prefs.interestTags.length) return true;
  if (!suggestion.tags?.length) return false;
  return suggestion.tags.some((tag) => prefs.interestTags.includes(tag));
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
      const leaveBy = addMinutes(startAt, -(etaMin + BUFFER_MIN));
      meta.leaveBy = leaveBy.toISOString();
    }

    if (suggestion.type === 'GO_OUT') {
      let leaveBy = addMinutes(
        availabilityEnd,
        -(suggestion.durationMin + etaMin + BUFFER_MIN),
      );
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
): boolean => {
  const now = new Date();
  const availabilityEnd = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);
  const durationMin = suggestion.durationMin;

  if (suggestion.type === 'AT_HOME') {
    return durationMin <= availability.durationMin;
  }

  if (!location.lat || !location.lng) {
    if (suggestion.type === 'GO_OUT') {
      return durationMin <= availability.durationMin;
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
    if (required > availability.durationMin) return false;
    if (suggestion.meta?.closesInMin !== undefined) {
      const closingBuffer = computeClosingBuffer(arrivalDelay, durationMin);
      return arrivalDelay + durationMin + closingBuffer <= suggestion.meta.closesInMin;
    }
    return true;
  }

  if (suggestion.type === 'EVENT' && suggestion.event?.startAt) {
    const startAt = new Date(suggestion.event.startAt);
    const earliest = addMinutes(now, eta + BUFFER_MIN);
    return startAt >= earliest && startAt <= availabilityEnd && !!suggestion.event.ticketUrl;
  }

  return false;
};

const scoreSuggestion = (
  suggestion: DeckSuggestion,
  prefs: UserPrefs,
  availability: Availability,
  history: HistoryState,
): number => {
  const feasibility = 1;
  const effortMatch = suggestion.type === 'AT_HOME'
    ? (prefs.openToGoingOut ? 0.6 : 1)
    : (prefs.openToGoingOut ? 1 : 0.4);
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
  const interestMatch = prefs.allowSerendipity
    ? 1
    : !prefs.interestTags.length
      ? 0.6
      : suggestion.tags?.some((tag) => prefs.interestTags.includes(tag))
        ? 1
        : 0.2;
  const confidence = suggestion.confidence;
  const habitBoost = suggestion.source === 'habit' ? 0.12 : 0;

  const weighted =
    feasibility * 0.3 +
    effortMatch * 0.2 +
    novelty * 0.15 +
    convenience * 0.15 +
    startImmediacy * 0.1 +
    confidence * 0.05 +
    interestMatch * 0.05 +
    openNowBonus +
    habitBoost;

  return weighted;
};

const enforceVariety = (deck: DeckSuggestion[], candidate: DeckSuggestion): boolean => {
  const count = deck.filter((item) => item.type === candidate.type).length;
  if (deck.length === 0) return true;
  return count < 3;
};

const seedSuggestions = async (
  availability: Availability,
  location: LocationState,
  prefs: UserPrefs,
  habits: Habit[],
): Promise<Suggestion[]> => {
  const habitSuggestions = habits
    .filter((habit) => isHabitDue(habit) && matchesTimeOfDay(habit))
    .map((habit) => attachEmojis(habitToSuggestion(habit)));

  const curated = prefs.openToGoingOut
    ? [...atHomeSuggestions, ...goOutSuggestions]
    : [...atHomeSuggestions];
  const inferredCurated = curated
    .map((item) => withSource(inferTags(item), 'curated'))
    .map((item) => attachEmojis(item));
  const filteredCurated = inferredCurated.filter((item) => matchesInterest(item, prefs));
  const curatedResult = filteredCurated.length ? filteredCurated : inferredCurated;
  if (prefs.openToGoingOut && location.lat && location.lng) {
    const [ticketmaster, seatgeek, googlePlaces] = await Promise.all([
      fetchTicketmasterSuggestions(location, prefs, availability).catch(() => []),
      fetchSeatGeekSuggestions(location, prefs, availability).catch(() => []),
      fetchGooglePlacesSuggestions(location, prefs, availability).catch(() => []),
    ]);
    const eventCandidates = [...ticketmaster, ...seatgeek];
    const inferredEvents = eventCandidates.map((item) => attachEmojis(inferTags(item)));
    const filteredEvents = inferredEvents.filter((item) => matchesInterest(item, prefs));
    const eventResult = filteredEvents.length ? filteredEvents : inferredEvents;
    const inferredPlaces = googlePlaces.map((item) => attachEmojis(inferTags(item)));
    const filteredPlaces = inferredPlaces.filter((item) => matchesInterest(item, prefs));
    const placeResult = filteredPlaces.length ? filteredPlaces : inferredPlaces;
    const fallbackEvents = curatedEvents
      .map((item) => withSource(inferTags(item), 'curated'))
      .map((item) => attachEmojis(item));
    return [
      ...habitSuggestions,
      ...curatedResult,
      ...placeResult,
      ...(eventResult.length ? eventResult : fallbackEvents),
    ];
  }
  return [...habitSuggestions, ...curatedResult];
};

export const buildDeck = async (
  availability: Availability,
  location: LocationState,
  prefs: UserPrefs,
  history: HistoryState,
  habits: Habit[],
): Promise<{ deck: DeckSuggestion[]; usedFallback: boolean }> => {
  const candidates = await seedSuggestions(availability, location, prefs, habits);
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
  const feasible = unique.filter((item) => isFeasible(item, availability, location));
  const historySet = new Set([...history.lastRejectedIds, ...history.lastAcceptedIds]);
  const filtered = feasible.filter((item) => !historySet.has(item.id));
  const eligible = filtered.length >= Math.min(5, feasible.length) ? filtered : feasible;
  const sorted = eligible
    .map((item) => ({ item, score: scoreSuggestion(item, prefs, availability, history) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  const deck: DeckSuggestion[] = [];
  let usedFallback = false;
  for (const candidate of sorted) {
    if (deck.length >= 5) break;
    if (!enforceVariety(deck, candidate)) continue;
    deck.push(candidate);
  }

  if (deck.length < 5) {
    for (const candidate of sorted) {
      if (deck.length >= 5) break;
      if (deck.find((item) => item.id === candidate.id)) continue;
      deck.push(candidate);
    }
  }

  if (deck.length < 5) {
    const fallbackHistory = new Set([...history.lastAcceptedIds, ...history.lastRejectedIds, ...deck.map((item) => item.id)]);
    const fallbackPool = fallbackSuggestions
      .map((item) => attachEmojis(inferTags(item)))
      .map((item) => enrichSuggestion(item, availability, location))
      .filter((item) => isFeasible(item, availability, location))
      .filter((item) => !fallbackHistory.has(item.id));
    for (const candidate of fallbackPool) {
      if (deck.length >= 5) break;
      deck.push(candidate);
      usedFallback = true;
    }
  }

  if (deck.length === 0) {
    const fallback = enriched.filter((item) => item.type === 'AT_HOME').slice(0, 5);
    const fallbackDeck = fallback.length ? fallback : enriched.slice(0, 5);
    return { deck: fallbackDeck, usedFallback: true };
  }

  return { deck, usedFallback };
};
