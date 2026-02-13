import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { fromISO } from '../utils/time';
import { addDebugMessage } from './debug';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter',
];
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { ts: number; data: Suggestion[] }>();

const buildCacheKey = (lat: number, lng: number, radius: number, filters: string[]) => {
  const keyFilters = [...filters].sort().join(',');
  return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}_${keyFilters}`;
};

const INTEREST_TAG_MAP: Record<string, string[]> = {
  coffee: ['amenity=cafe'],
  food: ['amenity=restaurant', 'shop=bakery'],
  art: ['tourism=museum', 'tourism=art_gallery'],
  nature: ['leisure=park', 'tourism=viewpoint', 'natural=beach'],
  explore: ['tourism=attraction', 'tourism=viewpoint'],
  learning: ['amenity=library', 'shop=books'],
  wellness: ['amenity=spa'],
  fitness: ['leisure=fitness_centre', 'leisure=sports_centre'],
};

const DEFAULT_FILTERS = [
  'amenity=cafe',
  'amenity=restaurant',
  'amenity=fast_food',
  'amenity=cinema',
  'shop=bakery',
  'leisure=park',
  'leisure=garden',
  'tourism=museum',
  'tourism=art_gallery',
  'tourism=attraction',
  'amenity=library',
  'tourism=viewpoint',
];

const BROAD_FILTERS = [
  'amenity=cafe',
  'amenity=restaurant',
  'amenity=fast_food',
  'amenity=bar',
  'amenity=pub',
  'amenity=cinema',
  'amenity=library',
  'shop=bakery',
  'leisure=park',
  'leisure=garden',
  'tourism=attraction',
  'tourism=museum',
  'tourism=art_gallery',
  'tourism=viewpoint',
];

const TAG_LABELS: Record<string, string> = {
  cafe: 'coffee',
  restaurant: 'food',
  bakery: 'food',
  park: 'nature',
  museum: 'art',
  art_gallery: 'art',
  attraction: 'explore',
  library: 'learning',
  viewpoint: 'nature',
  beach: 'nature',
  spa: 'wellness',
  fitness_centre: 'fitness',
  sports_centre: 'fitness',
  books: 'learning',
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
};

const estimateDuration = (labels: string[]): number => {
  if (labels.includes('nature')) return 60;
  if (labels.includes('art')) return 75;
  if (labels.includes('learning')) return 60;
  if (labels.includes('fitness')) return 60;
  if (labels.includes('food')) return 45;
  if (labels.includes('coffee')) return 40;
  return 45;
};

const buildOverpassQuery = (lat: number, lng: number, radius: number, filters: string[]) => {
  const nodes = filters
    .map((filter) => {
      const [key, value] = filter.split('=');
      return `nwr["${key}"="${value}"](around:${radius},${lat},${lng});`;
    })
    .join('\n');
  return `
[out:json][timeout:25];
(
${nodes}
);
out center 30;`;
};

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const fetchOverpass = async (query: string) => {
  const encoded = encodeURIComponent(query);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const url = `${endpoint}?data=${encoded}`;
    try {
      const response = await fetchWithTimeout(url, 8000);
      if (!response.ok) {
        addDebugMessage('osm', `Overpass error ${response.status} (${endpoint})`);
        continue;
      }
      return response.json();
    } catch (error) {
      addDebugMessage('osm', `Overpass failed (${endpoint})`);
    }
  }
  return null;
};

const extractTags = (rawTags: Record<string, string> | undefined): string[] => {
  if (!rawTags) return [];
  const labels: string[] = [];
  const add = (label?: string) => {
    if (label && !labels.includes(label)) labels.push(label);
  };
  Object.entries(rawTags).forEach(([key, value]) => {
    if (key === 'amenity') add(TAG_LABELS[value]);
    if (key === 'leisure') add(TAG_LABELS[value]);
    if (key === 'tourism') add(TAG_LABELS[value]);
    if (key === 'natural') add(TAG_LABELS[value]);
    if (key === 'shop') add(TAG_LABELS[value]);
  });
  return labels;
};

const buildAppeal = (tags: string[]) => {
  if (!tags.length) return 'Nearby spot worth a quick visit.';
  const appeal = TAG_APPEAL[tags[0]] || tags[0];
  return `Nearby spot for ${appeal}.`;
};

export const fetchOsmSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  if (!location.lat || !location.lng) return [];

  const radiusKm = Math.max(1, Math.min(prefs.radiusKm || 5, 10));
  const radius = Math.round(radiusKm * 1000);
  const filters = prefs.allowSerendipity
    ? DEFAULT_FILTERS
    : Array.from(
      new Set(
        (prefs.interestTags || [])
          .flatMap((tag) => INTEREST_TAG_MAP[tag] || []),
      ),
    );
  const activeFilters = filters.length ? filters : DEFAULT_FILTERS;
  const cacheKey = buildCacheKey(location.lat, location.lng, radius, activeFilters);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    addDebugMessage('osm', `Cache hit (${cached.data.length} results).`);
    return cached.data;
  }

  const availabilityEnd = fromISO(availability.end);
  const now = new Date();

  const mapElements = (elements: any[]) => {
    return elements
      .map((element: any) => {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (!lat || !lon) return null;
        const tags = extractTags(element.tags || {});
        const durationMin = estimateDuration(tags);
        const title = element.tags?.name || element.tags?.brand || 'Nearby spot';
        const description = buildAppeal(tags);
        return {
          id: `osm_${element.id}`,
          type: 'GO_OUT',
          source: 'curated',
          title,
          description,
          durationMin,
          tags,
          place: {
            name: title,
            lat,
            lng: lon,
            address: element.tags?.['addr:street'],
          },
          confidence: 0.55,
          whyNow: 'Nearby and easy to reach.',
        } as Suggestion;
      })
      .filter(Boolean) as Suggestion[];
  };

  const filterByWindow = (items: Suggestion[]) => items.filter((suggestion) => {
    if (!availabilityEnd) return true;
    const totalMin = suggestion.durationMin;
    const latestEnd = new Date(now.getTime() + totalMin * 60000);
    return latestEnd <= availabilityEnd;
  });

  const runQuery = async (filters: string[]) => {
    addDebugMessage('osm', `Querying Overpass (${filters.length} filters, ${radius}m).`);
    const query = buildOverpassQuery(location.lat!, location.lng!, radius, filters);
    const data = await fetchOverpass(query);
    if (!data?.elements) {
      addDebugMessage('osm', 'No elements in Overpass response.');
      return [];
    }
    addDebugMessage('osm', `Overpass returned ${data.elements.length} elements.`);
    return filterByWindow(mapElements(data.elements)).slice(0, 20);
  };

  let suggestions = await runQuery(activeFilters);
  if (suggestions.length < 3 && activeFilters !== DEFAULT_FILTERS) {
    addDebugMessage('osm', 'Few results - widening filters.');
    suggestions = await runQuery(DEFAULT_FILTERS);
  }
  if (suggestions.length < 3) {
    addDebugMessage('osm', 'Few results - using broad filters.');
    suggestions = await runQuery(BROAD_FILTERS);
  }

  if (!suggestions.length) {
    addDebugMessage('osm', 'No results from Overpass.');
    return [];
  }

  suggestions = suggestions.slice(0, 12);
  cache.set(cacheKey, { ts: Date.now(), data: suggestions });
  addDebugMessage('osm', `Using ${suggestions.length} suggestions.`);
  return suggestions;
};
