const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, dependencies = {}, globals = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Date, Math, Set, Map,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, ...globals }, { filename });
  return module.exports;
}

const timing = load('src/services/discoveryTiming.ts');
const now = new Date('2026-09-26T19:00:00Z');
const availability = { start: '2026-09-27T07:00:00Z', end: '2026-09-27T19:00:00Z', durationMin: 720, discoveryMode: 'plan_ahead' };
const event = (overrides = {}) => ({ type: 'EVENT', durationMin: 60, meta: { etaMin: 25 },
  event: { startAt: '2026-09-27T09:00:00Z', sourceUrl: 'https://example.test/race', attendanceMode: 'fixed' }, ...overrides });

test('planning uses the selected time and city radius, while now keeps the nearby radius', () => {
  assert.equal(timing.discoveryReferenceTime(availability, now).getTime(), Date.parse(availability.start));
  assert.equal(timing.isPlanningAhead(availability, now), true);
  assert.ok(timing.eventSearchRadiusKm({ radiusKm: 2 }, availability) > 15);
  assert.equal(timing.eventSearchRadiusKm({ radiusKm: 2 }, { ...availability, discoveryMode: 'now' }), 2);
  assert.equal(timing.eventSearchRadiusKm({ radiusKm: 50 }, availability), 35);
});

test('fixed events retain published times and must include outward and return travel', () => {
  const visit = timing.eventVisitWindow(event(), availability, now);
  assert.equal(visit.start.toISOString(), '2026-09-27T09:00:00.000Z');
  assert.equal(visit.departure.toISOString(), '2026-09-27T08:25:00.000Z');
  assert.equal(timing.eventVisitWindow(event(), { ...availability, start: '2026-09-27T09:10:00Z' }, now), null);
  assert.equal(timing.eventVisitWindow(event(), { ...availability, end: '2026-09-27T10:10:00Z' }, now), null);
  assert.ok(timing.eventVisitWindow(event(), { ...availability, end: '2026-09-27T10:25:00Z' }, now));
});

test('drop-in visits can join a running event only within its published end time', () => {
  const race = event({ event: { startAt: '2026-09-27T06:00:00Z', endAt: '2026-09-27T12:00:00Z', attendanceMode: 'drop_in' } });
  const visit = timing.eventVisitWindow(race, availability, now);
  assert.equal(visit.start.toISOString(), '2026-09-27T07:35:00.000Z');
  assert.equal(visit.end.toISOString(), '2026-09-27T08:35:00.000Z');
  assert.equal(timing.eventVisitWindow({ ...race, event: { ...race.event, endAt: '2026-09-27T08:00:00Z' } }, availability, now), null);
  assert.equal(timing.eventVisitWindow({ ...race, event: { ...race.event, endAt: undefined } }, availability, now), null);
});

test('Ticketmaster queries the selected window instead of filling tomorrow with today events', async () => {
  let requested;
  const futureStart = new Date(Date.now() + 24 * 60 * 60000);
  const window = { start: futureStart.toISOString(), end: new Date(+futureStart + 8 * 60 * 60000).toISOString(),
    durationMin: 480, discoveryMode: 'plan_ahead' };
  const service = load('src/services/ticketmaster.ts', {
    '../utils/time': { fromISO: value => new Date(value), addMinutes: (date, minutes) => new Date(+date + minutes * 60000) },
    './debug': { addDebugMessage() {} }, './discoveryTiming': timing,
  }, { process: { env: { EXPO_PUBLIC_TICKETMASTER_KEY: 'test-key' } },
    fetch: async url => { requested = new URL(url); return { ok: true, json: async () => ({}) }; } });
  await service.fetchTicketmasterSuggestions({ lat: 52.5, lng: 13.4 }, { radiusKm: 2, allowSerendipity: true }, window);
  assert.equal(requested.searchParams.get('startDateTime'), window.start.replace(/\.\d{3}Z$/, 'Z'));
  assert.equal(requested.searchParams.get('endDateTime'), window.end.replace(/\.\d{3}Z$/, 'Z'));
  assert.ok(Number(requested.searchParams.get('radius')) > 15);
  assert.equal(requested.searchParams.get('sort'), 'date,asc');
});

function deckHandler(name, context) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/screens/DeckScreen.tsx'), 'utf8');
  const tree = ts.createSourceFile('DeckScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer, name);
  const exports = {};
  const compiled = ts.transpileModule(`exports.handler = (${initializer.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Date, ...context });
  return exports.handler;
}

function schedulingContext(current = event()) {
  const calls = { alerts: [], clashes: [], pending: [], calendar: [], scheduled: [] };
  return { calls, current, availability,
    eventVisitWindow: (card, window, _now, preferred) => timing.eventVisitWindow(card, window, now, preferred),
    addMinutes: (date, minutes) => new Date(+date + minutes * 60000),
    formatTime: date => date.toISOString(), t: key => key,
    Alert: { alert: (...args) => calls.alerts.push(args) },
    state: { scheduledActivities: [], permissions: { calendarGranted: true }, disabledCalendars: [] },
    setClashInfo: info => calls.clashes.push(info), setPendingScheduleStart: date => calls.pending.push(date),
    getUpcomingEvents: async (start, end) => { calls.calendar.push([start, end]); return []; },
    doScheduleLater: async start => calls.scheduled.push(start),
  };
}

test('scheduling a fixed event checks its actual time and travel, even when a different later time was tapped', async () => {
  const context = schedulingContext();
  await deckHandler('checkClashAndSchedule', context)(new Date('2026-09-27T17:00:00Z'));
  assert.equal(context.calls.calendar[0][0].toISOString(), '2026-09-27T08:25:00.000Z');
  assert.equal(context.calls.calendar[0][1].toISOString(), '2026-09-27T10:25:00.000Z');
  assert.equal(context.calls.scheduled[0].toISOString(), '2026-09-27T09:00:00.000Z');

  context.state.scheduledActivities = [{ title: 'Existing plan', startAt: '2026-09-27T09:30:00Z', endAt: '2026-09-27T10:00:00Z' }];
  await deckHandler('checkClashAndSchedule', context)(new Date('2026-09-27T17:00:00Z'));
  assert.equal(context.calls.clashes[0].title, 'Existing plan');
  assert.equal(context.calls.pending[0].toISOString(), '2026-09-27T09:00:00.000Z');
  assert.equal(context.calls.scheduled.length, 1, 'a clash cannot silently schedule the event');
});

test('a tomorrow event swipe checks its published visit instead of finding a movable gap', async () => {
  const context = schedulingContext();
  context.planDate = 'tomorrow';
  context.isAdCard = () => false;
  context.findBestTomorrowFit = () => { throw new Error('fixed events cannot move into a generic gap'); };
  const checked = [];
  context.checkClashAndSchedule = async start => checked.push(start);
  await deckHandler('handleCommit', context)();
  assert.equal(checked[0].toISOString(), '2026-09-27T09:00:00.000Z');
});

test('a chosen later drop-in visit is preserved by both conflict checking and the visit calculation', async () => {
  const market = event({ event: { startAt: '2026-09-27T06:00:00Z', endAt: '2026-09-27T18:00:00Z', attendanceMode: 'drop_in' } });
  const context = schedulingContext(market);
  const desired = new Date('2026-09-27T14:00:00Z');
  await deckHandler('checkClashAndSchedule', context)(desired);
  assert.equal(context.calls.calendar[0][0].toISOString(), '2026-09-27T13:25:00.000Z');
  assert.equal(context.calls.calendar[0][1].toISOString(), '2026-09-27T15:25:00.000Z');
  assert.equal(context.calls.scheduled[0].toISOString(), desired.toISOString());
  assert.equal(timing.eventVisitWindow(market, availability, now, desired).start.toISOString(), desired.toISOString());
  assert.equal(timing.eventVisitWindow(market, availability, now, new Date('2026-09-27T18:00:00Z')), null);
});
