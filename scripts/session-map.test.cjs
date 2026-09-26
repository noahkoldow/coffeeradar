const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// The helper must stay pure: unexpected network or native dependencies fail here.
const modules = new Map();
function load(filename) {
  const absolute = path.resolve(__dirname, '..', filename);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const module = { exports: {} };
  modules.set(absolute, module);
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, Math, Set, Map,
    fetch() { throw new Error('Session map must not make network calls'); },
    require(name) {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(absolute), `${name}.ts`));
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: absolute });
  return module.exports;
}

const { createSessionMapCollection, getSessionMapOptions } = load('src/services/sessionMap.ts');
const origin = { lat: 52.52, lng: 13.405, areaLabel: 'Berlin' };
const urban = { label: 'urban' };
const activity = (id, title = `Activity ${id}`, extra = {}) => ({
  id, title, type: 'AT_HOME', source: 'gemini', description: 'An activity.',
  durationMin: 30, confidence: 0.8, ...extra,
});
const place = (number, extra = {}) => activity(`osm_${number}`, `Place activity ${number}`, {
  source: 'curated', type: 'GO_OUT',
  place: { name: `Destination ${number}`, lat: origin.lat + number * 0.002, lng: origin.lng },
  ...extra,
});
const ids = snapshot => [...snapshot.entries.map(entry => entry.suggestion.id)];

test('collection grows across new sets and map opens clear only the unread badge', () => {
  const collection = createSessionMapCollection();
  assert.equal(collection.snapshot().entries.length, 0);
  let snapshot = collection.add([activity('first'), activity('second')]);
  assert.deepEqual(ids(snapshot), ['first', 'second']);
  assert.equal(snapshot.unreadCount, 2);
  assert.ok(snapshot.entries.every(entry => Number.isFinite(entry.addedAt)));
  snapshot = collection.markRead();
  assert.equal(snapshot.unreadCount, 0);
  assert.equal(snapshot.entries.length, 2);
  snapshot = collection.add([activity('third')]);
  assert.deepEqual(ids(snapshot), ['first', 'second', 'third']);
  assert.equal(snapshot.unreadCount, 1);
  assert.equal(snapshot.entries[0].unread, false);
});

test('ads and map wrappers never become collected activities', () => {
  const collection = createSessionMapCollection();
  const wrapper = activity('map_wrapper', 'Map', {
    mapDiscovery: { origin: { latitude: 52.52, longitude: 13.405 }, activities: [] },
  });
  const snapshot = collection.add([activity('ad', 'An ad', { source: 'ad' }), wrapper, activity('real')]);
  assert.deepEqual(ids(snapshot), ['real']);
  assert.equal(snapshot.unreadCount, 1);
  assert.equal(collection.setSaved(wrapper).entries.length, 1);
});

test('regenerated content aliases cannot produce another entry or another unread badge', () => {
  const collection = createSessionMapCollection();
  collection.add([activity('first', '☕ Café break — 10 min!')]);
  collection.markRead();
  const copy = activity('copy', 'CAFE BREAK, 20 minutes');
  const snapshot = collection.add([copy, copy]);
  assert.deepEqual(ids(snapshot), ['first']);
  assert.equal(snapshot.unreadCount, 0);
  // A known provider ID continues to resolve even after its presentation changes.
  assert.equal(collection.remove({ ...copy, title: 'Updated display title' }).entries.length, 0);
});

test('saving a skipped activity preserves its entry, position and read status', () => {
  const collection = createSessionMapCollection();
  const first = activity('first', 'Read a chapter');
  const initial = collection.add([first, activity('second')]);
  collection.markRead();
  let snapshot = collection.setSaved({ ...first, id: 'regenerated' });
  assert.deepEqual(ids(snapshot), ['first', 'second']);
  assert.equal(snapshot.entries[0].saved, true);
  assert.equal(snapshot.entries[0].addedAt, initial.entries[0].addedAt);
  assert.equal(snapshot.unreadCount, 0);
  snapshot = collection.add([first], { saved: false });
  assert.equal(snapshot.entries[0].saved, true);
  snapshot = collection.setSaved(activity('newly-hearted'));
  assert.equal(snapshot.entries[2].saved, true);
  assert.equal(snapshot.entries[2].unread, true);
  assert.equal(snapshot.unreadCount, 1);
});

test('coordinate and content aliases identify the same venue despite address formatting', () => {
  const collection = createSessionMapCollection();
  const first = place(1, { title: 'Coffee break', place: { name: 'Cafe Alpha', address: 'One Street 1', lat: 52.5, lng: 13.4 } });
  const copy = { ...first, id: 'google_place1', place: { ...first.place, address: 'One St. 1' } };
  collection.add([first, copy]);
  assert.equal(collection.snapshot().entries.length, 1);
  assert.equal(collection.remove(copy).entries.length, 0);
});

test('separate venues and separate event times remain separate collected activities', () => {
  const collection = createSessionMapCollection();
  const event = (id, startAt) => activity(id, 'Live jazz', {
    source: 'ticketmaster', type: 'EVENT', event: { venue: 'Hall', startAt, ticketUrl: 'https://example.test' },
  });
  const snapshot = collection.add([
    place(1, { title: 'Coffee break' }), place(2, { title: 'Coffee break' }),
    event('tm_first', '2026-09-25T18:00:00Z'), event('tm_second', '2026-09-26T18:00:00Z'),
  ]);
  assert.equal(snapshot.entries.length, 4);
});

test('a bridging alias merges prior entries without losing saved status or aliases', () => {
  const collection = createSessionMapCollection();
  collection.add([activity('first', 'Read a chapter')]);
  collection.add([activity('second', 'Read outdoors')], { saved: true });
  collection.markRead();
  const snapshot = collection.add([activity('first', 'Read outdoors')]);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].saved, true);
  assert.equal(snapshot.unreadCount, 0);
  assert.equal(collection.remove(activity('second', 'Different title')).entries.length, 0);
});

test('input edits and snapshot edits cannot mutate collection state', () => {
  const collection = createSessionMapCollection();
  const card = place(1, { steps: [{ label: 'Walk there', minutes: 10 }], tags: ['nature'], meta: { etaMin: 10 } });
  const initial = collection.add([card]);
  card.title = 'Changed input';
  card.place.name = 'Changed input venue';
  card.steps[0].label = 'Changed input step';
  initial.entries[0].saved = true;
  initial.entries[0].suggestion.meta.etaMin = 999;
  initial.entries[0].suggestion.tags.push('fitness');
  initial.entries.pop();
  const snapshot = collection.snapshot();
  assert.equal(snapshot.entries[0].suggestion.title, 'Place activity 1');
  assert.equal(snapshot.entries[0].suggestion.place.name, 'Destination 1');
  assert.equal(snapshot.entries[0].suggestion.steps[0].label, 'Walk there');
  assert.equal(snapshot.entries[0].suggestion.meta.etaMin, 10);
  assert.equal(snapshot.entries[0].suggestion.tags.length, 1);
  assert.equal(snapshot.entries[0].saved, false);
});

test('reset empties activities, badges and old aliases for the next swiping session', () => {
  const collection = createSessionMapCollection();
  const card = activity('first');
  collection.setSaved(card);
  const prior = collection.snapshot();
  const snapshot = collection.reset();
  assert.equal(snapshot.entries.length, 0);
  assert.equal(snapshot.unreadCount, 0);
  assert.equal(prior.entries.length, 1);
  const next = collection.add([card]);
  assert.equal(next.unreadCount, 1);
  assert.equal(next.entries[0].saved, false);
});

test('every reliable destination can become a pin, including co-located and long activities', () => {
  const collection = createSessionMapCollection();
  const cards = Array.from({ length: 12 }, (_, index) => place(index + 1));
  cards.push(place(50, { durationMin: 900, place: { ...cards[0].place, name: 'Another business in this building' } }));
  const snapshot = collection.add(cards);
  const options = getSessionMapOptions(snapshot.entries, origin, urban);
  assert.equal(options.length, 13);
  assert.deepEqual([...options.map(option => option.suggestion.id)], cards.map(card => card.id));
  assert.equal(options[0].coordinate.latitude, options[12].coordinate.latitude);
  assert.ok(options.every(option => Number.isFinite(option.travelMin) && option.travelMin > 0));
});

test('home, generated coordinates and unsupported providers stay list-only without fake map pins', () => {
  const collection = createSessionMapCollection();
  const cards = [
    place(1, { type: 'AT_HOME' }), place(2, { id: 'gemini_2', source: 'gemini' }),
    place(3, { id: 'biz_seed_3', source: 'business' }), place(4, { id: 'community_4', source: 'community' }),
    place(5, { place: { name: 'No coordinates' } }), place(6, { place: { name: 'Bad coordinates', lat: Infinity, lng: 13.4 } }),
    place(7),
  ];
  const snapshot = collection.add(cards);
  const options = getSessionMapOptions(snapshot.entries, origin, { ...urban, homeBase: { lat: 52.5, lng: 13.4 } });
  assert.equal(snapshot.entries.length, 7);
  assert.deepEqual([...options.map(option => option.suggestion.id)], ['osm_7']);
  assert.equal(collection.snapshot().entries.length, 7);
});

test('missing location and all-home sessions remain usable without any network calls', () => {
  const collection = createSessionMapCollection();
  collection.add([activity('home')]);
  assert.equal(getSessionMapOptions(collection.snapshot().entries, origin, urban).length, 0);
  collection.add([place(1)]);
  for (const location of [undefined, null, { ...origin, lat: null }, { ...origin, lat: NaN }, { ...origin, lng: 200 }]) {
    assert.equal(getSessionMapOptions(collection.snapshot().entries, location, urban).length, 0);
  }
  assert.equal(collection.snapshot().entries.length, 2);
});

test('pins use walking, transit and car estimates without changing saved card data', () => {
  const collection = createSessionMapCollection();
  const cards = [
    place(1),
    place(2, { place: { name: 'Urban destination', lat: origin.lat + 0.036, lng: origin.lng } }),
    place(3, { place: { name: 'Distant destination', lat: origin.lat + 0.18, lng: origin.lng } }),
  ];
  const snapshot = collection.add(cards);
  const options = getSessionMapOptions(snapshot.entries, origin, urban);
  assert.deepEqual([...options.map(option => option.travelMode)], ['walk', 'transit', 'car']);
  assert.equal(snapshot.entries[0].suggestion.meta, undefined);
  assert.equal(getSessionMapOptions(snapshot.entries, origin, { label: 'suburban' })[1].travelMode, 'car');
});

test('resolved Gemini GO_OUT and EVENT destinations get pins independent of suggestion source', () => {
  const collection = createSessionMapCollection();
  const snapshot = collection.add([
    place(1, { source: 'gemini', id: 'gemini_named', place: { name: 'Verified park', lat: 52.52, lng: 13.4, coordinateSource: 'osm' } }),
    place(2, { source: 'gemini', id: 'gemini_event', type: 'EVENT', place: { name: 'Verified event venue', lat: 52.51, lng: 13.4, coordinateSource: 'geocoded' } }),
    place(3, { source: 'rausgegangen', id: 'city_event', type: 'EVENT', place: { name: 'Source venue', lat: 52.5, lng: 13.4, coordinateSource: 'source' } }),
    place(4, { type: 'AT_HOME', place: { name: 'Home', lat: 52.52, lng: 13.4, coordinateSource: 'osm' } }),
  ]);
  assert.deepEqual([...getSessionMapOptions(snapshot.entries, origin).map(option => option.suggestion.id)], ['gemini_named', 'gemini_event', 'city_event']);
});

test('a later resolved location updates the existing entry without changing saved state or unread count', () => {
  const collection = createSessionMapCollection();
  const card = activity('gemini_1', 'Read outdoors', { type: 'GO_OUT', place: { name: 'Verified park' } });
  const initial = collection.add([card], { saved: true });
  collection.markRead();
  const resolved = { ...card, place: { ...card.place, lat: 52.52, lng: 13.4, coordinateSource: 'osm' } };
  const snapshot = collection.add([resolved]);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].saved, true);
  assert.equal(snapshot.entries[0].addedAt, initial.entries[0].addedAt);
  assert.equal(snapshot.unreadCount, 0);
  assert.equal(getSessionMapOptions(snapshot.entries, origin).length, 1);
});
