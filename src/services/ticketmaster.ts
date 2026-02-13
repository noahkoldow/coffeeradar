import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { addMinutes, fromISO } from '../utils/time';
import { addDebugMessage } from './debug';

const interestKeywordMap: Record<string, string[]> = {
  fitness: ['fitness', 'workout', 'run', 'yoga'],
  wellness: ['wellness', 'meditation', 'mindfulness'],
  nature: ['park', 'garden', 'outdoor', 'walk'],
  art: ['art', 'gallery', 'museum', 'exhibit'],
  music: ['music', 'concert', 'live'],
  movies: ['film', 'cinema', 'screening'],
  food: ['food', 'dining', 'tasting', 'restaurant'],
  coffee: ['coffee', 'cafe'],
  learning: ['workshop', 'talk', 'class', 'lecture'],
  focus: ['focus', 'quiet', 'study'],
  social: ['social', 'community', 'meetup'],
  explore: ['tour', 'walk', 'explore'],
};

const getTicketmasterKey = (): string | null => {
  const env = typeof globalThis !== 'undefined' && (globalThis as any).process?.env;
  const key = env?.EXPO_PUBLIC_TICKETMASTER_KEY;
  return typeof key === 'string' && key.length > 0 ? key : null;
};

const buildKeywordQuery = (tags: string[]): string | null => {
  const keywords = tags.flatMap((tag) => interestKeywordMap[tag] || [tag]);
  const unique = Array.from(new Set(keywords)).slice(0, 6);
  return unique.length ? unique.join(' ') : null;
};

const toLowerTag = (value?: string): string | null => {
  if (!value) return null;
  return value.toLowerCase().replace(/\s+/g, '');
};

const buildFallbackEvents = (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Suggestion[] => {
  const now = new Date();
  const end = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);
  const defaultStart = addMinutes(now, Math.min(90, Math.max(10, availability.durationMin - 10)));
  const startAt = defaultStart.getTime() < end.getTime() ? defaultStart : addMinutes(now, 20);
  const lat = location.lat ?? -33.8688;
  const lng = location.lng ?? 151.2093;
  const area = location.areaLabel ?? 'City Center';
  const tags = prefs.interestTags.length ? prefs.interestTags : ['music', 'art', 'food'];

  return [
    {
      id: 'tm_mock_1',
      type: 'EVENT',
      source: 'ticketmaster',
      title: 'Ticketmaster live set',
      description: 'Sample Ticketmaster event while the API is warming up.',
      whyNow: 'Ticketed event starting soon.',
      durationMin: 120,
      tags,
      instructions: [
        'Check tickets and venue details.',
        'Plan your route and leave on time.',
        'Arrive 10 minutes early.',
      ],
      event: {
        startAt: startAt.toISOString(),
        venue: `${area} Live Hall`,
        ticketUrl: 'https://www.ticketmaster.com/',
        priceRange: '$25-$60',
      },
      place: {
        name: `${area} Live Hall`,
        lat,
        lng,
        address: area,
      },
      confidence: 0.4,
    },
    {
      id: 'tm_mock_2',
      type: 'EVENT',
      source: 'ticketmaster',
      title: 'Ticketmaster night screening',
      description: 'Sample Ticketmaster event to prove the flow.',
      whyNow: 'Seats available for a nearby screening.',
      durationMin: 110,
      tags,
      instructions: [
        'Grab tickets.',
        'Leave with a 10 minute buffer.',
        'Arrive a bit early.',
      ],
      event: {
        startAt: addMinutes(startAt, 30).toISOString(),
        venue: `${area} Cinema`,
        ticketUrl: 'https://www.ticketmaster.com/',
        priceRange: '$18-$35',
      },
      place: {
        name: `${area} Cinema`,
        lat,
        lng,
        address: area,
      },
      confidence: 0.35,
    },
  ];
};

export const fetchTicketmasterSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  const key = getTicketmasterKey();
  if (!key) {
    addDebugMessage('ticketmaster', 'Missing API key. Using fallback events.');
    return buildFallbackEvents(location, prefs, availability);
  }

  const now = new Date();
  const end = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  url.searchParams.set('apikey', key);
  const lat = location.lat ?? -33.8688;
  const lng = location.lng ?? 151.2093;
  url.searchParams.set('latlong', `${lat},${lng}`);
  url.searchParams.set('radius', String(prefs.radiusKm));
  url.searchParams.set('unit', 'km');
  url.searchParams.set('startDateTime', now.toISOString());
  url.searchParams.set('endDateTime', end.toISOString());
  url.searchParams.set('size', '12');

  if (!prefs.allowSerendipity && prefs.interestTags.length) {
    const keyword = buildKeywordQuery(prefs.interestTags);
    if (keyword) url.searchParams.set('keyword', keyword);
  }

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      addDebugMessage('ticketmaster', `Request error: ${response.status}. Using fallback events.`);
      return buildFallbackEvents(location, prefs, availability);
    }
    const data = await response.json();
    const events = data?._embedded?.events ?? [];
    if (!events.length) {
      addDebugMessage('ticketmaster', 'No results. Using fallback events.');
      return buildFallbackEvents(location, prefs, availability);
    }
    return events.map((event: any): Suggestion => {
      const venue = event._embedded?.venues?.[0];
      const lat = venue?.location?.latitude ? Number(venue.location.latitude) : undefined;
      const lng = venue?.location?.longitude ? Number(venue.location.longitude) : undefined;
      const startAt = event.dates?.start?.dateTime;
      const classifications = event.classifications
        ?.map((item: any) => toLowerTag(item.segment?.name))
        .filter(Boolean) as string[] | undefined;

      return {
        id: `tm_${event.id}`,
        type: 'EVENT',
        source: 'ticketmaster',
        title: event.name,
        description: event.info || 'Live event starting soon.',
        whyNow: 'Live event starting soon with tickets available.',
        durationMin: 120,
        tags: classifications?.length ? classifications : prefs.interestTags,
        instructions: [
          'Check tickets and venue details.',
          'Plan your route and leave on time.',
          'Arrive 10 minutes early.',
        ],
        event: {
          startAt: startAt ?? new Date().toISOString(),
          venue: venue?.name ?? 'Venue',
          ticketUrl: event.url,
          priceRange: event.priceRanges?.[0]
            ? `$${event.priceRanges[0].min}-$${event.priceRanges[0].max}`
            : undefined,
        },
        place: {
          name: venue?.name ?? 'Venue',
          lat,
          lng,
          address: venue?.address?.line1,
        },
        confidence: 0.6,
      };
    });
  } catch {
    addDebugMessage('ticketmaster', 'Request failed. Using fallback events.');
    return buildFallbackEvents(location, prefs, availability);
  }
};
