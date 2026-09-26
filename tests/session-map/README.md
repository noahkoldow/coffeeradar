# Session map UI checks

Run `node --test tests/session-map/native-check.cjs` for native map interaction,
clustering, list completeness and notification-button checks.

For browser checks, start the isolated fixture from this directory:
`node ../../node_modules/expo/bin/cli start --web --port 8101`.
Then run `node tests/session-map/check.cjs` from the repository root.

The fixture renders the actual session map components and normal SuggestionCard,
with deterministic local activities and stubbed theme/language providers. It
does not initialize production authentication, AI services or location access.
It checks 320px/390px English and German, empty/list-only/small/large collections,
saved labels, walking/transit/driving estimates, cluster selection, return from
the normal card, long labels, badge clearing and a dark theme. Screenshots are
written to `tests/artifacts/session-map`.

For the complete deck layout check, regenerate the source-derived fixture with
`node tests/session-map/create-layout-fixture.cjs`, then run
`node tests/session-map/layout-check.cjs`. The generated fixture uses the actual
DeckScreen loading/empty/main markup and styles with local data and callbacks.
It checks 375x667 and 390x844 layouts, the map button above the heart, no overlap,
loading/empty map access, zero-credit browsing, and horizontal swiping inside
the vertical page scroll. Short screens intentionally scroll to keep every
control reachable without shrinking activity cards.

To check a prepared release's exact SwipeDeck implementation, set
`SESSION_MAP_RELEASE_ROOT` to that checkout before starting Metro. The resolver
uses its SwipeDeck and relative SuggestionCard source while sharing the fixture's
React runtime. The validated September 25 release result is in `validation.json`.

Native tests use mocked platform elements to validate map props and callbacks.
Physical iPhone map rendering and gestures require device testing.
