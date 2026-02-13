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
  cafe: 'coffee',
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
};

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

  const radiusKm = Math.max(1, Math.min(prefs.radiusKm || 5, 10));
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
    if ((place.user_ratings_total ?? 0) < 20) return;

    const durationMin = estimateDuration(place.types || []);

    if (openStatus === 'opens_soon' && opensInMin) {
      const openAt = new Date(now.getTime() + opensInMin * 60000);
      if (openAt > availabilityEnd) return;
    }

    const tags = (place.types || [])
      .map((type) => TYPE_TAG_MAP[type])
      .filter(Boolean) as string[];

    const label = buildAppeal(tags, openStatus, opensInMin, place.rating, place.user_ratings_total);

    suggestions.push({
      id: `google_${place.place_id}`,
      type: 'GO_OUT',
      source: 'curated',
      title: place.name,
      description: label,
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
