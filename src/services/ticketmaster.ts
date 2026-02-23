import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { addMinutes, fromISO } from '../utils/time';
import { addDebugMessage } from './debug';

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

/* ── Interest → Ticketmaster classificationName mapping ──────────── */

const INTEREST_CLASSIFICATION: Record<string, string[]> = {
  music: ['music'],
  art: ['arts & theatre'],
  movies: ['film'],
  fitness: ['sports'],
  food: ['food & drink'],
  learning: ['arts & theatre', 'miscellaneous'],
  social: ['music', 'arts & theatre'],
  explore: ['miscellaneous'],
  wellness: ['sports'],
};

/* ── Segment/genre → app tag mapping ────────────────────────────── */

const SEGMENT_TAG_MAP: Record<string, string> = {
  music: 'music',
  sports: 'fitness',
  'arts & theatre': 'art',
  film: 'movies',
  miscellaneous: 'explore',
  'food & drink': 'food',
};

const GENRE_TAG_MAP: Record<string, string> = {
  rock: 'music',
  pop: 'music',
  'hip-hop/rap': 'music',
  r_b: 'music',
  electronic: 'music',
  jazz: 'music',
  classical: 'music',
  comedy: 'social',
  dance: 'music',
  theatre: 'art',
  opera: 'art',
  'fine art': 'art',
  'children\'s theatre': 'art',
  basketball: 'fitness',
  football: 'fitness',
  soccer: 'fitness',
  baseball: 'fitness',
  hockey: 'fitness',
  tennis: 'fitness',
  golf: 'fitness',
};

/* ── Duration estimation by segment ─────────────────────────────── */

const estimateDuration = (segmentName?: string): number => {
  const s = (segmentName ?? '').toLowerCase();
  if (s === 'sports') return 150;
  if (s === 'film') return 120;
  if (s === 'music') return 120;
  if (s.includes('theatre')) return 150;
  return 120;
};

/* ── Description builder ────────────────────────────────────────── */

const buildDescription = (event: any): string => {
  // Use event.info if available and not too long
  if (event.info && event.info.length > 20 && event.info.length < 500) {
    return event.info;
  }

  const venue = event._embedded?.venues?.[0];
  const venueName = venue?.name;
  const segment = event.classifications?.[0]?.segment?.name?.toLowerCase() ?? '';
  const genre = event.classifications?.[0]?.genre?.name;

  const templates: Record<string, string[]> = {
    music: [
      `Catch ${event.name} live${venueName ? ` at ${venueName}` : ''}. Grab tickets and go.`,
      `Live music${venueName ? ` at ${venueName}` : ''} — ${event.name} is playing tonight.`,
      `${event.name}${venueName ? ` at ${venueName}` : ''} — a live show worth catching.`,
    ],
    sports: [
      `${event.name}${venueName ? ` at ${venueName}` : ''}. Live sports, real atmosphere.`,
      `Watch ${event.name} live${venueName ? ` at ${venueName}` : ''}. Nothing beats being there.`,
    ],
    'arts & theatre': [
      `${event.name}${venueName ? ` at ${venueName}` : ''} — live performance worth seeing.`,
      `See ${event.name} live${venueName ? `. Playing at ${venueName}` : ''}. A great way to spend the evening.`,
    ],
    film: [
      `${event.name}${venueName ? ` at ${venueName}` : ''} — on the big screen now.`,
      `Catch a screening of ${event.name}${venueName ? ` at ${venueName}` : ''}.`,
    ],
  };

  const variants = templates[segment] || [
    `${event.name}${venueName ? ` at ${venueName}` : ''} — happening nearby.`,
  ];
  const hash = event.name.split('').reduce((sum: number, c: string) => sum + c.charCodeAt(0), 0);
  const blurb = variants[hash % variants.length];

  const genreLine = genre && genre !== 'Undefined' ? ` ${genre} event.` : '';
  return `${blurb}${genreLine}`;
};

/* ── Tag extraction ─────────────────────────────────────────────── */

const extractTags = (event: any): string[] => {
  const tags = new Set<string>();
  const classifications = event.classifications ?? [];

  for (const c of classifications) {
    const segName = c.segment?.name?.toLowerCase();
    if (segName && SEGMENT_TAG_MAP[segName]) {
      tags.add(SEGMENT_TAG_MAP[segName]);
    }
    const genreName = c.genre?.name?.toLowerCase();
    if (genreName && GENRE_TAG_MAP[genreName]) {
      tags.add(GENRE_TAG_MAP[genreName]);
    }
  }

  // Fallback: infer from event name
  if (!tags.size) {
    const title = event.name?.toLowerCase() ?? '';
    if (/concert|live|dj|band|festival/.test(title)) tags.add('music');
    if (/comedy|stand.?up|improv/.test(title)) tags.add('social');
    if (/exhibit|gallery|theatre|theater|opera|ballet/.test(title)) tags.add('art');
    if (/game|match|race/.test(title)) tags.add('fitness');
  }

  return tags.size ? Array.from(tags) : ['explore'];
};

/* ── Date formatting (Ticketmaster requires YYYY-MM-DDTHH:mm:ssZ) ─ */

const formatTmDateTime = (date: Date): string => {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/* ── Geohash for geoPoint parameter ─────────────────────────────── */

const encodeGeohash = (lat: number, lng: number, precision = 9): string => {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; minLng = mid; }
      else { ch <<= 1; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; minLat = mid; }
      else { ch <<= 1; maxLat = mid; }
    }
    isLng = !isLng;
    bit++;
    if (bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
};

/* ── Main export ────────────────────────────────────────────────── */

export const fetchTicketmasterSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  const key = (globalThis as any).process?.env?.EXPO_PUBLIC_TICKETMASTER_KEY;
  if (!key || typeof key !== 'string' || key.length < 5) {
    addDebugMessage('ticketmaster', 'Missing API key — skipping.');
    return [];
  }

  if (!location.lat || !location.lng) {
    addDebugMessage('ticketmaster', 'No location — skipping.');
    return [];
  }

  const now = new Date();
  const end = fromISO(availability.end) ?? addMinutes(now, availability.durationMin);

  // Widen the search window — events starting within the next 6 hours
  // (the feasibility check in suggestions.ts will filter out unreachable ones)
  const searchEnd = new Date(Math.max(
    end.getTime(),
    now.getTime() + 6 * 60 * 60 * 1000,
  ));

  // Build query params
  const params: Record<string, string> = {
    apikey: key,
    geoPoint: encodeGeohash(location.lat, location.lng),
    radius: String(Math.min(prefs.radiusKm || 25, 50)),
    unit: 'km',
    startDateTime: formatTmDateTime(now),
    endDateTime: formatTmDateTime(searchEnd),
    size: '15',
    sort: 'distance,asc',
  };

  // Use classificationName for interest-based filtering instead of keyword
  if (!prefs.allowSerendipity && prefs.interestTags.length) {
    const classifications = new Set<string>();
    for (const tag of prefs.interestTags) {
      const mapped = INTEREST_CLASSIFICATION[tag];
      if (mapped) mapped.forEach((c) => classifications.add(c));
    }
    if (classifications.size) {
      params.classificationName = Array.from(classifications).join(',');
    }
  }

  const url = `${BASE_URL}?${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}`;

  try {
    addDebugMessage('ticketmaster', `Fetching events (radius ${params.radius}km)...`);
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      addDebugMessage('ticketmaster', `API error ${response.status}: ${body.slice(0, 200)}`);
      return [];
    }

    const data = await response.json();
    const events = data?._embedded?.events;

    if (!Array.isArray(events) || !events.length) {
      addDebugMessage('ticketmaster', 'No events found nearby.');
      return [];
    }

    addDebugMessage('ticketmaster', `Got ${events.length} events.`);

    const suggestions: Suggestion[] = [];

    for (const event of events) {
      const venue = event._embedded?.venues?.[0];
      const lat = venue?.location?.latitude ? Number(venue.location.latitude) : undefined;
      const lng = venue?.location?.longitude ? Number(venue.location.longitude) : undefined;
      const startAt = event.dates?.start?.dateTime;

      // Skip events without a start time or ticket URL
      if (!startAt || !event.url) continue;

      const segmentName = event.classifications?.[0]?.segment?.name;
      const tags = extractTags(event);
      const durationMin = estimateDuration(segmentName);
      const description = buildDescription(event);

      // Price range
      let priceRange: string | undefined;
      if (event.priceRanges?.length) {
        const pr = event.priceRanges[0];
        const currency = pr.currency === 'EUR' ? '€' : pr.currency === 'GBP' ? '£' : '$';
        if (pr.min && pr.max && pr.min !== pr.max) {
          priceRange = `${currency}${Math.round(pr.min)}–${currency}${Math.round(pr.max)}`;
        } else if (pr.min) {
          priceRange = `from ${currency}${Math.round(pr.min)}`;
        }
      }

      // Build address from venue data
      const addressParts = [
        venue?.address?.line1,
        venue?.city?.name,
      ].filter(Boolean);
      const address = addressParts.join(', ') || undefined;

      suggestions.push({
        id: `tm_${event.id}`,
        type: 'EVENT',
        source: 'ticketmaster',
        title: event.name,
        description,
        durationMin,
        tags,
        instructions: [
          'Check tickets and confirm your seat.',
          `Head to ${venue?.name ?? 'the venue'} — leave with a buffer.`,
          'Arrive 10–15 minutes early.',
        ],
        event: {
          startAt,
          venue: venue?.name ?? 'Venue',
          ticketUrl: event.url,
          priceRange,
        },
        place: {
          name: venue?.name ?? 'Venue',
          lat,
          lng,
          address,
        },
        confidence: 0.72,
      });
    }

    addDebugMessage('ticketmaster', `Returning ${suggestions.length} valid suggestions.`);
    return suggestions;
  } catch (error) {
    addDebugMessage('ticketmaster', `Request failed: ${String(error)}`);
    return [];
  }
};
