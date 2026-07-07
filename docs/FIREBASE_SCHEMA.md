# CoffeeRadar Firebase Schema

**Date**: May 18, 2026  
**Purpose**: Complete Firestore schema for personalized activity recommendations + business integration

---

## Overview

Firebase Firestore structure with 3 main collections:

1. **`/businesses`** — Business listings (gyms, cafes, restaurants, etc.)
2. **`/users/{userId}`** — User data + activity history + habit tracking
3. **`/analytics`** — Aggregated business performance metrics (optional, for dashboards)

---

## Collection: `/businesses`

Stores all business listings that can be promoted to users.

### Document: `/businesses/{businessId}`

```typescript
{
  // Identifiers & Metadata
  id: string;                              // Same as doc ID (businessId)
  type: 'gym' | 'cafe' | 'restaurant' | 'studio' | 'venue' | 'other';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isVerified: boolean;                     // Admin-verified (prevents spam)

  // Business Info
  name: string;                            // E.g., "FitnessPro Gym Berlin"
  description: string;                     // E.g., "Premium gym with morning classes, 24/7 access"
  phone: string;                           // Contact number
  website: string;                         // URL to booking/info page
  rating: number;                          // Google rating (0–5)
  ratingCount: number;                      // Number of ratings

  // Location
  place: {
    name: string;
    address: string;                       // Full street address
    lat: number;
    lng: number;
    costHint?: string;                     // E.g., "€29/month", "€8 per visit"
  };

  // Operating Hours (if available)
  openingHours: {
    Monday: "09:00-21:00",
    Tuesday: "09:00-21:00",
    // ...
  };

  // Advertising Config
  targetTags: string[];                    // E.g., ["fitness", "wellness", "morning_routine"]
  promotionTags?: string[];                // E.g., ["free_trial_week", "new_member_special"]
  monthlyBudget: number;                   // Dollar budget for ad spend
  conversionGoal: 'visits' | 'booking' | 'signup' | 'awareness';

  // Monthly Metrics (updated daily by cloud function)
  metrics: {
    impressions: number;                   // Times shown to users
    clicks: number;                        // Times user clicked
    conversions: number;                   // Times user booked/visited/signed up
    spend: number;                         // Amount spent (auto-calculated from impressions)
  };

  // Admin Notes
  status: 'active' | 'inactive' | 'pending_review';
  notes?: string;                          // Internal admin notes
}
```

### Example Document

```json
{
  "id": "fitnesspro_berlin_001",
  "type": "gym",
  "createdAt": "2026-05-01T10:00:00Z",
  "updatedAt": "2026-05-18T15:30:00Z",
  "isVerified": true,
  "name": "FitnessPro Gym Berlin-Mitte",
  "description": "Premium fitness studio with 50+ morning yoga & HIIT classes weekly. Personal training available. 24/7 member access.",
  "phone": "+49 30 12345678",
  "website": "https://fitnesspro.de/berlin",
  "rating": 4.7,
  "ratingCount": 247,
  "place": {
    "name": "FitnessPro Gym",
    "address": "Alexanderplatz 1, 10178 Berlin",
    "lat": 52.5216,
    "lng": 13.4115,
    "costHint": "€29/month, €8 drop-in"
  },
  "openingHours": {
    "Monday": "06:00-22:00",
    "Tuesday": "06:00-22:00",
    "Wednesday": "06:00-22:00",
    "Thursday": "06:00-22:00",
    "Friday": "06:00-22:00",
    "Saturday": "08:00-20:00",
    "Sunday": "08:00-20:00"
  },
  "targetTags": ["fitness", "wellness", "morning_routine"],
  "promotionTags": ["free_trial_week"],
  "monthlyBudget": 200,
  "conversionGoal": "signup",
  "metrics": {
    "impressions": 1243,
    "clicks": 147,
    "conversions": 18,
    "spend": 142.50
  },
  "status": "active",
  "notes": "High engagement with morning habit users. Consider increasing budget."
}
```

---

## Collection: `/users/{userId}`

User data including profiles, activity history, habits, and business interactions.

### Document: `/users/{userId}`

```typescript
{
  userId: string;                          // Firebase Auth UID
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // User Profile
  profile: {
    displayName: string;
    photoUrl?: string;
  };

  // Preferences
  preferences: {
    openToGoingOut: boolean;
    allowSerendipity: boolean;
    radiusKm: number;
    interestTags: string[];                // E.g., ["fitness", "coffee", "art"]
    customInterests?: string[];
    lifestyle: 'active' | 'moderate' | 'chill' | 'mixed';
    selfDescription?: string;
    themeMode: 'light' | 'dark';
  };

  // Activity History (most recent 100)
  activityLog: {
    [activityId: string]: {
      suggestionsId: string;
      title: string;
      completedAt: Timestamp;
      durationMin: number;
      tags: string[];
      source: 'gemini' | 'curated' | 'habit' | 'fallback' | 'business';
      businessId?: string;                 // If from a business
      userFeedback?: {
        liked: boolean;                    // User saved to library
        wouldRepeat: boolean;
      };
    };
  };

  // Habit Tracking
  habits: {
    [habitId: string]: {
      id: string;
      name: string;
      type: 'AT_HOME' | 'GO_OUT';
      frequency: 'daily' | 'weekly' | 'fortnightly' | 'monthly';
      timeOfDay: 'any' | 'morning' | 'afternoon' | 'evening';
      tags: string[];
      createdAt: Timestamp;
      lastCompletedAt?: Timestamp;
      currentStreak: number;
      longestStreak: number;
      completionHistory: Timestamp[];      // Most recent first, max 90
    };
  };

  // Tag Affinities (learned from user behavior)
  tagAffinities: {
    [tag: string]: number;                 // Score –1 to +1
  };

  // Business Interactions
  businessProfile: {
    businessImpressions: {
      [businessId: string]: number;        // Times shown
    };
    businessInteractions: {
      [businessId: string]: {
        clicked: number;
        visited: number;
        booked: number;
      };
    };
    habitsActivelyBuilding: {
      [habitId: string]: number;           // Strength 0–1
    };
    lastUpdated: Timestamp;
  };

  // Saved / Favorited
  savedSuggestions: {
    [suggestionId: string]: {
      suggestionsId: string;
      savedAt: Timestamp;
      source: 'saved_later' | 'interest_signal';
    };
  };
}
```

### Sub-collection: `/users/{userId}/activityToHabitRecords`

Track conversion of activities to habits.

```typescript
{
  id: string;
  activityId: string;
  title: string;
  tags: string[];
  completedAt: Timestamp;
  habitSuggestionId?: string;              // If converted to habit
  userFeedback?: {
    liked: boolean;
    wouldRepeat: boolean;
    businessId?: string;
  };
}
```

### Example Document

```json
{
  "userId": "user_abc123",
  "email": "alice@example.com",
  "createdAt": "2024-01-15T08:20:00Z",
  "updatedAt": "2026-05-18T16:45:00Z",
  "profile": {
    "displayName": "Alice",
    "photoUrl": "gs://..."
  },
  "preferences": {
    "openToGoingOut": true,
    "allowSerendipity": true,
    "radiusKm": 5,
    "interestTags": ["fitness", "coffee", "art"],
    "lifestyle": "active",
    "themeMode": "dark"
  },
  "activityLog": {
    "go_morning_walk_30_20260518": {
      "suggestationsId": "go_morning_walk_30_20260518",
      "title": "Morning Walk at Tiergarten",
      "completedAt": "2026-05-18T08:00:00Z",
      "durationMin": 28,
      "tags": ["fitness", "nature"],
      "source": "curated",
      "userFeedback": {
        "liked": true,
        "wouldRepeat": true
      }
    }
  },
  "habits": {
    "habit_morning_walk": {
      "id": "habit_morning_walk",
      "name": "Morning Walk",
      "type": "GO_OUT",
      "frequency": "daily",
      "timeOfDay": "morning",
      "tags": ["fitness", "nature"],
      "createdAt": "2026-03-01T00:00:00Z",
      "lastCompletedAt": "2026-05-18T08:00:00Z",
      "currentStreak": 47,
      "longestStreak": 47,
      "completionHistory": [
        "2026-05-18T08:00:00Z",
        "2026-05-17T08:15:00Z",
        "2026-05-16T08:10:00Z"
      ]
    }
  },
  "tagAffinities": {
    "fitness": 0.85,
    "coffee": 0.72,
    "art": 0.61,
    "nightlife": -0.3
  },
  "businessProfile": {
    "businessImpressions": {
      "fitnesspro_berlin_001": 3,
      "cafe_prater_001": 5
    },
    "businessInteractions": {
      "fitnesspro_berlin_001": {
        "clicked": 2,
        "visited": 1,
        "booked": 0
      },
      "cafe_prater_001": {
        "clicked": 5,
        "visited": 3,
        "booked": 0
      }
    },
    "habitsActivelyBuilding": {
      "habit_morning_walk": 0.9,
      "habit_gym": 0.45
    },
    "lastUpdated": "2026-05-18T16:45:00Z"
  },
  "savedSuggestions": {
    "go_gallery_afternoon_45": {
      "suggestationsId": "go_gallery_afternoon_45",
      "savedAt": "2026-05-10T14:30:00Z",
      "source": "saved_later"
    }
  }
}
```

---

## Collection: `/analytics` (Optional)

For dashboards and business reporting. Aggregated daily.

### Document: `/analytics/daily_{YYYYMMDD}`

```typescript
{
  date: string;                            // "2026-05-18"
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  businessMetrics: {
    [businessId: string]: {
      impressions: number;
      clicks: number;
      conversions: number;
      topMatchingHabits: string[];          // Top 3 habits that triggered ads
    };
  };
  userMetrics: {
    activeUsers: number;
    newHabits: number;
    habitCompletions: number;
    activityToHabitConversions: number;
  };
}
```

---

## Security Rules

```typescript
// Firestore security rules (pseudo-code)

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Businesses: Public read, verify-required write/update
    match /businesses/{document=**} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.isVerified == false;
      allow update, delete: if request.auth.uid == 'admin_uid_here';
    }

    // Users: Private user data
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;

      // Sub-collections
      match /activityToHabitRecords/{document=**} {
        allow read, write: if request.auth.uid == userId;
      }
    }

    // Analytics: Read-only for dashboards
    match /analytics/{document=**} {
      allow read: if request.auth.uid == 'admin_uid_here';
    }
  }
}
```

---

## Indexes Required

Create these Firestore composite indexes for good query performance:

1. **Business Search by Location + Tags**
   - Collection: `businesses`
   - Fields: `place.lat` (ASC), `place.lng` (ASC), `targetTags` (ASC)

2. **User Activity Log**
   - Collection: `users/{userId}/activityLog`
   - Fields: `completedAt` (DESC)

3. **User Habits by Updated Time**
   - Collection: `users/{userId}/habits`
   - Fields: `lastCompletedAt` (DESC)

4. **Business Analytics by Date**
   - Collection: `analytics`
   - Fields: `date` (DESC)

---

## Cloud Functions (Recommended)

Auto-manage repetitive tasks:

### 1. `onBusinessImpression()`
```typescript
// Triggered when business is shown to user
// Records: businessImpressions counter
// Updates: business metrics
```

### 2. `onActivityCompletion()`
```typescript
// Triggered when user completes activity
// Checks: Should this activity convert to habit? (3+ completions)
// Updates: tagAffinities, completedActivityIds in HistoryState
```

### 3. `aggregateBusinessMetrics()`
```typescript
// Nightly: Aggregate /users/*/businessProfile into /analytics
// Calculates: daily_impressions, daily_clicks, daily_conversions
```

### 4. `updateHabitStreaks()`
```typescript
// Daily (e.g., 2am UTC): Check overdue habits, mark streaks as broken
// Resets: currentStreak if user missed the frequency window
```

---

## Data Migration & Initialization

### Bootstrap Businesses

On first app load, seed some test businesses:

```typescript
const seedBusinesses = [
  {
    name: "Prater Garten",
    type: "cafe",
    targetTags: ["coffee", "nature", "morning_routine"],
    place: { address: "Gendarmenmarkt 5, 10178 Berlin", lat: 52.5165, lng: 13.3899 },
    // ...
  },
  {
    name: "FitnessPro Gym",
    type: "gym",
    targetTags: ["fitness", "wellness"],
    place: { address: "Alexanderplatz 1, 10178 Berlin", lat: 52.5216, lng: 13.4115 },
    // ...
  },
];
```

### User Onboarding

Create `/users/{userId}` doc on first sign-up with:
- Empty `habits`, `activityLog`, `businessProfile`
- Default `preferences`
- Empty `tagAffinities`

---

## Querying Examples

### Get Active Businesses Near User

```typescript
const nearbyBusinesses = await firestore
  .collection('businesses')
  .where('status', '==', 'active')
  .where('place.lat', '>=', userLat - 0.04)  // ~4.4 km radius
  .where('place.lat', '<=', userLat + 0.04)
  .where('place.lng', '>=', userLng - 0.04)
  .where('place.lng', '<=', userLng + 0.04)
  .get();
```

### Get User's Activity Log (Last 20)

```typescript
const recentActivities = await firestore
  .collection(`users/${userId}/activityLog`)
  .orderBy('completedAt', 'desc')
  .limit(20)
  .get();
```

### Get User's Active Habits

```typescript
const habits = await firestore
  .collection(`users/${userId}/habits`)
  .where('currentStreak', '>', 0)
  .get();
```

### Get Daily Analytics

```typescript
const today = new Date().toISOString().split('T')[0]; // "2026-05-18"
const analytics = await firestore
  .collection('analytics')
  .doc(`daily_${today.replace(/-/g, '')}`)  // "daily_20260518"
  .get();
```

---

## Summary

| Entity | Collection | Purpose | Access |
|--------|-----------|---------|--------|
| **Business** | `/businesses` | Advertising listings | Public read, Admin write |
| **User** | `/users/{userId}` | Personal data + habits | User-only |
| **Activity History** | `/users/{userId}/activityLog` | What user completed | User-only |
| **Analytics** | `/analytics` | Business performance | Admin/dashboard |

This schema supports:
- ✅ Personalized activity recommendations
- ✅ Habit formation tracking
- ✅ Activity → Habit conversion
- ✅ Business-to-user targeting
- ✅ Impression + conversion analytics
- ✅ Real-time user behavior learning
