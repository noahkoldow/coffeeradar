const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(response = { events: [] }) {
  const calls = [];
  const module = { exports: {} };
  const dependencies = {
    'firebase/functions': { httpsCallable: (_functions, name) => async payload => {
      calls.push({ name, payload });
      if (response instanceof Error) throw response;
      return { data: response };
    } },
    './firebase': { ensureAuth: async () => 'test-user', functions: {} },
    './debug': { addDebugMessage() {} },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/services/cityEvents.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Date, Math, Number, URL,
    require(name) { assert.ok(dependencies[name], name); return dependencies[name]; } });
  return { ...module.exports, calls };
}
const event = {
  id: 'web_workshop_2026', title: 'Art workshop', venue: 'Studio', address: 'Example Street 1, Berlin',
  startAt: '2026-09-27T12:00:00+02:00', endAt: '2026-09-27T14:00:00+02:00',
  sourceUrl: 'https://www.berlin.de/events/art-workshop/', sourceName: 'Berlin.de', priceHint: '0 EUR',
};

test('free sourced events keep a source link without inventing tickets or coordinates', () => {
  const result = fixture().toCityEventSuggestion(event, 'de');
  assert.equal(result.source, 'web');
  assert.equal(result.event.startAt, '2026-09-27T10:00:00.000Z');
  assert.equal(result.event.ticketUrl, '');
  assert.equal(result.event.sourceUrl, event.sourceUrl);
  assert.equal(result.event.sourceName, event.sourceName);
  assert.equal(result.durationMin, 120);
  assert.equal(result.place.lat, undefined);
  assert.equal(result.place.coordinateSource, undefined);
  assert.equal(result.place.costHint, '0 EUR');
  assert.equal(result.isRepetitionFriendly, false);
  assert.match(result.description, /Veranstaltungsdetails/);
});

test('events from city sites, venues and event platforms all retain their individual source', () => {
  const { toCityEventSuggestion: convert } = fixture();
  for (const [sourceUrl, sourceName] of [
    ['https://www.berlin.de/events/art-workshop/', 'Berlin.de'],
    ['https://rausgegangen.de/events/art-workshop/', 'Rausgegangen'],
    ['https://www.hkw.de/programme/workshop?date=2026-09-27', 'HKW'],
    ['https://www.visitberlin.de/de/veranstaltung/stadtfuehrung', 'visitBerlin'],
  ]) {
    const result = convert({ ...event, sourceUrl, sourceName }, 'de');
    assert.equal(result.source, 'web');
    assert.equal(result.event.sourceUrl, sourceUrl);
    assert.equal(result.event.sourceName, sourceName);
  }
  assert.equal(convert({ ...event, sourceName: '' }, 'de').event.sourceName, 'berlin.de');
});

test('source coordinates and explicit drop-in intervals can support shorter visits', () => {
  const result = fixture().toCityEventSuggestion({ ...event, lat: 52.5, lng: 13.4, attendanceMode: 'drop_in' }, 'en');
  assert.equal(result.place.coordinateSource, 'source');
  assert.equal(result.durationMin, 60);
  assert.equal(result.event.attendanceMode, 'drop_in');
  const noEnd = fixture().toCityEventSuggestion({ ...event, attendanceMode: 'drop_in', endAt: undefined }, 'en');
  assert.equal(noEnd.event.attendanceMode, 'fixed');
});

test('invalid source pages, times and locations never become fabricated events or pins', () => {
  const { toCityEventSuggestion: convert } = fixture();
  for (const patch of [
    { title: '' }, { venue: '' }, { startAt: 'bad' }, { endAt: '2026-09-26T14:00:00Z' },
    { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'http://www.berlin.de/event' },
    { sourceUrl: 'https://user:password@www.berlin.de/event' },
    { sourceUrl: 'https://localhost/event' }, { sourceUrl: 'https://events.local/event' },
    { sourceUrl: 'https://127.0.0.1/event' }, { sourceUrl: 'https://2130706433/event' },
    { sourceUrl: 'https://[::1]/event' }, { sourceUrl: 'https://10.0.0.1/event' },
    { sourceUrl: 'https://berlin.de:8443/event' }, { sourceUrl: 'https://berlin.de/has a space' },
  ]) assert.equal(convert({ ...event, ...patch }, 'de'), null);
  assert.equal(convert({ ...event, lat: 999, lng: 13.4 }, 'de').place.coordinateSource, undefined);
});

test('public-source requests use bounded categories, dates and city context, never private free text', async () => {
  const location = { lat: 52.5, lng: 13.4, areaLabel: 'Berlin', timeZone: 'Europe/Berlin' };
  const prefs = { openToGoingOut: true, language: 'en', selfDescription: 'private profile',
    customInterests: ['private interest'], interestTags: ['music', 'art', 'music', 'private interest'] };
  const availability = { start: event.startAt, end: event.endAt, discoveryMode: 'plan_ahead',
    contextEventTitles: ['private appointment'], nextEventTitle: 'private next meeting' };
  const f = fixture({ events: [event] });
  assert.equal((await f.fetchCityEventSuggestions(location, prefs, availability)).length, 1);
  assert.equal(f.calls[0].name, 'discoverCityEvents');
  assert.deepEqual(Object.keys(f.calls[0].payload).sort(),
    ['areaLabel', 'discoveryMode', 'end', 'interests', 'language', 'lat', 'lng', 'start', 'timeZone']);
  assert.deepEqual(Array.from(f.calls[0].payload.interests), ['music', 'art']);
  assert.equal(f.calls[0].payload.discoveryMode, 'plan_ahead');
  assert.equal(f.calls[0].payload.language, 'en');
  assert.equal(f.calls[0].payload.timeZone, 'Europe/Berlin');
  assert.ok(!JSON.stringify(f.calls[0].payload).includes('private'));
  assert.equal((await f.fetchCityEventSuggestions(location, { ...prefs, openToGoingOut: false }, availability)).length, 0);
  assert.equal(f.calls.length, 1);
  const failed = fixture(new Error('source down'));
  assert.equal((await failed.fetchCityEventSuggestions(location, prefs, availability)).length, 0);
});

test('source search caps category sharing and supports minimal or older preferences', async () => {
  const f = fixture();
  const tags = ['music', 'art', 'learning', 'nature', 'running', 'hiking', 'swimming', 'cycling', 'coffee', 'food'];
  const location = { lat: 52.5, lng: 13.4, areaLabel: 'Berlin' };
  const availability = { start: event.startAt, end: event.endAt };
  await f.fetchCityEventSuggestions(location, { openToGoingOut: true, interestTags: tags }, availability);
  assert.deepEqual(Array.from(f.calls[0].payload.interests), tags.slice(0, 8));
  await f.fetchCityEventSuggestions(location, { openToGoingOut: true }, availability);
  assert.equal(f.calls[1].payload.interests.length, 0);
  assert.equal(f.calls[1].payload.timeZone, undefined);
});

test('source badges show the website name or domain and support existing saved cards', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/SuggestionCard.tsx'), 'utf8');
  const tree = ts.createSourceFile('SuggestionCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'getSourceBadge') initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(`exports.badge = (${initializer.getText(tree)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL });
  assert.equal(exports.badge('web', { sourceName: 'HKW', sourceUrl: 'https://www.hkw.de/event' }).label, 'HKW');
  assert.equal(exports.badge('web', { sourceUrl: 'https://www.berlin.de/event' }).label, 'berlin.de');
  assert.equal(exports.badge('rausgegangen').label, 'Rausgegangen');
  assert.equal(exports.badge('ticketmaster').label, 'Ticketmaster');
});
