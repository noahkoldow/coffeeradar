# Security Go-Live Checklist

Last updated: 2026-07-24

## 1. Required Secret and Runtime Configuration

Set function config and secrets before deploy:

```bash
firebase functions:config:set \
  app.voucher_secret="REPLACE_WITH_32_PLUS_CHAR_SECRET" \
  app.enforce_app_check="true" \
  app.admin_emails="bitsapp.admin@gmail.com" \
  models.api_url="https://YOUR_MODEL_BACKEND_URL" \
  models.api_key="REPLACE_WITH_SERVER_MODEL_KEY" \
  vendors.api_keys="vendor_key_1,vendor_key_2"
```

If you use `.env`-style deployment, ensure these are present in runtime env:
- `VOUCHER_SECRET`
- `ENFORCE_APP_CHECK=true`
- `MODEL_API_URL`
- `MODEL_API_KEY`
- `VENDOR_KEYS`

## 2. Admin Authorization via Custom Claims

Admin rules now depend on `request.auth.token.admin == true`.

Set admin claim with Firebase Admin SDK (run once, secure environment only):

```ts
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

initializeApp();
await getAuth().setCustomUserClaims("<FIREBASE_UID>", { admin: true });
```

After setting claims, users must re-authenticate to refresh ID token.

## 3. App Check Rollout

### Client
Set web site key in Expo env:
- `EXPO_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`

### Firebase Console
Enable App Check enforcement for:
- Cloud Functions
- Firestore
- Storage

Start with monitor mode if needed, then enforce.

## 4. Deploy Order (Important)

1. Deploy updated Cloud Functions (with auth/App Check checks).
2. Deploy Firestore and Storage rules.
3. Enable App Check enforcement in Firebase Console.
4. Ship app build with App Check client config.

Commands:

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage
```

## 5. Feature Flags and Security Defaults

- Keep direct client model calls disabled in production.
- Only enable direct calls for controlled dev testing:
  - `EXPO_PUBLIC_ALLOW_DIRECT_MODEL_CALLS=true`

Default production expectation:
- `EXPO_PUBLIC_ALLOW_DIRECT_MODEL_CALLS` is unset or `false`.

## 6. Verification Tests Before Release

- Unauthenticated callable call returns `unauthenticated`.
- Callable call without App Check returns `failed-precondition` when enforcement is on.
- Non-admin user cannot update business docs or campaign metrics outside membership rules.
- Community idea media is not publicly readable.
- Voucher redeem fails when caller UID does not match token userId.

## 7. Key Rotation

Rotate immediately if previously exposed:
- Gemini / model API keys
- Vendor API keys
- Voucher signing secret

Rotation sequence:
1. Add new keys to runtime config.
2. Deploy functions.
3. Revoke old keys.
4. Monitor logs for auth failures.
