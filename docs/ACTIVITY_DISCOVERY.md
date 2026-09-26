# Activity discovery: local actions and city events

Bits combines repeatable everyday actions, nearby places, and dated city experiences. The goal is a useful next action: movement, connection, curiosity, recovery, or practical progress. An event can inspire a habit without the one-off event itself becoming a recurring habit.

## Data before copy

- `cityEvents.ts` calls the authenticated `discoverCityEvents` function. Sources are discovered for the requested area, local dates, language and a bounded selection of public interest categories. There is no fixed city list or publisher allowlist. One broad city query and one interest/community query are interleaved before selecting different source domains.
- `eventSourceSearch.ts` defines the replaceable `WebSourceSearch` interface and its initial Brave Search adapter. Search results supply candidate URLs only. Titles and snippets from search results cannot become event facts.
- `publicWebFetch.ts` reads eligible public publisher pages with robots checks, DNS-pinned HTTPS requests, redirect validation and byte/time limits. `webEventParser.ts` extracts JSON-LD Event types, graph references and structured event-list detail links. It retains dates, venue/address, source domain and published price information. No generated event facts or substitute city-centre coordinates are used.
- Existing Ticketmaster and OSM discovery remain additional sources. Ticketmaster queries the selected time window rather than always starting at the current clock.
- Gemini receives up to 12 source-backed event candidates with IDs, alongside the user's availability and preferences. An EVENT response must reference one of those IDs. Generated copy may personalize the invitation; normalization restores the provider's identity, time, location, duration and link. There are no fabricated fallback ticket URLs.
- If sources fail or provide no relevant events, ordinary activities remain available. Mentioning a live event in a prompt does not make it verified. Spectator access, specific viewing points and flexible drop-in attendance must come from a source; they are never inferred merely from an event name.

## Timing and mix

`Availability.discoveryMode` distinguishes `now` from `plan_ahead`. Ordinary place discovery keeps the user's local radius. Planned event discovery can expand to city scale (bounded by travel budget, at most 35 km), while attendance, outward travel, return travel and calendar conflicts still have to fit.

Fixed events retain their published start. Explicitly supported drop-in events can use a shorter visit inside their published interval. Events without a known end use a conservative estimated duration; unresolved journeys receive a conservative allowance. Current weather is not presented as tomorrow's forecast.

The five-card deck no longer reserves all five places for Gemini. The default AI minimum is two. When an eligible planned event exists, it can survive source balancing alongside nearby activities, habits and useful tasks. Explicit filters still apply. Novelty and source failures do not justify inventing events.

## Maps

Activity authorship and location provenance are separate. `Place.coordinateSource` is set only by trusted adapters or `resolveSuggestionPlaces`, never by Gemini JSON. Named Gemini destinations and city-source venues first match existing provider places, then use one bounded, cached OSM lookup. Resolved destinations can become map pins. Ambiguous or unresolved destinations remain in the list; guessed coordinates are not promoted to verified pins.

The session map reuses the prepared suggestions. Opening it performs no new geocoding. See [SESSION_MAP.md](SESSION_MAP.md) for collection behavior.

## Source coverage and rollout

City portals, organizer websites, venues, neighborhood calendars and event aggregators can all be found by search. Rausgegangen is an eligible website among others; it has no special role in live discovery. Previously saved `rausgegangen` cards remain compatible, while newly discovered publisher events use `source: 'web'` and display the original source domain.

Each uncached discovery performs at most two search requests and ten page fetches, with three parallel page requests, a three-page cap per source site and at most four returned events per source site. The entire server request has a 15-second budget; independently fetched event facts are cached for 15 minutes by area, local calendar dates and discovery context. Empty successful results are cached for one minute. Search snippets are not cached. Same-context requests share work. Atomic backend quotas cap searches at 40 per account/day and 1,000 globally/day, independently of AI generation quotas.

The callable receives city/location, selected dates, timezone, language, mode and at most eight known interest categories. Search receives only area, dates and bounded topic labels; no coordinates, user identifiers, calendar titles or profile/free-text interests. An event's date and address/coordinates must match the requested area and period. Duplicate occurrences from multiple publishers are removed.

Pages without usable structured event data are skipped. JavaScript-only pages, blocked pages, missing dates and unsupported formats do not justify invented events or entry rules. This is a bounded discovery pass, not an exhaustive web crawl; every city and event cannot be guaranteed coverage. Existing non-web sources remain available when discovery fails.

### Configuration

The initial provider is [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started). Store its key as the Firebase secret `WEB_SEARCH_API_KEY` before deploying `discoverCityEvents`; never put it in an `EXPO_PUBLIC_` variable or the app bundle. Swapping `WebSourceSearch` replaces the search vendor without changing the crawler, parser or app. No search account was created and no paid search request was made during implementation.

The existing Gemini key is not reused to collect crawl targets: [Gemini Search Grounding terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search) explicitly exclude using its links to identify pages for automated crawling/scraping. Gemini continues personalizing recommendations from independently retrieved event facts.

Without a configured search key the callable reports `not_configured`; the app continues with its other sources. Deployment and key configuration are still required to activate this path. The code changes themselves do not publish an app or backend release.

Live fetch smoke check on 2026-09-26: the generic fetcher successfully read [Berlin's public event portal](https://www.berlin.de/tickets/) through the actual DNS-pinned/robots-aware transport. Search-to-event integration is verified with deterministic multi-publisher fixtures; it has not been tested against a configured paid search account or deployed production callable.

## Regression checks

Client coverage: `gemini-session-variety.test.cjs`, `city-events-client.test.cjs`, `city-event-discovery.test.cjs`, `suggestion-session.test.cjs`, the suggestion-place resolver tests, and session-map tests under `scripts/` and `tests/session-map/`.

Server coverage: `functions/scripts/cityEvents.test.js`, `eventSourceSearch.test.js`, `webEventParser.test.js` and `publicWebFetch.test.js`, with multi-publisher discovery, date/location checks, source variety, quotas, JSON-LD formats, robots/SSRF/redirect handling, deadlines and cache behavior. Type-check the app with `npx tsc --noEmit` and build functions with `npm --prefix functions run build`.
