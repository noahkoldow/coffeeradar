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
      # Firestore Security Rules - Production Version

      ## Updated Rules (Integrates Business Platform)

      ```firestore-security-rules
      rules_version = '2';

      service cloud.firestore {
        match /databases/{database}/documents {
          // ========================================================================
          // Helper Functions
          // ========================================================================

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
              && get(
                /databases/$(database)/documents/businesses/$(businessId)
              ).data.ownerId == getUserId();
          }

          function isBusinessMember(businessId) {
            let business = get(
              /databases/$(database)/documents/businesses/$(businessId)
            ).data;

            let memberId = getUserId();

            return isSignedIn()
              && (
                business.ownerId == memberId
                || memberId in business.teamMembers.keys()
              );
          }

          function isBusinessMemberWithRole(businessId, requiredRole) {
            let business = get(
              /databases/$(database)/documents/businesses/$(businessId)
            ).data;

            let memberId = getUserId();
            let memberRole = business.teamMembers[memberId];

            return isSignedIn()
              && (
                business.ownerId == memberId
                || (
                  memberId in business.teamMembers
                  && (
                    requiredRole == 'any'
                    || memberRole in ['owner', 'admin', requiredRole]
                  )
                )
              );
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
              && data.location.keys().hasAll([
                'address',
                'city',
                'country'
              ])
              && data.website is string
              && data.ownerId is string
              && data.verificationStatus in [
                'pending',
                'verified',
                'rejected'
              ];
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
              && data.status in [
                'draft',
                'pending_approval',
                'approved',
                'active',
                'paused',
                'archived'
              ]
              && data.targeting is map
              && data.targeting.keys().hasAll([
                'moods',
                'weatherConditions',
                'locationRadius',
                'interests'
              ])
              && data.createdBy is string;
          }

          // ========================================================================
          // User Collection
          // ========================================================================

          match /users/{userId} {

            allow read, write: if isSignedIn()
              && request.auth.uid == userId;

            match /{subcollection}/{document} {
              allow read, write: if isSignedIn()
                && request.auth.uid == userId;
            }
          }

          // ========================================================================
          // Analytics Events Collection
          // ========================================================================

          match /analytics_events/{eventId} {

            allow create: if isSignedIn()
              && request.resource.data.uid == request.auth.uid
              && request.resource.data.timestamp is timestamp;
          }

          // ========================================================================
          // Business Submissions Collection (Legacy)
          // ========================================================================

          match /business_submissions/{submissionId} {

            allow create: if isSignedIn()
              && request.resource.data.submittedBy == request.auth.uid
              && request.resource.data.status == 'pending'
              && request.resource.data.business.isVerified == false;

            allow read: if isAdmin()
              || (
                isSignedIn()
                && resource.data.submittedBy == request.auth.uid
              );

            allow update: if isAdmin();

            allow delete: if isAdmin();
          }

          // ========================================================================
          // Businesses Collection + nested rules (unchanged)
          // ========================================================================

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
            allow update: if (
                isAdmin()
                || isBusinessOwner(businessId)
              )
              && hasValidBusinessData(request.resource.data);

            // Only admin can delete
            allow delete: if isAdmin();

            // Campaigns subcollection
            match /campaigns/{campaignId} {

              allow read: if isBusinessMember(businessId)
                || resource.data.status in ['approved', 'active'];

              allow create: if isBusinessMemberWithRole(
                  businessId,
                  'editor'
                )
                && hasValidCampaignData(request.resource.data)
                && request.resource.data.businessId == businessId
                && request.resource.data.status == 'draft'
                && request.resource.data.createdBy == request.auth.uid;

              allow update: if (
                  isBusinessMemberWithRole(businessId, 'editor')
                  && request.resource.data.status in [
                    'draft',
                    'pending_approval'
                  ]
                )
                || isAdmin();

              allow update: if isAdmin()
                && request.resource.data.status in [
                  'approved',
                  'active'
                ];

              allow delete: if isBusinessOwner(businessId)
                || isAdmin();

              match /approvals/{approvalId} {
                allow read: if isAdmin()
                  || (
                    isBusinessMember(businessId)
                    && get(
                      /databases/$(database)/documents/businesses/$(businessId)/campaigns/$(campaignId)
                    ).data.createdBy == request.auth.uid
                  );

                allow create: if false;

                allow update: if isAdmin()
                  && (
                    request.resource.data.status in [
                      'approved',
                      'rejected'
                    ]
                    || request.resource.data.status
                      == resource.data.status
                  );

                allow delete: if isAdmin();
              }

              match /metrics/{metricId} {
                allow read: if isBusinessMember(businessId);

                allow create: if request.resource.data.type in [
                    'impression',
                    'click',
                    'conversion'
                  ]
                  && request.resource.data.timestamp is timestamp
                  && (
                    request.resource.data.type == 'impression'
                    || (
                      request.resource.data.type == 'click'
                      && request.resource.data.userId is string
                    )
                    || (
                      request.resource.data.type == 'conversion'
                      && request.resource.data.value is number
                    )
                  );

                allow update, delete: if isAdmin();
              }

              match /targeting_logs/{logId} {
                allow read: if isBusinessMember(businessId);

                allow create: if request.resource.data.timestamp is timestamp
                  && request.resource.data.matched is bool;

                allow update, delete: if isAdmin();
              }
            }

            match /team_members/{memberId} {
              allow read: if isBusinessMember(businessId);

              allow create: if (
                  isBusinessOwner(businessId)
                  || isAdmin()
                )
                && request.resource.data.role in [
                  'viewer',
                  'editor',
                  'admin'
                ]
                && request.resource.data.joinedAt is timestamp;

              allow update: if isBusinessOwner(businessId)
                || (
                  isAdmin()
                  && request.resource.data.role in [
                    'viewer',
                    'editor',
                    'admin'
                  ]
                );

              allow delete: if isBusinessOwner(businessId)
                || isAdmin();
            }

            match /billing/{billingId} {
              allow read: if isBusinessOwner(businessId)
                || isAdmin();

              allow create: if false;

              allow update: if isAdmin();

              allow delete: if isAdmin();

              match /invoices/{invoiceId} {
                allow read: if isBusinessOwner(businessId)
                  || isAdmin();

                allow create, update, delete: if isAdmin();
              }
            }

            match /verification_docs/{docId} {
              allow read: if isBusinessOwner(businessId)
                || isAdmin();

              allow create: if isBusinessOwner(businessId)
                && request.resource.data.type in [
                  'id_photo',
                  'business_license',
                  'address_proof'
                ]
                && request.resource.data.uploadedAt is timestamp;

              allow update: if isAdmin();

              allow delete: if (
                  isBusinessOwner(businessId)
                  && resource.data.status == 'pending'
                )
                || isAdmin();
            }
          }

          // ========================================================================
          // Activities collection (DB-first content store)
          // - Clients can read activities
          // - Clients cannot create activities (server-only creation via Cloud Functions / Admin SDK)
          // - Only admins may update/delete items (to allow moderation)
          // ========================================================================

          match /activities/{activityId} {
            // Public read (app clients browse activities)
            allow read: if true;

            // Prevent any client from creating activity documents
            // Activities must be generated and written only by server-side functions (Admin SDK)
            allow create: if false;

            // Only admins may edit or remove (moderation)
            allow update, delete: if isAdmin();
          }

          // ========================================================================
          // Affiliates catalog (public read, admin-managed)
          // ========================================================================

          match /affiliates/{affiliateId} {
            allow read: if true;
            allow create, update, delete: if isAdmin();
          }

          // ========================================================================
          // Vouchers (server-issued) and Conversions (server-recorded)
          // ========================================================================

          match /vouchers/{voucherId} {
            // Owner (user) or admin can read voucher info
            allow read: if isSignedIn() && resource.data.userId == request.auth.uid || isAdmin();

            // Vouchers are server-issued only
            allow create: if false;

            // Clients cannot update/delete vouchers directly
            allow update, delete: if false;
          }

          match /conversions/{conversionId} {
            // Only admin may read conversion records
            allow read: if isAdmin();

            // Created only by server as part of redemption
            allow create: if false;

            // Admins manage conversions
            allow update, delete: if isAdmin();
          }

          // ========================================================================
          // Campaign approval queue and metrics (unchanged)
          // ========================================================================

          match /approval_queue/{approvalId} {
            allow read: if isAdmin();
            allow create: if false;
            allow update: if isAdmin()
              && request.resource.data.status in [
                'approved',
                'rejected'
              ];
            allow delete: if isAdmin();
          }

          match /campaign_metrics_daily/{date} {
            allow read: if true;
            allow create, update, delete: if false;
          }

          match /business_directory/{categoryId} {
            allow read: if true;
            allow create, update, delete: if isAdmin();
          }

          // ========================================================================
          // Catch-all (deny)
          // ========================================================================

          match /{document=**} {
            allow read, write: if false;
          }
        }
      }
      ```
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

