# CoffeeRadar: Data Flow & Architecture Diagrams

## Quick Reference: Service Integration Map

```
EXTERNAL APIS                 INTERNAL SERVICES              APP STATE & UI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Firebase Auth              auth.ts                    AuthScreen
  │                          │
  └──────────────────────────┴─────────────→ AppState.userId
                                                      │
                                                      ├─→ ProfileScreen
                                                      └─→ SettingsScreen

Expo.Calendar              calendar.{native,web}     HomeScreen
  │                          │                          │
  └──────→ Availability ─────┴─────────────→ AppState  │
  │             │                              │        │
  └─────┬───────┴──────────────→ buildDeck()  │        │
        │                           │          │        │
        └───────────────────→ DeckScreen ──────┴─→ PlanScreen
                                      │
                                      ├─→ createPlanEvent
                                      └─→ CompletionScreen

Expo.Location              location.{native,web}    HomeScreen
  │                          │                          │
  └──────→ lat, lng ─────────┼─→ AppState.location    │
                             │        │                │
                             └────────┴───→ buildDeck()

Google Places API          googlePlaces.ts           DeckScreen
  │                          │                         │
  ├──→ Venue list ───────────┼─→ enrichSuggestion()   │
  │    (5min cache)          │        │                │
  │                          │        └─→ DeckSuggestion
  │                          │                │
  └──────────────────────────┴─────→ HabitsScreen
                             │       (rating display)


OpenStreetMap              osmPlaces.ts              DeckScreen
  Overpass                   │  (fallback venue       │
  (Free)                     │   when Google fails)   │
  │                          │                        │
  ├──→ Venue list ───────────┼─→ enrichSuggestion()  │
  │    (5min cache)          │        │               │
  └──────────────────────────┴─→ same display as GP


Ticketmaster API           ticketmaster.ts           DeckScreen
  │                          │                         │
  ├──→ Events list ──────────┼──→ buildDeck()         │
  │    (6h window)           │        │                │
  │                          │        └─→ EVENT suggestions
  └──────────────────────────┘

SeatGeek API               seatgeek.ts               (DEBUG only)
  (Unused)                   │                       SettingsScreen
                             │                         │
                             └──→ [experimental]      │
                                                       v

Gemini 2.5                 geminiSuggestions.ts      DeckScreen
Flash API                    │  (cached 10min)        │
                             │    + prefetch           │
                          ┌──┴──→ buildDeck()         │
                          │        │                  │
                          └─→ GEMINI source cards


Open-Meteo API             weather.ts                DeckScreen
  (Free)                     │  (15min cache)         │
                             │                        │
                          ┌──┴──→ indoorBias score   │
                          │        └─→ Suggestion filter
                          │           & effortMatch
                          └─→ whyNow.ts (copy gen)


Firebase                   user.ts                   AppState
Firestore                    │  (sync on logout,     │
                             │   periodic upload)    └─→ HabitsScreen
                             │                          LibraryScreen
                          ┌──┴──→ loadHabits()          CompletionScreen
                          │        loadAffinities()     ProfileScreen
                          │        loadSavedSuggestions
                          └──→ syncTagAffinities()
                              syncLocationProfile()


Expo.Notifications         notifications.ts         HabitsScreen
                             │                         │
                             └─→ rescheduleReminders   │
                                 (habit-based)         v
```

---

## Detailed: Deck Building Process

```
┌─────────────────────────────────────────────────────────────────────┐
│                    buildDeck() Flow (2.5s Timeout)                  │
└─────────────────────────────────────────────────────────────────────┘

PHASE 1: INPUT ASSEMBLY
══════════════════════════════════════════════════════════════════════
  location: { lat, lng, areaLabel }
  availability: { start, end, durationMin }
  prefs: { radiusKm, interestTags, openToGoingOut, allowSerendipity, lifestyle }
  habits: Habit[]
  weather: WeatherInfo? (may be fetched in parallel)
  tagAffinities: { tag → score }
  locationProfile: LocationProfile?

                           ↓

PHASE 2: CURATED SUGGESTIONS
══════════════════════════════════════════════════════════════════════
  ├─ Filter by time-of-day
  │    └─ Exclude GO_OUT after 21:00
  │    └─ Exclude café activities outside 09:00–18:00
  │    └─ etc.
  │
  ├─ Add user habits (if "due")
  │    └─ isHabitDue() = frequency + lastCompletedAt
  │    └─ matchesTimeOfDay() = habit.timeOfDay matches now
  │
  └─ Prepare curated: atHome + (openToGoingOut ? goOut : [])

                           ↓

PHASE 3: PARALLEL API CALLS (All timeout after 2.5s)
══════════════════════════════════════════════════════════════════════
  Promise.all([
    fetchGeminiSuggestions(location, prefs, availability, weather, learning),
    fetchGooglePlacesSuggestions(location, prefs, availability),
    fetchOsmSuggestions(location, prefs, availability),  [fallback]
    fetchTicketmasterSuggestions(location, prefs, availability),
    fetchSeatGeekSuggestions(...),  [unused in production]
  ]).catch(err → [])  // Return empty on timeout

                           ↓

PHASE 4: ENRICHMENT
══════════════════════════════════════════════════════════════════════
  enrichCuratedWithPlaces(curated, places) {
    // For each curated GO_OUT without a place:
    //   derive venue hints from title/description
    //   match to best nearby place (tag-aware)
    //   attach place coords, rating, openStatus
    // Returns: enriched[] + usedPlaceIds
  }

  enrichCircuit = enrichCuratedWithPlaces(cura, places);

                           ↓

PHASE 5: TAGGING & GENERATION
══════════════════════════════════════════════════════════════════════
  forEach suggestion {
    ├─ inferTags()           // Guess tags from title + description
    ├─ generateCta()         // "Crush a workout" or "Get coffee at..."
    ├─ attachEmojis()        // Via EMOJI_BY_TAG + EMOJI_BY_TYPE
    ├─ attachWhyNow()        // Motivational copy from weather, time
    └─ withSource()           // Mark origin: 'curated'|'gemini'|etc
  }

                           ↓

PHASE 6: COMPUTE FEASIBILITY
══════════════════════════════════════════════════════════════════════
  Filter(isFeasible):
    AT_HOME: durationMin ≤ availability.durationMin
    GO_OUT: eta + durationMin + 10min ≤ availability.durationMin
    EVENT:  (now < eventStart < availEnd) 
            AND hasTicketUrl 
            AND minutesUntil ≤ 180

  remaining = feasible[]

                           ↓

PHASE 7: SCORING
══════════════════════════════════════════════════════════════════════
  forEach suggestion {
    score = 
      0.25 * feasibility             (always 1 after filter)
    + 0.15 * effortMatch              (weather-aware, GO_OUT pref)
    + 0.12 * novelty                  (rejected? 0.2 : accepted? 0.1 : 1)
    + 0.10 * convenience              (distance + rating)
    + 0.05 * startImmediacy           (for events)
    + 0.03 * confidence               (suggestion confidence)
    + 0.05 * interestMatch            (tags match prefs?)
    + 0.15 * learnedAffinity          (swipe history)
    + 0.05 * typeAffinity             (GO_OUT vs AT_HOME pref)
    + openNowBonus                    (+0.05 if open, −0.03 if soon)
    + habitBoost                      (+0.12 if source='habit')
    + geminiBoost                     (+0.08 if source='gemini')
    + nightPenalty                    (−0.25 if late night + GO_OUT)
    + locationBoost                   (profile-based tag boost)
    + urgencyBoost                    (events in 30min? +0.25)

    scored[].push({ item, score })
  }

                           ↓

PHASE 8: INTERLEAVED DECK ASSEMBLY
══════════════════════════════════════════════════════════════════════
  buildInterleavedDeck(scored, deckSize=15):
    1. Group by primaryTag (first tag or type fallback)
    2. Within each group: sort by distance (nearest first), then score
    3. Order groups by max score (best category first)
    4. Round-robin pick across groups
    5. Enforce max 2-3 per type (AT_HOME/GO_OUT/EVENT variety)
    6. Return deck[] capped at deckSize

                           ↓

OUTPUT: DeckSuggestion[] (max 15 cards)
══════════════════════════════════════════════════════════════════════
  Each card includes:
    • Suggestion details + enriched place info
    • SuggestionMeta: { distanceKm, etaMin, leaveBy, startInMin, etc }
    • Score (for debugging)

  Rendered in DeckScreen with swipe gestures
```

---

## Data State Hierarchy

```
AppState (React Context)
├─ Meta
│  ├─ loading: boolean
│  ├─ authChecked: boolean
│  ├─ userId: string | null
│  ├─ userEmail: string | null
│  └─ onboardingComplete: boolean
│
├─ Permissions
│  ├─ calendarGranted: boolean
│  └─ locationGranted: boolean
│
├─ Location & Time
│  ├─ location: LocationState { lat, lng, areaLabel }
│  ├─ availability: Availability | null { start, end, durationMin, nextEventTitle }
│  └─ enabledCalendars: string[]
│
├─ User Profile
│  ├─ prefs: UserPrefs
│  │  ├─ openToGoingOut: boolean
│  │  ├─ allowSerendipity: boolean
│  │  ├─ radiusKm: number
│  │  ├─ interestTags: string[]
│  │  ├─ customInterests?: string[]
│  │  ├─ lifestyle?: 'active' | 'moderate' | 'chill' | 'mixed'
│  │  ├─ selfDescription?: string
│  │  └─ themeMode: 'light' | 'dark'
│  │
│  └─ tagAffinities: { tag → number }
│
├─ Habits & Activity
│  ├─ habits: Habit[]
│  │  └─ Habit { id, name, type, frequency, streaks, completionHistory }
│  │
│  ├─ activityLog: ActivityLog[]
│  │  └─ ActivityLog { suggestionId, title, durationMin, timestamp, source }
│  │
│  └─ scheduledActivities: ScheduledActivity[]
│     └─ ScheduledActivity { startAt, endAt, suggestion, commitment }
│
├─ Suggestions & History
│  ├─ preloadedDeck: { deck: DeckSuggestion[], usedFallback: boolean } | null
│  ├─ deckLoading: boolean
│  │
│  ├─ history: HistoryState
│  │  ├─ lastAcceptedIds: string[]
│  │  ├─ lastRejectedIds: string[]
│  │  └─ lastShownIds: string[]  (prevent repeats)
│  │
│  └─ savedSuggestions: SavedSuggestion[]
│     └─ SavedSuggestion { id, savedAt, source, suggestion }
│
└─ Learning
   ├─ locationProfile: LocationProfile | null
   │  ├─ label: 'coastal' | 'urban' | 'suburban' | 'unknown'
   │  ├─ boosts: { tag → number }
   │  └─ detectedAt: ISO timestamp
   │
   └─ (tagAffinities managed above)

Persistence:
  Local → AsyncStorage (all fields)
  Cloud → Firebase Firestore (if authenticated)
    ├─ users/{uid}/profile
    ├─ users/{uid}/habits[]
    ├─ users/{uid}/learning/affinities
    ├─ users/{uid}/learning/locationProfile
    └─ users/{uid}/saved_suggestions[]
```

---

## Suggestion Source Hierarchy

```
SUGGESTION SOURCES (Priority for Deck Assembly)
═══════════════════════════════════════════════════════════════════════

Source          Where            When            Score Boost   Confidence
──────────────────────────────────────────────────────────────────────
'habit'         From Habit       Due + matching  +0.12        User-set
'gemini'        AI-generated     Prefetch        +0.08        Varies
'ticketmaster'  Event API        Real-time       +0.00        0.85
'curated'       Bundled data     Always          +0.00        0.85
'fallback'      atHome/goOut     When APIs fail  +0.00        0.75

Mixing Strategy:
  Round-robin by primaryTag ensures variety:
  
  User interests: [coffee, art, fitness]
  
  Deck output (variety-maximized):
    1. Nearest café (TAG: coffee)
    2. Nearby museum (TAG: art)
    3. Fitness center (TAG: fitness)
    4. 2nd café option
    5. 2nd museum option
    ... (up to 15 cards)

  NOT: [café, café, café, café, café, ...]
```

---

## API & Cache Strategy

```
CACHING LAYER
═════════════════════════════════════════════════════════════════════════

Service              Cache TTL    Key                          Fallback
─────────────────────────────────────────────────────────────────────────
weather.ts           15 min       {lat, lng} (5km radius)      atHome.ts
googlePlaces.ts      5 min        {lat, lng, radius, types}    osmPlaces.ts
osmPlaces.ts         5 min        {lat, lng, radius, filters}  fallback.ts
geminiSuggestions    10 min       JSON hash of all inputs      curated
ticketmaster.ts      6 hours      {lat, lng, dateRange}        —
seatgeek.ts          1 hour       {lat, lng, dateRange}        —


TIMEOUT HANDLING
═════════════════════════════════════════════════════════════════════════

buildDeck() timeout chain:
  ├─ Each API call has 2.5s timeout
  ├─ Promise.all() waits for all (or timeout)
  ├─ On timeout → API returns []
  ├─ Deck builds from available sources
  └─ Fallback suggests from atHome/goOut/fallback.ts

Example failure cascades:
  ├─ Google Places times out → Use OSM (if ready) or curated only
  ├─ Ticketmaster times out → Deck just lacks events (okay)
  ├─ Gemini times out → Deck lacks AI suggestions (okay)
  ├─ ALL APIs timeout → Pure curated deck preserved
  └─ Weather timeout → Neutral indoorBias (0.3) used


RATE LIMITING (Missing)
═════════════════════════════════════════════════════════════════════════

Currently: No backoff or circuit breaking
Risks:
  ├─ Google Places quota exhaustion → Suggestions fail silently
  ├─ Ticketmaster rate limits → 429 errors not handled
  └─ Gemini token limits → Requests queued then dropped

Recommendation:
  Implement exponential backoff:
    Base delay: 100ms
    Multiplier: 2x per retry (100, 200, 400, 800ms...)
    Max retries: 3
    Circuit breaker: Disable API for 60s after 5 consecutive failures
```

---

## Type System: Redundancy Analysis

```
OVERLAPPING FIELDS
═════════════════════════════════════════════════════════════════════════

Suggestion Type:
  ├─ openStatus?: 'open_now' | 'opens_soon' | 'unknown'
  ├─ opensInMin?: number
  └─ closesInMin?: number

DeckSuggestion extends Suggestion with:
  └─ meta?: SuggestionMeta {
      openStatus?: 'open_now' | 'opens_soon' | 'unknown'
      opensInMin?: number
      closesInMin?: number
    }

ISSUE: Same fields in both Suggestion AND meta
SIZE IMPACT: Each card now carries these fields twice
FIX: Move {openStatus, opensInMin, closesInMin} into meta only


UNUSED FIELDS (Present but ignored in scoring)
═════════════════════════════════════════════════════════════════════════

suggestion.confidence: number
  ├─ Added by all sources (Gemini, curated, marketplace)
  ├─ Score weight: 0.03 (negligible)
  └─ Opportunity: Could amplify for low-confidence Gemini outputs

suggestion.effortToStart?: 1 | 2 | 3 | 4 | 5
  ├─ Returned by Gemini only
  ├─ Never used in filtering
  └─ Opportunity: Heavy fatigue (≤5 min left)? Suggest 5/5 only

suggestion.moodFit?: ['low' | 'okay' | 'good' | 'high' | 'anxious' | 'bored' | 'surprise']
  ├─ Returned by Gemini (mood-contextual suggestions)
  ├─ Parsed but never evaluated
  └─ Opportunity: User reports "feeling anxious"? Filter to anxious-safe suggestions

suggestion.equipment?: string[]
  ├─ Present in curated AT_HOME
  ├─ Never surfaced in UI
  └─ Opportunity: Show in PlanScreen reminder ("Bring: mat, water bottle")

suggestion.instructions?: string[]
  ├─ Multi-step activity breakdown
  ├─ Never used in cards
  └─ Opportunity: Show in DeckScreen card drawer or during completion


SUGGESTION.META (Could be better utilized)
═════════════════════════════════════════════════════════════════════════

SuggestionMeta {
  distanceKm?: number              ✅ Used: UI display + scoring
  etaMin?: number                  ✅ Used: UI display + feasibility check
  leaveBy?: string (ISO)           ⚠️  Calculated but rarely shown
  startInMin?: number              ⚠️  Only for events, not used
  openStatus?: 'open_now'|...      ⚠️  Duplicated in Suggestion
  opensInMin?: number              ⚠️  Duplicated in Suggestion
  closesInMin?: number             ⚠️  Duplicated in Suggestion
}
```

---

## Screen Usage Map

```
APP NAVIGATION
═══════════════════════════════════════════════════════════════════════

Authentication Flow:
  FirebaseAuth.onAuthStateChanged()
      ├─ No user + firebaseEnabled? → AuthScreen
      └─ User exists? → Onboarding or Main

Onboarding Flow:
  Welcome
    ├─→ CalendarPermission
    │   └─→ CalendarSelect
    │       └─→ LocationPermission
    │           └─→ Preferences
    │               └─→ Home

Main App Flow:
        ┌──→ Home (primary)
        │    ├─ preloadDeck()
        │    ├─ updateLocation()
        │    └─ updateAvailability()
        │
        ├─→ Deck (swipe cards)
        │    ├─ Accept → Plan screen
        │    ├─ Reject → next card
        │    ├─ Save → SavedSuggestions
        │    └─ Tag tap → affinity signal
        │
        ├─→ Plan (confirmation)
        │    ├─ Schedule in calendar
        │    ├─ Set reminder
        │    └─ → Completion screen
        │
        ├─→ Completion (activity log)
        │    ├─ Duration input
        │    ├─ Tag feedback
        │    └─ → ActivityLog + affinities
        │
        ├─→ Habits (sidebar)
        │    ├─ View streaks
        │    ├─ Create new habit
        │    └─ Edit/delete
        │
        ├─→ Library (saved + history)
        │    ├─ SavedSuggestions list
        │    ├─ ActivityLog timeline
        │    └─ Tap to revisit
        │
        ├─→ Settings (debug + prefs)
        │    ├─ Clear data
        │    ├─ API test buttons
        │    ├─ Debug logs
        │    └─ Theme toggle
        │
        ├─→ Profile (account)
        │    ├─ User email
        │    ├─ Sign out
        │    └─ Delete account
        │
        └─→ BadgeDetail (rewards)
             └─ Streak milestones

Screen Status: ✅ ALL 16 ACTIVELY USED
```

---

**End of Diagrams**
