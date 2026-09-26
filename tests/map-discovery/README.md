# Map discovery UI checks

This isolated Expo web app imports the real `MapDiscoveryCard`, `SuggestionCard`, and `SwipeDeck`. Theme and language contexts are local fixtures; Firebase and the production app are not started. Place names/coordinates are synthetic test data. No provider or routing requests are made.

Use the workspace's installed Expo, TypeScript, and Playwright tooling. No `node_modules` directory or junction belongs in this harness.

From the repository root, start the harness in one terminal:

```powershell
node node_modules/expo/bin/cli start tests/map-discovery --web --offline --port 8099
```

In another terminal:

```powershell
node tests/map-discovery/native-check.cjs
node tests/map-discovery/check.cjs
node tests/map-discovery/swipe-check.cjs
```

The matrix covers 320/390px, English/German, and one/two/three options. It checks every pin and row opening the matching actual activity card, return navigation, travel icons, fixed height, and horizontal overflow. It writes screenshots to `tests/artifacts/map-discovery`. `swipe-check.cjs` exercises real mouse drags through `SwipeDeck`, including blocked map right swipes, map skipping, selected activity rejection/acceptance, and back navigation.

`native-check.cjs` transpiles the production native component with a lightweight renderer to verify that previews preserve the same native map surface, content and measured camera region on activation and undo. Preview markers stay inert and hidden from accessibility, invalid origins use the diagram fallback, map gestures stay disabled, and active marker callbacks use the correct IDs. This is not native-device validation. Native map rendering and gesture behavior still require iOS/Android device testing. The harness simulates screen state around the real components; it does not cover `DeckScreen` backend/account lifecycle.

Open `http://localhost:8099/?language=de&count=3&theme=dark` for a manual review. Add `&deck=1` to use the real swipe deck.
