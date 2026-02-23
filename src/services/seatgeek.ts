import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { fromISO } from '../utils/time';
import { addDebugMessage } from './debug';

const SEATGEEK_KEY = (globalThis as any).process?.env?.EXPO_PUBLIC_SEATGEEK_KEY;
const BASE_URL = 'https://api.seatgeek.com/2/events';

const buildUrl = (base: string, params: Record<string, string | number | undefined | null>) => {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${base}?${query}`;
};

const kmToMiles = (km: number) => km * 0.621371;

export const fetchSeatGeekSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  if (!SEATGEEK_KEY) {
    addDebugMessage('seatgeek', 'Missing API key.');
    return [];
  }
  if (!location.lat || !location.lng) return [];

  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const radiusMiles = Math.max(1, Math.min(prefs.radiusKm || 5, 25));

  const url = buildUrl(BASE_URL, {
    client_id: SEATGEEK_KEY,
    'datetime_local.gte': start,
    'datetime_local.lte': end,
    lat: location.lat,
    lon: location.lng,
    range: `${kmToMiles(radiusMiles).toFixed(1)}mi`,
    per_page: 20,
  });

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    addDebugMessage('seatgeek', 'Request failed.');
    return [];
  }
  if (!response.ok) {
    addDebugMessage('seatgeek', `Request error: ${response.status}`);
    return [];
  }
  const data = await response.json();
  if (!Array.isArray(data.events)) return [];

  const availabilityEnd = fromISO(availability.end);

  const mapped: (Suggestion | null)[] = data.events
    .filter((event: any) => event?.datetime_local && event?.venue?.location)
    .map((event: any) => {
      const venue = event.venue;
      const startAt = new Date(event.datetime_local);
      if (Number.isNaN(startAt.getTime())) return null;
      const durationMin = 120;
      const tags: string[] = [];
      if (event.type) tags.push(event.type);
      if (event.taxonomies?.length) {
        event.taxonomies.forEach((tax: any) => {
          if (tax.name) tags.push(String(tax.name).toLowerCase());
        });
      }

      return {
        id: `seatgeek_${event.id}`,
        type: 'EVENT',
        source: 'curated',
        title: event.title,
        description: event.short_title || event.title,
        durationMin,
        tags,
        event: {
          startAt: startAt.toISOString(),
          venue: venue.name || venue.display_location || 'Venue',
          ticketUrl: event.url,
          priceRange: event.stats?.lowest_price
            ? `$${event.stats.lowest_price}+`
            : undefined,
        },
        place: {
          name: venue.name || venue.display_location || 'Venue',
          lat: venue.location.lat,
          lng: venue.location.lon,
          address: venue.address,
        },
        confidence: 0.72,
      } as Suggestion;
    });

  return mapped
    .filter((suggestion): suggestion is Suggestion => Boolean(suggestion))
    .filter((suggestion: Suggestion) => {
      if (!availabilityEnd) return true;
      const startAt = new Date(suggestion.event?.startAt || '');
      return startAt <= availabilityEnd;
    })
    .filter((suggestion: Suggestion) => suggestion.event?.ticketUrl);
};
