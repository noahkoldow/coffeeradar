const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loader(overrides = {}, globals = {}) {
  const modules = new Map();
  return function load(filename) {
    const absolute = path.resolve(__dirname, '..', filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, Date, Math, AbortController, setTimeout, clearTimeout,
      ...globals,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
        return require(name);
      },
    }, { filename: absolute });
    return module.exports;
  };
}

const load = loader();
const { selectMapActivities, shouldIncludeMapCard } = load('src/services/mapDiscovery.ts');
const { selectMapTravelMode, chooseTravelMode, estimateEtaMinutes, haversineKm } = load('src/services/travel.ts');
const origin = { lat: 52.52, lng: 13.405, areaLabel: 'Berlin' };
const urban = { label: 'urban', boosts: {}, lat: origin.lat, lng: origin.lng, detectedAt: '2026-09-25T08:00:00Z' };
const activity = (n, overrides = {}) => ({
  id: `osm_${n}`, source: 'curated', type: 'GO_OUT', title: `Activity ${n}`,
  description: 'A local activity.', durationMin: 30, confidence: 0.8,
  place: { name: `Place ${n}`, lat: origin.lat + n * 0.002, lng: origin.lng },
  tags: ['nature'], ...overrides,
});
const three = () => [activity(1), activity(2), activity(3)];

test('map selection returns exactly three stable, distinct provider activities without changing the deck', () => {
  const deck = Object.freeze(three().map(item => Object.freeze({ ...item, place: Object.freeze(item.place) })));
  const selected = selectMapActivities(deck, origin, urban, { durationMin: 90 });
  assert.equal(selected.length, 3);
  assert.deepEqual([...selected.map(option => option.suggestion.id)], deck.map(item => item.id));
  selected.forEach((option, index) => {
    assert.equal(option.suggestion, deck[index]);
    assert.equal(option.coordinate.latitude, deck[index].place.lat);
    assert.equal(option.coordinate.longitude, deck[index].place.lng);
    assert.equal(option.travelMode, 'walk');
    assert.equal(option.travelMin, estimateEtaMinutes(haversineKm(origin.lat, origin.lng, option.coordinate.latitude, option.coordinate.longitude), 'walk'));
    assert.equal(option.emoji, '🌳');
  });
  assert.equal(selectMapActivities(deck.slice(0, 2), origin), null);
});

test('generated AI coordinates, fabricated seed businesses, campaign regions and generic curated points are excluded', () => {
  const unsafe = [
    activity(10, { id: 'gemini_123', source: 'gemini' }),
    activity(11, { id: 'biz_seed_fit_studio_2026-09-25', source: 'business', businessId: 'seed_fit_studio' }),
    activity(12, { id: 'campaign_test', source: 'business' }),
    activity(13, { id: 'go_park_loop' }),
    activity(14, { id: 'community_123', source: 'community' }),
    activity(15, { id: 'google_forged', source: 'gemini' }),
  ];
  assert.equal(selectMapActivities(unsafe, origin), null);
  const selected = selectMapActivities([...unsafe, ...three()], origin);
  assert.deepEqual([...selected.map(option => option.suggestion.id)], ['osm_1', 'osm_2', 'osm_3']);
});

test('only the matching provider/source pairs can contribute venue coordinates', () => {
  const providers = [
    activity(1, { id: 'google_ChIJabc_123', emojis: ['☕'] }),
    activity(2, { id: 'tm_event123', type: 'EVENT', source: 'ticketmaster' }),
    activity(3, { id: 'seatgeek_123', type: 'EVENT' }),
  ];
  const selected = selectMapActivities(providers, origin);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].emoji, '☕');
  assert.equal(selectMapActivities(providers.map(item => ({ ...item, source: 'library' })), origin), null);
});

test('an inferred home region and current GPS never become an AT_HOME destination', () => {
  const profile = { ...urban, homeBase: { lat: 52.51, lng: 13.4, sampleCount: 120, establishedAt: '2025-01-01', updatedAt: '2026-09-25' } };
  const homes = [activity(10, { type: 'AT_HOME' }), activity(11, { type: 'AT_HOME', source: 'habit' })];
  assert.equal(selectMapActivities([...homes, ...three().slice(0, 2)], origin, profile), null);
  const selected = selectMapActivities([...homes, ...three()], origin, profile);
  assert.equal(selected.filter(option => option.suggestion.type === 'AT_HOME').length, 0);
});

test('missing origin and invalid coordinates fail closed, while zero latitude/longitude remain valid', () => {
  for (const bad of [null, undefined, NaN, Infinity, '52.52', 91]) {
    assert.equal(selectMapActivities(three(), { ...origin, lat: bad }), null);
    assert.equal(selectMapActivities([activity(1, { place: { name: 'Bad', lat: bad, lng: 13.4 } }), activity(2), activity(3)], origin), null);
  }
  assert.equal(selectMapActivities(three(), { ...origin, lng: -181 }), null);
  const equator = three().map((item, index) => ({ ...item, place: { name: item.place.name, lat: 0, lng: 0.001 * index } }));
  assert.equal(selectMapActivities(equator, { lat: 0, lng: 0, areaLabel: null }).length, 3);
});

test('duplicate IDs, normalized titles and duplicate provider destinations do not fill the three places', () => {
  const a = activity(1);
  const duplicateId = activity(4, { id: a.id });
  const duplicateTitle = activity(5, { title: '  ACTIVITY   1  ' });
  const samePlace = activity(6, { id: 'google_place1', title: 'Another provider', place: { ...a.place, lat: a.place.lat + 0.00001 } });
  const samePoint = activity(7, { place: { ...a.place, name: 'Alias' } });
  const selected = selectMapActivities([a, duplicateId, duplicateTitle, samePlace, samePoint, activity(2), activity(3)], origin);
  assert.deepEqual([...selected.map(option => option.suggestion.id)], ['osm_1', 'osm_2', 'osm_3']);
});

test('travel modes use explicit distance/context estimates and keep the legacy choice unchanged', () => {
  assert.equal(selectMapTravelMode(1.5, urban), 'walk');
  assert.equal(selectMapTravelMode(4, urban), 'transit');
  assert.equal(selectMapTravelMode(15, urban), 'car');
  assert.equal(selectMapTravelMode(4, { label: 'suburban' }), 'car');
  assert.equal(selectMapTravelMode(4), 'transit');
  assert.equal(chooseTravelMode(15), 'transit');
  assert.equal(estimateEtaMinutes(10, 'car'), 22);
  assert.ok(estimateEtaMinutes(20, 'car') > estimateEtaMinutes(10, 'car'));
});

test('the activity and return journey must fit in the available window', () => {
  const far = activity(10, { place: { name: 'Distant', lat: origin.lat + 0.09, lng: origin.lng }, durationMin: 90 });
  const selected = selectMapActivities([far, ...three()], origin, urban, { durationMin: 90 });
  assert.deepEqual([...selected.map(option => option.suggestion.id)], ['osm_1', 'osm_2', 'osm_3']);
  assert.equal(selectMapActivities(three(), origin, urban, 30), null);
  assert.equal(selectMapActivities(three(), origin, urban, 0), null);
  assert.equal(selectMapActivities(three(), origin, urban, NaN), null);
});

test('one cadence draw gives 62.5 percent of eligible sets and never more than one card', () => {
  let calls = 0;
  assert.equal(shouldIncludeMapCard(() => { calls++; return 0.624999; }), true);
  assert.equal(calls, 1);
  assert.equal(shouldIncludeMapCard(() => 0.625), false);
  assert.equal(shouldIncludeMapCard(() => NaN), false);
  assert.equal(shouldIncludeMapCard(() => -0.1), false);
  let included = 0;
  for (let n = 0; n < 1000; n++) included += Number(shouldIncludeMapCard(() => n / 1000));
  assert.equal(included, 625);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const availability = { start: '2026-09-25T08:00:00Z', end: '2026-09-25T20:00:00Z', durationMin: 720 };
const prefs = { openToGoingOut: true, radiusKm: 5, allowSerendipity: false, interestTags: ['nature', 'coffee'] };

function candidateLoader(fetcher) {
  let now = Date.parse('2026-09-25T08:00:00Z');
  let nextTimer = 1;
  const timers = new Map();
  const customLoad = loader({ './osmPlaces': { fetchOsmSuggestions: fetcher } }, {
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    fetch: customLoad('src/services/mapDiscoveryCandidates.ts').fetchMapDiscoveryCandidates,
    tick(ms) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
  };
}

test('concurrent decks share one free request and a successful cached list survives reordered preferences', async () => {
  let calls = 0;
  let finish;
  let options;
  const instance = candidateLoader((_location, _prefs, _availability, opts) => {
    calls++; options = opts;
    return new Promise(resolve => { finish = resolve; });
  });
  const requests = Array.from({ length: 12 }, () => instance.fetch(origin, prefs, availability));
  await flush();
  assert.equal(calls, 1);
  assert.equal(options.maxEndpoints, 1);
  assert.equal(options.allowWidening, false);
  finish(three());
  const results = await Promise.all(requests);
  assert.equal(results.every(items => items.length === 3), true);
  results[0].pop();
  assert.equal((await instance.fetch(origin, { ...prefs, interestTags: ['coffee', 'nature', 'coffee'] }, availability)).length, 3);
  assert.equal(calls, 1);
});

test('the three-second deadline aborts work, caches the failure and ignores late results', async () => {
  let calls = 0;
  let finish;
  let signal;
  const instance = candidateLoader((_location, _prefs, _availability, opts) => {
    calls++; signal = opts.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const first = instance.fetch(origin, prefs, availability);
  await flush();
  instance.tick(3000);
  assert.equal((await first).length, 0);
  assert.equal(signal.aborted, true);
  finish(three());
  await flush();
  assert.equal((await instance.fetch(origin, prefs, availability)).length, 0);
  assert.equal(calls, 1);
  instance.tick(60001);
  const retry = instance.fetch(origin, prefs, availability);
  await flush();
  assert.equal(calls, 2);
  finish(three());
  assert.equal((await retry).length, 3);
});

test('place discovery caches cannot reuse current opening status for a planned day', async () => {
  let calls = 0;
  const instance = candidateLoader(async () => { calls++; return three(); });
  const start = new Date(Date.now() + 24 * 60 * 60000);
  const planned = { ...availability, start: start.toISOString(),
    end: new Date(+start + 720 * 60000).toISOString(), discoveryMode: 'plan_ahead' };
  await instance.fetch(origin, prefs, availability);
  await instance.fetch(origin, prefs, planned);
  await instance.fetch(origin, prefs, planned);
  assert.equal(calls, 2);
});

test('empty responses are negatively cached and unavailable locations never initiate requests', async () => {
  let calls = 0;
  const instance = candidateLoader(async () => { calls++; return []; });
  await instance.fetch({ ...origin, lat: null }, prefs, availability);
  await instance.fetch(origin, { ...prefs, openToGoingOut: false }, availability);
  assert.equal(calls, 0);
  await instance.fetch(origin, prefs, availability);
  await instance.fetch(origin, prefs, availability);
  assert.equal(calls, 1);
});

test('OSM cancellation stops endpoint fallback and query widening', async () => {
  let calls = 0;
  const customLoad = loader({ './debug': { addDebugMessage() {} } }, {
    fetch(_url, { signal }) {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  const { fetchOsmSuggestions } = customLoad('src/services/osmPlaces.ts');
  const controller = new AbortController();
  const work = fetchOsmSuggestions(origin, prefs, availability, { signal: controller.signal });
  await flush();
  controller.abort();
  assert.equal((await work).length, 0);
  assert.equal(calls, 1);
});

test('the map OSM options permit only one endpoint request even on immediate failure', async () => {
  let calls = 0;
  const customLoad = loader({ './debug': { addDebugMessage() {} } }, {
    fetch: async () => { calls++; return { ok: false, status: 429 }; },
  });
  const { fetchOsmSuggestions } = customLoad('src/services/osmPlaces.ts');
  assert.equal((await fetchOsmSuggestions(origin, prefs, availability, { maxEndpoints: 1, allowWidening: false })).length, 0);
  assert.equal(calls, 1);
});

test('OSM cancellation remains attached until the response body finishes', async () => {
  let calls = 0;
  let bodyStarted = false;
  const customLoad = loader({ './debug': { addDebugMessage() {} } }, {
    fetch: async (_url, { signal }) => {
      calls++;
      return { ok: true, status: 200, json() {
        bodyStarted = true;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted body'))));
      } };
    },
  });
  const { fetchOsmSuggestions } = customLoad('src/services/osmPlaces.ts');
  const controller = new AbortController();
  const pending = fetchOsmSuggestions(origin, prefs, availability, { signal: controller.signal });
  await flush();
  assert.equal(bodyStarted, true);
  controller.abort();
  assert.equal((await pending).length, 0);
  assert.equal(calls, 1);
});

test('the existing OSM adapter evicts old area entries instead of accumulating locations forever', async () => {
  let calls = 0;
  const customLoad = loader({ './debug': { addDebugMessage() {} } }, {
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ elements: [1, 2, 3].map(id => ({
        id, lat: origin.lat + id * 0.002, lon: origin.lng,
        tags: { name: `Cafe ${id}`, amenity: 'cafe' },
      })) }) };
    },
  });
  const { fetchOsmSuggestions } = customLoad('src/services/osmPlaces.ts');
  const window = { ...availability, end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
  const options = { maxEndpoints: 1, allowWidening: false };
  for (let index = 0; index < 65; index++) {
    assert.equal((await fetchOsmSuggestions({ ...origin, lat: origin.lat + index * 0.01 }, prefs, window, options)).length, 3);
  }
  assert.equal(calls, 65);
  await fetchOsmSuggestions(origin, prefs, window, options);
  assert.equal(calls, 66);
});
