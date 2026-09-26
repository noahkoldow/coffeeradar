const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}, extra = '') {
  const filename = path.resolve(__dirname, '..', relative);
  const source = fs.readFileSync(filename, 'utf8') + extra;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    module, exports: module.exports, Date, Math, Intl, Set, Map, console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return module.exports;
}

const time = load('src/utils/time.ts');
const discoveryTiming = load('src/services/discoveryTiming.ts');
const location = { lat: 52.52, lng: 13.405, areaLabel: 'Berlin', timeZone: 'Europe/Berlin' };
const prefs = { interestTags: ['creative'], radiusKm: 5, openToGoingOut: true, allowSerendipity: true, language: 'en' };
const availability = { start: '2026-09-25T10:00:00Z', end: '2026-09-25T12:00:00Z', durationMin: 120 };

function fixture() {
  const calls = [];
  let wait;
  const service = load('src/services/geminiSuggestions.ts', {
    '../utils/time': time,
    './discoveryTiming': discoveryTiming,
    './debug': { addDebugMessage() {} },
    '../utils/storage': { loadGeminiUsage: async () => null, loadPremiumActive: async () => false, saveGeminiUsage: async () => {} },
    '../utils/challengeMode': { selectChallengeCandidates: items => items },
    './firebaseAiLogic': { generateJsonWithFirebaseAiLogic: async request => {
      calls.push(request);
      if (wait) await wait;
      return JSON.stringify({ suggestions: [{ type: 'AT_HOME', title: `Sketch ${calls.length}`,
        description: 'Sketch something you can see.', durationMin: 20, tags: ['creative'], confidence: 0.8 }] });
    } },
  }, '\nexports.testInternals = { buildPrompt, buildCacheKey, boundedExcludedTitles, cache, validatePayload, toSuggestion };');
  return { calls, service, internals: service.testInternals, pause(promise) { wait = promise; },
    fetch: learning => service.fetchGeminiSuggestions(location, prefs, availability, null, learning, 'test-user') };
}

test('same context shares work, while presented titles create a fresh generation context', async () => {
  const f = fixture();
  let release;
  f.pause(new Promise(resolve => { release = resolve; }));
  const first = f.fetch({ excludedActivityTitles: [] });
  const duplicate = f.fetch({ excludedActivityTitles: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  release();
  await Promise.all([first, duplicate]);
  await f.fetch({ excludedActivityTitles: [] });
  assert.equal(f.calls.length, 1, 'unused cached results can still be reused');
  await f.fetch({ excludedActivityTitles: ['sketch a houseplant'] });
  assert.equal(f.calls.length, 2, 'a new set must not replay the same cached batch');
  assert.match(f.calls[1].prompt, /sketch a houseplant/);
  assert.match(f.calls[1].prompt, /do not repeat or merely reword/);
});

test('regular and challenge prompts include identical bounded novelty data used by the cache', () => {
  const f = fixture();
  const titles = ['discard me', ...Array.from({ length: 45 }, (_, i) => `activity ${i}`), 'x'.repeat(200)];
  for (const filter of [undefined, 'challenge_me']) {
    const learning = { filter, excludedActivityTitles: titles };
    const key = JSON.parse(f.internals.buildCacheKey(location, prefs, availability, null, learning, 'test-user'));
    assert.equal(key.learning.excludedActivityTitles.length, 40);
    assert.equal(key.learning.excludedActivityTitles.at(-1).length, 100);
    const prompt = f.internals.buildPrompt(location, prefs, availability, null, learning);
    assert.ok(prompt.includes(JSON.stringify(key.learning.excludedActivityTitles)));
    assert.ok(!prompt.includes('discard me'));
  }
});

test('duplicates, blanks, and titles beyond the bounded window do not waste another cache context', () => {
  const f = fixture();
  const keys = titles => f.internals.buildCacheKey(location, prefs, availability, null, { excludedActivityTitles: titles }, 'test-user');
  assert.equal(keys(['read a chapter']), keys([' ', 'read a chapter', 'read a chapter']));
  const recent = Array.from({ length: 40 }, (_, i) => `recent ${i}`);
  assert.equal(keys(['old', ...recent]), keys(['another old', ...recent]));
});

test('many different sets keep only a bounded cache of completed generation contexts', async () => {
  const f = fixture();
  for (let i = 0; i < 36; i++) await f.fetch({ excludedActivityTitles: [`set ${i}`] });
  assert.equal(f.calls.length, 36);
  assert.equal(f.internals.cache.size, 32);
  await f.fetch({ excludedActivityTitles: ['set 35'] });
  assert.equal(f.calls.length, 36);
});

const sourcedEvent = {
  id: 'rausgegangen_race_2026', source: 'rausgegangen', type: 'EVENT',
  title: 'City race viewing', description: 'Public viewing at the named meeting point.',
  durationMin: 60, tags: ['fitness'], confidence: 0.85,
  place: { name: 'Viewing point', address: 'Test Street 1, Berlin', lat: 52.52, lng: 13.4, coordinateSource: 'source' },
  event: { startAt: '2026-09-27T09:00:00+02:00', endAt: '2026-09-27T14:00:00+02:00',
    venue: 'Viewing point', ticketUrl: '', sourceUrl: 'https://rausgegangen.de/events/test-race/', attendanceMode: 'drop_in' },
};

test('plan-ahead uses the future window and sourced city events without imposing immediate departure', () => {
  const f = fixture();
  const planned = { ...availability, discoveryMode: 'plan_ahead', start: '2026-09-27T07:00:00Z', end: '2026-09-27T18:00:00Z' };
  const learning = { filter: 'go_out', eventCandidates: [sourcedEvent] };
  const prompt = f.internals.buildPrompt(location, prefs, planned, null, learning);
  assert.match(prompt, /PLAN AHEAD/);
  assert.match(prompt, /across the same city/);
  assert.match(prompt, /rausgegangen_race_2026/);
  assert.doesNotMatch(prompt, /The user wants to GO OUT NOW|Make activities that can start immediately/);
  assert.match(prompt, /no live web search/);
  assert.match(prompt, /public spectator access/);
  const nowPrompt = f.internals.buildPrompt(location, prefs, { ...availability, discoveryMode: 'now' }, null, learning);
  assert.match(nowPrompt, /DO NOW/);
  assert.match(nowPrompt, /Only suggest going out within 5km/);
  assert.notEqual(f.internals.buildCacheKey(location, prefs, planned, null, learning),
    f.internals.buildCacheKey(location, prefs, { ...planned, discoveryMode: 'now' }, null, learning));
});

test('event source facts and source changes remain authoritative through generation and cache', () => {
  const f = fixture();
  const learning = { eventCandidates: [sourcedEvent] };
  const raw = { type: 'EVENT', title: 'Cheer for the runners', description: 'Enjoy the atmosphere together.',
    eventCandidateId: sourcedEvent.id, eventStartAt: '2099-01-01T00:00:00Z', eventVenue: 'Invented venue',
    eventTicketUrl: 'https://tickets.example.com', placeLat: 0, placeLng: 0, durationMin: 5, isRepetitionFriendly: true };
  assert.equal(f.internals.validatePayload({ suggestions: [raw] }, learning).ok, true);
  const result = f.internals.toSuggestion(raw, 0, learning);
  assert.equal(result.event.startAt, sourcedEvent.event.startAt);
  assert.equal(result.event.ticketUrl, '');
  assert.equal(result.event.sourceUrl, sourcedEvent.event.sourceUrl);
  assert.equal(result.place.lat, sourcedEvent.place.lat);
  assert.equal(result.id, sourcedEvent.id);
  assert.equal(result.title, sourcedEvent.title);
  assert.equal(result.source, 'rausgegangen');
  assert.equal(result.durationMin, 60);
  assert.equal(result.isRepetitionFriendly, false);
  assert.notEqual(f.internals.buildCacheKey(location, prefs, availability, null, learning),
    f.internals.buildCacheKey(location, prefs, availability, null, { eventCandidates: [] }));
});

test('unbacked events are rejected while a named address can be resolved without invented coordinates', () => {
  const f = fixture();
  const event = { type: 'EVENT', title: 'Made up event', description: 'Not sourced.',
    eventStartAt: '2026-09-27T09:00:00Z', eventVenue: 'Hall', eventCandidateId: 'not-provided' };
  assert.equal(f.internals.validatePayload({ suggestions: [event] }).ok, false);
  assert.equal(f.internals.toSuggestion(event, 0), null);
  const outing = { type: 'GO_OUT', title: 'Draw in the garden', description: 'Sketch a plant.',
    placeName: 'Botanical Garden', placeAddress: 'Test Street 1, Berlin', placeLat: null, placeLng: null };
  assert.equal(f.internals.validatePayload({ suggestions: [outing] }).ok, true);
  assert.equal(f.internals.toSuggestion(outing, 0).place.lat, undefined);
  for (const filter of ['at_home', 'challenge_me']) {
    const prompt = f.internals.buildPrompt(location, prefs, availability, null, { filter });
    assert.match(prompt, /No verified events were supplied/);
  }
});
