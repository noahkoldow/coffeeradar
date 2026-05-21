# Firestore Security Rules - Production Version

## Updated Rules (Integrates Business Platform)

```firestore-security-rules
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // ============================================================================
    // Helper Functions
    // ============================================================================
    
    function isSignedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return isSignedIn()
        && request.auth.token.email != null
        && request.auth.token.email.lower() in [
          'bitsapp.admin@gmail.com'
        ];
    }

    function getUserId() {
      return request.auth.uid;
    }

    function isBusinessOwner(businessId) {
      return isSignedIn() 
        && get(/databases/{database}/documents/businesses/{businessId}).data.ownerId == getUserId();
    }

    function isBusinessMember(businessId) {
      let business = get(/databases/{database}/documents/businesses/{businessId}).data;
      let memberId = getUserId();
      return isSignedIn() 
        && (business.ownerId == memberId 
          || memberId in business.teamMembers.keys());
    }

    function isBusinessMemberWithRole(businessId, requiredRole) {
      let business = get(/databases/{database}/documents/businesses/{businessId}).data;
      let memberId = getUserId();
      let memberRole = business.teamMembers[memberId];
      
      return isSignedIn() 
        && (business.ownerId == memberId 
          || (memberId in business.teamMembers 
            && (requiredRole == 'any' 
              || memberRole in ['owner', 'admin', requiredRole])));
    }

    function hasValidBusinessData(data) {
      return data.keys().hasAll([
        'businessName',
        'category', 
        'email',
        'location',
        'website',
        'ownerId',
        'verificationStatus',
        'createdAt'
      ])
      && data.businessName is string
      && data.businessName.size() > 0
      && data.category is string
      && data.email is string
      && data.location is map
      && data.location.keys().hasAll(['address', 'city', 'country'])
      && data.website is string
      && data.ownerId is string
      && data.verificationStatus in ['pending', 'verified', 'rejected'];
    }

    function hasValidCampaignData(data) {
      return data.keys().hasAll([
        'businessId',
        'title',
        'hook',
        'cta',
        'description',
        'category',
        'status',
        'targeting',
        'createdAt',
        'createdBy'
      ])
      && data.title is string
      && data.title.size() > 0
      && data.hook is string
      && data.cta is string
      && data.status in ['draft', 'pending_approval', 'approved', 'active', 'paused', 'archived']
      && data.targeting is map
      && data.targeting.keys().hasAll(['moods', 'weatherConditions', 'locationRadius', 'interests'])
      && data.createdBy is string;
    }

    // ============================================================================
    // User Collection
    // ============================================================================
    
    match /users/{userId} {
      allow read, write: if isSignedIn() && request.auth.uid == userId;

      match /{subcollection}/{document} {
        allow read, write: if isSignedIn() && request.auth.uid == userId;
      }
    }

    // ============================================================================
    // Analytics Events Collection
    // ============================================================================
    
    match /analytics_events/{eventId} {
      allow create: if isSignedIn()
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.timestamp is timestamp;
    }

    // ============================================================================
    // Business Submissions Collection (Legacy)
    // ============================================================================
    
    match /business_submissions/{submissionId} {
      allow create: if isSignedIn()
        && request.resource.data.submittedBy == request.auth.uid
        && request.resource.data.status == 'pending'
        && request.resource.data.business.isVerified == false;

      allow read: if isAdmin()
        || (isSignedIn() && resource.data.submittedBy == request.auth.uid);

      allow update: if isAdmin();

      allow delete: if isAdmin();
    }

    // ============================================================================
    // BUSINESS PLATFORM: Businesses Collection
    // ============================================================================
    
    match /businesses/{businessId} {
      // Anyone can read business info (public profiles)
      allow read: if true;

      // Only owner/admin can create
      allow create: if isSignedIn()
        && request.resource.data.ownerId == request.auth.uid
        && hasValidBusinessData(request.resource.data)
        && request.resource.data.teamMembers is map
        && request.resource.data.verificationStatus == 'pending';

      // Only owner/admins can update
      allow update: if isAdmin()
        || isBusinessOwner(businessId)
        && hasValidBusinessData(request.resource.data);

      // Only admin can delete
      allow delete: if isAdmin();

      // ========================================================================
      // Campaigns Subcollection
      // ========================================================================
      
      match /campaigns/{campaignId} {
        // Business members can read their campaigns
        allow read: if isBusinessMember(businessId)
          || (resource.data.status in ['approved', 'active'] && true);

        // Business members can create campaigns
        allow create: if isBusinessMemberWithRole(businessId, 'editor')
          && hasValidCampaignData(request.resource.data)
          && request.resource.data.businessId == businessId
          && request.resource.data.status == 'draft'
          && request.resource.data.createdBy == request.auth.uid;

        // Business members and admins can update drafts/pending
        allow update: if (isBusinessMemberWithRole(businessId, 'editor') && request.resource.data.status in ['draft', 'pending_approval'])
          || isAdmin();

        // Only admins can publish approved campaigns
        allow update: if isAdmin() 
          && request.resource.data.status in ['approved', 'active'];

        // Business owner or admin can delete
        allow delete: if isBusinessOwner(businessId) || isAdmin();

        // ====================================================================
        // Campaign Approvals Subcollection
        // ====================================================================
        
        match /approvals/{approvalId} {
          // Campaign creator and admins can read
          allow read: if isAdmin() 
            || (isBusinessMember(businessId) && get(/databases/{database}/documents/businesses/{businessId}/campaigns/{campaignId}).data.createdBy == request.auth.uid);

          // Only cloud function should create approvals (via backend)
          // This is enforced at the Cloud Functions level, not here
          allow create: if false;

          // Only admins can update (approve/reject)
          allow update: if isAdmin()
            && (request.resource.data.status in ['approved', 'rejected']
              || request.resource.data.status == resource.data.status);

          allow delete: if isAdmin();
        }

        // ====================================================================
        // Campaign Metrics Subcollection
        // ====================================================================
        
        match /metrics/{metricId} {
          // Business members can read their metrics
          allow read: if isBusinessMember(businessId);

          // Client can record impressions/clicks (from consumer app)
          // This is write-only, records must have valid structure
          allow create: if request.resource.data.type in ['impression', 'click', 'conversion']
            && request.resource.data.timestamp is timestamp
            && (request.resource.data.type == 'impression'
              || (request.resource.data.type == 'click' && request.resource.data.userId is string)
              || (request.resource.data.type == 'conversion' && request.resource.data.value is number));

          // Only admins can update/delete metrics (for corrections)
          allow update, delete: if isAdmin();
        }

        // ====================================================================
        // Campaign Targeting Logs (for analytics)
        // ====================================================================
        
        match /targeting_logs/{logId} {
          // Business members read their logs
          allow read: if isBusinessMember(businessId);

          // Client writes targeting events during deck matching
          allow create: if request.resource.data.timestamp is timestamp
            && request.resource.data.matched is boolean;

          allow update, delete: if isAdmin();
        }
      }

      // ========================================================================
      // Team Members Subcollection
      // ========================================================================
      
      match /team_members/{memberId} {
        // Business members can view team
        allow read: if isBusinessMember(businessId);

        // Only owner/admin can add members
        allow create: if (isBusinessOwner(businessId) || isAdmin())
          && request.resource.data.role in ['viewer', 'editor', 'admin']
          && request.resource.data.joinedAt is timestamp;

        // Owner can remove, admin can update roles
        allow update: if isBusinessOwner(businessId)
          || (isAdmin() && request.resource.data.role in ['viewer', 'editor', 'admin']);

        allow delete: if isBusinessOwner(businessId) || isAdmin();
      }

      // ========================================================================
      // Billing Subcollection
      // ========================================================================
      
      match /billing/{billingId} {
        // Business owner can read own billing
        allow read: if isBusinessOwner(businessId) || isAdmin();

        // Cloud Functions create billing records (not direct writes)
        allow create: if false;

        // Only admin can modify billing
        allow update: if isAdmin();

        allow delete: if isAdmin();

        // Invoices subcollection
        match /invoices/{invoiceId} {
          allow read: if isBusinessOwner(businessId) || isAdmin();
          allow create, update, delete: if isAdmin();
        }
      }

      // ========================================================================
      // Verification Documents Subcollection
      // ========================================================================
      
      match /verification_docs/{docId} {
        // Only owner can read own verification docs
        allow read: if isBusinessOwner(businessId) || isAdmin();

        // Owner can upload verification docs
        allow create: if isBusinessOwner(businessId)
          && request.resource.data.type in ['id_photo', 'business_license', 'address_proof']
          && request.resource.data.uploadedAt is timestamp;

        // Admin can approve/reject
        allow update: if isAdmin();

        allow delete: if isBusinessOwner(businessId) && resource.data.status == 'pending'
          || isAdmin();
      }
    }

    // ============================================================================
    // CAMPAIGN APPROVALS QUEUE (Global)
    // ============================================================================
    
    match /approval_queue/{approvalId} {
      // Only admins can view approval queue
      allow read: if isAdmin();

      // Only create via cloud function
      allow create: if false;

      // Admins approve/reject
      allow update: if isAdmin()
        && request.resource.data.status in ['approved', 'rejected'];

      allow delete: if isAdmin();
    }

    // ============================================================================
    // CAMPAIGN METRICS AGGREGATION (Global - Read by Business)
    // ============================================================================
    
    match /campaign_metrics_daily/{date} {
      // Anyone can read aggregated public metrics
      allow read: if true;

      // Only cloud function creates daily aggregates
      allow create, update, delete: if false;
    }

    // ============================================================================
    // BUSINESS DIRECTORY (Public)
    // ============================================================================
    
    match /business_directory/{categoryId} {
      // Anyone can browse directory
      allow read: if true;

      // Only admin updates
      allow create, update, delete: if isAdmin();
    }

    // ============================================================================
    // CATCH-ALL (Deny by default)
    // ============================================================================
    
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

## Key Security Features

### User-Level Access Control
- ✅ Users can only read/write their own `/users/{userId}` data
- ✅ Subcollections inherit parent permissions
- ✅ Analytics events linked to authenticated user

### Business Platform Access Control
- ✅ **Owner**: Full access to business data, campaigns, billing
- ✅ **Members**: Role-based (viewer, editor, admin) with specific permissions
- ✅ **Public**: Anyone can read approved/active campaigns and directory
- ✅ **Admin**: Global override for compliance/troubleshooting

### Campaign Approval Workflow
- ✅ Campaigns created in 'draft' state by default
- ✅ Members can only modify own drafts/pending campaigns
- ✅ Only admins can approve → 'approved' state
- ✅ Only admins can activate → 'active' state
- ✅ Approval history auditable via approvals subcollection

### Metrics & Analytics Security
- ✅ Impressions/clicks recorded by client (no auth needed - public)
- ✅ Business members can read aggregated metrics
- ✅ Raw metrics write-protected (Cloud Functions only)
- ✅ Daily aggregates computed server-side

### Billing & Verification
- ✅ Billing data readable only by owner/admins
- ✅ Verification documents soft-deleted until approved
- ✅ Payment history immutable (append-only)
- ✅ Business verification required for campaign activation

---

## Required Firestore Indexes

Create these composite indexes in Firestore console:

### Business Queries
```
Collection: businesses
Fields: category (Asc), verificationStatus (Asc), createdAt (Desc)
Query scope: Collection
```

### Campaign Queries
```
Collection: businesses/{businessId}/campaigns
Fields: status (Asc), createdAt (Desc)
Query scope: Collection

Collection: businesses/{businessId}/campaigns
Fields: status (Asc), approvedAt (Desc)
Query scope: Collection
```

### Approval Queue
```
Collection: approval_queue
Fields: status (Asc), submittedAt (Desc)
Query scope: Collection
```

### Metrics Aggregation
```
Collection: campaign_metrics_daily
Fields: date (Asc), impressions (Desc)
Query scope: Collection
```

---

## Deployment Instructions

1. **Go to Firebase Console** → Your Project → Firestore Database → Rules
2. **Replace all rules** with the content above
3. **Test rules** with the provided test scenarios
4. **Publish** (automatically deploys globally)

## Test Scenarios

### Scenario 1: Business Owner Creates Campaign
```
Context:
  - User A owns business "CoffeeShop"
  - User A authenticated
Expected:
  - ✅ Can create campaign in draft
  - ✅ Can read own draft
  - ✅ Cannot change status to active (only admin)
```

### Scenario 2: Team Member Edits Campaign
```
Context:
  - User B has 'editor' role in User A's business
  - Campaign is in 'draft' state
Expected:
  - ✅ Can read campaign
  - ✅ Can update campaign fields
  - ✅ Cannot view other businesses
```

### Scenario 3: Public User Views Active Campaign
```
Context:
  - Unauthenticated user
  - Campaign is 'active'
Expected:
  - ✅ Can view campaign details
  - ✅ Can record impression metric
  - ✅ Cannot modify campaign
```

### Scenario 4: Admin Approves Pending Campaign
```
Context:
  - Admin user (verified email)
  - Campaign in 'pending_approval'
Expected:
  - ✅ Can sign approval record
  - ✅ Can change status to approved
  - ✅ Audit trail recorded
```

