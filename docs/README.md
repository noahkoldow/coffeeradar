# CoffeeRadar MVP

React Native + Expo MVP for a commitment-first "what should I do next" app.

## Setup

1) Install dependencies

```
npm install
```

2) Configure Firebase (optional but recommended)

`src/services/firebase.ts` already contains a hardcoded Firebase web app config for this project. If you fork or retarget the app, replace it with your own Firebase web app config there.

3) Optional events API

Add a Ticketmaster API key if you want live EVENT suggestions.

```
EXPO_PUBLIC_TICKETMASTER_KEY=your_key_here
```

4) Optional Firebase AI Logic source

The app now uses Firebase AI Logic through the Firebase JS SDK, so no exposed Gemini API key env var is required. If you want to override the default model, set `EXPO_PUBLIC_GEMINI_MODEL`.

The Firebase app config is hardcoded in `src/services/firebase.ts`, so no native Firebase files or config plugins are needed for the JS SDK path.

5) Run

```
npm run start
```

## Notes

- If calendar or location permissions are denied, the app still works with reduced features.
- The app never uploads raw calendar event titles or notes. Only derived availability blocks are stored when Firebase is configured.
