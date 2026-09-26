import type { MapActivityOption } from '../components/ActivityMap.types';
import type { Availability, DeckSuggestion, LocationProfile, LocationState } from '../types';
import { estimateEtaMinutes, haversineKm, selectMapTravelMode } from './travel';

export const MAP_CARD_PROBABILITY = 1 / 1.6;
export type MapActivityTriple = [MapActivityOption, MapActivityOption, MapActivityOption];

/** Sample once when an eligible set is actually presented, never during render. */
export const shouldIncludeMapCard = (rng: () => number = Math.random): boolean => {
  const sample = rng();
  return Number.isFinite(sample) && sample >= 0 && sample < MAP_CARD_PROBABILITY;
};

export const hasMapCoordinates = (lat: unknown, lng: unknown): boolean => (
  typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  && typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
);

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * These adapters copy coordinates from a place/event provider, not an AI prompt.
 * `curated` alone is insufficient: generic suggestions and invented seed businesses
 * also carry plausible coordinates. Keep this allowlist aligned with the adapters.
 */
export const hasProviderDestination = (suggestion: DeckSuggestion): boolean => {
  if (suggestion.source === 'ad') return false;
  if (suggestion.type !== 'GO_OUT' && suggestion.type !== 'EVENT') return false;
  // A generated activity can point at a real venue. Trust the resolved place,
  // not the author of the activity or coordinates copied from a model response.
  if (suggestion.place?.coordinateSource && ['osm', 'google', 'geocoded', 'source'].includes(suggestion.place.coordinateSource)) return true;
  if (suggestion.source === 'ticketmaster') {
    return suggestion.type === 'EVENT' && /^tm_.+/.test(suggestion.id);
  }
  if (suggestion.source !== 'curated') return false;
  if (suggestion.type === 'EVENT') return /^seatgeek_\d+$/.test(suggestion.id);
  return suggestion.type === 'GO_OUT'
    && (/^osm_\d+$/.test(suggestion.id) || /^google_[A-Za-z0-9_-]+$/.test(suggestion.id));
};

const activityEmoji = (suggestion: DeckSuggestion): string => {
  const supplied = suggestion.emojis?.find(value => typeof value === 'string' && value.trim());
  if (supplied) return supplied.trim();
  const tags = new Set(suggestion.tags ?? []);
  for (const [tag, emoji] of [
    ['coffee', '☕'], ['food', '🍽️'], ['nature', '🌳'], ['art', '🖼️'],
    ['fitness', '🚶'], ['music', '🎵'], ['movies', '🎬'], ['learning', '📚'],
  ]) if (tags.has(tag)) return emoji;
  return suggestion.type === 'EVENT' ? '🎟️' : '📍';
};

/** Convert a verified destination to a local estimate; no geocoding or routing calls. */
export const toMapActivityOption = (
  suggestion: DeckSuggestion,
  location: LocationState | null | undefined,
  locationProfile?: LocationProfile | null,
): MapActivityOption | null => {
  if (!location || !hasMapCoordinates(location.lat, location.lng)) return null;
  if (suggestion.mapDiscovery || !hasProviderDestination(suggestion)
    || !suggestion.title?.trim() || !suggestion.place?.name?.trim()) return null;
  const { lat, lng } = suggestion.place;
  if (!hasMapCoordinates(lat, lng)) return null;
  if (!Number.isFinite(suggestion.durationMin) || suggestion.durationMin <= 0) return null;
  const distanceKm = haversineKm(location.lat!, location.lng!, lat!, lng!);
  if (!Number.isFinite(distanceKm)) return null;
  const travelMode = selectMapTravelMode(distanceKm, locationProfile);
  return {
    suggestion,
    coordinate: { latitude: lat!, longitude: lng! },
    travelMin: estimateEtaMinutes(distanceKm, travelMode),
    travelMode,
    emoji: activityEmoji(suggestion),
  };
};

/**
 * Preserve deck ranking and return exactly three distinct, usable destinations.
 * All travel is an estimate from the current origin, including a return allowance.
 * `homeBase` is an averaged regional GPS anchor, not a confirmed home address;
 * consequently AT_HOME cards cannot safely receive a map pin with today's model.
 */
export const selectMapActivities = (
  deck: readonly DeckSuggestion[],
  location: LocationState,
  locationProfile?: LocationProfile | null,
  availability?: Pick<Availability, 'durationMin'> | number,
): MapActivityTriple | null => {
  const availableMinutes = typeof availability === 'number' ? availability : availability?.durationMin;
  if (!hasMapCoordinates(location.lat, location.lng)) return null;
  if (availableMinutes != null && (!Number.isFinite(availableMinutes) || availableMinutes <= 0)) return null;
  const selected: MapActivityOption[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  const positions = new Set<string>();

  for (const suggestion of deck) {
    const option = toMapActivityOption(suggestion, location, locationProfile);
    if (!option) continue;
    const { latitude: lat, longitude: lng } = option.coordinate;
    const title = normalize(suggestion.title);
    const position = `${lat!.toFixed(5)}:${lng!.toFixed(5)}`;
    if (ids.has(suggestion.id) || titles.has(title) || positions.has(position)) continue;
    // A place returned by two different providers is still only one destination.
    if (selected.some(option => normalize(option.suggestion.place!.name) === normalize(suggestion.place!.name)
      && haversineKm(option.coordinate.latitude, option.coordinate.longitude, lat!, lng!) < 0.15)) continue;

    if (availableMinutes != null && suggestion.durationMin + 2 * option.travelMin > availableMinutes) continue;
    selected.push(option);
    ids.add(suggestion.id);
    titles.add(title);
    positions.add(position);
    if (selected.length === 3) return selected as MapActivityTriple;
  }
  return null;
};
