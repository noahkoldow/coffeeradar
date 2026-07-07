# Firestore rules snippet for DB-first activities

Add this block to your existing published `firestore.rules` inside the top-level `match /databases/{database}/documents { ... }` section.

```rules
match /activities/{activityId} {
  allow read: if isSignedIn();

  allow create: if isSignedIn()
    && request.resource.data.request_key is string
    && request.resource.data.title is string
    && request.resource.data.description is string
    && request.resource.data.attributes is list
    && request.resource.data.time_tags is list
    && request.resource.data.geo_scope is string
    && request.resource.data.source_info is map
    && request.resource.data.source_info.origin in ['AI', 'DB']
    && request.resource.data.verified == false;

  allow update: if isSignedIn()
    && resource.data.source_info.origin == 'AI'
    && request.resource.data.request_key == resource.data.request_key
    && request.resource.data.title is string
    && request.resource.data.description is string
    && request.resource.data.attributes is list
    && request.resource.data.time_tags is list
    && request.resource.data.geo_scope is string
    && request.resource.data.usage_count is number;

  allow delete: if false;
}
```

Notes:
- `create` is allowed for signed-in users so the app can save generated ideas back to Firestore.
- `verified` stays `false` for client-created content.
- `source_info.origin` lets you distinguish DB hits from AI-generated items.
- Keep the rest of your existing rules unchanged.
