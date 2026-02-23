import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { fromISO, minutesBetween } from '../utils/time';
import { fetchOsmSuggestions } from './osmPlaces';
import { addDebugMessage } from './debug';

const GOOGLE_PLACES_KEY = (globalThis as any).process?.env?.EXPO_PUBLIC_GOOGLE_PLACES_KEY;
const NEARBY_URL = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

type NearbyResult = {
  place_id: string;
  name: string;
  vicinity?: string;
  types?: string[];
  geometry?: { location?: { lat: number; lng: number } };
  opening_hours?: { open_now?: boolean };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
};

type PlaceDetails = {
  result?: {
    opening_hours?: {
      open_now?: boolean;
      periods?: { open: { day: number; time: string }; close?: { day: number; time: string } }[];
    };
    formatted_address?: string;
  };
};

const buildUrl = (base: string, params: Record<string, string | number | undefined | null>) => {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${base}?${query}`;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: Suggestion[] }>();
const buildCacheKey = (lat: number, lng: number, radius: number, types: string[]) => {
  const keyTypes = [...types].sort().join(',');
  return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}_${keyTypes}`;
};

const INTEREST_TYPE_MAP: Record<string, string[]> = {
  coffee: ['cafe'],
  food: ['restaurant', 'bakery'],
  art: ['art_gallery', 'museum'],
  music: ['museum', 'tourist_attraction'],
  movies: ['movie_theater'],
  nature: ['park', 'tourist_attraction'],
  wellness: ['spa', 'gym'],
  fitness: ['gym', 'park'],
  learning: ['library', 'book_store'],
  focus: ['library'],
  social: ['bar', 'restaurant'],
  explore: ['tourist_attraction', 'park'],
};

const DEFAULT_TYPES = ['cafe', 'park', 'art_gallery', 'museum', 'library'];

const TYPE_TAG_MAP: Record<string, string> = {
  restaurant: 'food',
  bakery: 'food',
  bar: 'social',
  art_gallery: 'art',
  museum: 'art',
  library: 'learning',
  book_store: 'learning',
  park: 'nature',
  tourist_attraction: 'explore',
  gym: 'fitness',
  spa: 'wellness',
  movie_theater: 'movies',
  cafe: 'coffee', // Keep café last so it doesn't override more specific types
};

/** Ordered priority for picking the "primary" type label — first match wins */
const TYPE_PRIORITY: string[] = [
  'museum', 'art_gallery', 'library', 'book_store', 'movie_theater',
  'park', 'tourist_attraction', 'spa', 'gym',
  'restaurant', 'bakery', 'bar',
  'cafe', // café is last resort
];

const TAG_APPEAL: Record<string, string> = {
  coffee: 'coffee break',
  food: 'bite to eat',
  art: 'art fix',
  nature: 'fresh air',
  explore: 'something new',
  learning: 'quiet focus',
  wellness: 'reset',
  fitness: 'move your body',
  movies: 'a quick movie',
  social: 'easy hang',
};

const estimateDuration = (types: string[] = []): number => {
  if (types.includes('park') || types.includes('tourist_attraction')) return 60;
  if (types.includes('museum') || types.includes('art_gallery')) return 75;
  if (types.includes('library') || types.includes('book_store')) return 60;
  if (types.includes('movie_theater')) return 120;
  if (types.includes('gym') || types.includes('spa')) return 60;
  if (types.includes('restaurant') || types.includes('bakery')) return 45;
  if (types.includes('cafe')) return 40;
  return 45;
};

const parseTime = (time: string): { hours: number; minutes: number } | null => {
  if (!time || time.length < 3) return null;
  const hours = parseInt(time.slice(0, 2), 10);
  const minutes = parseInt(time.slice(2), 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return { hours, minutes };
};

/** Pick the best primary type for a place, using priority order */
const pickPrimaryType = (types: string[]): string | undefined =>
  TYPE_PRIORITY.find((t) => types.includes(t));

const generatePlaceBlurb = (
  name: string,
  types: string[],
  rating?: number,
  ratingCount?: number,
  address?: string,
): string => {
  const primary = pickPrimaryType(types);

  // Per-type blurb templates — each has several variants picked by name hash
  const templates: Record<string, string[]> = {
    cafe: [
      `${name} — a solid coffee spot nearby. Grab a drink, settle in, take a breather.`,
      `Pop into ${name} for a coffee and a change of scenery.`,
      `${name} is the kind of café where you can just sit and let time pass.`,
    ],
    restaurant: [
      `${name} — a great place to sit down for a proper meal nearby.`,
      `Hungry? ${name} has you covered. Sit down, order something good.`,
      `Treat yourself to a meal at ${name}. No cooking, no cleanup.`,
    ],
    bakery: [
      `${name} — fresh baked goods just around the corner.`,
      `Walk into ${name}, pick something warm out of the oven, enjoy.`,
      `Pastries, bread, good smells — that's ${name}.`,
    ],
    bar: [
      `${name} — a chill spot for a drink and some downtime.`,
      `Swing by ${name} for a drink. No plans needed.`,
      `${name} is a good bar to just show up at.`,
    ],
    art_gallery: [
      `${name} — browse some art and let your mind wander.`,
      `Step into ${name} for a quiet dose of culture.`,
      `${name} has exhibits worth seeing. Go look at something beautiful.`,
    ],
    museum: [
      `${name} — spend some time exploring exhibits and learning something new.`,
      `Curious? ${name} has plenty to discover. Give yourself an hour.`,
      `${name} is a great museum to wander through at your own pace.`,
    ],
    library: [
      `${name} — quiet, calm, free Wi-Fi. Perfect for reading or focused work.`,
      `Head to ${name} for some uninterrupted focus time.`,
      `${name} is nearby and ideal for deep reading or study.`,
    ],
    book_store: [
      `${name} — browse shelves, discover something unexpected.`,
      `Walk into ${name} with no plan. Leave with a new book.`,
      `${name} is the kind of bookshop you can lose yourself in.`,
    ],
    park: [
      `${name} — green space, fresh air, room to move or just sit.`,
      `Take a walk through ${name}. Breathe. No agenda.`,
      `${name} is a great spot to stretch your legs or find a bench.`,
    ],
    tourist_attraction: [
      `${name} — something interesting nearby worth checking out.`,
      `Go see ${name}. It's close and you haven't been in a while (or ever).`,
      `${name} is one of those places you keep meaning to visit.`,
    ],
    gym: [
      `${name} — get a workout in and burn off some energy.`,
      `Head to ${name} and move your body for a bit.`,
      `${name} is nearby. Time to sweat.`,
    ],
    spa: [
      `${name} — unwind with some wellness time.`,
      `Treat yourself at ${name}. You could use the reset.`,
      `${name} is a good excuse to slow down and recharge.`,
    ],
    movie_theater: [
      `${name} — see what's playing and catch a screening.`,
      `Movie time at ${name}. Pick something, sit back, enjoy.`,
      `${name} has films showing now. Big screen, no distractions.`,
    ],
  };

  // Simple hash from name to pick a template variant
  const hash = name.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const variants = (primary && templates[primary]) || templates.cafe!;
  const blurb = variants[hash % variants.length];

  const locationHint = address ? ` At ${address.split(',')[0]}.` : '';
  return `${blurb}${locationHint}`;
};

const buildAppeal = (
  tags: string[],
  openStatus: 'open_now' | 'opens_soon' | 'unknown',
  opensInMin?: number,
  rating?: number,
  ratingCount?: number,
) => {
  const openLabel = openStatus === 'open_now'
    ? 'Open now'
    : openStatus === 'opens_soon'
      ? `Opens in ${opensInMin ?? 0}m`
      : 'Nearby';
  const ratingLabel = rating
    ? `Rated ${rating.toFixed(1)}${ratingCount ? ` (${ratingCount})` : ''}`
    : 'Popular nearby';
  const tagLabel = tags.length ? TAG_APPEAL[tags[0]] || tags[0] : 'easy to reach';
  return `${openLabel} - ${ratingLabel} - Great for ${tagLabel}.`;
};

const computeOpenStatus = (
  periods: { open: { day: number; time: string }; close?: { day: number; time: string } }[] | undefined,
  now: Date,
): { openStatus: 'open_now' | 'opens_soon' | 'unknown'; opensInMin?: number; closesInMin?: number } => {
  if (!periods || !periods.length) return { openStatus: 'unknown' };
  const nowDay = now.getDay();
  let nextOpen: Date | null = null;
  let nextClose: Date | null = null;
  for (const period of periods) {
    const openTime = parseTime(period.open.time);
    if (!openTime) continue;
    const open = new Date(now);
    const dayOffset = (period.open.day - nowDay + 7) % 7;
    open.setDate(open.getDate() + dayOffset);
    open.setHours(openTime.hours, openTime.minutes, 0, 0);

    let close: Date | null = null;
    if (period.close?.time) {
      const closeTime = parseTime(period.close.time);
      if (closeTime) {
        close = new Date(now);
        const closeOffset = (period.close.day - nowDay + 7) % 7;
        close.setDate(close.getDate() + closeOffset);
        close.setHours(closeTime.hours, closeTime.minutes, 0, 0);
        if (close <= open) {
          close.setDate(close.getDate() + 1);
        }
      }
    }

    if (close && now >= open && now <= close) {
      return { openStatus: 'open_now', closesInMin: minutesBetween(now, close) };
    }
    if (open >= now && (!nextOpen || open < nextOpen)) {
      nextOpen = open;
      nextClose = close;
    }
  }
  if (!nextOpen) return { openStatus: 'unknown' };
  const opensInMin = minutesBetween(now, nextOpen);
  if (opensInMin <= 60) {
    const closesInMin = nextClose ? minutesBetween(now, nextClose) : undefined;
    return { openStatus: 'opens_soon', opensInMin, closesInMin };
  }
  return { openStatus: 'unknown' };
};

const fetchPlaceDetails = async (placeId: string): Promise<PlaceDetails | null> => {
  if (!GOOGLE_PLACES_KEY) return null;
  const url = buildUrl(DETAILS_URL, {
    key: GOOGLE_PLACES_KEY,
    place_id: placeId,
    fields: 'opening_hours,formatted_address',
  });
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
};

export const fetchGooglePlacesSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  if (!GOOGLE_PLACES_KEY) {
    addDebugMessage('google_places', 'Missing API key. Using OSM fallback.');
    return fetchOsmSuggestions(location, prefs, availability);
  }
  if (!location.lat || !location.lng) return [];

  const radiusKm = Math.max(1, Math.min(prefs.radiusKm || 5, 25));
  const radius = Math.round(radiusKm * 1000);
  const interestTypes = prefs.allowSerendipity
    ? DEFAULT_TYPES
    : Array.from(
      new Set(
        (prefs.interestTags || [])
          .flatMap((tag) => INTEREST_TYPE_MAP[tag] || []),
      ),
    );
  const types = interestTypes.length ? interestTypes : DEFAULT_TYPES;
  const now = new Date();
  const availabilityEnd = fromISO(availability.end) ?? new Date(now.getTime() + availability.durationMin * 60000);

  const cacheKey = buildCacheKey(location.lat, location.lng, radius, types);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const results: NearbyResult[] = [];
  try {
    for (const type of types) {
      const url = buildUrl(NEARBY_URL, {
        key: GOOGLE_PLACES_KEY,
        location: `${location.lat},${location.lng}`,
        radius,
        type,
      });
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data.results)) {
        results.push(...data.results);
      }
    }
  } catch (error) {
    addDebugMessage('google_places', 'Request failed. Using OSM fallback.');
    return fetchOsmSuggestions(location, prefs, availability);
  }

  const unique = new Map<string, NearbyResult>();
  for (const item of results) {
    if (!item.place_id) continue;
    if (!unique.has(item.place_id)) {
      unique.set(item.place_id, item);
    }
  }

  const candidates = Array.from(unique.values()).slice(0, 12);
  const details = await Promise.all(candidates.map((item) => fetchPlaceDetails(item.place_id)));

  const suggestions: Suggestion[] = [];
  candidates.forEach((place, index) => {
    const geometry = place.geometry?.location;
    if (!geometry) return;
    const detail = details[index];
    const periods = detail?.result?.opening_hours?.periods;
    const openNow = detail?.result?.opening_hours?.open_now ?? place.opening_hours?.open_now;
    let openStatus: 'open_now' | 'opens_soon' | 'unknown' = 'unknown';
    let opensInMin: number | undefined;
    let closesInMin: number | undefined;

    if (periods) {
      const computed = computeOpenStatus(periods, now);
      openStatus = computed.openStatus;
      opensInMin = computed.opensInMin;
      closesInMin = computed.closesInMin;
    } else if (openNow) {
      openStatus = 'open_now';
    }

    if (openStatus === 'unknown') return;
    if ((place.user_ratings_total ?? 0) < 10) return;
    if ((place.rating ?? 0) < 3.7) return;

    const durationMin = estimateDuration(place.types || []);

    if (openStatus === 'opens_soon' && opensInMin) {
      const openAt = new Date(now.getTime() + opensInMin * 60000);
      if (openAt > availabilityEnd) return;
    }

    // Assign tags using priority order — first matching type becomes primary
    const primary = pickPrimaryType(place.types || []);
    const allTags = (place.types || [])
      .map((type) => TYPE_TAG_MAP[type])
      .filter(Boolean) as string[];
    // Deduplicate and put primary tag first
    const primaryTag = primary ? TYPE_TAG_MAP[primary] : undefined;
    const seen = new Set<string>();
    const tags: string[] = [];
    if (primaryTag) { tags.push(primaryTag); seen.add(primaryTag); }
    for (const t of allTags) {
      if (!seen.has(t)) { tags.push(t); seen.add(t); }
    }

    const label = buildAppeal(tags, openStatus, opensInMin, place.rating, place.user_ratings_total);
    const placeBlurb = generatePlaceBlurb(
      place.name,
      place.types || [],
      place.rating,
      place.user_ratings_total,
      detail?.result?.formatted_address ?? place.vicinity,
    );

    suggestions.push({
      id: `google_${place.place_id}`,
      type: 'GO_OUT',
      source: 'curated',
      title: place.name,
      description: placeBlurb,
      durationMin,
      tags,
      openStatus,
      opensInMin,
      closesInMin,
      rating: place.rating,
      ratingCount: place.user_ratings_total,
      place: {
        name: place.name,
        lat: geometry.lat,
        lng: geometry.lng,
        address: detail?.result?.formatted_address ?? place.vicinity,
      },
      confidence: 0.78,
      whyNow: openStatus === 'open_now'
        ? 'Open now and close by.'
        : opensInMin
          ? `Opens in ${opensInMin}m.`
          : undefined,
    });
  });

  if (!suggestions.length) {
    addDebugMessage('google_places', 'No results. Using OSM fallback.');
    return fetchOsmSuggestions(location, prefs, availability);
  }
  cache.set(cacheKey, { ts: Date.now(), data: suggestions });
  return suggestions;
};
