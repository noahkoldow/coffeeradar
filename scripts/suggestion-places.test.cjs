const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loader(fetch, globals = {}) {
  const modules = new Map();
  return function load(filename) {
    const absolute = path.resolve(__dirname, '..', filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const module = { exports: {} };
    modules.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, Date, Math, AbortController, setTimeout, clearTimeout, fetch, ...globals,
      require(name) {
        if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename: absolute });
    return module.exports;
  };
}
const origin = { lat: 52.52, lng: 13.405, areaLabel: 'Berlin' };
const idea = (id = 'gemini_1', place = { name: 'Tempelhofer Feld' }, extra = {}) => ({
  id, source: 'gemini', type: 'GO_OUT', title: 'Take a walk', description: 'Walk outside.',
  durationMin: 30, confidence: .8, place, ...extra,
});
const osm = (name, lat = 52.475, lon = 13.4, extraTags = {}) => ({ type: 'way', id: 1,
  center: { lat, lon }, tags: { name, leisure: 'park', ...extraTags } });
const response = elements => ({ ok: true, json: async () => ({ elements }) });

test('a generated activity with a named venue becomes a session map pin from provider coordinates', async () => {
  let calls = 0;
  const load = loader(async (url, options) => {
    calls++;
    assert.equal(options.method, 'POST');
    const query = new URLSearchParams(options.body).get('data');
    assert.ok(query.includes('Tempelhofer Feld'));
    assert.ok(query.includes('around:40000,52.52,13.405'));
    return response([osm('Tempelhofer Feld')]);
  });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const { createSessionMapCollection, getSessionMapOptions } = load('src/services/sessionMap.ts');
  const input = idea();
  const resolved = await resolveSuggestionPlaces([input], origin);
  assert.equal(resolved[0].place.coordinateSource, 'osm');
  assert.equal(resolved[0].place.lat, 52.475);
  assert.equal(input.place.lat, undefined, 'does not mutate generated or cached input');
  const collection = createSessionMapCollection();
  const snapshot = collection.add(resolved);
  assert.equal(getSessionMapOptions(snapshot.entries, origin).length, 1);
  assert.equal(getSessionMapOptions(snapshot.entries, origin)[0].suggestion.id, input.id);
  assert.equal(calls, 1, 'revisiting map options performs no lookup');
});

test('verified catalog matches are reused without a network call and correct generated coordinates', async () => {
  const load = loader(() => { throw new Error('No request expected'); });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const generated = idea('gemini_1', { name: 'Tempelhofer Feld', lat: 1, lng: 2 });
  const real = idea('osm_123', { name: 'Tempelhofer Feld', lat: 52.475, lng: 13.4 }, { source: 'curated' });
  const resolved = await resolveSuggestionPlaces([generated], origin, [real]);
  assert.equal(resolved[0].place.lat, 52.475);
  assert.equal(resolved[0].place.coordinateSource, 'geocoded');
  assert.equal(generated.place.lat, 1);
});

test('event venue addresses without coordinates resolve, including provider name aliases', async () => {
  const load = loader(async () => response([osm('Brandenburger Tor', 52.5163, 13.3777, { 'name:en': 'Brandenburg Gate' })]));
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const result = await resolveSuggestionPlaces([idea('event', { name: 'Brandenburg Gate' }, {
    type: 'EVENT', event: { venue: 'Brandenburg Gate', startAt: '2026-09-27T10:00:00Z', ticketUrl: '' },
  })], origin);
  assert.equal(result[0].place.name, 'Brandenburg Gate');
  assert.equal(result[0].place.lat, 52.5163);
});

test('same-name branches stay unresolved unless a matching address disambiguates them', async () => {
  const load = loader(async () => response([
    osm('Cafe Alpha', 52.52, 13.4, { 'addr:street': 'First Street', 'addr:housenumber': '1' }),
    osm('Cafe Alpha', 52.55, 13.4, { 'addr:street': 'Second Street', 'addr:housenumber': '2' }),
  ]));
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const input = idea('generic', { name: 'Cafe Alpha' });
  const specific = idea('specific', { name: 'Cafe Alpha', address: 'Second Street 2, Berlin' });
  const result = await resolveSuggestionPlaces([input, specific], origin);
  assert.equal(result[0].place.coordinateSource, undefined);
  assert.equal(result[1].place.lat, 52.55);
});

test('home activities, generic places and missing origin never start lookups', async () => {
  let calls = 0;
  const load = loader(async () => { calls++; return response([]); });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const inputs = [idea('home', { name: 'Private flat' }, { type: 'AT_HOME' }), idea('generic', { name: 'Nearby cafe' }), idea('german', { name: 'Ein Park' })];
  await resolveSuggestionPlaces(inputs, origin);
  await resolveSuggestionPlaces([idea()], { lat: null, lng: null });
  assert.equal(calls, 0);
});

test('source-listed city events without coordinates resolve their named venue too', async () => {
  const load = loader(async () => response([osm('Festsaal Kreuzberg', 52.496, 13.446, { 'addr:street': 'Am Flutgraben', 'addr:housenumber': '2' })]));
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const result = await resolveSuggestionPlaces(['web', 'rausgegangen'].map(source => idea(`${source}_1`, {
    name: 'Festsaal Kreuzberg', address: 'Am Flutgraben 2, Berlin',
  }, { source, type: 'EVENT' })), origin);
  assert.equal(result[0].place.coordinateSource, 'osm');
  assert.equal(result[0].place.lat, 52.496);
  assert.equal(result[1].place.coordinateSource, 'osm', 'legacy saved source cards remain supported');
});

test('even a single same-name venue cannot override an explicit conflicting street address', async () => {
  const load = loader(async () => response([osm('Cafe Alpha', 52.52, 13.4, { 'addr:street': 'First Street', 'addr:housenumber': '1' })]));
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const result = await resolveSuggestionPlaces([idea('other_branch', { name: 'Cafe Alpha', address: 'Second Street 2, Berlin' })], origin);
  assert.equal(result[0].place.coordinateSource, undefined);
  const alias = await resolveSuggestionPlaces([idea('same_branch', { name: 'Cafe Alpha', address: 'First St. 1, Berlin' })], origin);
  assert.equal(alias[0].place.coordinateSource, 'osm');
});

test('invalid, distant, administrative or wrong-name results cannot verify a pin', async () => {
  const load = loader(async () => response([
    osm('Tempelhofer Feld', 91, 13.4), osm('Tempelhofer Feld', 48, 13.4),
    osm('Tempelhofer Feld', 52.52, 13.4, { boundary: 'administrative' }), osm('Other park'),
  ]));
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const result = await resolveSuggestionPlaces([idea()], origin);
  assert.equal(result[0].place.coordinateSource, undefined);
});

test('generated coordinates alone are not mistaken for provider provenance during outages', async () => {
  const load = loader(async () => { throw new Error('offline'); });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const { createSessionMapCollection, getSessionMapOptions } = load('src/services/sessionMap.ts');
  const result = await resolveSuggestionPlaces([idea('raw', { name: 'Tempelhofer Feld', lat: 52.475, lng: 13.4 })], origin);
  const snapshot = createSessionMapCollection().add(result);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(getSessionMapOptions(snapshot.entries, origin).length, 0);
});

test('shared requests, successful locations and misses are cached across decks', async () => {
  let calls = 0;
  const load = loader(async () => { calls++; return response([osm('Tempelhofer Feld')]); });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const cards = [idea(), idea('missing', { name: 'Unmapped Studio' })];
  const [first, second] = await Promise.all([resolveSuggestionPlaces(cards, origin), resolveSuggestionPlaces(cards, origin)]);
  await resolveSuggestionPlaces(cards, origin);
  assert.equal(calls, 1);
  assert.equal(first[0].place.lat, second[0].place.lat);
  first[0].place.lat = 0;
  const again = await resolveSuggestionPlaces(cards, origin);
  assert.equal(again[0].place.lat, 52.475, 'callers cannot corrupt the location cache');
});

test('a hanging request stops at the deadline and aborts without discarding the activity', async () => {
  let signal;
  const load = loader((_url, options) => { signal = options.signal; return new Promise(() => {}); }, {
    setTimeout: callback => setTimeout(callback, 10),
  });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  const result = await resolveSuggestionPlaces([idea()], origin);
  assert.equal(signal.aborted, true);
  assert.equal(result.length, 1);
  assert.equal(result[0].place.coordinateSource, undefined);
});

test('venue punctuation stays a quoted literal in the indexed Overpass name query', async () => {
  let query;
  const load = loader(async (_url, options) => { query = new URLSearchParams(options.body).get('data'); return response([]); });
  const { resolveSuggestionPlaces } = load('src/services/suggestionPlaces.ts');
  await resolveSuggestionPlaces([idea('special', { name: 'Café (West) "A+B"' })], origin);
  assert.ok(query.includes('["name"="Café (West) \\"A+B\\""]'));
  assert.ok(!query.includes('[~'), 'avoid city-wide regular-expression key scans');
});
