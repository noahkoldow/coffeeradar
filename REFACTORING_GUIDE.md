# CoffeeRadar: Code Consolidation Guide

## Priority Refactorings with Code Examples

---

## 1. CRITICAL: Consolidate Google Places + OSM (Save ~400 LOC)

### Current Problem

Two services doing 70% overlapping work:
- `src/services/googlePlaces.ts` (403 LOC)
- `src/services/osmPlaces.ts` (512 LOC)
- Both: parse, tag-map, score, generate descriptions

**Duplicate logic:**
```typescript
// Both do this independently:
const buildAppeal(tags, openStatus, opensInMin, rating) { ... }
const generatePlaceBlurb(name, types, rating, address) { ... }
const computeConfidence(hasOpeningHours, rating, ratingCount) { ... }
```

### Solution: Create `venueService.ts` with Adapter Pattern

**New file: `src/services/venueService.ts`**

```typescript
// ============ SHARED VENUE LOGIC ============
export type VenueProvider = 'google' | 'osm';

export interface VenueSourceAdapter {
  fetchVenues(location, prefs, availability): Promise<RawVenue[]>;
  parseVenueResponse(raw): RawVenue[];
  mapTypesToTags(types: string[]): string[];
}

// Shared parsing & scoring
const SHARED_TAG_MAP: Record<string, string> = {
  cafe: 'coffee',
  restaurant: 'food',
  museum: 'art',
  park: 'nature',
  // ... shared across both providers
};

// Shared enrichment
export function enrichVenue(raw: RawVenue): Suggestion {
  const tags = SHARED_TAG_MAP[raw.primaryType] ? [SHARED_TAG_MAP[raw.primaryType]] : [];
  const confidence = computeConfidence(
    !!raw.openingHours,
    raw.rating,
    raw.ratingCount
  );
  
  return {
    id: `venue_${raw.id}`,
    type: 'GO_OUT',
    title: raw.name,
    description: generatePlaceBlurb(raw.name, tags),
    duration: estimateDurationForTags(tags),
    place: { name: raw.name, lat: raw.lat, lng: raw.lng, address: raw.address },
    rating: raw.rating,
    ratingCount: raw.ratingCount,
    openStatus: raw.openStatus,
    opensInMin: raw.opensInMin,
    closesInMin: raw.closesInMin,
    tags,
    confidence,
  };
}

// ============ PROVIDER-SPECIFIC ADAPTERS ============

class GooglePlacesAdapter implements VenueSourceAdapter {
  async fetchVenues(location, prefs, availability) {
    const url = buildUrl(NEARBY_URL, {
      location: `${location.lat},${location.lng}`,
      radius: prefs.radiusKm * 1000,
      key: GOOGLE_PLACES_KEY,
    });
    const response = await fetch(url);
    return response.json().results || [];
  }
  
  parseVenueResponse(results) {
    return results.map(r => ({
      id: r.place_id,
      name: r.name,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      address: r.vicinity,
      types: r.types,
      rating: r.rating,
      ratingCount: r.user_ratings_total,
      openStatus: r.opening_hours?.open_now ? 'open_now' : 'unknown',
    }));
  }
  
  mapTypesToTags(types: string[]) {
    return types
      .map(t => GOOGLE_TYPES_TO_APP_TAGS[t])
      .filter(Boolean);
  }
}

class OSMAdapter implements VenueSourceAdapter {
  async fetchVenues(location, prefs, availability) {
    const query = buildOverpassQuery(location.lat, location.lng, prefs.radiusKm * 1000, DEFAULT_FILTERS);
    const response = await fetchOverpass(query);
    return response.elements || [];
  }
  
  parseVenueResponse(elements) {
    return elements
      .filter(e => e.lat && e.lon)
      .map(e => ({
        id: e.id,
        name: e.tags?.name || 'Unnamed',
        lat: e.lat,
        lng: e.lon,
        address: e.tags?.['addr:street'],
        tags: extractTags(e.tags),
        rating: null,  // OSM doesn't have ratings
        ratingCount: null,
        openStatus: parseOpeningStatus(e.tags?.['opening_hours'], now),
      }));
  }
  
  mapTypesToTags(osmTags: string[]) {
    return osmTags; // Already app tags
  }
}

// ============ MAIN FETCH LOGIC ============

export async function fetchVenues(
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  fallbackToOSM = true
): Promise<Suggestion[]> {
  const googleAdapter = new GooglePlacesAdapter();
  const osmAdapter = new OSMAdapter();
  
  try {
    const raw = await googleAdapter.fetchVenues(location, prefs, availability);
    const parsed = googleAdapter.parseVenueResponse(raw);
    return parsed.map(enrichVenue);
  } catch (error) {
    addDebugMessage('venues', `Google failed: ${error.message}`);
    
    if (fallbackToOSM) {
      try {
        const raw = await osmAdapter.fetchVenues(location, prefs, availability);
        const parsed = osmAdapter.parseVenueResponse(raw);
        return parsed.map(enrichVenue);
      } catch (error2) {
        addDebugMessage('venues', `OSM failed: ${error2.message}`);
        return [];
      }
    }
    return [];
  }
}
```

### Migration Path

**Step 1: Create venueService.ts** with shared logic above

**Step 2: Update suggestions.ts**
```typescript
// Before:
const places = await Promise.all([
  fetchGooglePlacesSuggestions(),
  fetchOsmSuggestions()
]);

// After:
const places = await fetchVenues(location, prefs, availability);
```

**Step 3: Deprecate old files**
```typescript
// googlePlaces.ts
export async function fetchGooglePlacesSuggestions(...) {
  console.warn('DEPRECATED: Use venueService.fetchVenues() instead');
  return fetchVenues(location, prefs, availability, false); // Google-only
}

// osmPlaces.ts
export async function fetchOsmSuggestions(...) {
  console.warn('DEPRECATED: Use venueService.fetchVenues() with fallback');
  // Removed in next version
}
```

**Step 4: Remove after 2 release cycles**

### Benefits
- ✅ Eliminate 400 LOC duplication
- ✅ Single source of truth for venue parsing
- ✅ Consistent tag mapping & confidence scoring
- ✅ Easier to add new providers (TripAdvisor, Foursquare, etc.)
- ✅ Unified caching strategy

---

## 2. HIGH: Remove Unused SeatGeek (Save ~100 LOC)

### Current Problem

`seatgeek.ts` (98 LOC) is:
- Imported in SettingsScreen for manual testing only
- Never called in `buildDeck()`
- Overlaps with Ticketmaster (same event discovery)

### Solution: Delete & Document

**Remove:**
- `src/services/seatgeek.ts`
- Import from SettingsScreen

**Document in git:**
```
commit: "refactor: remove seatgeek, consolidate to ticketmaster"

SeatGeek was experimental event discovery backup to Ticketmaster.
Unused in production deck builds. If needed in future, could be
re-added as fallback provider in eventService.ts abstraction.

Services consolidated:
  - seatgeek.ts → deprecated
  - Events now: Ticketmaster only
```

### Code Changes

**SettingsScreen.tsx (before):**
```typescript
import { fetchSeatGeekSuggestions } from '../services/seatgeek';

// In render:
<Button onPress={() => fetchSeatGeekSuggestions(...)} />
```

**SettingsScreen.tsx (after):**
```typescript
// Remove seatgeek import
// Remove SeatGeek test button
```

**suggestions.ts (no change needed — seatgeek never used there)**

---

## 3. MEDIUM: Extract Event Service (Save ~200 LOC refactoring)

### Current Problem

Ticketmaster-only, but could be abstracted like venues for future extensibility.

### Optional Refactoring

```typescript
// src/services/eventService.ts

interface EventProvider {
  fetchEvents(location, prefs, availability): Promise<Suggestion[]>;
}

class TicketmasterProvider implements EventProvider {
  // Existing ticketmaster.ts logic here
}

// Future: ies StubHub, Eventbrite, etc.
class EventbriteProvider implements EventProvider { }

export async function fetchEvents(
  location, prefs, availability,
  providers: EventProvider[] = [new TicketmasterProvider()]
): Promise<Suggestion[]> {
  const all = await Promise.allSettled(
    providers.map(p => p.fetchEvents(location, prefs, availability))
  );
  
  return all
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value || []);
}
```

**Effort**: ~1 hour | **Benefit**: Future-proofing, not urgent

---

## 4. MEDIUM: Deduplicate Place Descriptions

### Current Problem

Both Google and OSM generate blurbs independently with different logic:

**googlePlaces.ts:**
```typescript
const templates: Record<string, string[]> = {
  cafe: [
    `${name} — a solid coffee spot nearby.`,
    `Pop into ${name} for a coffee...`,
  ],
  // 14 more type templates
};
```

**osmPlaces.ts:**
```typescript
const templates: Record<string, string[]> = {
  coffee: [
    `${name} — a solid coffee spot nearby.`,
    `Pop into ${name} for a coffee...`,
  ],
  // 12 more tag templates
};
```

### Solution: Extract to `descriptionTemplates.ts`

```typescript
// src/services/descriptionTemplates.ts

export const PLACE_TEMPLATES: Record<string, string[]> = {
  coffee: [
    `${name} — a solid coffee spot nearby. Grab a drink, settle in.`,
    `Pop into ${name} for a coffee and a change of pace.`,
    `${name} is the kind of café where you can just sit and let time pass.`,
  ],
  food: [
    `${name} — great place for a meal. Sit down, order something good.`,
    `Hungry? ${name} is nearby and calling your name.`,
    `Treat yourself to a meal at ${name}. No cooking, no cleanup.`,
  ],
  // ... 12+ more
};

export function generatePlaceDescription(
  name: string,
  primaryTag: string | undefined,
  address?: string
): string {
  const tag = primaryTag || 'explore';
  const templates = PLACE_TEMPLATES[tag] || PLACE_TEMPLATES.explore;
  const hash = hashString(name);
  const description = templates[hash % templates.length];
  return address ? `${description} At ${address}.` : description;
}

// Helper
function hashString(str: string): number {
  return str.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0);
}
```

**Update both files:**
```typescript
// googlePlaces.ts
import { generatePlaceDescription } from './descriptionTemplates';

// Replace: const templates = { ... }
// Replace: const blurb = variants[hash % variants.length]

const blurb = generatePlaceDescription(name, primaryTag, address);
```

**Effort**: ~30 min | **Savings**: ~100 LOC

---

## 5. MEDIUM: Add Rate-Limit Backoff

### Current Problem

No retry logic for API failures. If Google Places quota exceeded:
- Silently returns `[]`
- Deck builds without venues
- User sees degraded experience

### Solution: Add Exponential Backoff

```typescript
// src/utils/apiRetry.ts

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  multiplier?: number;
  timeout?: number;
}

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T | null> {
  const {
    maxRetries = 3,
    baseDelayMs = 100,
    multiplier = 2,
    timeout = 5000
  } = options;

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), timeout)
        )
      ]);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(multiplier, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  addDebugMessage('retry', `Failed after ${maxRetries} attempts: ${lastError?.message}`);
  return null;
}

// Circuit breaker
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold = 5;
  private readonly resetTimeMs = 60000;

  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.isOpen()) {
      addDebugMessage('circuit', 'Circuit breaker is OPEN');
      return null;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isOpen() {
    return (
      this.failureCount >= this.threshold &&
      Date.now() - this.lastFailureTime < this.resetTimeMs
    );
  }

  private onSuccess() {
    this.failureCount = 0;
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }
}
```

**Update suggestions.ts:**
```typescript
import { withExponentialBackoff, CircuitBreaker } from '../utils/apiRetry';

const googleCB = new CircuitBreaker();
const ticketmasterCB = new CircuitBreaker();

const seedSuggestions = async (...) => {
  const venues = await withExponentialBackoff(
    () => fetchGooglePlacesSuggestions(...),
    { maxRetries: 2, timeout: 2500 }
  );
  
  const events = await withExponentialBackoff(
    () => ticketmasterCB.execute(() => fetchTicketmasterSuggestions(...)),
    { maxRetries: 1, timeout: 2500 }
  );
  
  // ...
};
```

**Effort**: ~2 hours | **Benefit**: Production resilience

---

## 6. LOW: Consolidate Venue Type Mappings

### Current Problem

Three separate type→tag maps:
- `googlePlaces.ts`: TYPE_TAG_MAP (16 entries)
- `osmPlaces.ts`: TAG_LABELS (24 entries)
- `ticketmaster.ts`: SEGMENT_TAG_MAP + GENRE_TAG_MAP

```typescript
// googlePlaces.ts
const TYPE_TAG_MAP: Record<string, string> = {
  restaurant: 'food',
  cafe: 'coffee',
  park: 'nature',
  // ...
};

// osmPlaces.ts
const TAG_LABELS: Record<string, string> = {
  restaurant: 'food',
  cafe: 'coffee',
  park: 'nature',
  // ... same entries redefined
};
```

### Optional Solution

```typescript
// src/services/typeMapping.ts

export const UNIVERSAL_TYPE_MAP: Record<string, string> = {
  // Google Places types
  'restaurant': 'food',
  'cafe': 'coffee',
  'park': 'nature',
  'art_gallery': 'art',
  'library': 'learning',
  'gym': 'fitness',
  
  // OSM tags
  'amenity_restaurant': 'food',
  'amenity_cafe': 'coffee',
  'leisure_park': 'nature',
  'tourism_museum': 'art',
  'amenity_library': 'learning',
  'leisure_fitness_centre': 'fitness',
  
  // Ticketmaster segments
  'segment_music': 'music',
  'segment_sports': 'fitness',
  'segment_theatre': 'art',
};

export function normalizeTypeToTag(type: string, source: 'google' | 'osm' | 'ticketmaster'): string | undefined {
  const key = source === 'google' 
    ? type 
    : source === 'osm' 
      ? type 
      : `segment_${type}`;
  
  return UNIVERSAL_TYPE_MAP[key];
}
```

**Effort**: ~30 min | **Benefit**: Maintainability, not urgent

---

## 7. Refactoring Checklist

| Priority | Task | Files | LOC Saved | Effort | Blocking |
|----------|------|-------|-----------|--------|----------|
| 🔴 Critical | Consolidate Google + OSM | venueService.ts, googlePlaces, osmPlaces | ~400 | 4h | No |
| 🔴 High | Remove SeatGeek | seatgeek.ts, SettingsScreen | ~100 | 15m | No |
| ⚠️ Medium | Add rate-limit backoff | apiRetry.ts, suggestions.ts | — | 2h | No |
| ⚠️ Medium | Extract event service | eventService.ts, ticketmaster | ~50 | 1h | No |
| ⚠️ Medium | Deduplicate templates | descriptionTemplates.ts | ~100 | 30m | No |
| ⚠️ Low | Consolidate type maps | typeMapping.ts | ~50 | 30m | No |
| — | **TOTAL** | — | **~700 LOC** | **~8h** | — |

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
1. Create `venueService.ts` abstraction
2. Add `apiRetry.ts` utilities
3. Add comprehensive tests

### Phase 2: Migration (Week 2)
1. Update `suggestions.ts` to use new services
2. Deprecate old files (keep stubs)
3. Test on staging

### Phase 3: Cleanup (Week 3)
1. Remove deprecated files
2. Update documentation
3. Monitor production for issues

---

**End of Consolidation Guide**
