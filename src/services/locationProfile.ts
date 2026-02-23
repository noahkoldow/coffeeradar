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

/**
 * Detect (or load cached) location profile for the user's current position.
 * Call this once on HomeScreen mount — it's cheap and cached.
 */
export const detectLocationProfile = async (
  lat: number,
  lng: number,
  userId?: string | null,
): Promise<LocationProfile> => {
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
    const { label, boosts } = classify(counts);
    const profile: LocationProfile = {
      label,
      boosts,
      lat,
      lng,
      detectedAt: new Date().toISOString(),
    };
    await saveLocationProfile(profile, userId);
    console.log('[LocationProfile] Detected:', label, boosts);
    return profile;
  } catch (err) {
    console.warn('[LocationProfile] Detection failed, using unknown', err);
    const fallback: LocationProfile = {
      label: 'unknown',
      boosts: {},
      lat,
      lng,
      detectedAt: new Date().toISOString(),
    };
    return fallback;
  }
};
