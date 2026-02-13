# CoffeeRadar MVP

React Native + Expo MVP for a commitment-first "what should I do next" app.

## Setup

1) Install dependencies

```
npm install
```

2) Configure Firebase (optional but recommended)

Edit `src/services/firebase.ts` and replace the placeholder config with your Firebase web app config.

3) Optional events API

Add a Ticketmaster API key if you want live EVENT suggestions.

```
EXPO_PUBLIC_TICKETMASTER_KEY=your_key_here
```

4) Run

```
npm run start
```

## Notes

- If calendar or location permissions are denied, the app still works with reduced features.
- The app never uploads raw calendar event titles or notes. Only derived availability blocks are stored when Firebase is configured.
