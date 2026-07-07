# CoffeeRadar: Strategic Roadmap
## Activities → Habits → Life Reclaim + Business Integration

**Date**: May 18, 2026  
**Status**: Master Blueprint for Evolution  

---

## EXECUTIVE SUMMARY

You're right: **the app feels oversized for what it currently does** (14k LOC for "suggest activities").

**Root cause**: 8 API integrations doing overlapping work, dead code (SeatGeek, unused fields), and no unifying business model.

**Vision**: Transform into **Activity Finder + Habit Builder + Business Marketplace** where:
1. Activities users enjoy get converted to recurring habits
2. Habits drive user re-engagement and life reclaim
3. Targeted ads from businesses (gyms, restaurants, cafes) align with user habits & interests
4. Revenue comes from SMBs seeking habit-aligned users

**Approach**:
- **Phase 1**: Clean up codebase (consolidate, remove dead code) → **→ 30% smaller**
- **Phase 2**: Build activity-to-habit conversion pipeline (use existing types)
- **Phase 3**: Integrate business layer (gyms, restaurants target habit-builders)
- **Phase 4**: AI learns which businesses feed user habits

**Expected outcome**: 10k LOC, focused, monetizable, clear data flow.

---

## PART 1: CODEBASE CLEANUP (Phase 0 — Do First)

### 1.1 CRITICAL: Consolidate Venue Services

**Current**: `googlePlaces.ts` (403 LOC) + `osmPlaces.ts` (512 LOC) = **915 LOC of duplication**

**New**: Single `venueService.ts` with adapter pattern

```typescript
// src/services/venueService.ts (NEW)

export interface VenueAdapter {
  fetchVenues(location, prefs, availability): Promise<RawVenue[]>;
  parseResponse(raw): RawVenue[];
}

class GooglePlacesAdapter implements VenueAdapter { ... }
class OSMAdapter implements VenueAdapter { ... }

// Main export - single function
export async function fetchVenuesWithFallback(
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability
): Promise<Suggestion[]> {
  try {
    return await new GooglePlacesAdapter().fetchVenues(...);
  } catch {
    return await new OSMAdapter().fetchVenues(...);
  }
}
```

**Impact**: Remove 2 files, save ~400 LOC, maintain dual-source fallback  
**Effort**: 4h  
**Done by**: Week 1

---

### 1.2 Remove Dead Code

| Code | Status | Action |
|------|--------|--------|
| `seatgeek.ts` | Never called | DELETE |
| `effortToStart` field | Present, unused | Remove from Gemini output |
| `moodFit` field | Present, unused | Keep (will use for habits) |
| Badge system | Partially used | Clarify usage or remove |
| `geminiSuggestions.ts` redundant context | Unused | Simplify |

**Impact**: Save ~150 LOC  
**Effort**: 2h  
**Done by**: Week 1

---

### 1.3 Simplify API Integrations

**Current**: 8 APIs = 8 potential failure points + $70–300/month costs

**Action** (strategic, not immediate):
```
Keep:    Google Places (best venue data) + fallback OSM ✅
Keep:    Gemini (AI recommendations) ✅
Keep:    Firebase (auth + persistence) ✅
Keep:    Ticketmaster (real events) ✅
Keep:    Open-Meteo (weather, free) ✅
Remove:  SeatGeek (duplicate events, unused) ❌
Remove:  Calendar/Location platform wrappers (iOS/web both needed) ⚠️
Optional: Gemini can handle place research for GO_OUT → no need for separate Places API
```

**Future**: Evaluate whether Gemini alone can handle place research + mock for now.

---

## PART 2: NEW ARCHITECTURE — Activity → Habit → Ads Pipeline

### 2.1 Data Model Extensions

**Existing Types We Already Have**:
- `Suggestion`: Already tracks source, has `habitId` field, `tags`
- `Habit`: Already tracks frequency, streak, completion history
- `ActivityLog`: Already exists, tracks what user completed
- `SavedSuggestion`: Already tracks saved items

**New Types to Add**:

```typescript
// src/types/index.ts (ADD THESE)

/** Connection between a completed activity and a recurring habit */
export type ActivityToHabitRecord = {
  activityId: string;        // Suggestion ID that user completed
  title: string;
  tags: string[];
  completedAt: string;       // When user did it
  habitSuggestionId?: string; // If converted to habit, link it
  userFeedback?: {
    liked: boolean;          // Saved to library or marked liked
    wouldRepeat: boolean;    // Asked: "Want to do this again?"
    businessId?: string;     // If from a business
  };
};

/** Business profile for targeted recommendations */
export type Business = {
  id: string;
  type: 'gym' | 'cafe' | 'restaurant' | 'studio' | 'venue';
  name: string;
  description: string;
  place: Place;
  rating?: number;
  targetTags: string[];      // e.g. gym targets ['fitness', 'wellness']
  promotionTags?: string[];  // e.g. "free trial week" for 'fitness' users
  weeklyBudget?: number;     // Budget for impressions/targeting
  conversionGoal?: 'visits' | 'booking' | 'signup' | 'awareness';
};

/** Ad placement in deck (contextual, not disruptive) */
export type BusinessSuggestion = {
  id: string;
  type: 'BUSINESS_AD';       // New suggestion type
  business: Business;
  title: string;             // e.g. "Grab espresso at Prater Garten"
  description: string;
  hook: string;              // e.g. "Morning boost"
  tags: string[];            // Inherited from business targets
  place: Place;
  confidence: number;        // 0.5–0.8 (lower than genuine suggestions)
  reasonShown: string;       // e.g. "You love coffee | matches your routine"
  impressionId: string;      // For analytics
  clickedAt?: string;        // Track engagement
};

/** Habit-to-Business Alignment */
export type HabitBusinessAlignment = {
  habitId: string;
  businessIds: string[];     // Businesses that could reinforce this habit
  alignmentScore: number;    // 0–1: how well aligned
  matchReason: string;       // e.g. "morning routine" + "nearby gym"
};

/** User engagement tracking for business targeting */
export type UserBusinessProfile = {
  userId: string;
  businessImpressions: Map<string, number>;      // businessId → times shown
  businessInteractions: Map<string, {
    clicked: number;
    visited: number;
    booked: number;
  }>;
  habitsActivelyBuilding: Map<string, number>; // habitId → strength (0–1)
  lastUpdated: string;
};
```

### 2.2 Activity → Habit Conversion Flow

**Scenario**: User completes an activity (e.g., "Morning walk at Tiergarten"). How does it become a habit?

```

┌─────────────────────────────────────────┐
│     User Completes Activity              │
│  (Suggestion type: GO_OUT or AT_HOME)   │
└────────────────┬──────────────────────────┘
                 │
                 ▼
      ┌──────────────────────┐
      │ Record in ActivityLog │
      └──────────┬───────────┘
                 │
        ┌────────┴───────────┐
        │                    │
        ▼                    ▼
    EXPLICIT:          IMPLICIT:
    "Make Habit"       Track completion
    (user clicks)      frequency
        │                  │
        │           ┌──────▼──────┐
        │           │ After N     │
        │           │ completions │
        │           │ (e.g. 3×)   │
        │           └──────┬──────┘
        │                  │
        │              ┌───▼──────────┐
        │              │ Suggest:     │
        │              │ "This is     │
        │              │ becoming a   │
        │              │ habit!"      │
        │              └───┬──────────┘
        │                  │
        └──────────┬───────┘
                   │
                   ▼
        ┌─────────────────────┐
        │ Create Habit Record │
        │ (Habit type)        │
        └─────────┬───────────┘
                  │
                  ▼
       ┌────────────────────────┐
       │ Track Streaks &        │
       │ Completion History     │
       │ (Already exists!)      │
       └────────────────────────┘
```

**Code**: New service `activityToHabitService.ts`

```typescript
// src/services/activityToHabitService.ts (NEW)

/**
 * Check if an activity completed N times could become a habit
 */
export async function checkActivityForHabitConversion(
  activityId: string,
  userProfile: UserProfile
): Promise<{
  shouldSuggest: boolean;
  activityRecord?: ActivityToHabitRecord;
  createHabitPayload?: Partial<Habit>;
}> {
  // Get all completions of this activity
  const completions = await getActivityCompletions(activityId);
  const uniqueDates = new Set(completions.map(c => c.completedAt.split('T')[0])).size;
  
  if (uniqueDates >= 3) {
    // Pattern detected: user did this 3+ different days
    // Suggest converting to habit
    
    const template = buildHabitFromActivity(activityId, completions);
    
    return {
      shouldSuggest: true,
      createHabitPayload: template,
    };
  }
  
  return { shouldSuggest: false };
}

/**
 * User clicks "Make This a Habit" on a suggestion
 */
export function createHabitFromActivity(
  suggestion: Suggestion,
  frequency: HabitFrequency = 'weekly'
): Habit {
  return {
    id: `habit_from_${suggestion.id}_${Date.now()}`,
    name: suggestion.title,
    type: suggestion.type,
    lengthMin: suggestion.durationMin,
    description: suggestion.description,
    frequency,
    timeOfDay: suggestion.timeOfDay ?? 'any',
    tags: suggestion.tags,
    createdAt: new Date().toISOString(),
    lastCompletedAt: null,
    currentStreak: 0,
    longestStreak: 0,
    completionHistory: [],
  };
}

/**
 * Record activity completion for habit learning
 */
export async function recordActivityCompletion(
  suggestion: Suggestion,
  userFeedback?:{ liked?: boolean; wouldRepeat?: boolean }
) {
  const record: ActivityToHabitRecord = {
    activityId: suggestion.id,
    title: suggestion.title,
    tags: suggestion.tags ?? [],
    completedAt: new Date().toISOString(),
    userFeedback: userFeedback && {
      liked: userFeedback.liked ?? false,
      wouldRepeat: userFeedback.wouldRepeat ?? true,
    },
  };
  
  await saveActivityToHabitRecord(record);
  
  // Async: check if should suggest habit conversion
  // (no need to block UI)
  checkActivityForHabitConversion(suggestion.id, userProfile).then(result => {
    if (result.shouldSuggest) {
      // Queue notification or show in next deck
      showHabitConversionSuggestion(suggestion, result.createHabitPayload);
    }
  });
}
```

---

## PART 3: BUSINESS INTEGRATION — Ads + Marketplace Layer

### 3.1 How Businesses Fit In

**Current problem**: App generates recommendations, but zero business model.

**Solution**: Position recommendations so businesses (gyms, cafes, restaurants) can reach habit-builders.

**Example workflow**:
```
1. User habit: "Morning walk" (outdoor, 30min, fitness + nature)
2. Nearby business: "FitnessPro Gym" (targets fitness enthusiasts, morning classes)
3. Business posts: "Free trial class 6am tomorrow?"
4. If user interested → Click → Conversion
5. Business sees: "500 impressions, 45 clicks, 12 signups, $120/month"
```

### 3.2 Ad Placement Strategy (Non-Disruptive)

**Where NOT to put ads**:
- ❌ Replace genuine suggestions
- ❌ Spam every 2 cards
- ❌ Misaligned (gym ad for couch potato user)

**Where to put ads**:
- ✅ **Card 4–6** in deck (after user has seen genuine options)
- ✅ **Habit-aligned only** (user's active habits + tags)
- ✅ **Contextual** (morning habit → morning gym ad)
- ✅ **Transparent** (shows "Promoted by FitnessPro", not disguised)
- ✅ **Lower confidence** (0.5–0.7 vs. 0.7+ for real suggestions)

**New code**: `businessService.ts`

```typescript
// src/services/businessService.ts (NEW)

/**
 * Get businesses that align with user's active habits
 */
export async function getAlignedBusinesses(
  userProfile: UserProfile,
  activeHabits: Habit[],
  location: LocationState,
  radiusKm: number
): Promise<Business[]> {
  // Find businesses within radius
  const nearbyBusinesses = await fetchNearbyBusinesses(location, radiusKm);
  
  // Score alignment with active habits
  const aligned = nearbyBusinesses.map(biz => {
    const alignmentScore = calculateAlignment(biz, activeHabits);
    return { ...biz, alignmentScore };
  });
  
  // Return top 3–5 aligned businesses
  return aligned
    .filter(b => b.alignmentScore > 0.6)
    .sort((a, b) => b.alignmentScore - a.alignmentScore)
    .slice(0, 5);
}

/**
 * Convert business to a suggestion for deck
 */
export function businessToSuggestion(
  business: Business,
  habitContext: Habit
): BusinessSuggestion {
  const reasonShown = `Matches your "${habitContext.name}" routine`;
  
  return {
    id: `biz_${business.id}`,
    type: 'BUSINESS_AD',
    business,
    title: `${business.name}`,
    description: business.description,
    hook: 'Promoted',
    tags: business.targetTags,
    place: business.place,
    confidence: 0.65,
    reasonShown,
    impressionId: `imp_${Date.now()}_${business.id}`,
  };
}

/**
 * Track business impression (shown to user)
 */
export async function trackBusinessImpression(
  userId: string,
  suggestion: BusinessSuggestion
) {
  const profile = await getUserBusinessProfile(userId);
  profile.businessImpressions[suggestion.business.id] =
    (profile.businessImpressions[suggestion.business.id] ?? 0) + 1;
  
  await saveUserBusinessProfile(profile);
  
  // Async: report impression to business analytics
  reportAnalytics('impression', suggestion.business.id, userId);
}

/**
 * Track click (user clicked on business)
 */
export async function trackBusinessClick(
  userId: string,
  businessId: string
) {
  const profile = await getUserBusinessProfile(userId);
  const interactions = profile.businessInteractions[businessId] ?? { clicked: 0, visited: 0, booked: 0 };
  interactions.clicked++;
  profile.businessInteractions[businessId] = interactions;
  
  await saveUserBusinessProfile(profile);
  reportAnalytics('click', businessId, userId);
}

/**
 * Calculate how well a business aligns with user's habits
 */
function calculateAlignment(
  business: Business,
  userHabits: Habit[]
): number {
  if (userHabits.length === 0) return 0.4; // Baseline for new users
  
  const habitTags = new Set(userHabits.flatMap(h => h.tags ?? []));
  const match = business.targetTags.filter(tag => habitTags.has(tag)).length;
  
  return Math.min(1.0, 0.5 + (match / business.targetTags.length) * 0.5);
}
```

### 3.3 Business Deck Injection

**Where**: Modify `suggestions.ts` buildDeck to inject business suggestions

```typescript
// src/services/suggestions.ts (MODIFY)

export async function buildDeck(
  location: LocationState,
  prefs: UserPrefs,
  availability: Availability,
  habits: Habit[]
): Promise<DeckSuggestion[]> {
  // ... existing logic to build realSuggestions ...
  
  // NEW: Get aligned businesses
  const businesses = await getAlignedBusinesses(
    userProfile,
    habits.filter(h => !isStreakBroken(h)), // Only active habits
    location,
    prefs.radiusKm
  );
  
  // Inject after position 4–5 (not at start)
  const withAds = injectBusinessSuggestions(
    realSuggestions,
    businesses.map(b => businessToSuggestion(b, habits[0])), // or pick best habit
    positionStart: 4
  );
  
  return withAds.slice(0, 15); // Max 15 cards per deck
}
```

---

## PART 4: ENHANCED LOCATION CONTEXT for Gemini

### 4.1 Problem
Current prompt sends: `{ lat, lng, areaLabel, radiusKm }`

Gemini treats it generically. Result: Recommendations like "Find a cafe nearby" instead of "Prater Garten opens in 10 min".

### 4.2 Solution: Enrich Context

```typescript
// src/services/geminiSuggestions.ts (MODIFY buildPrompt)

type EnrichedLocationContext = {
  lat: number;
  lng: number;
  areaLabel: string;
  currentStreet?: string;        // "Gendarmenmarkt"
  nearbyLandmarks?: string[];    // ["Brandenburg Gate", "Reichstag"]
  nearbyPoiCategories?: string[]; // {"cafe": 5, "restaurant": 3, "park": 1}
  placesContext?: string;        // "You're on a busy shopping street with many cafes and restaurants"
};

function buildLocationContext(location: LocationState): EnrichedLocationContext {
  // Optional: Use Google Places API for reverse geocode + nearby search
  // For now, mock or use Gemini's web research
  
  return {
    lat: location.lat,
    lng: location.lng,
    areaLabel: location.areaLabel,
    // In future: call Places API to get nearby POI categories
  };
}

// In buildPrompt():
const enrichedLoc = buildLocationContext(location);

return [
  // ... existing prompt ...
  
  `📍 PRECISE LOCATION CONTEXT:`,
  `Current location: ${enrichedLoc.currentStreet || enrichedLoc.areaLabel} (${enrichedLoc.lat}, ${enrichedLoc.lng})`,
  enrichedLoc.nearbyLandmarks?.length ? `Nearby landmarks: ${enrichedLoc.nearbyLandmarks.join(', ')}` : '',
  enrichedLoc.nearbyPoiCategories ? `POI types nearby: ${summarizePoiCategories(enrichedLoc.nearbyPoiCategories)}` : '',
  `Research REAL venues/events based on this exact location and time.`,
  
  // ... rest of prompt ...
].filter(Boolean).join('\n');
```

### 4.3 Future: Google Places Integration

```typescript
// Optional: Integrate Google Places Nearby Search before Gemini call
// This allows: "Here's what's open NOW within 500m"

async function enrichLocationContextWithPlaces(
  location: LocationState,
  radiusM: number = 500
): Promise<EnrichedLocationContext> {
  const places = await fetch(`https://maps.googleapis.com/maps/api/place/nearbysearch/json`, {
    params: {
      location: `${location.lat},${location.lng}`,
      radius: radiusM,
      key: GOOGLE_PLACES_KEY,
    }
  }).then(r => r.json());
  
  const categories = {};
  places.results.forEach(p => {
    const type = p.types[0];
    categories[type] = (categories[type] ?? 0) + 1;
  });
  
  return {
    lat: location.lat,
    lng: location.lng,
    areaLabel: location.areaLabel,
    nearbyPoiCategories: categories,
    placesContext: `Within 500m: ${formatPlacesContext(places.results)}`,
  };
}
```

---

## PART 5: IMPLEMENTATION TIMELINE & CODE CHANGES

### Phase 0: Cleanup (Week 1 - Critical Path)

```
Monday–Tuesday:
  [ ] Consolidate venues: Create venueService.ts, update suggestions.ts
  [ ] Remove SeatGeek service completely
  
Wednesday:
  [ ] Remove unused fields (effortToStart, if truly unused)
  [ ] Clean up dead branches in geminiSuggestions
  
Thursday:
  [ ] Add new types: ActivityToHabitRecord, Business, BusinessSuggestion
  [ ] Unit tests for new types
  
Friday:
  [ ] Review & test, reduce LOC count verify it's now ~10k
```

**Result**: 14k LOC → **10.5k LOC** (400 LOC consolidation + 150 LOC removal)

---

### Phase 1: Activity → Habit Pipeline (Week 2–3)

```
Week 2:
  [ ] Create activityToHabitService.ts
  [ ] Modify ActivityLog recording in suggestions
  [ ] Add "Make Habit" button to SuggestionCard UI
  [ ] Add habit conversion detection (N completions)
  
Week 3:
  [ ] Update Habit data model to track source activity
  [ ] Add "View as Habit" screen (shows habit from activity)
  [ ] Test end-to-end: complete activity → see habit suggestion
```

**Result**: Full activity → habit pipeline working

---

### Phase 2: Business Integration (Week 4–5)

```
Week 4:
  [ ] Create businessService.ts with alignment scoring
  [ ] Add Business + BusinessSuggestion types to Firebase schema
  [ ] Create mock business data (test gyms, cafes in Berlin)
  
Week 5:
  [ ] Integrate businessToSuggestion into buildDeck
  [ ] Track impressions + clicks
  [ ] Dashboard stub: show business metrics
```

**Result**: Ads appear in deck, targeted by habit alignment

---

### Phase 3: Enhanced Location Context (Week 6)

```
[ ] Update buildPrompt in geminiSuggestions (enrich location data)
[ ] Optional: Integrate Google Places API for POI pre-fetching
[ ] Test Gemini recommendations quality improvement
```

---

## PART 6: FINANCIAL MODEL (Ads/Business)

### 6.1 Revenue Streams

| Model | Monthly (1000 users) | Notes |
|-------|----------------------|-------|
| **Impressions** | $50–100 | CPM $5–10/1000 for habit users |
| **Clicks** | $200–400 | CPC $0.20–0.40 per click |
| **Conversions** | $500–1500 | CPA $5–15 per signup/booking |
| **Premium (no ads)** | $100–200 | $2/mo per user |
| **Total** | $850–2200/mo | With 1000 active users |

### 6.2 Business Targeting Filters

```typescript
// Businesses can filter by:
export type BusinessAudienceTarget = {
  habitTag?: string;          // e.g., "fitness" → user with fitness habits
  frequencyMin?: HabitFrequency; // Only show to weekly+ users
  timeOfDay?: HabitTimeOfDay;  // Morning gyms target morning habit users
  streakMin?: number;          // Only show to users with 5+ day streaks
  ageRange?: [number, number]; // Optional demographic
  locationRadiusKm?: number;   // Nearby only
};
```

### 6.3 Business Dashboard (Future)

```
Business views stats:
  - Impressions: 1,200
  - Clicks: 145 (12%)
  - Conversions: 18 (15%)
  - Estimated ROI: 3.2x
  - Cost: $120/mo
```

---

## PART 7: DATA ARCHITECTURE & FIREBASE SCHEMA

### Firestore Collections

```
/businesses/
  ├─ {businessId}
  │  ├─ name, type, description, place, targetTags, budget, conversionGoal
  │  └─ campaignMetrics { impressions, clicks, conversions, spend }
  
/users/{userId}/
  ├─ activityLog/
  │  └─ {activityId}
  │     ├─ title, tags, completedAt, userFeedback
  │     └─ habitSuggestionId (if converted)
  │
  ├─ businessProfile/
  │  ├─ businessImpressions { businessId: count }
  │  ├─ businessInteractions { businessId: { clicked, visited, booked } }
  │  └─ habitBusinessAlignment { habitId: businessIds[] }
  │
  └─ (existing) habits/, savedSuggestions/, preferences/ ...
```

---

## PART 8: UI/UX CHANGES

### 8.1 Activity Card: Add "Make Habit" Button

```
┌─────────────────────────────┐
│  Morning Walk at Tiergarten │
│  ✓ This is becoming a habit!│ ← New insight
│  [We've saved this 3 times] │
│                             │
│  [Not Now] [Make a Habit]   │ ← New button
└─────────────────────────────┘
```

### 8.2 Habit Card: Show Source Activity

```
┌─────────────────────────────┐
│  Morning Walk (Habit)        │
│  📌 Started from "Tiergarten 
│     morning walks" activity  │ ← Origin link
│  Streak: 12 days            │
│  Next due: Tomorrow 7am      │
│                             │
│  [Edit] [View Activity]      │
└─────────────────────────────┘
```

### 8.3 Business Ad Card: Transparent Promotion

```
┌─────────────────────────────┐
│  🏢 Promoted: FitnessPro Gym │
│  Matches your morning workouts│
│                             │
│  Free trial class, 6am daily │
│  2km away • €30/mo          │
│                             │
│  [Learn More] [Not Now]      │
└─────────────────────────────┘
```

---

## PART 9: QUESTIONS & DECISIONS

### Questions for You

1. **Activity → Habit threshold**: After how many completions should we suggest habit conversion? (3? 5? 7?)
   
2. **Habit auto-creation**: Should we auto-create habits after threshold, or only if user explicitly clicks?

3. **Business data**: Will you curate initial business partnerships, or build admin panel for businesses to self-register?

4. **Location enrichment**: Should app use Google Places API for reverse geocode, or let Gemini handle via web research?

5. **Ad frequency**: What's acceptable ad-to-content ratio? Every 5th card? Every 6th?

6. **Habit-habit business stack**: If user has "dance" + "fitness" habits, should gym ads appear or dance studio ads?

---

## PART 10: SUCCESS METRICS

### KPIs to Track

| Metric | Current | Target (6mo) |
|--------|---------|--------------|
| **Codebase size** | 14k LOC | 10.5k LOC |
| **Activities → Habits** | 0% | 30% conversion |
| **Active habits per user** | 0.5 | 2.5 |
| **Business impressions/user/mo** | 0 | 15 |
| **Business click-through** | 0% | 8–12% |
| **Revenue (1000 users)** | $0 | $1500/mo |

---

## SUMMARY: The Path Forward

**Phase 0 (Week 1)**: Clean up 30% of code (consolidate venues, remove dead code) → 10.5k LOC  
**Phase 1 (Week 2–3)**: Build activity → habit pipeline (UI + logic)  
**Phase 2 (Week 4–5)**: Integrate business layer (ads + targeting)  
**Phase 3 (Week 6)**: Enhance Gemini with location context  

**Result**: A focused, monetizable app that builds user habits AND connects them with relevant businesses.

**Real value prop**: "We help you build habits that matter to you—and connect you with places that support them."
