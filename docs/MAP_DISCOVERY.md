# Session variety and map discovery

Implemented and published on 2026-09-25. The iOS production OTA update is available to compatible TestFlight builds 11 and 12 (runtime `1.0.0`): [release `63a4537e-8c94-486f-b81d-12565eecbb52`](https://expo.dev/accounts/noehxpo/projects/bits/updates/63a4537e-8c94-486f-b81d-12565eecbb52), published at 19:38 UTC (21:38 Berlin). It also includes today's activity checklists, calendar placement, and swipe fixes while preserving yesterday's published authentication/admin fixes. All 136 release regression checks and 12 swipe browser tests passed; the iOS production export succeeded, and the served bundle plus all 28 assets were hash-verified. See [release evidence](IOS_RELEASE_20260925.json). Device application and native interaction remain unverified. Open Bits online, allow the update to download, then fully close and reopen it to apply the update.

## Behavior

An eligible presented set has a 62.5% chance of containing one map card (one per 1.6 eligible sets on average). It groups three distinct activities from the five-activity set; those activities do not also appear as standalone slides. Up to two ordinary cards remain, plus existing ads. The map starts with exactly three destinations. Tapping an emoji or a row opens the usual activity card. Back returns to the map; dismissing a selected activity removes that option. Dismissing the overview skips the map. Saving and committing act only on a selected activity.

Locations must come from supported place/event adapters with valid named destinations. The current implementation also accepts Gemini and source-listed activities after their venue is resolved to provider coordinates (`Place.coordinateSource`); an activity's source no longer excludes its verified destination. Raw generated coordinates, seed businesses, and inferred home regions are excluded. Missing places are resolved during generation using the provider catalog and a bounded, cached OSM city-area lookup; ambiguous or unavailable results stay list-only. See [the current session map behavior](SESSION_MAP.md), which supersedes the historical three-activity slide described here. The current data model has no confirmed home address, so this implementation includes zero home destinations.

Travel labels show walking, public transport, or driving, with estimated minutes from the current location. Walking is preferred within 1.5 km; medium trips favor transit in urban/unknown areas; longer or nonurban trips favor driving. These are distance/context estimates, not live routes, transit schedules, traffic, or a check that the user has a car. Activity duration plus estimated return travel must fit the free window.

## Repetition and cost

An AppState session ledger reserves activity identities synchronously before display. It survives screen remounts and new sets, and resets on account changes/app restart. Content aliases handle changed AI IDs, punctuation, accents, and duration wording. Stale preloads and fallback padding cannot bypass it. This prevents matched repeats; arbitrary semantic paraphrases are not guaranteed to match.

The most recent 40 unique activity titles also enter the AI prompt/cache key, so an unchanged ten-minute cache cannot replay already presented batches. Concurrent identical requests still share work. Explicit zero generation budgets skip new AI calls. The completed AI cache is bounded.

Free OSM discovery uses the existing adapter with a three-second abort, one endpoint, no widened retry, shared in-flight requests, positive/negative caching, and bounded cache sizes. The map itself does not trigger another AI call. Public place-service availability can reduce map eligibility; ordinary suggestions continue.

## Validation

Run the service and integration regressions:

```powershell
node --test scripts/suggestion-session.test.cjs scripts/suggestion-places.test.cjs scripts/map-discovery.test.cjs scripts/gemini-session-variety.test.cjs scripts/deck-map-integration.test.cjs scripts/deck-screen-animation.test.cjs scripts/native-ad-slide.test.cjs
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

UI fixtures use mocked contexts and real card components; no production login or backend calls are required. See [UI harness instructions](../tests/map-discovery/README.md), [validation results](../tests/artifacts/map-discovery/validation.json), and [a map preview](../tests/artifacts/map-discovery/map-390-en-3.png). Native MapView interaction and iPhone crash behavior still require device testing. An iOS JavaScript/Hermes export is a packaging check, not a device test.

Validated on 2026-09-25: all 63 regressions above pass; the full project TypeScript check passes; the final iOS Hermes export succeeds with 1,434 modules. The browser matrix covers 320/390 px, English/German, one/two/three remaining options, plus dark mode. Actual SwipeDeck checks cover disabled overview acceptance, overview dismissal, pin selection, return to the map, selected dismissal, and selected acceptance. Browser fixtures do not exercise native MapView or live backend calls.
