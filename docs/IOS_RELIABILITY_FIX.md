# iOS reliability investigation — 24 September 2026

The user reported that AI worked initially, then Bits closed to the iPhone home screen and no longer recognized their administrator account after reopening.

## Confirmed findings

- Native Firebase Auth was initialized with `getAuth(app)` without React Native persistence. The installed SDK explicitly defaults to memory in this configuration, so a cold restart loses the session. The fix initializes Auth with the existing AsyncStorage dependency. A test using the actual Firebase React Native SDK verifies sign-in, cold restart, and persistent sign-out.
- The published client only queried the legacy `isAdmin` callable using its existing token. It did not reconcile server role assignments or refresh the token. The new shared resolver calls `getAccountAccess`, refreshes signed claims, and updates the five affected screens on focus, foreground, and a bounded refresh interval. Account identity is checked before accepting asynchronous results. Email lists do not confer server authority.
- A live account lookup initially found the requested account enabled, email unverified, and without either an `admin` or managed-email-admin claim. After the user explicitly authorized the account change, a manual `admin: true` claim was granted and read back successfully at 11:32 UTC. The managed-email-admin marker is absent, so email reconciliation preserves this manual grant. Email verification and unrelated claims remain unchanged. See `ADMIN_ACCESS_CHANGE.json`.
- The planner treated a cached empty suggestion list as a cache miss. Updating that cache retriggered its effect and generation again. Restoring the original condition reproduces six requests where the fixed behavior issues one. Empty results now complete the request; duplicate pending requests and stale results are suppressed. An explicit retry button remains available.
- The original OTA export used installed Expo patch versions newer than the native build, although the package files were unchanged. The corrective checkout uses its own fresh `npm ci`; all 37 direct dependencies match the released lockfile. Build 12's native versions include Expo 54.0.33, expo-updates 29.0.18, and expo-constants 18.0.13. The mismatch is a compatibility risk, not a demonstrated crash cause.

## Evidence and limits

The initial EAS insights query reported one installed user and no failed installs. The authenticated TestFlight crash-report query returned no reports. These results do not disprove the user's native crash report. No device crash stack trace or on-device reproduction is available yet.

Backend logs after the original update show nine successful AI HTTP responses and one HTTP 503 provider failure by 10:59 UTC. The failure is recorded as `unavailable`; its precise upstream cause was not logged. No user prompts, calendar contents, images, credentials, or account identifiers were exported into this report. An AI provider failure is not evidence of the cause of an iOS process crash.

The corrective release preserves the original ten AI/consent changes and adds only the scoped authentication, admin-refresh, and planner-loop fixes. Unrelated workspace changes remain excluded. No native package or build configuration changes are required.

## Verification

- Root `npx tsc --noEmit`: passed.
- Authentication restart/sign-out, existing AI client transport, and AI consent checks: 17 passed.
- Admin resolver and screen lifecycle checks: 12 passed.
- Planner request-loop, deduplication, stale response, unmount, and retry checks: 5 passed.
- Corrective native dependency installation matches the released lockfile; no shared `node_modules` junction.

The corrective update was published on 24 September 2026 at 11:14 UTC to the iOS `production` channel, runtime `1.0.0`: [EAS update group `d2e1125b-fc6a-4cd0-84e1-2c269d27b090`](https://expo.dev/accounts/noehxpo/projects/bits/updates/d2e1125b-fc6a-4cd0-84e1-2c269d27b090). It supersedes the first AI update. The public production endpoint serves update `01a0d31f-ba27-7399-8d84-e2bc7e7518bf`; all 28 assets downloaded successfully using Expo's supplied headers and matched their expected hashes. The launch bundle matches the reviewed export (`1df46d4b8abd74b4e12b82aa2d2e7482bdaeaa2265eb64274a27670f39d1ce55`). See `IOS_RELIABILITY_RELEASE.json`.

Open Bits online, allow the update to download, then fully close and reopen it. Because the previous client did not persist login, signing in once may be necessary after this update loads. The fixed client persists subsequent sessions. Native crash resolution still requires device confirmation or a crash report. The separately authorized admin grant is now active on the server; opening Settings or Profile in the corrective client refreshes the signed token used by admin checks.
