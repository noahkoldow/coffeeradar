# bits — Intellectual Property Documentation

**Document version:** 1.0  
**Date:** February 23, 2026  
**Author(s):** bits development team  
**Project codename:** CoffeeRadar  
**Published app name:** bits  
**Bundle identifier:** com.bits.app (iOS and Android)

---

## 1. Overview & Vision

**bits** is a proprietary mobile application built with React Native and Expo SDK 54, targeting iOS and Android. The app addresses the universal problem of "I have free time but don't know what to do" by intelligently generating personalized activity suggestions based on the user's location, calendar availability, weather conditions, learned preferences, and real-time data from multiple external APIs.

The core innovation is a **context-aware suggestion engine** that combines curated activity data, real-time venue/event APIs, calendar integration, weather awareness, location profiling, and a machine-learned affinity system to produce a short deck of 5 highly relevant, immediately actionable suggestions presented in a swipeable card interface.

**Tagline:** "Tap once. Do something now."

---

## 2. Technical Architecture

### 2.1 Platform & Framework

| Layer | Technology |
|---|---|
| Framework | React Native 0.81.5 (New Architecture enabled) |
| Build system | Expo SDK 54 |
| Language | TypeScript 5.9 |
| State management | React Context + useState (no external library) |
| Navigation | @react-navigation/stack v7 |
| Persistence | @react-native-async-storage/async-storage |
| Backend | Firebase (Auth, Cloud Firestore) |
| Maps | react-native-maps 1.20.1 |
| Illustrations | react-native-svg 15.12 (all illustrations hand-drawn in SVG) |
| Typography | Space Grotesk (400, 600, 700 weights via @expo-google-fonts) |

### 2.2 Project Structure

```
bits/
├── App.tsx                     # Root: fonts, navigation, providers
├── index.ts                    # Expo entry point
├── app.json                    # Expo configuration
├── src/
│   ├── types/index.ts          # All TypeScript type definitions
│   ├── state/AppState.tsx      # Global state context provider
│   ├── theme.ts                # Light/dark theme definitions
│   ├── theme/ThemeProvider.tsx  # Theme context with system mode support
│   ├── navigation/types.ts     # Stack navigator route params
│   ├── screens/                # 15 screen components
│   ├── components/             # 14 reusable UI components
│   ├── services/               # 17 service modules (APIs, business logic)
│   ├── data/                   # 6 curated data files (~135+ activities)
│   └── utils/                  # 4 utility modules
└── assets/                     # App icons, splash screen
```

---

## 3. Data Model (Proprietary Type System)

All types are defined in `src/types/index.ts`.

### 3.1 Core Models

**Suggestion** — The central data unit representing a single activity suggestion:
- `id` (string) — Unique identifier
- `type` (SuggestionType: `'AT_HOME'` | `'GO_OUT'` | `'EVENT'`) — Activity category
- `source` (`'ticketmaster'` | `'curated'` | `'habit'` | `'fallback'`) — Data origin
- `title`, `description` — Display text
- `cta` (optional) — Short action-oriented call-to-action headline
- `durationMin` (number) — Expected activity duration in minutes
- `steps` (Step[]) — Timed sub-steps for AT_HOME activities, each with `label` and `minutes`
- `instructions` (string[]) — Step-by-step guide text
- `tags` (string[]) — Categorization tags for affinity learning
- `emojis` (string[]) — Visual emoji identifiers
- `equipment` (string[]) — Required items
- `timeOfDay` (HabitTimeOfDay) — Preferred time of day
- `confidence` (number) — Quality/reliability score
- `whyNow` (string) — Contextual motivation text
- `place` (Place) — Venue data for GO_OUT/EVENT types
- `event` (EventDetails) — Event-specific data (startAt, venue, ticketUrl, priceRange)
- `rating`, `ratingCount` — Venue ratings from external APIs
- `openStatus`, `opensInMin`, `closesInMin` — Real-time venue availability

**DeckSuggestion** — Extended suggestion with computed metadata:
- Inherits all Suggestion fields
- `meta.distanceKm` — Distance from user's location
- `meta.etaMin` — Estimated travel time
- `meta.leaveBy` — Departure time for on-time arrival
- `meta.startInMin` — Minutes until event starts

**Commitment** — Accepted activity plan:
- `suggestionId`, `type`, `title` — From the accepted suggestion
- `startAt`, `endAt` — Calendar time window (ISO strings)
- `leaveBy` — Departure time (GO_OUT/EVENT)
- `ticketUrl` — Event ticket link
- `calendarEventId` — Device calendar event reference
- `calendarWriteFailed` — Calendar write status flag

**Habit** — User-created recurring activity:
- Core: `id`, `name`, `type`, `lengthMin`, `description`, `frequency`, `timeOfDay`
- Scheduling: `preferredTime` (HH:MM 24h), `frequency` (`'daily'` | `'weekly'` | `'fortnightly'` | `'monthly'`)
- Tracking: `currentStreak`, `longestStreak`, `completionHistory` (ISO timestamps, max 90)
- Content: `tags`, `emojis`, `steps`, `instructions`, `equipment`

**ActivityLog** — Completion record for analytics and badge progression:
- `id`, `suggestionId`, `title`, `durationMin`, `timestamp`
- `source`, `isHabit`, `habitId`, `tags`, `suggestionType`

**BadgeDefinition** — Gamification badge category:
- `id`, `label`, `tags[]`, `levels[]` (threshold counts), `color`, `emoji`

### 3.2 User State

**UserPrefs**: `openToGoingOut`, `allowSerendipity`, `radiusKm`, `interestTags[]`, `themeMode`

**TagAffinities**: `Record<string, number>` — Learned per-tag preference scores

**LocationProfile**: `label` (`'coastal'` | `'urban'` | `'suburban'` | `'unknown'`), `boosts` (tag→score mapping), lat/lng of detection, detection timestamp

**Availability**: `start`, `end` (ISO strings), `durationMin`, `nextEventTitle`

---

## 4. Proprietary Algorithms

### 4.1 Deck-Building Engine (`src/services/suggestions.ts`)

The core suggestion engine — the most complex and valuable algorithm in the application.

**Pipeline stages:**

1. **Parallel Multi-Source Seeding**: Simultaneously fetches candidates from:
   - Due habits converted to suggestions via `habitToSuggestion()`
   - Curated AT_HOME pool (~60+ activities)
   - Curated GO_OUT pool (~35+ activities)
   - Curated event fallbacks (3 templates)
   - Ticketmaster Discovery API v2 (concerts, sports, comedy, theater)
   - SeatGeek API v2 (alternative event source)
   - Google Places Nearby Search API (cafés, parks, museums, gyms, etc.)
   - OpenStreetMap Overpass API (fallback venue source)

2. **Content-Aware Place Enrichment** (`enrichCuratedWithPlaces()`): Attaches real nearby venue data to curated GO_OUT suggestion templates using keyword→venue-type matching. For example, a "café walk" suggestion gets enriched with an actual nearby café including name, address, coordinates, rating, and open status.

3. **Deduplication**: Removes suggestions with identical IDs, previously shown/accepted/rejected cards (tracked in HistoryState), and near-duplicate titles.

4. **Feasibility Check**: Filters suggestions that don't fit the available time window, are too far away to reach, or require conditions not currently met.

5. **Multi-Factor Scoring** (`scoreSuggestion()`): Weighted composite score:

   | Factor | Weight | Description |
   |---|---|---|
   | Feasibility | 0.25 | Fits within available time window |
   | Effort match | 0.15 | Matches user's current energy/effort level |
   | Learned affinity | 0.15 | Tag affinity scores from user history |
   | Novelty | 0.12 | Haven't shown/done this recently |
   | Convenience | 0.10 | Proximity and ease of access |
   | Interest match | 0.05 | Matches declared interest tags |
   | Type affinity | 0.05 | Preference for AT_HOME vs GO_OUT vs EVENT |
   | Start immediacy | 0.05 | Can start right now vs later |
   | Confidence | 0.03 | Data quality/reliability of the suggestion |
   | Variable bonuses | - | Weather alignment, whyNow text, open now, habit due |

6. **Interleaved Variety Selection** (`buildInterleavedDeck()`): Groups candidates by primary tag, sorts nearest-first within each group, then round-robins across groups to ensure the 5-card deck has maximum variety.

7. **5-Level Fallback Cascade**: If primary sources yield fewer than 5 cards, progressively relaxes constraints through 5 fallback levels, ultimately drawing from the 40+ ultra-reliable fallback activities.

### 4.2 Tag Affinity Learning System (`src/services/affinity.ts`)

A real-time preference learning engine that tracks per-tag and per-type affinity scores.

**Signal types and strengths:**
- **Accept** (swipe right): +1.0 per tag
- **Complete** (finish activity): +1.5 per tag (strongest signal)
- **Reject** (swipe left): −0.3 per tag

**Algorithm:**
- **Exponential daily decay**: Factor 0.95 per day since last update, preventing stale preferences from dominating
- **Sigmoid mapping**: Raw scores mapped through sigmoid function to bounded 0–1 output range
- **Type affinity**: Separate tracking for AT_HOME vs GO_OUT vs EVENT preference, applied as a scoring factor in deck building
- **Cross-device sync**: Affinities synced to Cloud Firestore for persistence across devices

### 4.3 Calendar-Aware Smart Notification Scheduling (`src/services/notifications.ts`)

Schedules habit reminder notifications at optimal times by:
1. Scanning 15-minute increments within a threshold window around the habit's preferred time
2. The threshold window spans ±250% of the habit's duration (e.g., a 30-minute habit checks ±75 minutes)
3. Rejecting any time slot that overlaps with existing calendar events
4. Selecting the closest available slot to the preferred time
5. Supporting daily, weekly, fortnightly, and monthly recurrence patterns

### 4.4 Location Profile Detection (`src/services/locationProfile.ts`)

Automatically classifies the user's environment to adjust suggestion scoring:

**Detection method:**
- Queries OpenStreetMap Overpass API for nearby water bodies (coastal detection) and POI density within 500m radius (urban vs suburban)
- **Coastal**: Presence of natural=water or natural=coastline features nearby
- **Urban**: POI density > 15 amenities within 500m
- **Suburban**: Below urban threshold, no coastal features

**Tag boost mapping:**
- Coastal → +nature, +water, +beach suggestions
- Urban → +explore, +café, +culture suggestions
- Suburban → +nature, +walk suggestions

Results cached and re-detected only when user moves >5km.

### 4.5 Contextual Copy Generation (`src/services/whyNow.ts`)

Generates motivational "why now" text for each suggestion by considering:
- Calendar urgency ("You have 45 minutes before your next meeting")
- Weather conditions ("Perfect weather for being outside")
- Time of day alignment ("Great morning energy activity")
- Venue status ("Opens in 10 minutes — perfect timing")
- Event timing ("Starts in 30 minutes — just enough time to get there")
- Habit streaks ("Keep your 7-day streak going!")
- Anti-procrastination nudges

### 4.6 Travel Time Estimation (`src/services/travel.ts`)

**Haversine distance** calculation between user location and venue, with mode-aware ETA:
- **Walk mode** (≤1.5km): 4.5 km/h average speed
- **Transit mode** (>1.5km): 5 min wait + 25 km/h average + 6 min walking to/from stops
- Computes optimal departure time for calendar event creation

### 4.7 Weather Integration (`src/services/weather.ts`)

- **Open-Meteo API** (free, no key required)
- WMO weather code → condition mapping (clear, cloudy, rain, snow, unknown)
- `indoorBias` computation: rain/snow → high indoor bias, clear+warm → low indoor bias
- 15-minute result cache to avoid excessive API calls
- Weather condition influences both suggestion scoring and UI presentation (animated banners)

### 4.8 Progress Bar Algorithm (PlanScreen)

For AT_HOME activities with timed steps, the progress bar uses **duration-weighted progress**:
- Each step's contribution to total progress is proportional to its duration in minutes (not equal per step)
- Within the active step, progress advances continuously based on elapsed wall-clock time
- A 3-step activity with steps of 5m, 10m, and 5m would show: step 1 = 0–25%, step 2 = 25–75%, step 3 = 75–100%
- For activities without steps, progress is purely time-based using the total `durationMin`

### 4.9 Calendar Event Shortening on Early Finish

When a user finishes an activity before the planned end time:
- The original calendar event's end time is automatically shortened to the actual finish time
- This prevents the old event from blocking the time window for a potential new activity
- Implemented via the device calendar API (`Calendar.updateEventAsync`)

---

## 5. External API Integrations

### 5.1 Ticketmaster Discovery API v2 (`src/services/ticketmaster.ts`)
- Geohash-based location encoding via `ngeohash` library
- Interest → `classificationName` mapping (e.g., "music" → "Music", "comedy" → "Comedy")
- Tag extraction from event classifications
- Duration estimation by genre (concerts ~2h, sports ~3h, comedy ~1.5h)
- Auto-generated event descriptions with venue context

### 5.2 SeatGeek API v2 (`src/services/seatgeek.ts`)
- Interest → taxonomy mapping
- Distance-based filtering
- Tag extraction and event normalization

### 5.3 Google Places Nearby Search API (`src/services/googlePlaces.ts`)
- Interest → place type mapping (e.g., "cafe" → "cafe", "fitness" → "gym")
- Open status computation from `opening_hours.periods`
- Content-aware place descriptions with per-type templates
- Falls back to OSM if no API key configured

### 5.4 OpenStreetMap Overpass API (`src/services/osmPlaces.ts`)
- Primary fallback for Google Places
- Multiple endpoint failover (3 Overpass endpoints for reliability)
- Extensive OSM tag → app tag mapping (amenity, leisure, shop, tourism categories)
- Opening hours parser for real-time open/closed status
- Content-aware descriptions per OSM type

### 5.5 Open-Meteo API (`src/services/weather.ts`)
- Weather condition and temperature data
- No API key required
- 15-minute result caching

### 5.6 Firebase (`src/services/firebase.ts`)
- **Authentication**: Email/password, Google OAuth (PKCE flow), Apple Sign-In (native + web fallback), Anonymous fallback
- **Cloud Firestore**: User data sync (tag affinities, location profile, habits), analytics event logging
- Project: `coffeeradar-415f2`

---

## 6. User Interface & Interaction Design

### 6.1 Navigation Flow

```
Auth → Welcome → CalendarPermission → CalendarSelect → LocationPermission → Preferences → Home
                                                                                          ↓
                                                                              Deck (swipe cards)
                                                                                          ↓
                                                                              Plan (active plan)
                                                                                          ↓
                                                                           Completion (celebration)
                                                                                          ↓
                                                                                        Home
```

Additional routes: Settings, Profile, HabitForm, Habits, BadgeDetail

### 6.2 Screen Inventory

| Screen | File | Purpose |
|---|---|---|
| AuthScreen | `src/screens/AuthScreen.tsx` | Email/password + Google + Apple authentication |
| WelcomeScreen | `src/screens/WelcomeScreen.tsx` | Animated onboarding welcome with SVG avatar |
| CalendarPermissionScreen | `src/screens/CalendarPermissionScreen.tsx` | Calendar access request |
| CalendarSelectScreen | `src/screens/CalendarSelectScreen.tsx` | Calendar selection with privacy notice |
| LocationPermissionScreen | `src/screens/LocationPermissionScreen.tsx` | Location access request |
| PreferencesScreen | `src/screens/PreferencesScreen.tsx` | Interest tags, radius, mode toggles |
| HomeScreen | `src/screens/HomeScreen.tsx` | Main dashboard with stats, habits, badges, action buttons |
| DeckScreen | `src/screens/DeckScreen.tsx` | Tinder-style 5-card swipe deck |
| PlanScreen | `src/screens/PlanScreen.tsx` | Active plan execution with timer, progress, checklist |
| CompletionScreen | `src/screens/CompletionScreen.tsx` | Celebration screen with stats and badge callouts |
| SettingsScreen | `src/screens/SettingsScreen.tsx` | Permissions, preferences, debug tools |
| ProfileScreen | `src/screens/ProfileScreen.tsx` | User account management |
| HabitFormScreen | `src/screens/HabitFormScreen.tsx` | Create/edit recurring habits |
| HabitsScreen | `src/screens/HabitsScreen.tsx` | Habit management with flip cards and weekly history |
| BadgeDetailScreen | `src/screens/BadgeDetailScreen.tsx` | Badge progress detail view |

### 6.3 Component Inventory

| Component | File | Purpose |
|---|---|---|
| SuggestionCard | `src/components/SuggestionCard.tsx` | Flippable activity card (front/back) with spring 3D animation |
| SwipeDeck | `src/components/SwipeDeck.tsx` | Zero-lag swipe gesture handler with 3-layer card rendering |
| ActivityBanner | `src/components/ActivityBanner.tsx` | Weather-responsive animated SVG illustration (6 characters × 2 poses, 4 sky types, 6 terrains) |
| BadgeRing | `src/components/BadgeRing.tsx` | SVG circular progress ring |
| BadgeIcon | `src/components/BadgeIcon.tsx` | 8 hand-drawn SVG badge icons |
| PrimaryButton | `src/components/PrimaryButton.tsx` | Animated CTA button with pulsing glow |
| Chip | `src/components/Chip.tsx` | Tag selection chip |
| Countdown | `src/components/Countdown.tsx` | Large countdown timer display |
| DeckLoader | `src/components/DeckLoader.tsx` | Loading screen with cycling motivational messages |
| EmojiConfetti | `src/components/EmojiConfetti.tsx` | 18-particle emoji confetti animation |
| MapThumbnail | `src/components/MapThumbnail.{native,web}.tsx` | Platform-split map preview |
| TimerSteps | `src/components/TimerSteps.tsx` | Step-by-step countdown timer with auto-advance |
| ToggleRow | `src/components/ToggleRow.tsx` | Labeled toggle switch |

### 6.4 Original UI Innovations

**Zero-Lag Swipe Deck** (`SwipeDeck.tsx`): When a card is swiped, it is immediately captured as a non-interactive departing snapshot that animates off-screen independently. The new current card renders underneath and is instantly interactive — there is no animation delay or gesture lock between cards.

**Flippable Suggestion Cards** (`SuggestionCard.tsx`): Spring-driven 3D Y-axis card flip (perspective: 1000, friction: 8, tension: 80) with opacity crossfade. Front face adapts layout based on suggestion type (map for GO_OUT, step preview for AT_HOME). Back face shows detailed info, ratings, venue details, and full instructions.

**Weather-Responsive Animated Banner** (`ActivityBanner.tsx`): Entirely original SVG illustrations — 6 character types (cyclist, runner, hiker, umbrella person, cozy person, snowman), each with 2 animated pose frames for walk-cycle animation. 4 weather-specific sky backgrounds (ClearSky with sun rays and birds, CloudySky with dense layers, RainSky with storm clouds and rain streaks, SnowSky with snowflakes). 6 terrain types matched to weather. Characters walk across the screen with terrain parallax scrolling.

---

## 7. Curated Content Library

### 7.1 AT_HOME Activities (`src/data/atHome.ts` — ~60+ activities)

Hand-authored activities with structured timed steps, covering:
- **Fitness**: HIIT workouts, yoga flows, stretching routines, shadow boxing, Tabata, dance cardio, core circuits
- **Productivity**: Deep work sessions, inbox zero, planning blocks, digital declutter
- **Creative**: Sketching challenges, free writing, photography projects, music jam sessions
- **Cooking**: Quick meal recipes, smoothie preparation, baking sessions
- **Wellness**: Guided meditation, journaling, gratitude practice, breathing exercises
- **Learning**: Language study sessions, book reading blocks, podcast deep-dives

Each activity includes: title, description, CTA text, step-by-step timer instructions with per-step duration in minutes, tags, emojis, equipment requirements, time-of-day preference, and confidence score.

### 7.2 GO_OUT Activities (`src/data/goOut.ts` — ~35+ activities)

Curated outdoor and venue-based activities:
- **Nature**: Park loops, waterfront walks, sunrise/sunset viewing, forest bathing
- **Fitness**: Jogging routes, 5K runs, bike rides, outdoor gym
- **Exploration**: Photo walks, neighborhood exploration, street art tours
- **Food & Drink**: Café hopping, bakery exploration, food walks
- **Culture**: Gallery visits, museum trips, live music venues
- **Shopping**: Thrift shopping, plant shop visits, farmers markets

### 7.3 Fallback Activities (`src/data/fallback.ts` — ~40+ activities)

Ultra-reliable AT_HOME activities (5–60 min range) used as last resort:
- Quick resets, focus sprints, tidy sweeps, stretches, meditation
- Source: `'fallback'`, low confidence (0.4–0.5)
- Guaranteed to always provide suggestions even when all APIs fail

### 7.4 Habit Templates (`src/data/habits.ts` — 6 templates)

Recommended recurring habits: morning walk, lunch stretch, evening tidy, weekly creative hour, café check-in, monthly culture night.

### 7.5 Badge Definitions (`src/data/badges.ts` — 8 categories)

Gamification badges with 5 progression levels each:
- **Focus** (🧠), **Fitness** (💪), **Nature** (🌿), **Wellness** (🧘), **Social** (👫), **Art** (🎨), **Food** (☕), **Habits** (📅)
- Standard thresholds: [1, 3, 6, 10, 15] activities per badge
- Habits badge uses special thresholds: [3, 7, 14, 30, 60] completions

---

## 8. Gamification System

### 8.1 Badge Progression (`src/utils/badges.ts`)

- 8 badge categories mapped to activity tags
- 5 levels per badge with ascending thresholds
- Progress computed from ActivityLog entries matching badge tags
- Special "Habits" badge counts total habit completions across all habits
- Level-up celebrations shown on CompletionScreen with confetti

### 8.2 Habit Streaks (`src/utils/habits.ts`)

- Streak tracking per frequency (daily/weekly/fortnightly/monthly)
- Streak auto-breaks when completion window is missed
- Visual weekly completion dots (Mon–Sun) on habit cards
- Streak emoji scaling: 🔥 (1–4), ⚡ (5–9), 💎 (10–19), 🏆 (20+)

---

## 9. State Management Architecture

### 9.1 Global State (`src/state/AppState.tsx`)

React Context provider with 20+ state variables and 18 action methods. No external state management library.

**Key architecture decisions:**
- Ref-based preload deck management with build ID race-condition prevention
- Cloud-first data loading: tries Firebase Firestore, falls back to AsyncStorage
- User-scoped AsyncStorage keys (`@bits_{userId}_{key}`) for multi-account support
- Firebase auth state listener with anonymous fallback

### 9.2 Persistence Layer (`src/utils/storage.ts`)

AsyncStorage wrapper with user-scoped keys, handling:
- User preferences, history, calendars, onboarding state
- Habits, activity log, weather condition cache
- Tag affinities, location profile

### 9.3 Cloud Sync (`src/services/user.ts`)

Firestore sync layer for cross-device data:
- Tag affinities, location profile, habits
- Skips anonymous users
- Bi-directional: loads from cloud on init, syncs changes on mutation

---

## 10. Theme System

### 10.1 Design Tokens (`src/theme.ts`)

Dual theme support (light and dark) with consistent design tokens:

| Token | Light | Dark |
|---|---|---|
| Background | `#F6F7FB` | `#121218` |
| Card | `#FFFFFF` | `#1E1E2A` |
| Text | `#1A1A2E` | `#E8E8F0` |
| Accent | `#6C63FF` | `#8B83FF` |
| Success | `#2D8C6A` | `#6ED4A8` |
| Error | `#E74C3C` | `#FF6B6B` |

**Typography**: Space Grotesk at three weights (400 body, 600 semibold, 700 heading).

**Spacing scale**: xs(4), sm(8), md(12), lg(16), xl(24), xxl(32).

**Border radii**: sm(6), md(10), lg(14), xl(20).

### 10.2 Theme Provider (`src/theme/ThemeProvider.tsx`)

React Context that reads `prefs.themeMode` from AppState, supporting `'light'`, `'dark'`, and `'system'` (via `useColorScheme()` hook).

---

## 11. Authentication Architecture (`src/services/auth.ts`)

Four authentication methods:

1. **Email/Password**: Firebase `createUserWithEmailAndPassword` / `signInWithEmailAndPassword`
2. **Google OAuth**: PKCE flow via `expo-auth-session` with `GOOGLE_WEB_CLIENT_ID`, exchanged for Firebase `GoogleAuthProvider.credential`
3. **Apple Sign-In**: Native via `expo-apple-authentication` with cryptographic nonce generated by `expo-crypto`; web fallback available
4. **Anonymous**: Automatic fallback via `signInAnonymously()` through `ensureAuth()` when no other auth is available

Auth state is monitored via Firebase `onAuthStateChanged` subscriber, with user ID propagated throughout the app state.

---

## 12. Privacy & Data Handling

- Calendar data: **Only availability blocks are read** — event titles, descriptions, and attendees are never stored or transmitted (except `nextEventTitle` for display context)
- Location data: Used only for suggestion scoring and travel time estimation; not persistently tracked
- Analytics events: Logged to Firestore only for authenticated (non-anonymous) users
- Data deletion: Full `clearStorage()` function wipes all local and cloud user data
- Calendar event creation: Events created on device stay on device; the app only writes plan events the user explicitly accepts

---

## 13. Original Creative Works

The following elements are entirely original creative works authored for this project:

1. **135+ curated activity descriptions** with structured step-by-step instructions, timing, and motivational copy
2. **6 SVG character illustrations** with 2 animated pose frames each (cyclist, runner, hiker, umbrella person, cozy person, snowman)
3. **4 weather-themed SVG sky backgrounds** (clear with sun rays and birds, cloudy with layered clouds, rain with storm clouds and streaks, snow with flakes)
4. **6 terrain illustration sets** (road, track, trail, rain puddles, snow drifts, cozy sidewalk with houses)
5. **8 SVG badge icons** in consistent stick-figure/landscape art style (focus, fitness, nature, wellness, social, art, food, habits)
6. **8 cycling motivational loader messages**
7. **Welcome screen SVG avatar** (person holding a coffee cup)
8. **Tag-to-emoji mapping** covering 17+ activity categories
9. **All UI copy, CTAs, and onboarding text**

---

## 14. Dependencies & Licenses

All third-party dependencies are open-source packages installed via npm. The project uses no proprietary third-party SDKs beyond the standard Expo/Firebase ecosystem. Key dependencies and their license types:

| Package | Version | License |
|---|---|---|
| react | 19.1.0 | MIT |
| react-native | 0.81.5 | MIT |
| expo | ~54.0.33 | MIT |
| firebase | ^12.9.0 | Apache-2.0 |
| @react-navigation/stack | ^7.7.1 | MIT |
| react-native-maps | 1.20.1 | MIT |
| react-native-svg | 15.12.1 | MIT |
| @react-native-async-storage/async-storage | ^2.2.0 | MIT |
| expo-calendar | ~15.0.8 | MIT |
| expo-location | ~19.0.8 | MIT |
| expo-notifications | ~0.32.16 | MIT |
| expo-haptics | ~15.0.8 | MIT |
| expo-blur | ~15.0.8 | MIT |
| expo-linear-gradient | ~15.0.8 | MIT |
| expo-apple-authentication | ~8.0.8 | MIT |
| expo-auth-session | ~7.0.10 | MIT |
| expo-crypto | ~15.0.8 | MIT |
| @expo-google-fonts/space-grotesk | ^0.4.1 | MIT |

---

## 15. Revision History

| Date | Version | Changes |
|---|---|---|
| 2026-02-23 | 1.0 | Initial comprehensive IP documentation |

---

*This document describes proprietary software, algorithms, creative works, and business logic owned by the bits development team. All rights reserved. Unauthorized reproduction, distribution, or use of any part of this documentation or the described software is prohibited.*
