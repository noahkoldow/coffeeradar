# Bits for Business - Implementation Roadmap

## Phase 1: Foundation (Routes & State)

### Tasks

- [ ] **1.1**: Update `AppState.tsx` with business mode support
  - Add `accountType: 'consumer' | 'business'`
  - Add `businessProfile?: BusinessProfile`
  - Add `businessMode: boolean`
  - Add actions: `switchToBusinessMode()`, `switchToConsumerMode()`

- [ ] **1.2**: Create `BusinessNavigator.tsx`
  - Stack with all business screens
  - Separate from consumer navigation

- [ ] **1.3**: Create `BusinessContext.tsx`
  - Provider for business state
  - Hooks for easy access to business data

- [ ] **1.4**: Add entry point in `PreferencesScreen.tsx`
  - "Bits for Business" button
  - Route to `BusinessOnboarding`

---

## Phase 2: Business Profile Services

### Tasks

- [ ] **2.1**: Create `src/services/business.ts`
  - `createBusinessProfile(userId, profile)`
  - `getBusinessProfile(userId)`
  - `updateBusinessProfile(userId, updates)`
  - `listBusinesses()` (for admin)

- [ ] **2.2**: Integrate with account creation
  - After `BusinessAccountCreationScreen` submit
  - Create profile in Firestore
  - Update AppState
  - Switch to business mode

- [ ] **2.3**: Add verification workflow templates
  - Email verification
  - Location verification
  - Identity verification (future)

---

## Phase 3: Campaign Services

### Tasks

- [ ] **3.1**: Create `src/services/campaigns.ts`
  - `createCampaign(businessId, campaign)`
  - `getCampaigns(businessId)`
  - `updateCampaign(campaignId, updates)`
  - `deleteCampaign(campaignId)`
  - `publishCampaign(campaignId)` (submit for approval)
  - `pauseCampaign(campaignId)`
  - `endCampaign(campaignId)`

- [ ] **3.2**: Add media validation
  - Aspect ratio (9:16)
  - File size limits (5MB)
  - Format validation (JPEG, PNG)

---

## Phase 4: Campaign Creation Screen

### Tasks

- [ ] **4.1**: Create `CampaignCreationScreen.tsx`
  - Multi-step form (title, hook, description, CTA)
  - Category selection
  - Media upload with preview
  - Targeting options (interests, mood, location, weather, time)
  - Save as draft (with auto-save)
  - Submit for approval

- [ ] **4.2**: Create `src/components/MediaUploadPreview.tsx`
  - Image picker
  - Crop tool for 9:16 aspect ratio
  - Safe zone overlay
  - Local and network validation

- [ ] **4.3**: Create targeting UI components
  - Interest multiselect
  - Mood picker
  - Location radius map
  - Weather condition selector
  - Time window picker

---

## Phase 5: Campaign Preview & Validation

### Tasks

- [ ] **5.1**: Create `CampaignPreviewScreen.tsx`
  - Render campaign in actual deck UI
  - Show how it looks on different phone sizes
  - Simulate positioning in card stack

- [ ] **5.2**: Create `src/components/CampaignPreviewRenderer.tsx`
  - Reuse deck card component
  - Show campaign as it appears to consumers
  - Allow adjustments before submission

---

## Phase 6: Campaign List & Management

### Tasks

- [ ] **6.1**: Create `CampaignListScreen.tsx`
  - List campaigns by status (draft, pending, approved, active, paused, ended)
  - Filter by status
  - Sort by date, performance
  - Quick actions (edit, preview, pause, archive)

- [ ] **6.2**: Create `CampaignDetailsScreen.tsx`
  - Campaign info overview
  - Edit form (for draft campaigns)
  - Performance metrics
  - Approval status & feedback

- [ ] **6.3**: Update `BusinessDashboardScreen.tsx`
  - Link to campaign list
  - Show recent campaigns
  - Show active campaign count

---

## Phase 7: Analytics Services

### Tasks

- [ ] **7.1**: Create `src/services/businessAnalytics.ts`
  - `getCampaignPerformanceData(campaignId, startDate, endDate)`
  - `getAudienceInsights(campaignId)`
  - `getBusinessOverview(businessId)` (aggregated)
  - `trackImpression(campaignId, userId)`
  - `trackClick(campaignId, userId)`
  - `trackConversion(campaignId, userId, type)`

- [ ] **7.2**: Deploy Cloud Functions
  - `recordImpression()`
  - `recordClick()`
  - `recordConversion()`
  - Real-time aggregation

---

## Phase 8: Analytics UI

### Tasks

- [ ] **8.1**: Create `AudienceInsightsScreen.tsx`
  - Demographics breakdown (age, gender, interests)
  - Time-of-day heatmap
  - Engagement by category
  - Mood correlation chart

- [ ] **8.2**: Create analytics components
  - `src/components/PerformanceChart.tsx` (line chart with trends)
  - `src/components/AudienceChart.tsx` (bar/pie charts)
  - `src/components/HeatmapChart.tsx` (time-based heatmap)

- [ ] **8.3**: Add to `CampaignDetailsScreen`
  - Performance over time
  - Audience breakdown
  - Conversion funnel

---

## Phase 9: Approval Workflow

### Tasks

- [ ] **9.1**: Create `src/services/businessApproval.ts`
  - `getPendingApprovals()`
  - `approveCampaign(approvalId, feedback)`
  - `rejectCampaign(approvalId, feedback, changesRequested)`
  - `requestChanges(approvalId, changesRequested)`

- [ ] **9.2**: Create approval admin screens
  - `CampaignApprovalQueueScreen.tsx`
  - `CampaignApprovalReviewScreen.tsx`
  - Form for feedback/decisions

- [ ] **9.3**: Add notifications
  - Campaign approved → send to business
  - Campaign rejected → send to business with feedback
  - Changes requested → send with edit instructions

---

## Phase 10: Billing Architecture

### Tasks

- [ ] **10.1**: Design billing schema (UI, not payment processing)
  - `BillingAccount` interface
  - Pricing model selection (CPM, CPC, conversion, subscription)
  - Budget management
  - Spend tracking

- [ ] **10.2**: Create `BillingScreen.tsx`
  - Show total spend, remaining budget
  - Pricing model info
  - Billing history
  - Invoice download links

- [ ] **10.3**: Cost calculations
  - Update metrics with cost data
  - Show per-impression/click/conversion costs
  - ROI calculations

---

## Phase 11: Business Settings & Support

### Tasks

- [ ] **11.1**: Create `BusinessSettingsScreen.tsx`
  - Edit profile
  - Change category
  - Update location
  - Social media links
  - Support/help center

- [ ] **11.2**: Add FAQ/Help content
  - Campaign best practices
  - Targeting guide
  - Common issues
  - Contact support

---

## Phase 12: Integration & Consumer-Side

### Tasks

- [ ] **12.1**: Integrate campaigns into consumer deck
  - When building suggestion deck → check active campaigns
  - Match by targeting (interests, mood, location, weather, time)
  - Insert campaign card at natural position
  - Track as impression

- [ ] **12.2**: Track consumer interactions
  - Impression: when card renders
  - Click: when card tapped
  - Conversion: when activity started/added/QR scanned

- [ ] **12.3**: Update consumer analytics
  - Show how many campaigns seen
  - Aggregate campaign engagement stats

---

## Phase 13: Testing & Polish

### Tasks

- [ ] **13.1**: Manual testing
  - E2E workflow: create account → onboard → create campaign → approve → live
  - Campaign in deck → consumer interactions
  - Analytics updates in real-time

- [ ] **13.2**: Performance testing
  - Dashboard load time
  - Analytics queries
  - Batch campaign retrieval

- [ ] **13.3**: Polish
  - Error handling & messages
  - Loading states
  - Empty states
  - Edge cases

- [ ] **13.4**: Mobile responsiveness
  - Test on small phones (< 5")
  - Test on large phones (> 6")
  - Test landscape orientation

---

## File Checklist

### Already Created ✅

- [x] `src/types/business.ts` – Type definitions
- [x] `src/screens/BusinessOnboardingScreen.tsx` – Multi-slide onboarding
- [x] `src/screens/BusinessAccountCreationScreen.tsx` – Profile form
- [x] `src/screens/BusinessDashboardScreen.tsx` – Dashboard hub

### To Create

- [ ] **State & Navigation**
  - [ ] Update `src/state/AppState.tsx`
  - [ ] `src/navigation/BusinessNavigator.tsx`
  - [ ] `src/state/BusinessContext.tsx`

- [ ] **Services**
  - [ ] `src/services/business.ts`
  - [ ] `src/services/campaigns.ts`
  - [ ] `src/services/businessAnalytics.ts`
  - [ ] `src/services/businessApproval.ts`

- [ ] **Screens**
  - [ ] `src/screens/CampaignListScreen.tsx`
  - [ ] `src/screens/CampaignDetailsScreen.tsx`
  - [ ] `src/screens/CampaignCreationScreen.tsx`
  - [ ] `src/screens/CampaignPreviewScreen.tsx`
  - [ ] `src/screens/AudienceInsightsScreen.tsx`
  - [ ] `src/screens/BillingScreen.tsx`
  - [ ] `src/screens/BusinessSettingsScreen.tsx`
  - [ ] `src/screens/CampaignApprovalQueueScreen.tsx` (admin)
  - [ ] `src/screens/CampaignApprovalReviewScreen.tsx` (admin)

- [ ] **Components**
  - [ ] `src/components/MediaUploadPreview.tsx`
  - [ ] `src/components/CampaignPreviewRenderer.tsx`
  - [ ] `src/components/PerformanceChart.tsx`
  - [ ] `src/components/AudienceChart.tsx`
  - [ ] `src/components/HeatmapChart.tsx`

- [ ] **Utilities**
  - [ ] `src/utils/businessValidation.ts`
  - [ ] `src/utils/campaignBuilder.ts`
  - [ ] `src/utils/mediaProcessor.ts`

---

## Milestones

### MVP (Minimal Viable Product)

- Business account creation + onboarding
- Campaign creation (draft only)
- Manual approval (admin approves)
- Campaigns live in consumer deck
- Basic impression tracking
- Simple dashboard with KPI cards

**Timeline**: 2-3 weeks

### V1 (Feature Complete)

- Full campaign lifecycle (draft → approval → active → paused → ended)
- Campaign management (edit, preview, pause, archive)
- Analytics with charts and audience insights
- Billing UI (pricing models, spend tracking)
- Business settings & profile management

**Timeline**: 4-6 weeks

### V2 (Polish & Scale)

- Advanced analytics (A/B testing, audience segmentation)
- Template campaigns
- Batch uploads
- Real-time dashboard
- API for integrations

**Timeline**: 6-8 weeks

---

## Success Criteria

- [ ] Business can create account in < 2 minutes
- [ ] Campaign creation takes < 5 minutes (with media)
- [ ] Dashboard loads in < 1 second
- [ ] Analytics update within 5 minutes of user interaction
- [ ] Approval review takes < 30 seconds per campaign
- [ ] Campaign visible in consumer deck within 5 minutes of approval
- [ ] No crashes on campaign CRUD operations
- [ ] Support can answer 95% of issues from FAQ

---

## Notes

- Always maintain separation between consumer and business modes
- Test heavily on low-end Android devices
- Monitor Firestore costs (use indexes for queries)
- Plan for 1000+ active campaigns by end of year
- Keep business UI consistent with consumer premium feel
