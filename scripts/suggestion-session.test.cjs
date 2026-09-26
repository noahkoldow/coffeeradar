const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Date, Set, Map, Math,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency ${name} in ${relative}`);
    },
  }, { filename });
  return module.exports;
}

const identity = loadSource('src/services/suggestionIdentity.ts');
const discoveryTiming = loadSource('src/services/discoveryTiming.ts');
const repetition = loadSource('src/services/activityRepetitionService.ts', { './debug': { addDebugMessage() {} } });
const item = (id, title = 'Read a chapter', extra = {}) => ({ id, title, description: 'A short activity.',
  type: 'AT_HOME', source: 'gemini', durationMin: 15, confidence: 0.8, tags: ['learning'], ...extra });
const emptyHistory = () => ({ lastShownIds: [], lastRejectedIds: [], lastAcceptedIds: [], lastShownDates: {} });
const prefs = { openToGoingOut: false, allowSerendipity: true, interestTags: [], radiusKm: 5 };
const availability = () => ({ start: new Date().toISOString(), end: new Date(Date.now() + 7200000).toISOString(), durationMin: 120 });

function suggestions({ home = [], fallback = [], gemini = [], mapPlaces = [], cityEvents = [], onGeminiLearning } = {}) {
  return loadSource('src/services/suggestions.ts', {
    '../data/atHome': { atHomeSuggestions: home }, '../data/goOut': { goOutSuggestions: [] },
    '../data/fallback': { fallbackSuggestions: fallback },
    '../utils/time': { addMinutes: (date, minutes) => new Date(date.getTime() + minutes * 60000),
      clamp: (number, min, max) => Math.min(max, Math.max(min, number)),
      fromISO: value => value ? new Date(value) : null,
      minutesBetween: (a, b) => Math.round((b.getTime() - a.getTime()) / 60000),
      getTimeZoneParts: () => ({ hour: 12, weekday: 'Friday' }), getPreferredTimeZone: () => 'UTC',
      isSameCalendarDayInTimeZone: () => true },
    './travel': { haversineKm: () => 1, chooseTravelMode: () => 'walk', estimateEtaMinutes: () => 10,
      estimateDeparture: date => new Date(date.getTime() - 600000) },
    './ticketmaster': { fetchTicketmasterSuggestions: async () => [] },
    './cityEvents': { fetchCityEventSuggestions: async () => cityEvents },
    './suggestionPlaces': { resolveSuggestionPlaces: async items => items },
    './discoveryTiming': discoveryTiming,
    './mapDiscovery': { hasProviderDestination: item => item.id.startsWith('osm_')
      || item.source === 'ticketmaster' || item.place?.coordinateSource === 'source' },
    '../utils/habits': { habitToSuggestion: value => value, isHabitDue: () => true, matchesTimeOfDay: () => true },
    './weather': { fetchWeather: async () => null },
    './geminiSuggestions': { fetchGeminiSuggestions: async (_location, _prefs, _availability, _weather, learning) => {
      onGeminiLearning?.(learning);
      return gemini;
    }, adaptHabitForToday: async () => null },
    './whyNow': { generateWhyNow: () => 'Fits your free time.' },
    './affinity': { affinityScore: () => 0.5, typeAffinityScore: () => 0.5 },
    './analytics': { logEvent: async () => {} }, './user': { loadFirebaseBusinesses: async () => [] },
    './communityIdeas': { loadApprovedCommunityIdeas: async () => [], communityIdeaToSuggestion: value => value },
    './activityRepetitionService': repetition,
    './businessService': { calculateBusinessHabitAlignment: () => 0, findAlignedBusinesses: () => [], businessToSuggestion: value => value },
    './business': { getCampaignsByStatus: async () => [] },
    '../utils/todoAtomization': {}, '../utils/challengeMode': { selectChallengeCandidates: value => value },
    '../utils/todos': {}, './activityChat': { loadActivityChatSocialProofCounts: async () => ({}) },
    '../utils/storage': { loadHabitAdaptation: async () => null, saveHabitAdaptation: async () => {} },
    './suggestionIdentity': identity, './mapDiscoveryCandidates': { fetchMapDiscoveryCandidates: async () => mapPlaces },
  });
}

const build = (service, exclusions = new Set(), options = {}) => service.buildDeck(
  options.availability || availability(), options.location || {}, options.prefs || prefs, options.history || emptyHistory(), [], [], 1,
  {}, null, undefined, [], '', 'alice', undefined, options.geminiOverride, options.maxGeminiCards, exclusions,
);

test('regenerated IDs, case, accents, punctuation, emoji and duration changes keep the same activity identity', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const first = item('gemini_first', '☕ Café break — 10 min!');
  assert.equal(ledger.reserve([first]).length, 1);
  assert.equal(ledger.reserve([item('gemini_second', 'cafe BREAK, 20 minutes')]).length, 0);
  assert.equal(ledger.filter([item('gemini_third', 'CAFÉ BREAK')]).length, 0);
});

test('distinct venues and event occurrences stay distinct while regenerated copies match', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const alpha = item('one', 'Coffee break', { type: 'GO_OUT', place: { name: 'Cafe Alpha', address: 'One Street 1', lat: 52.5, lng: 13.4 } });
  const beta = item('two', 'Coffee break', { type: 'GO_OUT', place: { name: 'Cafe Beta', address: 'Two Street 2', lat: 52.6, lng: 13.5 } });
  assert.equal(ledger.reserve([alpha, beta]).length, 2);
  assert.equal(ledger.reserve([{ ...alpha, id: 'regenerated', place: { ...alpha.place, address: 'One St. 1' } }]).length, 0);
  const event = (id, startAt) => item(id, 'Live jazz', { type: 'EVENT', event: { venue: 'Jazz Hall', startAt, ticketUrl: 'https://example.test/ticket' } });
  assert.equal(ledger.reserve([event('event-one', '2026-09-25T18:00:00Z')]).length, 1);
  assert.equal(ledger.reserve([event('event-copy', '2026-09-25T20:00:00+02:00')]).length, 0);
  assert.equal(ledger.reserve([event('event-next-day', '2026-09-26T18:00:00Z')]).length, 1);
});

test('a renamed daily habit remains the same activity within a session', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([item('first', 'Read outdoors', { source: 'habit', habitId: 'reading-habit' })]);
  assert.equal(ledger.reserve([item('second', 'Read indoors today', { source: 'habit', habitId: 'reading-habit' })]).length, 0);
});

test('filtering is pure, snapshots are isolated and reservation is synchronous across competing consumers', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const candidates = [item('one'), item('two', 'READ A CHAPTER!'), item('three', 'Sketch a tree')];
  const snapshot = ledger.snapshot();
  assert.equal(ledger.filter(candidates).length, 2);
  assert.equal(ledger.snapshot().size, 0);
  assert.equal(ledger.reserve(candidates).length, 2);
  assert.equal(snapshot.size, 0);
  assert.equal(ledger.reserve(candidates).length, 0);
  const isolated = ledger.snapshot();
  isolated.clear();
  assert.equal(ledger.filter(candidates).length, 0);
});

test('screen remount/new-set consumers retain the ledger; switching accounts starts a new session', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const reserveFromFirstScreen = candidates => ledger.reserve(candidates);
  const reserveFromRemountedScreen = candidates => ledger.reserve(candidates);
  reserveFromFirstScreen([item('one')]);
  assert.equal(ledger.resetForUser('alice'), false);
  assert.equal(reserveFromRemountedScreen([item('new-id')]).length, 0);
  assert.equal(ledger.resetForUser(null), true);
  assert.equal(ledger.resetForUser('alice'), true);
  assert.equal(ledger.reserve([item('new-session')]).length, 1);
  assert.equal(ledger.resetForUser('bob'), true);
  assert.equal(ledger.isForUser('alice'), false);
  assert.equal(ledger.reserve([item('other-account')]).length, 1);
});

test('ads do not reserve activity identities or disappear due to session filtering', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const ad = item('ad', 'Read a chapter', { source: 'ad' });
  assert.equal(ledger.reserve([ad, ad]).length, 2);
  assert.equal(ledger.snapshot().size, 0);
  assert.equal(ledger.reserve([item('real')]).length, 1);
  assert.equal(ledger.filter([ad]).length, 1);
});

test('AI exclusion context contains the latest forty distinct normalized titles with bounded length', () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve(Array.from({ length: 45 }, (_, index) => item(`id_${index}`, `Activity ${index}!`)));
  ledger.reserve([item('long', 'A'.repeat(150)), item('ad', 'Do not include ads', { source: 'ad' })]);
  const titles = identity.getExcludedActivityTitles(ledger.snapshot());
  assert.equal(titles.length, 40);
  assert.equal(titles[0], 'activity 6');
  assert.equal(titles.at(-1), 'a'.repeat(100));
  assert.equal(titles.includes('do not include ads'), false);
  assert.equal(ledger.snapshot().size > titles.length, true);
});

test('deck generation forwards current session exclusions to the AI cache and prompt context', async () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([item('old', 'Read A Chapter!')]);
  let context;
  const service = suggestions({ onGeminiLearning: learning => { context = learning; } });
  await build(service, ledger.snapshot());
  assert.equal(context.excludedActivityTitles.length, 1);
  assert.equal(context.excludedActivityTitles[0], 'read a chapter');
  ledger.reserve([item('next', 'Sketch a Leaf')]);
  await build(service, ledger.snapshot());
  assert.equal(context.excludedActivityTitles.length, 2);
  assert.equal(context.excludedActivityTitles[1], 'sketch a leaf');
});

test('an explicit zero AI budget skips generation; default generation and supplied pools retain their behavior', async () => {
  let calls = 0;
  const service = suggestions({ gemini: [item('generated', 'Read a chapter')], onGeminiLearning: () => { calls++; } });
  const skipped = await build(service, new Set(), { maxGeminiCards: 0 });
  assert.equal(calls, 0);
  assert.equal(skipped.deck.length, 0);
  assert.equal(skipped.allGemini, undefined);
  const supplied = await build(service, new Set(), { maxGeminiCards: 0, geminiOverride: [item('pooled', 'Sketch a leaf')] });
  assert.equal(calls, 0);
  assert.equal(supplied.deck[0].id, 'pooled');
  const normal = await build(service);
  assert.equal(calls, 1);
  assert.equal(normal.deck[0].id, 'generated');
});

test('the independent 72-hour habit policy cannot override an activity already reserved this session', () => {
  const first = item('habit', 'Read a chapter', { source: 'habit', habitId: 'habit', isRepetitionFriendly: true });
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([first]);
  const history = { ...emptyHistory(), lastShownDates: { habit: '2026-09-20T12:00:00Z' } };
  assert.equal(repetition.filterForHabitRepetition([first], history, new Date('2026-09-24T12:00:00Z')).length, 1);
  assert.equal(ledger.filter([first]).length, 0);
});

test('fallback exhaustion returns an empty/smaller deck instead of repeat-filling later passes', async () => {
  const pool = [item('f1', 'Breathe slowly', { source: 'fallback' }), item('f2', 'Sketch a leaf', { source: 'fallback' })];
  const service = suggestions({ fallback: pool });
  const ledger = identity.createSessionSuggestionLedger('alice');
  const first = await build(service, ledger.snapshot());
  assert.equal(first.deck.length, 2);
  ledger.reserve(first.deck);
  const second = await build(service, ledger.snapshot());
  assert.equal(second.deck.length, 0);
  assert.equal(second.usedFallback, false);
});

test('new generated IDs cannot evade session filtering through the primary or fallback path', async () => {
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([item('already-shown', 'Read a chapter')]);
  const service = suggestions({ gemini: [item('regenerated', 'READ A CHAPTER!')],
    fallback: [item('fallback-copy', 'Read a chapter', { source: 'fallback' })] });
  assert.equal((await build(service, ledger.snapshot())).deck.length, 0);
});

test('filtered fallback generation respects content exclusions and evaluates feasibility without a TDZ error', () => {
  const first = item('seen', 'Breathe slowly');
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([first]);
  const service = suggestions({ home: [item('copy', 'BREATHE SLOWLY!'), item('fresh', 'Sketch a leaf')],
    fallback: [item('duplicate-fresh', 'Sketch a leaf!')] });
  const result = service.buildFilteredFallbacks('at_home', availability(), {}, new Set(), ledger.snapshot());
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Sketch a leaf');
});

test('undersized decks never bypass time feasibility to fill empty slots', async () => {
  const service = suggestions({ fallback: [item('too-long', 'A full day project', { source: 'fallback', durationMin: 999 })] });
  assert.equal((await build(service)).deck.length, 0);
});

test('real venue pool survives the ranked five-card cap and excludes reserved venues without extra discovery', async () => {
  const mapPlaces = Array.from({ length: 8 }, (_, i) => item(`osm_${i}`, `Visit gallery ${i}`, {
    type: 'GO_OUT', source: 'curated', place: { name: `Gallery ${i}`, lat: 52.5 + i / 1000, lng: 13.4 },
  }));
  const generated = Array.from({ length: 5 }, (_, i) => item(`gemini_${i}`, `Creative prompt ${i}`));
  const service = suggestions({ mapPlaces, gemini: generated });
  const ledger = identity.createSessionSuggestionLedger('alice');
  ledger.reserve([mapPlaces[0]]);
  const result = await build(service, ledger.snapshot(), { prefs: { ...prefs, openToGoingOut: true },
    location: { lat: 52.5, lng: 13.4, areaLabel: 'Berlin', timeZone: 'Europe/Berlin' }, maxGeminiCards: 5 });
  assert.equal(result.deck.length, 5);
  assert.equal(result.mapCandidates.length, 7);
  assert.equal(result.mapCandidates.some(candidate => candidate.id === 'osm_0'), false);
  assert.equal(result.mapCandidates.every(candidate => candidate.id.startsWith('osm_')), true);
});

function appStateHarness(buildDeck) {
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/state/AppState.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const slots = [];
  const effects = [];
  let cursor = 0;
  let authCallback;
  const auth = { currentUser: null };
  const react = { createContext: () => ({ Provider: 'provider' }), createElement: (_component, props) => props,
    useContext: () => undefined, useMemo: fn => fn(), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Date, Set, Map, console,
    require(name) {
      if (name === 'react') return react;
      if (name === '../services/suggestionIdentity') return identity;
      if (name === '../services/suggestions') return { buildDeck };
      if (name === '../services/firebase') return { auth, firebaseEnabled: true };
      if (name === '../services/auth') return { subscribeAuthState: callback => { authCallback = callback; return () => {}; } };
      if (name === '../services/debug') return { addDebugMessage() {} };
      if (name === '../services/user') return { isBusinessPremium: () => false };
      if (name === '../utils/availabilityIgnore') return { applyIgnoredEventsToAvailability: value => value };
      if (name === '../utils/storage') return new Proxy({}, { get: () => async () => {} });
      return {};
    },
  });
  const render = () => { cursor = 0; return module.exports.AppStateProvider({ children: null }).value; };
  render();
  effects.find(effect => String(effect).includes('subscribeAuthState'))();
  const signIn = uid => {
    auth.currentUser = uid ? { uid, email: `${uid}@example.test` } : null;
    authCallback(auth.currentUser);
    return render();
  };
  return { render, signIn };
}

test('plan-ahead keeps sourced city events in the mix and supplies them to Gemini', async () => {
  const start = new Date(Date.now() + 24 * 60 * 60000);
  const window = { start: start.toISOString(), end: new Date(+start + 8 * 60 * 60000).toISOString(),
    durationMin: 480, discoveryMode: 'plan_ahead' };
  const event = item('city-event', 'Cheer at the city race', { type: 'EVENT', source: 'rausgegangen', durationMin: 45,
    event: { startAt: new Date(+start + 60 * 60000).toISOString(), venue: 'City route',
      sourceUrl: 'https://events.example/city-race', ticketUrl: '', attendanceMode: 'fixed' },
    place: { name: 'City route', lat: 52.51, lng: 13.39, coordinateSource: 'source' }, tags: ['fitness'] });
  let eventCandidates;
  const service = suggestions({ cityEvents: [event],
    gemini: Array.from({ length: 5 }, (_, i) => item(`ai-${i}`, `Creative exercise ${i}`)),
    onGeminiLearning: learning => { eventCandidates = learning.eventCandidates; } });
  const result = await build(service, new Set(), { availability: window,
    prefs: { ...prefs, openToGoingOut: true }, location: { lat: 52.5, lng: 13.4 } });
  assert.equal(eventCandidates[0].id, 'city-event');
  assert.ok(result.deck.some(card => card.id === 'city-event'));
  assert.ok(result.mapCandidates.some(card => card.id === 'city-event'));
});

test('events before a selected window or overrunning it cannot enter the deck', async () => {
  const start = new Date(Date.now() + 24 * 60 * 60000);
  const window = { start: start.toISOString(), end: new Date(+start + 120 * 60000).toISOString(),
    durationMin: 120, discoveryMode: 'plan_ahead' };
  const event = (id, offset, duration) => item(id, id, { type: 'EVENT', source: 'rausgegangen', durationMin: duration,
    event: { startAt: new Date(+start + offset * 60000).toISOString(), venue: 'Hall',
      sourceUrl: 'https://events.example/show', ticketUrl: '' }, place: { name: 'Hall', lat: 52.51, lng: 13.39 } });
  const service = suggestions({ cityEvents: [event('before-window', -60, 30), event('overruns-window', 90, 45)] });
  const result = await build(service, new Set(), { availability: window,
    prefs: { ...prefs, openToGoingOut: true }, location: { lat: 52.5, lng: 13.4 } });
  assert.equal(result.deck.length, 0);
  assert.equal(result.mapCandidates.length, 0);
});

test('AppState filters preloads at consumption, reserves synchronously and keeps snapshot reads non-mutating', async () => {
  const pool = [item('preload', 'Read a chapter'), item('fresh', 'Sketch a leaf')];
  const app = appStateHarness(async () => ({ deck: pool, mapCandidates: pool, usedFallback: false }));
  const { actions } = app.signIn('alice');
  actions.preloadDeck(availability());
  await new Promise(resolve => setImmediate(resolve));
  actions.reserveDeckSuggestions([item('other-build', 'READ A CHAPTER!')]);
  const queued = actions.consumeDeck();
  assert.equal(queued.deck.length, 1);
  assert.equal(queued.mapCandidates.length, 1);
  assert.equal(queued.deck[0].id, 'fresh');
  assert.equal(actions.filterUnseenSuggestions(queued.deck).length, 1);
  assert.equal(actions.reserveDeckSuggestions(queued.deck).length, 1);
  assert.equal(actions.reserveDeckSuggestions(queued.deck).length, 0);
  assert.equal(app.render().actions.filterUnseenSuggestions(pool).length, 0);
});

test('AppState preloads read history synchronously and reject stale cross-account completion/actions', async () => {
  const pending = [];
  const calls = [];
  const app = appStateHarness((...args) => {
    calls.push(args);
    return new Promise(resolve => pending.push(resolve));
  });
  const alice = app.signIn('alice').actions;
  const history = { ...emptyHistory(), lastShownIds: ['history-updated-before-render'] };
  alice.setHistory(history);
  alice.preloadDeck(availability());
  assert.equal(calls[0][3], history);
  const bob = app.signIn('bob').actions;
  bob.preloadDeck(availability());
  assert.equal(alice.reserveDeckSuggestions([item('wrong-owner')]).length, 0);
  pending[0]({ deck: [item('alice-result')], usedFallback: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bob.consumeDeck(), null);
  pending[1]({ deck: [item('bob-result')], usedFallback: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alice.consumeDeck(), null);
  assert.equal(bob.consumeDeck().deck[0].id, 'bob-result');
});
