/**
 * Location profile detector — runs a single Overpass query at startup
 * to classify the user's area as coastal / urban / suburban.
 *
 * The result is cached and only re-detected when the user moves
 * more than ~5 km from the last detection point.
 */

import { LocationProfile } from '../types';
import { loadLocationProfile, saveLocationProfile } from '../utils/storage';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const REDETECT_DISTANCE_KM = 5;
const HOME_AREA_RADIUS_KM = 30;
const TRAVEL_START_DISTANCE_KM = 80;
const TRAVEL_BIAS_DAYS = 3;
type TravelPurpose = 'sightseeing' | 'business' | 'unknown';

/** Haversine distance (km) — lightweight copy to avoid circular imports */
const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Query Overpass for a count of specific POI types within a radius.
 * Returns a map of { queryLabel: count }.
 */
const overpassCounts = async (
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ water: number; cafes: number; shops: number; parks: number; beaches: number }> => {
  // Count water bodies, cafés, shops, parks, and beaches in a single query
  const query = `
[out:json][timeout:10];
(
  way["natural"="water"](around:${radiusM},${lat},${lng});
  way["natural"="coastline"](around:${radiusM},${lat},${lng});
  way["natural"="beach"](around:${radiusM},${lat},${lng});
  node["natural"="beach"](around:${radiusM},${lat},${lng});
  node["amenity"="cafe"](around:${radiusM},${lat},${lng});
  node["shop"](around:${radiusM},${lat},${lng});
  way["leisure"="park"](around:${radiusM},${lat},${lng});
);
out count;
`;
  // We'll use a lighter approach: tag-specific counts via 3 small queries
  // But for efficiency let's do one combined query and parse element tags
  const countQuery = `
[out:json][timeout:12];
(
  way["natural"="water"](around:${radiusM},${lat},${lng});
  way["natural"="coastline"](around:${radiusM},${lat},${lng});
);
out count;
`;
  const beachQuery = `
[out:json][timeout:12];
(
  way["natural"="beach"](around:${radiusM},${lat},${lng});
  node["natural"="beach"](around:${radiusM},${lat},${lng});
  node["leisure"="beach_resort"](around:${radiusM},${lat},${lng});
);
out count;
`;
  const densityQuery = `
[out:json][timeout:12];
(
  node["amenity"="cafe"](around:${radiusM},${lat},${lng});
  node["shop"](around:${radiusM * 0.5},${lat},${lng});
  way["leisure"="park"](around:${radiusM},${lat},${lng});
);
out count;
`;

  const fetchCount = async (q: string): Promise<number> => {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(q)}`,
        });
        if (!res.ok) continue;
        const json = await res.json();
        // Overpass "out count" puts total in elements[0].tags.total
        const total = json.elements?.[0]?.tags?.total;
        return total ? parseInt(total, 10) : (json.elements?.length ?? 0);
      } catch {
        continue;
      }
    }
    return 0;
  };

  const [waterCount, beachCount, densityText] = await Promise.all([
    fetchCount(countQuery),
    fetchCount(beachQuery),
    fetchCount(densityQuery),
  ]);

  // densityText is a combined count of cafés + shops + parks
  // We'll estimate individual counts via ratios from a second pass — but
  // for classification purposes the combined number is enough.
  return {
    water: waterCount,
    beaches: beachCount,
    cafes: Math.round(densityText * 0.3), // rough estimate
    shops: Math.round(densityText * 0.5),
    parks: Math.round(densityText * 0.2),
  };
};

/**
 * Classify the area and return tag boosts.
 */
const classify = (
  counts: { water: number; beaches: number; cafes: number; shops: number; parks: number },
): { label: LocationProfile['label']; boosts: Record<string, number> } => {
  const { water, beaches, cafes, shops, parks } = counts;
  const density = cafes + shops + parks;

  // Coastal: significant water/coastline AND beaches nearby
  if ((water >= 2 || beaches >= 1) && beaches >= 1) {
    return {
      label: 'coastal',
      boosts: {
        nature: 0.12,
        explore: 0.1,
        fitness: 0.08,
        wellness: 0.1,
        // Beach-adjacent tags boosted
        __coastal: 0.15,
      },
    };
  }

  // Urban: high POI density
  if (density >= 30) {
    return {
      label: 'urban',
      boosts: {
        coffee: 0.1,
        food: 0.1,
        art: 0.08,
        explore: 0.08,
        social: 0.1,
        music: 0.06,
        movies: 0.06,
      },
    };
  }

  // Suburban: moderate density, more parks
  if (density >= 8) {
    return {
      label: 'suburban',
      boosts: {
        nature: 0.1,
        fitness: 0.08,
        wellness: 0.06,
        explore: 0.06,
      },
    };
  }

  return { label: 'unknown', boosts: {} };
};

const mergeBoosts = (...sets: Array<Record<string, number>>): Record<string, number> => {
  const merged: Record<string, number> = {};
  for (const current of sets) {
    for (const [tag, value] of Object.entries(current)) {
      merged[tag] = (merged[tag] ?? 0) + value;
    }
  }
  return merged;
};

const inferTravelPurpose = (
  counts: { water: number; beaches: number; cafes: number; shops: number; parks: number },
): TravelPurpose => {
  const scenicSignal = counts.beaches * 2 + counts.parks + counts.water;
  const businessSignal = counts.cafes + counts.shops;
  if (scenicSignal >= 6) return 'sightseeing';
  if (businessSignal >= 35 && scenicSignal <= 2) return 'business';
  return 'sightseeing';
};

const travelPurposeBoosts = (
  purpose: TravelPurpose,
): Record<string, number> => {
  if (purpose === 'business') {
    return {
      coffee: 0.12,
      productivity: 0.12,
      food: 0.08,
      social: 0.06,
    };
  }
  if (purpose === 'sightseeing') {
    return {
      explore: 0.16,
      art: 0.12,
      nature: 0.1,
      food: 0.08,
      social: 0.06,
    };
  }
  return {
    explore: 0.08,
    food: 0.05,
  };
};

const resolveHomeBase = (
  cached: LocationProfile | null,
  lat: number,
  lng: number,
  nowIso: string,
) => {
  const existing = cached?.homeBase;
  if (!existing) {
    return {
      lat,
      lng,
      establishedAt: nowIso,
      updatedAt: nowIso,
      sampleCount: 1,
    };
  }

  const distToHome = haversine(existing.lat, existing.lng, lat, lng);
  if (distToHome > HOME_AREA_RADIUS_KM) {
    return {
      ...existing,
      updatedAt: nowIso,
    };
  }

  // Blend nearby points so the home anchor slowly adapts without jumping.
  const nextCount = Math.min((existing.sampleCount ?? 1) + 1, 120);
  const weight = 1 / nextCount;
  return {
    ...existing,
    lat: existing.lat * (1 - weight) + lat * weight,
    lng: existing.lng * (1 - weight) + lng * weight,
    updatedAt: nowIso,
    sampleCount: nextCount,
  };
};

/**
 * Detect (or load cached) location profile for the user's current position.
 * Call this once on HomeScreen mount — it's cheap and cached.
 */
export const detectLocationProfile = async (
  lat: number,
  lng: number,
  userId?: string | null,
): Promise<LocationProfile> => {
  const now = new Date();
  const nowIso = now.toISOString();
  // 1. Try cache
  const cached = await loadLocationProfile(userId);
  if (cached) {
    const dist = haversine(cached.lat, cached.lng, lat, lng);
    if (dist < REDETECT_DISTANCE_KM) {
      return cached;
    }
  }

  // 2. Query Overpass
  try {
    const counts = await overpassCounts(lat, lng, 3000); // 3 km radius
    const { label, boosts: baseBoosts } = classify(counts);
    const homeBase = resolveHomeBase(cached, lat, lng, nowIso);
    const distanceFromHomeKm = haversine(homeBase.lat, homeBase.lng, lat, lng);

    const isAwayFromHome = distanceFromHomeKm >= TRAVEL_START_DISTANCE_KM;
    const existingTravel = cached?.travelContext;
    let travelContext: LocationProfile['travelContext'] | undefined;
    let boosts = baseBoosts;

    if (isAwayFromHome) {
      const inferredPurpose = inferTravelPurpose(counts);
      const startedAt = existingTravel?.active ? existingTravel.startedAt : nowIso;
      const expiresAtDate = new Date(new Date(startedAt).getTime() + TRAVEL_BIAS_DAYS * 24 * 60 * 60 * 1000);
      const expiresAt = expiresAtDate.toISOString();
      const active = now.getTime() <= expiresAtDate.getTime();

      travelContext = {
        active,
        inferredPurpose,
        startedAt,
        expiresAt,
        distanceFromHomeKm,
      };

      if (active) {
        boosts = mergeBoosts(baseBoosts, travelPurposeBoosts(inferredPurpose));
      }
    }

    const profile: LocationProfile = {
      label,
      boosts,
      lat,
      lng,
      detectedAt: nowIso,
      homeBase,
      ...(travelContext ? { travelContext } : {}),
    };
    await saveLocationProfile(profile, userId);
    console.log('[LocationProfile] Detected:', label, boosts, travelContext ? { travelContext } : {});
    return profile;
  } catch (err) {
    console.warn('[LocationProfile] Detection failed, using unknown', err);
    const fallback: LocationProfile = {
      label: 'unknown',
      boosts: {},
      lat,
      lng,
      detectedAt: nowIso,
      homeBase: resolveHomeBase(cached, lat, lng, nowIso),
    };
    return fallback;
  }
};
