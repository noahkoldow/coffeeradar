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

// ── Interest-to-OSM mapping (expanded) ─────────────────────────────────
const INTEREST_TAG_MAP: Record<string, string[]> = {
  coffee: ['amenity=cafe'],
  food: ['amenity=restaurant', 'shop=bakery', 'amenity=fast_food', 'amenity=ice_cream'],
  street_food: ['amenity=fast_food', 'amenity=marketplace'],
  art: ['tourism=museum', 'tourism=gallery', 'tourism=artwork'],
  nature: ['leisure=park', 'tourism=viewpoint', 'natural=beach', 'leisure=garden', 'leisure=nature_reserve'],
  beaches: ['natural=beach', 'leisure=beach_resort'],
  parks: ['leisure=park', 'leisure=garden', 'leisure=nature_reserve'],
  explore: ['tourism=attraction', 'tourism=viewpoint', 'historic=monument', 'historic=memorial'],
  learning: ['amenity=library', 'shop=books', 'amenity=arts_centre'],
  wellness: ['amenity=spa', 'leisure=swimming_pool'],
  fitness: ['leisure=fitness_centre', 'leisure=sports_centre', 'leisure=pitch'],
  cycling: ['amenity=bicycle_rental', 'shop=bicycle'],
  running: ['leisure=track', 'leisure=pitch'],
  swimming: ['leisure=swimming_pool', 'amenity=public_bath'],
  hiking: ['route=hiking', 'tourism=viewpoint'],
  social: ['amenity=bar', 'amenity=pub', 'amenity=biergarten', 'amenity=community_centre'],
  music: ['amenity=nightclub', 'amenity=arts_centre', 'amenity=theatre'],
  movies: ['amenity=cinema'],
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
  'tourism=gallery',
  'tourism=attraction',
  'amenity=library',
  'tourism=viewpoint',
];

const BROAD_FILTERS = [
  ...DEFAULT_FILTERS,
  'amenity=bar',
  'amenity=pub',
  'amenity=biergarten',
  'amenity=ice_cream',
  'amenity=arts_centre',
  'amenity=theatre',
  'leisure=nature_reserve',
  'leisure=swimming_pool',
  'historic=monument',
  'historic=memorial',
  'amenity=community_centre',
];

// ── Tag labelling (expanded) ───────────────────────────────────────────
const TAG_LABELS: Record<string, string> = {
  // Culture & learning first — most specific
  museum: 'art',
  gallery: 'art',
  artwork: 'art',
  arts_centre: 'art',
  theatre: 'art',
  cinema: 'movies',
  nightclub: 'music',
  library: 'learning',
  books: 'learning',
  // Nature
  park: 'nature',
  garden: 'nature',
  nature_reserve: 'nature',
  viewpoint: 'nature',
  beach: 'nature',
  // Fitness & wellness
  spa: 'wellness',
  swimming_pool: 'wellness',
  fitness_centre: 'fitness',
  sports_centre: 'fitness',
  pitch: 'fitness',
  // Social
  bar: 'social',
  pub: 'social',
  biergarten: 'social',
  community_centre: 'social',
  // Food
  restaurant: 'food',
  fast_food: 'food',
  ice_cream: 'food',
  bakery: 'food',
  // Explore
  attraction: 'explore',
  monument: 'explore',
  memorial: 'explore',
  // Café last — so it doesn't override more specific types
  cafe: 'coffee',
};

/** Priority order for picking the primary tag — first match wins */
const TAG_PRIORITY: string[] = [
  'museum', 'gallery', 'arts_centre', 'theatre', 'cinema', 'nightclub',
  'library', 'books',
  'park', 'garden', 'nature_reserve', 'beach', 'viewpoint',
  'spa', 'swimming_pool', 'fitness_centre', 'sports_centre',
  'restaurant', 'bakery', 'bar', 'pub', 'biergarten',
  'attraction', 'monument', 'memorial',
  'fast_food', 'ice_cream',
  'cafe', // café as last resort
];

const TAG_APPEAL: Record<string, string> = {
  coffee: 'a coffee break',
  food: 'a bite to eat',
  art: 'an art fix',
  nature: 'fresh air',
  explore: 'something new',
  learning: 'quiet focus',
  wellness: 'a reset',
  fitness: 'getting your body moving',
  social: 'an easy hang',
  music: 'some live vibes',
  movies: 'a movie break',
};

const estimateDuration = (labels: string[]): number => {
  if (labels.includes('nature')) return 60;
  if (labels.includes('art')) return 75;
  if (labels.includes('learning')) return 60;
  if (labels.includes('fitness')) return 60;
  if (labels.includes('movies')) return 120;
  if (labels.includes('wellness')) return 60;
  if (labels.includes('food')) return 45;
  if (labels.includes('coffee')) return 40;
  if (labels.includes('social')) return 60;
  if (labels.includes('music')) return 90;
  return 45;
};

// ── Overpass query ─────────────────────────────────────────────────────
// `out center qt` returns results sorted by proximity and includes
// center coordinates for ways/relations.
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
out center qt 40;`;
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

// ── Tag extraction ─────────────────────────────────────────────────────
const extractTags = (rawTags: Record<string, string> | undefined): string[] => {
  if (!rawTags) return [];
  const TAG_KEYS = ['amenity', 'leisure', 'tourism', 'natural', 'shop', 'historic'];

  // Collect all raw OSM type values from the element
  const rawValues: string[] = [];
  TAG_KEYS.forEach((key) => {
    if (rawTags[key]) rawValues.push(rawTags[key]);
  });

  // Use priority order to pick the primary label, then add others
  let primary: string | undefined;
  for (const pKey of TAG_PRIORITY) {
    if (rawValues.includes(pKey)) {
      primary = TAG_LABELS[pKey];
      break;
    }
  }

  const seen = new Set<string>();
  const labels: string[] = [];
  if (primary) { labels.push(primary); seen.add(primary); }
  for (const val of rawValues) {
    const label = TAG_LABELS[val];
    if (label && !seen.has(label)) { labels.push(label); seen.add(label); }
  }
  return labels;
};

// ── Opening hours parser ───────────────────────────────────────────────
const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const parseOpeningStatus = (
  ohString: string | undefined,
  now: Date,
): { openStatus: 'open_now' | 'opens_soon' | 'unknown'; opensInMin?: number; closesInMin?: number } => {
  if (!ohString) return { openStatus: 'unknown' };
  if (ohString === '24/7') return { openStatus: 'open_now' };

  try {
    const dayIndex = (now.getDay() + 6) % 7; // Mon=0
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const rules = ohString.split(';').map((r) => r.trim());
    let bestOpen: number | null = null;
    let bestClose: number | null = null;

    for (const rule of rules) {
      const timeMatch = rule.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (!timeMatch) continue;

      const openTime = timeMatch[1].split(':').map(Number);
      const closeTime = timeMatch[2].split(':').map(Number);
      const openMin = openTime[0] * 60 + openTime[1];
      const closeMin = closeTime[0] * 60 + closeTime[1];

      const dayPart = rule.replace(timeMatch[0], '').trim();
      let dayApplies = false;

      if (!dayPart) {
        dayApplies = true;
      } else {
        const dayRanges = dayPart.split(',').map((d) => d.trim());
        for (const range of dayRanges) {
          const rangeMatch = range.match(/([A-Z][a-z])\s*-\s*([A-Z][a-z])/);
          if (rangeMatch) {
            const from = DAY_NAMES.indexOf(rangeMatch[1]);
            const to = DAY_NAMES.indexOf(rangeMatch[2]);
            if (from === -1 || to === -1) continue;
            dayApplies = from <= to
              ? dayIndex >= from && dayIndex <= to
              : dayIndex >= from || dayIndex <= to;
          } else if (DAY_NAMES.includes(range)) {
            dayApplies = dayIndex === DAY_NAMES.indexOf(range);
          }
          if (dayApplies) break;
        }
      }

      if (!dayApplies) continue;

      if (nowMinutes >= openMin && nowMinutes < closeMin) {
        return { openStatus: 'open_now', closesInMin: closeMin - nowMinutes };
      }

      if (openMin > nowMinutes) {
        const diff = openMin - nowMinutes;
        if (bestOpen === null || diff < bestOpen) {
          bestOpen = diff;
          bestClose = closeMin > openMin ? closeMin - nowMinutes : null;
        }
      }
    }

    if (bestOpen !== null && bestOpen <= 90) {
      return { openStatus: 'opens_soon', opensInMin: bestOpen, closesInMin: bestClose ?? undefined };
    }

    return { openStatus: 'unknown' };
  } catch {
    return { openStatus: 'unknown' };
  }
};

// ── Description & why-now builders ─────────────────────────────────────
const buildAppeal = (
  tags: string[],
  openStatus: 'open_now' | 'opens_soon' | 'unknown',
  opensInMin?: number,
  cuisine?: string,
): string => {
  const parts: string[] = [];
  if (openStatus === 'open_now') parts.push('Open now');
  else if (openStatus === 'opens_soon' && opensInMin) parts.push(`Opens in ${opensInMin}m`);
  else parts.push('Nearby');

  if (cuisine) parts.push(`${cuisine} spot`);
  else if (tags.length) parts.push(`great for ${TAG_APPEAL[tags[0]] || tags[0]}`);

  return parts.join(' — ') + '.';
};

const buildWhyNow = (
  openStatus: 'open_now' | 'opens_soon' | 'unknown',
  opensInMin?: number,
  closesInMin?: number,
): string => {
  if (openStatus === 'open_now') {
    if (closesInMin && closesInMin <= 90) {
      return `Open now but closes in ${closesInMin}m — go now or wait until tomorrow.`;
    }
    return 'Open now and easy to reach.';
  }
  if (openStatus === 'opens_soon' && opensInMin) {
    return `Opens in ${opensInMin}m — time your walk perfectly.`;
  }
  return 'Nearby and worth a quick visit.';
};

const generateOsmPlaceBlurb = (
  name: string,
  tags: string[],
  cuisine?: string,
  address?: string,
): string => {
  // Per-tag blurb templates — multiple variants for variety
  const templates: Record<string, string[]> = {
    coffee: [
      `${name} — a solid coffee spot nearby. Grab a drink and settle in.`,
      `Pop into ${name} for a coffee and a change of pace.`,
      `${name} is the kind of place where you can just sit with a good cup.`,
    ],
    food: [
      `${name} — a great place to sit down for a meal.`,
      `Hungry? ${name} is nearby and well worth a visit.`,
      `Treat yourself to something at ${name}. No cooking required.`,
    ],
    art: [
      `${name} — browse some art and let your mind wander.`,
      `Step into ${name} for a quiet dose of culture.`,
      `${name} has something worth seeing. Go discover it.`,
    ],
    nature: [
      `${name} — green space, fresh air, room to move or just sit.`,
      `Take a walk through ${name}. No agenda, just fresh air.`,
      `${name} is a great spot to stretch your legs and breathe.`,
    ],
    explore: [
      `${name} — something interesting nearby worth checking out.`,
      `Go see ${name}. It's close and worth the walk.`,
      `${name} is one of those places you keep meaning to visit.`,
    ],
    learning: [
      `${name} — quiet, focused, ideal for reading or deep work.`,
      `Head to ${name} for some uninterrupted time.`,
      `${name} is nearby and perfect for getting into the zone.`,
    ],
    wellness: [
      `${name} — a chance to unwind and recharge.`,
      `Treat yourself at ${name}. You've earned a reset.`,
      `${name} is a good excuse to slow down for a bit.`,
    ],
    fitness: [
      `${name} — get a workout in and burn off some energy.`,
      `Head to ${name} and move your body.`,
      `${name} is nearby. Time to break a sweat.`,
    ],
    social: [
      `${name} — a chill spot for a drink and good vibes.`,
      `Swing by ${name}. No plans needed, just show up.`,
      `${name} is a solid place to hang out.`,
    ],
    music: [
      `${name} — catch some live vibes or just soak in the atmosphere.`,
      `Head to ${name} for some music and a good time.`,
      `${name} is the kind of place where the music does the talking.`,
    ],
    movies: [
      `${name} — check what's playing and catch a screening.`,
      `Movie time at ${name}. Big screen, no distractions.`,
      `${name} has films showing. Pick one and sit back.`,
    ],
  };

  // Simple hash to pick variant
  const hash = name.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const primaryTag = tags[0] || 'explore';
  const variants = templates[primaryTag] || templates.explore!;
  const blurb = variants[hash % variants.length];

  const cuisineLine = cuisine ? ` Known for ${cuisine}.` : '';
  const locationHint = address ? ` At ${address}.` : '';
  return `${blurb}${cuisineLine}${locationHint}`;
};

// ── Confidence scoring ─────────────────────────────────────────────────
const computeConfidence = (
  hasOpeningHours: boolean,
  openStatus: string,
  hasCuisine: boolean,
): number => {
  let score = 0.55;
  if (hasOpeningHours) score += 0.1;
  if (openStatus === 'open_now') score += 0.1;
  else if (openStatus === 'opens_soon') score += 0.05;
  if (hasCuisine) score += 0.05;
  return Math.min(0.85, score);
};

// ── Main export ────────────────────────────────────────────────────────
export const fetchOsmSuggestions = async (
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
): Promise<Suggestion[]> => {
  if (!location.lat || !location.lng) return [];

  const radiusKm = Math.max(1, Math.min(prefs.radiusKm || 5, 25));
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
    const seen = new Map<string, { lat: number; lng: number }>();

    return elements
      .map((element: any) => {
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;
        if (!lat || !lon) return null;

        const rawTags = element.tags || {};
        const name = rawTags.name || rawTags.brand;
        if (!name) return null; // Skip unnamed POIs

        const tags = extractTags(rawTags);
        if (!tags.length) return null;

        // Deduplicate: skip same name+tag within ~200m
        const dedupKey = `${name.toLowerCase()}_${tags[0]}`;
        const prev = seen.get(dedupKey);
        if (prev) {
          const dlat = Math.abs(prev.lat - lat);
          const dlng = Math.abs(prev.lng - lon);
          if (dlat < 0.002 && dlng < 0.002) return null;
        }
        seen.set(dedupKey, { lat, lng: lon });

        const durationMin = estimateDuration(tags);
        const ohStatus = parseOpeningStatus(rawTags.opening_hours, now);
        const cuisine = rawTags.cuisine
          ? rawTags.cuisine.split(';')[0].replace(/_/g, ' ')
          : undefined;

        const whyNow = buildWhyNow(ohStatus.openStatus, ohStatus.opensInMin, ohStatus.closesInMin);
        const confidence = computeConfidence(!!rawTags.opening_hours, ohStatus.openStatus, !!cuisine);

        const addressParts = [rawTags['addr:street'], rawTags['addr:housenumber']].filter(Boolean);
        const address = addressParts.length ? addressParts.join(' ') : undefined;
        const description = generateOsmPlaceBlurb(name, tags, cuisine, address);
        const costHint = rawTags.fee === 'no' || rawTags.access === 'yes'
          ? 'Free'
          : rawTags.fee === 'yes' ? '$' : undefined;

        return {
          id: `osm_${element.id}`,
          type: 'GO_OUT',
          source: 'curated',
          title: name,
          description,
          durationMin,
          tags,
          openStatus: ohStatus.openStatus,
          opensInMin: ohStatus.opensInMin,
          closesInMin: ohStatus.closesInMin,
          place: { name, lat, lng: lon, address, costHint },
          confidence,
          whyNow,
        } as Suggestion;
      })
      .filter(Boolean) as Suggestion[];
  };

  const filterByWindow = (items: Suggestion[]) => items.filter((suggestion) => {
    if (!availabilityEnd) return true;
    const latestEnd = new Date(now.getTime() + suggestion.durationMin * 60000);
    return latestEnd <= availabilityEnd;
  });

  const sortByOpenStatus = (items: Suggestion[]) => {
    const priority: Record<string, number> = { open_now: 0, opens_soon: 1, unknown: 2 };
    return items.sort((a, b) => {
      const pa = priority[a.openStatus ?? 'unknown'] ?? 2;
      const pb = priority[b.openStatus ?? 'unknown'] ?? 2;
      if (pa !== pb) return pa - pb;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  };

  const runQuery = async (queryFilters: string[]) => {
    addDebugMessage('osm', `Querying Overpass (${queryFilters.length} filters, ${radius}m).`);
    const query = buildOverpassQuery(location.lat!, location.lng!, radius, queryFilters);
    const data = await fetchOverpass(query);
    if (!data?.elements) {
      addDebugMessage('osm', 'No elements in Overpass response.');
      return [];
    }
    addDebugMessage('osm', `Overpass returned ${data.elements.length} raw elements.`);
    const mapped = mapElements(data.elements);
    const windowed = filterByWindow(mapped);
    return sortByOpenStatus(windowed).slice(0, 20);
  };

  let suggestions = await runQuery(activeFilters);
  if (suggestions.length < 3 && activeFilters !== DEFAULT_FILTERS) {
    addDebugMessage('osm', 'Few results — widening to default filters.');
    suggestions = await runQuery(DEFAULT_FILTERS);
  }
  if (suggestions.length < 3) {
    addDebugMessage('osm', 'Few results — using broad filters.');
    suggestions = await runQuery(BROAD_FILTERS);
  }

  if (!suggestions.length) {
    addDebugMessage('osm', 'No results from Overpass.');
    return [];
  }

  suggestions = suggestions.slice(0, 15);
  cache.set(cacheKey, { ts: Date.now(), data: suggestions });
  addDebugMessage('osm', `Returning ${suggestions.length} suggestions (${suggestions.filter((s) => s.openStatus === 'open_now').length} open now).`);
  return suggestions;
};
