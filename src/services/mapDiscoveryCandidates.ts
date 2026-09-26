import type { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { hasMapCoordinates } from './mapDiscovery';
import { fetchOsmSuggestions } from './osmPlaces';
import { discoveryReferenceTime } from './discoveryTiming';

const REQUEST_DEADLINE_MS = 3000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 24;
const cache = new Map<string, { expiresAt: number; data: Suggestion[] }>();
const requests = new Map<string, Promise<Suggestion[]>>();

const keyFor = (location: LocationState, prefs: UserPrefs, availability: Availability): string => JSON.stringify([
  location.lat!.toFixed(3), location.lng!.toFixed(3), location.timeZone ?? '',
  Math.max(1, Math.min(prefs.radiusKm || 5, 25)), prefs.allowSerendipity,
  [...new Set(prefs.interestTags ?? [])].sort(),
  Math.floor(discoveryReferenceTime(availability).getTime() / 900000), availability.durationMin,
]);

/**
 * Existing free OSM adapter, bounded to one query/endpoint and three seconds.
 * Cache both successful and empty results, including timeouts, so repeated decks
 * do not retry a slow public endpoint. Same-area concurrent decks share one call.
 * No location request, paid API, or AI call is started here.
 */
export const fetchMapDiscoveryCandidates = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  if (!prefs.openToGoingOut || !hasMapCoordinates(location.lat, location.lng)) return [];
  const key = keyFor(location, prefs, availability);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data.slice();
  const pending = requests.get(key);
  if (pending) return (await pending).slice();

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<Suggestion[]>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve([]); }, REQUEST_DEADLINE_MS);
  });
  const work = Promise.resolve().then(() => fetchOsmSuggestions(location, prefs, availability, {
    signal: controller.signal, maxEndpoints: 1, allowWidening: false,
  })).catch(() => [] as Suggestion[]);
  const request = Promise.race([work, deadline]).then(data => {
    const results = data.slice(0, 20);
    cache.delete(key);
    cache.set(key, {
      data: results,
      expiresAt: Date.now() + (results.length ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS),
    });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return results;
  }).finally(() => {
    clearTimeout(timeout);
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return (await request).slice();
};
