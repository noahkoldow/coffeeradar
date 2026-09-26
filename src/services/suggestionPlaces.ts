import type { LocationState, Place, Suggestion } from '../types';
import { hasMapCoordinates, hasProviderDestination } from './mapDiscovery';
import { haversineKm } from './travel';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEADLINE_MS = 3000;
const SEARCH_RADIUS_METERS = 40000;
const MAX_NAMES = 20;
const MAX_CACHE_ENTRIES = 240;
const NAME_TAGS = ['name', 'official_name', 'short_name', 'alt_name', 'name:en', 'name:de'];
const cache = new Map<string, { expiresAt: number; places: Place[] }>();
const pending = new Map<string, Promise<Place[]>>();

const normalize = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const namedDestination = (place: Place | undefined): place is Place => {
  const name = place?.name?.trim();
  if (!name || name.length < 3 || name.length > 120) return false;
  return !/^(?:(?:a|an|the|your|nearby|local|ein|eine|dein|deine|der|die|das|nahegelegene[rns]?)\s+)*(?:caf[eé]|coffee shop|park|museum|restaurant|bar|library|bibliothek|venue|event|city centre|city center|stadtzentrum|zu hause|at home)(?:\s+(?:near you|in der nähe|um die ecke))?$/iu.test(name);
};

const nearOrigin = (place: Place, location: LocationState): boolean => hasMapCoordinates(place.lat, place.lng)
  && haversineKm(location.lat!, location.lng!, place.lat!, place.lng!) <= SEARCH_RADIUS_METERS / 1000;

const streetAddress = (value?: string): string | undefined => {
  const street = normalize((value ?? '').split(',')[0]).replace(/str(?:asse)?\b/g, 'strasse').replace(/\bst\b/g, 'street');
  // A locality or postcode alone is not evidence of a conflicting street.
  return /\b\d{1,4}[a-z]?\b/.test(street) && /[a-z]/.test(street) ? street : undefined;
};

/** Same-name chains need an address; duplicated OSM node/way records may share a pin. */
const matchPlace = (wanted: Place, candidates: readonly Place[]): Place | undefined => {
  const name = normalize(wanted.name);
  const wantedStreet = streetAddress(wanted.address);
  let matches = candidates.filter(place => normalize(place.name) === name && hasMapCoordinates(place.lat, place.lng)
    && (!wantedStreet || !streetAddress(place.address) || streetAddress(place.address) === wantedStreet));
  const address = normalize(wanted.address ?? '');
  if (address && matches.length > 1) {
    const addressed = matches.filter(place => {
      const known = normalize(place.address ?? '').split(' ').filter(Boolean);
      return known.length >= 2 && known.every(part => address.split(' ').includes(part));
    });
    if (addressed.length) matches = addressed;
  }
  if (!matches.length) return undefined;
  const first = matches[0];
  return matches.every(place => haversineKm(first.lat!, first.lng!, place.lat!, place.lng!) < 0.12)
    ? first : undefined;
};

const cacheKey = (name: string, location: LocationState): string => `${location.lat!.toFixed(2)}:${location.lng!.toFixed(2)}:${normalize(name)}`;

/** A single bounded city-area query resolves all named places in a generated set. */
const searchPlaces = async (names: readonly string[], location: LocationState): Promise<Place[]> => {
  const result: Place[] = [];
  const missing = names.filter(name => {
    const cached = cache.get(cacheKey(name, location));
    if (!cached || cached.expiresAt <= Date.now()) return true;
    result.push(...cached.places);
    return false;
  }).slice(0, MAX_NAMES);
  if (!missing.length) return result;
  const requestKey = missing.map(name => cacheKey(name, location)).sort().join('|');
  const existing = pending.get(requestKey);
  if (existing) return [...result, ...await existing];

  // Exact name filters use OSM's indexes instead of scanning every named object
  // across a whole city. JSON quoting keeps venue punctuation out of the query.
  const selectors = missing.flatMap(name => NAME_TAGS.map(tag =>
    `nwr[${JSON.stringify(tag)}=${JSON.stringify(name)}](around:${SEARCH_RADIUS_METERS},${location.lat},${location.lng});`)).join('');
  const query = `[out:json][timeout:5];(${selectors});out center 100;`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<Place[]>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve([]); }, DEADLINE_MS);
  });
  const work = Promise.resolve().then(async () => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Bits/1.0 (OpenStreetMap venue resolution)' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.elements)) return [];
    const found: Place[] = [];
    for (const element of data.elements.slice(0, 100)) {
      const tags = element?.tags;
      if (!tags || tags.boundary === 'administrative' || ['city', 'town', 'village', 'suburb', 'neighbourhood'].includes(tags.place)) continue;
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      if (!hasMapCoordinates(lat, lng)) continue;
      const address = [tags['addr:street'], tags['addr:housenumber']].filter(value => typeof value === 'string').join(' ');
      for (const key of NAME_TAGS) {
        if (typeof tags[key] !== 'string') continue;
        for (const name of tags[key].split(';')) {
          const place: Place = { name: name.trim(), lat, lng, coordinateSource: 'osm', ...(address ? { address } : {}) };
          if (nearOrigin(place, location)) found.push(place);
        }
      }
    }
    return found;
  }).catch(() => [] as Place[]);
  const request = Promise.race([work, deadline]).then(places => {
    for (const name of missing) {
      const matches = places.filter(place => normalize(place.name) === normalize(name));
      const key = cacheKey(name, location);
      cache.delete(key);
      cache.set(key, { places: matches, expiresAt: Date.now() + (matches.length ? 6 * 60 * 60 * 1000 : 2 * 60 * 1000) });
    }
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return places;
  }).finally(() => {
    clearTimeout(timer);
    pending.delete(requestKey);
  });
  pending.set(requestKey, request);
  return [...result, ...await request];
};

/**
 * Resolve generated and source-listed destinations independently of AI coordinates.
 * Reuse real provider places first, then one cached OSM lookup. This runs during
 * deck generation; reopening the session map never starts another request.
 * Unresolved/ambiguous places keep their card but cannot claim a verified pin.
 */
export const resolveSuggestionPlaces = async (
  suggestions: readonly Suggestion[],
  location: LocationState,
  knownPlaces: readonly Suggestion[] = [],
): Promise<Suggestion[]> => {
  if (!hasMapCoordinates(location.lat, location.lng)) return suggestions.slice();
  const providers = knownPlaces.filter(hasProviderDestination).map(item => item.place!)
    .filter(place => place && nearOrigin(place, location))
    .map(place => ({ ...place, coordinateSource: place.coordinateSource ?? 'geocoded' as const }));
  const unresolved: Suggestion[] = [];
  const resolved = suggestions.map(suggestion => {
    if (!['gemini', 'web', 'rausgegangen'].includes(suggestion.source ?? '') || suggestion.type === 'AT_HOME' || hasProviderDestination(suggestion)
      || !namedDestination(suggestion.place)) return suggestion;
    const matched = matchPlace(suggestion.place, providers);
    if (!matched) { unresolved.push(suggestion); return suggestion; }
    return { ...suggestion, place: { ...suggestion.place, ...matched, name: suggestion.place.name } };
  });
  if (!unresolved.length) return resolved;
  const names = [...new Set(unresolved.map(suggestion => suggestion.place!.name.trim()))];
  const found = await searchPlaces(names, location);
  const unresolvedSet = new Set(unresolved);
  return resolved.map(suggestion => {
    if (!unresolvedSet.has(suggestion)) return suggestion;
    const matched = matchPlace(suggestion.place!, found);
    return matched ? { ...suggestion, place: { ...suggestion.place!, ...matched, name: suggestion.place!.name } } : suggestion;
  });
};
