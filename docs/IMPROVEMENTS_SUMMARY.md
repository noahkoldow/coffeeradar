# CoffeeRadar: Time & Event Specificity Improvements
**Date:** April 28, 2026

## Problem Statement
The suggestion algorithm had three critical issues:
1. **Generic Time Matching** - Coffee suggested at 6pm, workouts at random times
2. **Poor Event Urgency** - "Visit a bar" ranked higher than "Trivia at Tony's Bar TONIGHT at 8:30pm"
3. **Unrealistic Suggestions** - Events shown even if user can't reach them in time

## Solutions Implemented

### 1. Strict Time-of-Day Rules ✅
**File:** `src/services/suggestions.ts`
**Function:** `isAppropriateTimeOfDay()`

Added explicit time windows for activity types:
- **Coffee/Café:** 9:00-18:00 only
- **Breakfast:** 5:00-12:00 only  
- **Lunch:** 11:30-15:00 only
- **Dinner:** 17:00-22:00 only
- **Workouts:** 5:00-12:00 OR 17:00-21:00 (never random times)
- **Late-night Social:** 19:00-02:00 only

**Example:** Now prevents "Grab coffee at 22:00" - coffee tagged activities filtered out automatically.

### 2. Time Urgency Scoring ✅
**File:** `src/services/suggestions.ts`
**Function:** `scoreSuggestion()` - new `urgencyBoost` logic

Events get urgency scores based on how soon they start:
- **30 min or less:** +0.25 boost (massive priority)
- **60 min or less:** +0.15 boost (strong priority)
- **120 min or less:** +0.08 boost (moderate priority)
- **Beyond 120 min:** Decays to near-zero

**Impact:** "Trivia at Tony's Bar at 8:30pm (in 45 min)" now gets 0.15 urgency boost, making it rank much higher than generic suggestions.

### 3. Enhanced Gemini Prompt ✅
**File:** `src/services/geminiSuggestions.ts`
**Function:** `buildPrompt()`

Complete rewrite emphasizing:
- **"NEXT 2 HOURS ONLY"** - Not generic "soon"
- **Real events happening TODAY** - Web research for actual events
- **Specific venue names & addresses** - Not "a nearby cafe"
- **EXACT start times** - ISO timestamps required
- **Travel time constraints** - Must include feasibility calculation
- **Golden rules section** - Heavy emphasis on specificity

Example rules added:
```
NEVER suggest generic ideas like "go to a cafe" or "visit a museum".
Instead, ALWAYS name the SPECIFIC venue/event with address and times.
Example: "Grab espresso at Prater Garten, Gendarmenmarkt 5, opens in 5 min" 
(NOT "go to a cafe")
```

### 4. Stricter Event Reachability Checks ✅  
**File:** `src/services/suggestions.ts`
**Function:** `isFeasible()` - Enhanced EVENT validation

New constraints:
- Must start within next 3 hours (or user has 120+ min availability)
- Must have valid travel time calculation
- Start time must be AFTER (travel time + 10-min buffer)
- Start time must be BEFORE availability window ends
- Must have booking URL (ticketUrl)

**Example:** Won't suggest a concert starting in 2.5 hours if user only has 1 hour free.

### 5. Travel Time as Hard Constraint ✅
**File:** `src/services/suggestions.ts`  
**Function:** `enrichSuggestion()` + `isFeasible()`

Travel feasibility calculation:
```
Earliest Arrival = Now + Travel Time + Safety Buffer
Must Have: Event Start Time >= Earliest Arrival
Must Have: Event Start Time <= Availability End
```

**Example:** Won't suggest driving 30min to an event starting in 25 min.

## Weighted Scoring Formula (Updated)

```
Final Score = 
  feasibility × 0.25 +      // Must be completable
  effortMatch × 0.15 +       // Weather/mood fit
  novelty × 0.12 +           // Avoid repetition
  convenience × 0.10 +       // Distance/rating
  startImmediacy × 0.05 +    // Time to start
  confidence × 0.03 +        // AI confidence
  interestMatch × 0.05 +     // User interests
  learnedAffinity × 0.15 +   // User taste history
  typeAff × 0.05 +           // Activity type preference
  openNowBonus +              // Place status
  habitBoost +                // User-created habits
  geminiBoost +               // AI source boost
  nightPenalty +              // Late-night constraints
  locationBoost +             // Home/area boost
  urgencyBoost ← NEW          // Events happening soon!
```

## Files Modified

1. **src/services/suggestions.ts**
   - Added `isAppropriateTimeOfDay()` function (50 lines)
   - Updated `filterByTimeOfDay()` to use new rules
   - Enhanced `isFeasible()` for stricter event checks (20 lines)
   - Added `urgencyBoost` calculation in `scoreSuggestion()` (25 lines)
   - Updated weighted scoring formula to include urgencyBoost

2. **src/services/geminiSuggestions.ts**
   - Completely rewrote `buildPrompt()` (expanded from ~60 to 150 lines)
   - Added critical timing constraints section
   - Added golden rules section with specificity emphasis
   - Fixed null-safety check for coordinates

## Testing Recommendations

1. **Coffee Activity Test**
   - Time: 6:00 PM (evening)
   - Should NOT suggest coffee/café activities
   - Should suggest dinner, bars, or AT_HOME activities

2. **Event Urgency Test**
   - User has 60 min available
   - Events at: 30 min, 60 min, 120 min
   - 30-min event should rank highest due to urgency boost

3. **Reachability Test**
   - User 30km away from event
   - Event starts in 45 min (travel time > time available)
   - Should NOT appear in suggestions

4. **Gemini Specificity Test**
   - Check that Gemini returns:
     - Specific venue names, not generic categories
     - Real event times (ISO timestamps)
     - Full addresses with coordinates
     - Travel time calculations

## Performance Impact

- **Minimal:** New functions are O(n) where n = activity title length
- **Urgency calculation:** Single lookup in meta object
- **No additional API calls introduced**

## Breaking Changes

None - Fully backward compatible. Existing suggestions still work, just filtered/ranked differently.

## Future Enhancements

1. Add `canReach: boolean` flag to meta for explicit tracking
2. Cache verified addresses from Google Places
3. Add "time window" metadata to activities
4. Integrate real-time venue events API
5. Add user-configurable time preferences
