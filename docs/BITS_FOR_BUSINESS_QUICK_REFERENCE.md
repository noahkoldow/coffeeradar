# Bits for Business - Architecture Quick Reference

## Quick Facts

| Aspect | Details |
|--------|---------|
| **Mode Switch** | AppState.accountType: 'consumer' \| 'business' |
| **Activation** | Via PreferencesScreen → "Bits for Business" button |
| **Onboarding** | 8 slides → BusinessAccountCreationScreen → create profile → switch mode |
| **Core Entity** | Campaign (title, hook, media, targeting, status, metrics) |
| **Campaign Lifecycle** | draft → pending_approval → (approved OR rejected) → active/paused/ended |
| **Targeting Dimensions** | interests, mood, location, weather, time windows |
| **Metrics Tracked** | impressions, clicks, conversions, engagement, CTR, conversion rate |
| **Approval** | Required before campaign goes live; admin role needed |
| **Analytics** | Real-time KPIs, audience demographics, performance trends |

---

## Database Schema (Firestore)

```
/businesses/{userId}
├── businessName: string
├── category: enum (wellness, food, tech, etc.)
├── verificationStatus: pending | verified | rejected
├── createdAt: timestamp
├── onboardingComplete: boolean
└── socialLinks: object

/campaigns/{campaignId}
├── businessId: string (FK to businesses)
├── title, hook, description, cta: string
├── media: array<{ url, type, aspectRatio }>
├── targeting: { interests[], moods[], locations[], weather[], timeWindows[] }
├── status: enum (draft, pending_approval, approved, active, paused, ended, rejected)
├── budget: { daily, total, currency }
├── metrics: { impressions, clicks, conversions, ... }
├── dateRange: { startDate, endDate }
├── createdAt, publishedAt: timestamp
└── approvalNotes?: string

/campaign_approvals/{approvalId}
├── campaignId: string (FK to campaigns)
├── status: enum (pending, approved, rejected, changes_requested)
├── feedback: string
├── changesRequested: array<{ field, reason }>
├── reviewedBy: string (admin user ID)
├── reviewedAt: timestamp
└── createdAt: timestamp

/campaign_performance/{performanceId}
├── campaignId: string (FK to campaigns)
├── date: string (YYYY-MM-DD)
├── impressions, clicks, conversions: number
├── revenue: number
└── lastUpdated: timestamp

/audience_insights/{campaignId}
├── campaignId: string (FK to campaigns)
├── ageRanges: object (histogram)
├── topInterests: array<{ interest, count }>
├── engagementByTime: object (24-hour breakdown)
├── moodCorrelation: object (mood → effectiveness)
└── lastUpdated: timestamp
```

---

## State Management

### AppState Extension

```typescript
// Existing consumer-only fields
accountType: 'consumer' | 'business'
businessProfile?: BusinessProfile
businessMode: boolean

// Actions
switchToBusinessMode: (profile: BusinessProfile) => void
switchToConsumerMode: () => void
```

### Navigation Switch

```typescript
// In main app's RootNavigator or equivalent
if (appState.businessMode) {
  <BusinessNavigator />
} else {
  <ConsumerNavigator />
}
```

---

## Campaign Keys

### Draft Campaigns

- Status: `draft`
- Stored locally in AppState or AsyncStorage
- Can be edited immediately
- No approval needed
- Not visible to consumers

### Submitted Campaigns

- Status: `pending_approval`
- In approval queue (admin sees)
- Business can still edit (creates new version)
- NOT visible to consumers yet

### Approved Campaigns

- Status: `approved`
- Stored in Firestore
- Ready to go live once date range starts
- Visible to consumers matching targeting

### Active Campaigns

- Status: `active`
- Date range includes today
- Inserted into consumer decks
- Impressions/clicks/conversions tracked
- Visible on dashboard with real-time metrics

### Paused/Ended Campaigns

- Status: `paused` or `ended`
- Not inserted into new decks
- Historical metrics still visible
- Can be resumed (paused only)

### Rejected Campaigns

- Status: `rejected`
- Failed approval
- Feedback provided to business
- Can be re-submitted after revision

---

## Consumer Integration

When building a suggestion deck for consumer:

```javascript
// Pseudocode
const consumerDeck = [];
const organicSuggestions = await getOrganicSuggestions(user);
const activeCampaigns = await getActiveCampaigns();

// Match campaigns to consumer's profile
const matchedCampaigns = activeCampaigns.filter(campaign => {
  return matchesTargeting(consumer, campaign.targeting);
});

// Distribute campaigns throughout deck
for (const campaign of matchedCampaigns) {
  const position = Math.floor(Math.random() * organicSuggestions.length);
  organicSuggestions.splice(position, 0, createCampaignCard(campaign));
  recordImpression(campaign.id, consumer.id);
}

return organicSuggestions;
```

---

## Targeting Logic

### Dimensions

1. **Interests**: User's explicit interests match campaign target interests
2. **Mood**: User's current mood matches campaign target moods
3. **Location**: User's location within campaign's location radius
4. **Weather**: Current weather at user's location matches campaign target
5. **Time Windows**: Current time falls within campaign's preferred times

### Matching Algorithm

```javascript
function matchesTargeting(consumer, campaign) {
  const { interests, moods, locations, weather, timeWindows } = campaign.targeting;

  // Must match ALL dimensions (AND logic)
  if (consumer.interests && !interests.some(i => consumer.interests.includes(i))) {
    return false;
  }

  if (consumer.mood && !moods.includes(consumer.mood)) {
    return false;
  }

  if (consumer.location && !withinRadius(consumer.location, locations)) {
    return false;
  }

  if (consumer.weather && !weather.includes(consumer.weather)) {
    return false;
  }

  if (!withinTimeWindow(timeWindows)) {
    return false;
  }

  return true;
}
```

---

## Performance Considerations

### Firestore Queries

**Optimize with indexes:**

```
collections: campaigns
  filters:
    - businessId == "X" AND status == "active"
    - status == "pending_approval"
    - createdAt > date

You'll need composite indexes for:
  - businessId + status
  - businessId + status + createdAt
  - status + dateRange.startDate
```

### Caching Strategy

- **Dashboard KPIs**: Cache for 5 minutes
- **Campaign list**: Cache for 1 minute
- **Analytics data**: Cache for 10 minutes
- **Approval queue**: No cache (real-time)

### Data Aggregation

Use Cloud Functions to pre-aggregate metrics:

```javascript
// Runs nightly or weekly
exports.aggregateCampaignMetrics = functions.pubsub
  .schedule('every day 00:00')
  .onRun(async (context) => {
    const campaigns = await db.collection('campaigns')
      .where('status', '==', 'active')
      .get();

    for (const campaign of campaigns.docs) {
      const metrics = await aggregatePerformance(campaign.id);
      await db
        .collection('campaign_metrics_daily')
        .add({
          campaignId: campaign.id,
          date: new Date().toISOString().split('T')[0],
          ...metrics
        });
    }
  });
```

---

## Approval Workflow Diagram

```
Draft Campaign Created
        ↓
    Business Reviews & Edits
        ↓
  Business Submits For Approval
        ↓
  Campaign → pending_approval
        ↓
  (Admin Reviews)
        ├─→ Approves
        │       ├─→ Campaign → approved
        │       ├─→ Ready to go live (based on date)
        │       └─→ Notification to business ✓
        │
        ├─→ Rejects
        │       ├─→ Campaign → rejected
        │       ├─→ Feedback to business
        │       └─→ Business can revise & re-submit
        │
        └─→ Requests Changes
                ├─→ Campaign → draft
                ├─→ Edit suggestions to business
                └─→ Business can submit again after editing
```

---

## Key Business Rules

1. **Media Aspect Ratio**: Strictly 9:16 (or auto-cropped)
2. **Campaign Min Duration**: 3 days
3. **Campaign Max Duration**: 90 days
4. **Approval Timeout**: 48 hours (default) or custom
5. **Budget Min**: $0.50 (for MVP) or custom
6. **Budget Max**: Unlimited (tied to account verification)
7. **Rejection Threshold**: Campaigns with profanity/misleading claims auto-rejected
8. **Unverified Business**: Limited to 1 active campaign at a time
9. **Rejected Resubmit Limit**: 3 attempts before manual support needed

---

## Error Handling

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Media upload fails | Check file size (< 5MB), format (JPEG/PNG), internet connection |
| Campaign stuck in pending | Admin queue might be backed up; show estimated wait time |
| Metrics not updating | Data might be cached; refresh after 5 min |
| Approval feedback unclear | Route to support chat with context |
| Campaign not appearing in deck | Check date range, targeting, status, approval |

---

## Compliance & Safety

1. **Content Moderation**:
   - Media flagging (nudity, violence, misinformation)
   - Text flagging (spam, hate speech, false claims)
   - Team reviews within 48 hours

2. **GDPR/Privacy**:
   - Don't store user demographics on campaigns
   - Aggregate analytics only (no PII in targeting)
   - Allow data deletion on request

3. **Rate Limiting**:
   - Campaign submissions: 50 per day max per business
   - Approval requests: 1 per hour
   - Analytics queries: 100 per minute per business

---

## Monitoring & Alerts

### Business Dashboard Alerts

- Campaign approved
- Campaign rejected
- Daily budget reached
- Low conversion rate (< 0.1%)
- High fraud score (click/impression ratio > 5%)

### Admin Dashboard Alerts

- Campaigns pending > 8 hours
- Fraud detected in campaign
- Copyright claim filed
- High complaint rate

---

## Cost Model (Example)

```
Pricing Tiers:
- Starter: $0 (1 campaign, pay-per-performance)
- Pro: $9.99/mo (5 campaigns, $100/mo spend included)
- Business: $29.99/mo (unlimited campaigns, $500/mo spend included)

Per-Impression Rates:
- Starter: $0.05 CPM (5¢ per 1000 impressions)
- Pro: $0.03 CPM (discounted)
- Business: $0.02 CPM (discounted)

Alternative: CPC Model
- Starter: $0.50 per click
- Pro: $0.25 per click
- Business: $0.15 per click
```

---

## Next Steps (In Order)

1. **Phase 1**: Update AppState + create BusinessNavigator
2. **Phase 2**: Create business.ts service + integrate with account creation
3. **Phase 3**: Create campaigns.ts service
4. **Phase 4**: Build CampaignCreationScreen + media upload
5. **Phase 5**: Build CampaignPreviewScreen
6. **Phase 6**: Build CampaignListScreen + CampaignDetailsScreen
7. **Phase 7**: Integrate campaigns into consumer deck + tracking
8. **Phase 8**: Build analytics screens
9. **Phase 9**: Implement approval workflow
10. **Phase 10**: Polish & deploy

---

## Success Metrics

- Campaign creation time < 5 min
- Approval time < 2 hours (manual)
- Campaign visible in deck < 5 min after approval
- Metrics accuracy > 99%
- Zero data loss on failures
- Support response time < 24 hours
