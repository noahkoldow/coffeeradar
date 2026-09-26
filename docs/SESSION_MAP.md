# Session map

The session map replaces the random three-activity slide. A persistent map button sits above the heart button and is also available while another set loads, after the final card, and from the out-of-swipes view. Its red badge counts entries added since the map was last opened.

## Session behavior

- A successful left swipe collects the passed activity. Heart-saved activities are included and marked Saved.
- Requesting a new set archives the remaining presented-deck alternatives. Background preloads, ads, duplicate activities, and synthetic map containers are excluded.
- Opening the map clears its unread badge, not its contents. Returning to swiping preserves the deck position.
- Tapping an emoji or list row opens the regular activity card. Returning from that card does not spend another swipe or record a second rejection. Saving updates its Saved state. Committing uses the existing activity flow and swipe rules.
- New sets, temporary Bank/Settings visits, and app backgrounding retain the map. Leaving the Deck route, returning Home, starting an activity, changing accounts, or restarting the app clears it. Scheduling an activity for later removes that choice while retaining the session's other alternatives.
- Session map state is local to the Deck screen. The existing broader app-session repeat prevention remains independent.

## Locations and cost

All collected activities remain in the list. Named destinations with valid, provider-confirmed coordinates get pins, including activities written by Gemini and source-listed city events. `Place.coordinateSource` records the location's provenance independently of the activity's author. Raw generated coordinates are not sufficient evidence of a real destination.

During deck generation, `suggestionPlaces.ts` first matches named venues against the existing provider catalog, then resolves missing venues through one OSM query covering the city area (40 km). It handles provider name aliases and addresses, rejects conflicting addresses and ambiguous same-name branches, and never substitutes the current position or a city centre. The request has a three-second deadline, bounded positive/negative caches, and shared concurrent requests. Public endpoint failures keep the idea and its venue name in the list; no invented marker is added. At-home suggestions and activities without a reliable location remain list-only; an inferred regional home anchor is never treated as a confirmed address.

The native map supports pan and zoom. Nearby pins group together; tapping a group shows its activities in the list. More than three destinations are supported. Only an explicitly opened overview mounts the new native map. Selecting a card or returning to swiping unmounts it.

Walking, transit, and car icons show distance/context travel estimates. They do not query live routes, timetables, traffic, or car ownership. Collecting and revisiting activities performs no additional generation, geocoding, or routing calls.

## Validation and release

Service tests are in `scripts/session-map.test.cjs` and `scripts/suggestion-places.test.cjs`; screen tests in `scripts/session-map-integration.test.cjs`. They cover generated/source-listed venues, address conflicts, missing coordinates, timeouts, caching, and provider-confirmed pins. The legacy `deck-map-integration.test.cjs` entry point is retained for release scripts. Existing session variety, generation-cache, and swipe regressions must remain passing. The location-resolution changes above are local changes after the historical release described below.

Published on September 25, 2026 for TestFlight 1.0.0 (12), runtime 1.0.0, using its existing production OTA channel. The release preserves the previous live source outside the eight session-map files and uses build 12's locked native dependencies. It requires no new native module. The live bundle and all 28 remote assets were downloaded and hash-verified; 78 release regression tests, TypeScript checks, 32 browser scenarios, and the exact-release swipe gesture passed. Publishing and delivery evidence is recorded in [IOS_SESSION_MAP_RELEASE.json](IOS_SESSION_MAP_RELEASE.json).

Open Bits online, allow the update to download, then fully close and reopen it. TestFlight continues to show 1.0.0 (12); this update does not add a TestFlight Update button. Native device application and crash behavior require testing on the phone; web and bundle checks do not prove device stability.
