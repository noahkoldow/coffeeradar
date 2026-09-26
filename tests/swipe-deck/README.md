# Swipe deck browser regression tests

Run `npm run test:swipe` (or only the browser suite with
`npx playwright test --config tests/swipe-deck/playwright.config.cjs`).
Install Chromium once with `npx playwright install chromium` if needed.

The suite serves the real `SwipeDeck` and `SuggestionCard` through Expo Metro
and React Native Web. Three deterministic cards and local callback controls
replace the rest of the application. Only the unrelated `AppState` import is
stubbed, preventing authentication, storage, and business services from starting.
Each browser test rejects requests to non-local origins.

Coverage includes actual mouse and touch gestures, button actions, abandoned
drags, preview DOM identity and opacity during promotion, retained flipped
content, deferred callbacks, failures, duplicate protection, disabled actions,
deck exhaustion, and undo. Frame-by-frame geometry checks at 360px and 430px
widths verify that preview bounds, title, description, instructions, and flip
hint retain their exact layout through two consecutive button or pointer
promotions. Playwright saves screenshots and failure traces under
`.expo/swipe-deck-results`.

For manual inspection, run `node scripts/serve-swipe-deck.cjs` and open
`http://127.0.0.1:8173`. The callback controls can hold, resolve, or reject actions
without using a real account. Set `SWIPE_TEST_PORT` to use another local port.

These browser tests verify component behavior on React Native Web. Native-driver
frame timing and performance on a physical iOS/Android device still require a
device build.
