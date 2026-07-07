# Bits for Business - Complete Platform Implementation Guide

## Overview

This document provides a complete blueprint for building the "Bits for Business" platform within the Bits app. This is a dedicated business advertising platform integrated into the consumer app, with full separation of concerns, modern architecture, and future scalability.

---

## Architecture

### File Structure

```
src/
├── types/
│   └── business.ts                           # All business types & interfaces
├── screens/
│   ├── BusinessOnboardingScreen.tsx          # Multi-step onboarding flow
│   ├── BusinessAccountCreationScreen.tsx    # Business profile form
│   ├── BusinessDashboardScreen.tsx           # Main dashboard hub
│   ├── CampaignListScreen.tsx               # Campaign overview/management
│   ├── CampaignDetailsScreen.tsx            # Campaign details & analytics
│   ├── CampaignCreationScreen.tsx           # Campaign builder
│   ├── CampaignPreviewScreen.tsx            # How ads look in decks
│   ├── AudienceInsightsScreen.tsx           # Audience analytics
│   └── BillingScreen.tsx                    # Billing & monetization
├── navigation/
│   └── BusinessNavigator.tsx                # Business-mode navigation
├── services/
│   ├── business.ts                          # Business API/Firestore
│   ├── campaigns.ts                         # Campaign management
│   ├── businessAnalytics.ts                 # Analytics & metrics
│   └── businessApproval.ts                  # Admin approval workflow
├── components/
│   ├── CampaignCard.tsx                     # Reusable campaign card
│   ├── PerformanceChart.tsx                 # Analytics charts
│   ├── KpiWidget.tsx                        # KPI display
│   ├── MediaUploadPreview.tsx              # Media validation & preview
│   └── CampaignPreviewRenderer.tsx         # Shows ads in actual deck

├── state/
│   ├── BusinessAppState.tsx                 # Business mode state management
│   └── BusinessContext.tsx                  # Business context provider

└── utils/
    ├── businessValidation.ts                # Form validation
    ├── campaignBuilder.ts                   # Campaign logic helpers
    └── mediaProcessor.ts                    # Image/video handling
```

---

## Core Types

### BusinessProfile

```typescript
interface BusinessProfile {
  id: string;
  userId: string;
  businessName: string;
  category: BusinessCategory;
  description?: string;
  website?: string;
  phone?: string;
  email: string;
  location: { address, lat, lng, city, country };
  logo?: { url, uploadedAt };
  socialLinks?: { instagram, facebook, tiktok, linkedin };
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verificationBadge?: boolean;
  createdAt: string;
  updatedAt: string;
  onboardingComplete: boolean;
}
```

### Campaign

```typescript
interface Campaign {
  id: string;
  businessId: string;
  title: string;
  hook: string;
  description: string;
  cta: { text, action, value };
  category: BusinessCategory;
  media: CampaignMedia[];
  targeting: CampaignTargeting;
  dateRange: { startDate, endDate };
  budget?: { daily, total, currency };
  status: CampaignStatus;
  approvalNotes?: string;
  metrics?: CampaignMetrics;
  createdAt: string;
  publishedAt?: string;
}
```

### CampaignMetrics

```typescript
interface CampaignMetrics {
  impressions: number;
  clicks: number;
  engagements: number;
  activityStarts: number;
  calendarAdds: number;
  conversions: number;
  qrScans?: number;
  uniqueUsers: number;
  ctr: number;
  conversionRate: number;
  lastUpdated: string;
}
```

---

## Implementation Steps

### Step 1: Add Business Mode to AppState

Extend `src/state/AppState.tsx`:

```typescript
type AppState = {
  ...existing fields...
  accountType: 'consumer' | 'business';
  businessProfile?: BusinessProfile;
  businessMode: boolean;
};

type AppActions = {
  ...existing actions...
  switchToBusinessMode: (profile: BusinessProfile) => void;
  switchToConsumerMode: () => void;
};
```

### Step 2: Update Navigation

Create `src/navigation/BusinessNavigator.tsx`:

```typescript
export const BusinessNavigator = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen name="BusinessDashboard" component={BusinessDashboardScreen} />
      <Stack.Screen name="CampaignList" component={CampaignListScreen} />
      <Stack.Screen name="CampaignDetails" component={CampaignDetailsScreen} />
      <Stack.Screen name="CampaignCreate" component={CampaignCreationScreen} />
      <Stack.Screen name="CampaignPreview" component={CampaignPreviewScreen} />
      <Stack.Screen name="Audience" component={AudienceInsightsScreen} />
      <Stack.Screen name="Billing" component={BillingScreen} />
      <Stack.Screen name="Settings" component={BusinessSettingsScreen} />
    </Stack.Navigator>
  );
};
```

### Step 3: Add Business Entry Point

Update `src/screens/PreferencesScreen.tsx` to add "Bits for Business" button:

```typescript
<Pressable
  onPress={() => navigation.navigate('BusinessOnboarding')}
  style={styles.businessButton}
>
  <Text style={styles.businessButtonIcon}>💼</Text>
  <View style={styles.businessButtonContent}>
    <Text style={styles.businessButtonTitle}>Bits for Business</Text>
    <Text style={styles.businessButtonSubtitle}>Advertise to engaged users</Text>
  </View>
  <Text style={styles.businessButtonArrow}>→</Text>
</Pressable>
```

### Step 4: Implement Business Services

Create `src/services/business.ts`:

```typescript
export const createBusinessProfile = async (
  userId: string,
  profile: Partial<BusinessProfile>
): Promise<BusinessProfile> => {
  const docRef = doc(db, 'businesses', userId);
  const businessData = {
    ...profile,
    userId,
    verificationStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    onboardingComplete: true,
  };
  await setDoc(docRef, businessData);
  return businessData as BusinessProfile;
};

export const getBusinessProfile = async (userId: string): Promise<BusinessProfile | null> => {
  const docRef = doc(db, 'businesses', userId);
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as BusinessProfile) : null;
};

export const updateBusinessProfile = async (
  userId: string,
  updates: Partial<BusinessProfile>
): Promise<void> => {
  const docRef = doc(db, 'businesses', userId);
  await updateDoc(docRef, {
    ...updates,
    updatedAt: new Date().toISOString(),
  });
};
```

### Step 5: Implement Campaign Services

Create `src/services/campaigns.ts`:

```typescript
export const createCampaign = async (
  businessId: string,
  campaign: Partial<Campaign>
): Promise<Campaign> => {
  const docRef = doc(collection(db, 'campaigns'));
  const campaignData = {
    ...campaign,
    businessId,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await setDoc(docRef, campaignData);
  return campaignData as Campaign;
};

export const getCampaigns = async (businessId: string): Promise<Campaign[]> => {
  const q = query(collection(db, 'campaigns'), where('businessId', '==', businessId));
  const snap = await getDocs(q);
  return snap.docs.map((doc) => doc.data() as Campaign);
};

export const submitCampaignForApproval = async (campaignId: string): Promise<void> => {
  const docRef = doc(db, 'campaigns', campaignId);
  await updateDoc(docRef, {
    status: 'pending_approval',
    updatedAt: new Date().toISOString(),
  });

  // Create approval record
  const approvalRef = doc(collection(db, 'campaign_approvals'));
  await setDoc(approvalRef, {
    campaignId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

export const updateCampaignMetrics = async (
  campaignId: string,
  metrics: Partial<CampaignMetrics>
): Promise<void> => {
  const docRef = doc(db, 'campaigns', campaignId);
  await updateDoc(docRef, {
    metrics: { ...metrics, lastUpdated: new Date().toISOString() },
  });
};
```

### Step 6: Implement Analytics Service

Create `src/services/businessAnalytics.ts`:

```typescript
export const getCampaignPerformanceData = async (
  campaignId: string,
  startDate: string,
  endDate: string
): Promise<CampaignPerformanceData[]> => {
  const q = query(
    collection(db, 'campaign_performance'),
    where('campaignId', '==', campaignId),
    where('date', '>=', startDate),
    where('date', '<=', endDate)
  );
  const snap = await getDocs(q);
  return snap.docs.map((doc) => doc.data() as CampaignPerformanceData);
};

export const getAudienceInsights = async (campaignId: string): Promise<AudienceInsight> => {
  const docRef = doc(db, 'audience_insights', campaignId);
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as AudienceInsight) : null;
};
```

### Step 7: Implement Approval Workflow

Create `src/services/businessApproval.ts`:

```typescript
export const getPendingApprovals = async (): Promise<CampaignApproval[]> => {
  const q = query(collection(db, 'campaign_approvals'), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((doc) => doc.data() as CampaignApproval);
};

export const approveCampaign = async (
  approvalId: string,
  feedback?: string
): Promise<void> => {
  const docRef = doc(db, 'campaign_approvals', approvalId);
  await updateDoc(docRef, {
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    feedback,
  });

  // Activate campaign
  const approval = await getDoc(docRef);
  const campaignId = approval.data().campaignId;
  const campaignRef = doc(db, 'campaigns', campaignId);
  await updateDoc(campaignRef, { status: 'active' });
};

export const rejectCampaign = async (
  approvalId: string,
  feedback: string,
  changesRequested: Array<{ field: string; reason: string }>
): Promise<void> => {
  const docRef = doc(db, 'campaign_approvals', approvalId);
  await updateDoc(docRef, {
    status: 'rejected',
    feedback,
    changesRequested,
    reviewedAt: new Date().toISOString(),
  });
};

export const requestChanges = async (
  approvalId: string,
  changesRequested: Array<{ field: string; reason: string }>
): Promise<void> => {
  const docRef = doc(db, 'campaign_approvals', approvalId);
  await updateDoc(docRef, {
    status: 'changes_requested',
    changesRequested,
  });

  // Campaign reverts to draft
  const approval = await getDoc(docRef);
  const campaignId = approval.data().campaignId;
  const campaignRef = doc(db, 'campaigns', campaignId);
  await updateDoc(campaignRef, { status: 'draft' });
};
```

---

## Firestore Collections Structure

### `/businesses/{userId}`

Stores business profiles.

```
businesses/
  user123/
    id: "user123"
    businessName: "Urban Yoga Studio"
    category: "wellness"
    location: { address, lat, lng, city, country }
    verificationStatus: "verified"
    createdAt: "2024-01-15T10:00:00Z"
    ...
```

### `/campaigns/{campaignId}`

Stores campaign definitions.

```
campaigns/
  camp_abc123/
    id: "camp_abc123"
    businessId: "user123"
    title: "Spring Yoga Classes"
    hook: "Find your flow"
    status: "active"
    media: [ { url, type, aspectRatio } ]
    targeting: { moods, interests, locations }
    metrics: { impressions, clicks, conversions }
    createdAt: "2024-01-20T08:00:00Z"
    ...
```

### `/campaign_approvals/{approvalId}`

Stores approval workflow state.

```
campaign_approvals/
  appr_xyz789/
    id: "appr_xyz789"
    campaignId: "camp_abc123"
    status: "approved"
    feedback: "Great visuals!"
    reviewedBy: "admin_user_001"
    reviewedAt: "2024-01-21T12:00:00Z"
    createdAt: "2024-01-20T08:30:00Z"
```

### `/campaign_performance/{performanceId}`

Time-series analytics data (can be sharded by day).

```
campaign_performance/
  camp_abc123_2024-01-25/
    campaignId: "camp_abc123"
    date: "2024-01-25"
    impressions: 1250
    clicks: 45
    conversions: 8
    revenue: 12.50
    ...
```

### `/audience_insights/{campaignId}`

Cached audience analytics.

```
audience_insights/
  camp_abc123/
    campaignId: "camp_abc123"
    ageRanges: { "18-25": 450, "26-35": 650, ... }
    topInterests: [ { interest: "yoga", count: 200 } ]
    engagementByTime: { "08:00": 120, "09:00": 180, ... }
    moodCorrelation: { "relaxed": 0.92, "energetic": 0.45 }
    lastUpdated: "2024-01-25T12:00:00Z"
```

---

## Campaign Workflow

### 1. Draft Creation

User creates campaign in `CampaignCreationScreen`:

- Fill form (title, hook, description, CTA, media)
- Select targeting (interests, mood, location, weather, time)
- Save as draft

**Status**: `draft`

### 2. Preview & Media Validation

User sees how ads look in actual decks:

- Media validation (aspect ratio, resolution)
- Preview in `CampaignPreviewRenderer`
- Adjust as needed

### 3. Submit for Approval

User clicks "Submit Campaign":

- Campaign status → `pending_approval`
- Create `CampaignApproval` record
- Trigger notification to admin

**Status**: `pending_approval`

### 4. Admin Review

Admin can:

- **Approve**: Campaign → `approved`, then → `active` (if date range applies)
- **Reject**: Campaign → `rejected`, with feedback
- **Request Changes**: Campaign → `draft`, with notes

### 5. Live Campaign

Once `active`, campaign enters the suggestion inference pipeline:

- When building user deck → check active campaigns
- Match by targeting (interests, mood, location, weather, time)
- Insert campaign card into deck alongside organic suggestions
- Track impressions, clicks, conversions

### 6. Pause / End

Business can pause or end campaigns manually:

- Pause: campaign not inserted into new decks
- End: campaign status → `ended`

---

## Metrics & Attribution

### On Impression

When a campaign card appears in a user's deck:

```
POST /functions/recordImpression
{
  campaignId: "camp_abc123",
  userId: "consumer_user_456",
  timestamp: "2024-01-25T10:30:00Z"
}
```

Cloud Function increments `campaign_performance` doc.

### On Click

User taps the campaign card:

```
POST /functions/recordClick
{
  campaignId: "camp_abc123",
  userId: "consumer_user_456",
  timestamp: "2024-01-25T10:31:00Z"
}
```

### On Conversion

User completes activity (visits/books/adds to calendar):

```
POST /functions/recordConversion
{
  campaignId: "camp_abc123",
  userId: "consumer_user_456",
  activityId: "activity_789",
  conversionType: "activity_start" | "calendar_add" | "qr_scan",
  timestamp: "2024-01-25T10:45:00Z"
}
```

---

## Monetization Architecture

Design (DO NOT fully implement yet, but architect for:):

### Model Options

1. **CPM (Cost Per Mille)**: $X per 1000 impressions
2. **CPC (Cost Per Click)**: $Y per click
3. **Conversion-based**: $Z per actual conversion
4. **Subscription**: Monthly retainer + discounted rates
5. **Hybrid**: Base CPM + performance bonus

### Billing Schema

```typescript
interface BillingAccount {
  businessId: string;
  pricingModel: 'cpm' | 'cpc' | 'conversion' | 'subscription' | 'hybrid';
  monthlyBudget?: number;
  totalSpent: number;
  balance: number;
  paymentMethod?: string;
}
```

---

## Media Requirements

Campaign media must fit into suggestion cards (9:16 vertical).

### Validation Rules

- Min resolution: 1080x1920
- Max file size: 5MB
- Formats: JPEG, PNG
- Aspect ratio: 9:16 (1.125:1)
- Safe zone: 80% of card (leave 10% margin on all sides)

### Safe Zone Overlay

`CampaignCreationScreen` should show:

- Card preview with safe zone overlay
- Auto-crop suggestions
- Format recommendations

---

## Design Principles

1. **Modern Aesthetics**:
   - Soft rounded corners (12-16px)
   - Glassmorphism accents
   - Premium gradients
   - Clean typography

2. **Mobile-First**:
   - All screens tested on small phones
   - Touch-friendly tap targets (min 44x44)
   - Vertical scrolling priority

3. **Clarity**:
   - KPI cards clearly labeled
   - Status badges color-coded
   - Call-to-actions obvious

4. **Premium Feel**:
   - Like Stripe, Notion, Meta Ads Manager
   - Trustworthy & professional
   - Data-driven aesthetic

---

## Testing Checklist

- [ ] Create business profile
- [ ] Complete onboarding
- [ ] Switch to business mode (nav changes)
- [ ] Dashboard loads KPI data
- [ ] Create campaign (draft)
- [ ] Preview campaign in deck
- [ ] Submit for approval
- [ ] Admin approves campaign
- [ ] Campaign live (visible in consumer deck)
- [ ] Impressions/clicks tracked
- [ ] Analytics page shows data
- [ ] Pause/resume campaign
- [ ] End campaign

---

## Future Enhancements

1. **Advanced Analytics**:
   - Real-time dashboards
   - Audience segmentation
   - A/B testing campaigns

2. **Content Management**:
   - Template campaigns
   - Batch uploads
   - Content calendar

3. **Marketplace**:
   - Featured campaigns
   - Trending categories
   - Sponsored placements

4. **Integrations**:
   - Google Ads
   - Facebook Ads Manager
   - Slack notifications
   - Zapier support

5. **AI-Driven**:
   - Auto-suggest targeting
   - Optimal posting times
   - Creative recommendations

---

## Support & Troubleshooting

For business mode issues:

1. Check user `accountType` in AppState
2. Verify business profile exists in Firestore
3. Confirm navigation switching to `BusinessNavigator`
4. Check campaign status in approval queue

---

This blueprint is ready for implementation. Start with Steps 1-4, then build screens iteratively.
