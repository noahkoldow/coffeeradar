const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const sourceTree = relative => {
  const filename = path.join(root, relative);
  return ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
};
const deckTree = sourceTree('src/screens/DeckScreen.tsx');
const swipeTree = sourceTree('src/components/SwipeDeck.tsx');
function findAll(tree, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(tree);
  return found;
}
function only(matches, label) { assert.equal(matches.length, 1, `Expected one ${label}`); return matches[0]; }
const component = only(findAll(deckTree, node => ts.isVariableDeclaration(node)
  && node.name.getText(deckTree) === 'DeckScreen'), 'DeckScreen').initializer;
function initializer(name, tree = deckTree) {
  const candidates = findAll(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);
  return only(tree === deckTree ? candidates.filter(node => node.parent.parent.parent === component.body) : candidates, name).initializer;
}
function expression(name, tree = deckTree) {
  const node = initializer(name, tree);
  return ts.isCallExpression(node) && ['useCallback', 'useMemo'].includes(node.expression.getText(tree))
    ? (node.expression.getText(tree) === 'useMemo' ? `(${node.arguments[0].getText(tree)})()` : node.arguments[0].getText(tree))
    : node.getText(tree);
}
function evaluate(source, context) {
  vm.runInContext(compile(`exports.value = (${source});`), context);
  return context.exports.value;
}
function loadSource(relative, dependencies = {}) {
  const filename = path.join(root, relative);
  const module = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(filename, 'utf8')), {
    module, exports: module.exports, Date, Math, Map, Set,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith('.')) return loadSource(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)), dependencies);
      throw new Error(`Unexpected runtime dependency ${name}`);
    },
  }, { filename });
  return module.exports;
}
const identity = loadSource('src/services/suggestionIdentity.ts');
const session = loadSource('src/services/sessionMap.ts');
const travel = loadSource('src/services/travel.ts');
const repetition = loadSource('src/services/activityRepetitionService.ts', { './debug': { addDebugMessage() {} } });
const origin = { lat: 52.52, lng: 13.405 };
const activity = (id, extra = {}) => ({ id, title: `Activity ${id}`, description: 'A local activity.',
  type: 'AT_HOME', source: 'gemini', durationMin: 20, confidence: 0.8, tags: [], ...extra });
const place = number => activity(`osm_${number}`, { source: 'curated', type: 'GO_OUT',
  place: { name: `Place ${number}`, lat: origin.lat + number * 0.001, lng: origin.lng } });
const deckResult = (offset = 0) => ({
  deck: Array.from({ length: 5 }, (_, index) => activity(`home_${offset + index}`)), usedFallback: false,
  mapCandidates: Array.from({ length: 4 }, (_, index) => place(offset + index + 1)),
});
const ids = items => Array.from(items, item => item.id);
const collected = f => ids(f.context.sessionMap.entries.map(entry => entry.suggestion));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the real screen callbacks against real identity/collection services.
// Native animation/network/calendar effects are controlled at their boundary.
function fixture(overrides = {}) {
  const ledger = identity.createSessionSuggestionLedger('alice');
  const collection = session.createSessionMapCollection();
  const calls = { reservations: [], histories: [], events: [], navigation: [], saves: [], schedule: [],
    writes: [], swipes: 0, animations: [], alerts: [], listeners: new Map(), timers: new Map() };
  const context = vm.createContext({
    exports: {}, Date, Math, Map, Set, console: { log() {}, warn() {} },
    deck: [], index: 0, selectedMapActivityId: null, sessionMapOpen: false, sessionMap: collection.snapshot(),
    sessionMapRef: { current: collection }, sessionEpochRef: { current: 0 },
    loading: true, confirming: false, planDate: 'today', activityMode: 'all', isGerman: false,
    route: { params: {} }, isAdmin: false, controlsDisabled: false, DESIRED_SIZE: 5,
    state: { userId: 'alice', prefs: { openToGoingOut: true }, location: origin, locationProfile: { label: 'urban' },
      history: { lastShownIds: [], lastRejectedIds: [], lastAcceptedIds: [], lastShownDates: {} },
      permissions: { calendarGranted: false }, tagAffinities: {} },
    availability: { durationMin: 120 },
    loadingRef: { current: true }, didLoadDeck: { current: false }, deckRequestRef: { current: 0 },
    swipeLockRef: { current: false }, newSetBusyRef: { current: false }, commitWatchdogRef: { current: null },
    videoAdResolveRef: { current: null }, deckPresentCountRef: { current: 0 },
    adsFreeUser: true, newSetCount: 0, adKeywords: [], heartAnimIds: new Set(), savedPopupVisible: false,
    gridUsed: false, inspectedGridCard: null, declinedGridCardIds: new Set(),
    AD_RULES: { nativeEveryNthDeck: 2, nativeSlotMin: 2, nativeSlotMax: 5, videoEveryNthNewSet: 2 },
    filterUnseenSuggestions: identity.filterUnseenSuggestions,
    getSessionMapOptions: session.getSessionMapOptions,
    recordActivityShown: repetition.recordActivityShown, recordActivityCompleted: repetition.recordActivityCompleted,
    shouldSuggestHabitConversion: () => false,
    logEvent: async (...args) => { calls.events.push(args); }, syncBusinessMetric() {},
    t: value => value, Alert: { alert: (...args) => calls.alerts.push(args) },
    decayAffinities: value => value, recordReject: value => value, recordAccept: value => value,
    recordInterested: value => value, recordTypeAccept: value => value, recordTypeReject: value => value,
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
    withTimeout: promise => promise, triggerRipple() {},
    setTimeout(fn) { const id = calls.timers.size + 1; calls.timers.set(id, fn); return id; },
    clearTimeout(id) { calls.timers.delete(id); },
    addMinutes: (date, minutes) => new Date(date.getTime() + minutes * 60000),
    formatTime: date => date.toISOString(), ...travel,
    createPlanEvent: async () => { assert.fail('Calendar permission is off'); },
    setConfettiEmojis() {}, setSchedulePreview() {}, playSchedulePreview: async () => {},
    consumeVideoAd: () => null, preloadVideoAd() {}, setVideoAd() {},
    savedPopupAnim: { setValue() {} }, Animated: { spring() {}, timing() {}, sequence() {
      return { start(callback) { calls.animations.push(callback); } };
    } },
    ...overrides,
  });
  context.historyRef = { current: context.state.history };
  for (const [setter, key] of Object.entries({ setDeck: 'deck', setIndex: 'index', setSelectedMapActivityId: 'selectedMapActivityId',
    setSessionMap: 'sessionMap', setSessionMapOpen: 'sessionMapOpen', setLoading: 'loading', setFallbackUsed: 'fallbackUsed',
    setConfirming: 'confirming', setNewSetCount: 'newSetCount', setHeartAnimIds: 'heartAnimIds',
    setSavedPopupVisible: 'savedPopupVisible', setInspectedGridCard: 'inspectedGridCard', setGridUsed: 'gridUsed',
    setDeclinedGridCardIds: 'declinedGridCardIds' })) {
    context[setter] = value => { calls.writes.push(key); context[key] = typeof value === 'function' ? value(context[key]) : value; };
  }
  context.navigation = { canGoBack: () => true,
    navigate: (...args) => calls.navigation.push(args), replace: (...args) => calls.navigation.push(args),
    goBack: () => calls.navigation.push(['goBack']), reset: (...args) => calls.navigation.push(['reset', ...args]),
    addListener(name, callback) { calls.listeners.set(name, callback); return () => calls.listeners.delete(name); },
  };
  context.actions = {
    filterUnseenSuggestions: items => ledger.filter(items),
    reserveDeckSuggestions(items) { const fresh = ledger.reserve(items); calls.reservations.push(fresh); return fresh; },
    spendSwipe() { calls.swipes++; return true; },
    setHistory(history) { context.state.history = history; calls.histories.push(history); },
    setTagAffinities() {}, saveSuggestion: item => calls.saves.push(item),
    addScheduledActivity: item => calls.schedule.push(item), consumeDeck: () => null,
  };
  for (const name of ['collectSessionActivities', 'resetSessionMap', 'recordShown', 'filterDeck', 'injectAdsIntoDeck',
    'isAdCard', 'applyDeck', 'buildNotes', 'saveCurrentSuggestion', 'handleSwipeLeft', 'handleSaveQuick',
    'commitSuggestion', 'handleCommit', 'rebuildDeck', 'handleNewSet', 'toggleSessionMap', 'selectSessionMapActivity',
    'goBack', 'declineInspectedCard', 'saveInspectedSuggestion', 'acceptInspectedCard']) {
    context[name] = evaluate(expression(name), context);
  }
  const resetLock = only(findAll(deckTree, node => ts.isCallExpression(node)
    && node.expression.getText(deckTree) === 'useEffect'
    && node.arguments[1]?.getText(deckTree) === '[index, selectedMapActivityId, sessionMapOpen]'), 'selection lock effect');
  const reset = evaluate(resetLock.arguments[0].getText(deckTree), context);
  const unmountEffect = only(findAll(deckTree, node => ts.isCallExpression(node)
    && node.expression.getText(deckTree) === 'useEffect'
    && node.arguments[0]?.getText(deckTree).includes('deckRequestRef.current += 1;')
    && node.arguments[0]?.getText(deckTree).includes('commitWatchdogRef.current')), 'deck unmount cleanup');
  const cleanup = evaluate(unmountEffect.arguments[0].getText(deckTree), context)();
  let previousSelection;
  const render = () => {
    for (const name of ['rawCurrent', 'sessionMapOptions', 'selectedMapEntry', 'selectedMapOption',
      'selectedMapSuggestion', 'current', 'next', 'mapOverviewVisible']) context[name] = evaluate(expression(name), context);
    const nextSelection = [context.index, context.selectedMapActivityId, context.sessionMapOpen];
    if (!previousSelection || nextSelection.some((value, index) => !Object.is(value, previousSelection[index]))) reset();
    previousSelection = nextSelection;
    return context.current;
  };
  const open = () => { context.toggleSessionMap(); return render(); };
  const select = id => { context.selectSessionMapActivity(id); return render(); };
  render();
  return { context, calls, ledger, collection, render, open, select, unmount: cleanup };
}

function effectRunner(context, predicate, label) {
  const node = only(findAll(deckTree, candidate => ts.isCallExpression(candidate)
    && candidate.expression.getText(deckTree) === 'useEffect'
    && predicate(candidate.arguments[0].getText(deckTree), candidate)), label);
  const script = new vm.Script(compile(node.getText(deckTree)));
  let previous, cleanup;
  return {
    render() {
      context.useEffect = (callback, dependencies) => {
        if (previous && dependencies.length === previous.length
          && dependencies.every((value, index) => Object.is(value, previous[index]))) return;
        cleanup?.(); previous = Array.from(dependencies); cleanup = callback();
      };
      script.runInContext(context);
    },
    unmount() { cleanup?.(); },
  };
}

test('ordinary sets stay five activities; candidate pools never create a periodic map or enter its collection', () => {
  const f = fixture();
  const result = deckResult();
  f.context.applyDeck(result, true);
  const cards = f.context.deck.filter(card => card.source !== 'ad');
  assert.deepEqual(ids(cards), ids(result.deck));
  assert.equal(cards.some(card => card.mapDiscovery), false);
  assert.deepEqual(ids(f.calls.reservations[0]), ids(result.deck));
  assert.equal(f.context.sessionMap.entries.length, 0);
  assert.equal(f.ledger.filter(result.mapCandidates).length, 4);
  assert.doesNotMatch(expression('applyDeck'), /shouldIncludeMapCard|groupMapActivities|selectMapActivities|Math\.random/);
});

test('passing a normal activity collects it once and revisiting it neither spends nor rejects again', () => {
  const f = fixture();
  f.context.applyDeck(deckResult(), false); f.render();
  const first = f.context.current;
  f.context.handleSwipeLeft(); f.render();
  assert.deepEqual(collected(f), [first.id]);
  assert.equal(f.context.sessionMap.unreadCount, 1);
  assert.equal(f.calls.swipes, 1);
  const position = f.context.index;
  const returnCardId = f.context.current.id;
  const historyCount = f.calls.histories.length;
  const eventCount = f.calls.events.length;
  f.open();
  assert.equal(f.context.sessionMap.unreadCount, 0);
  assert.equal(f.context.sessionMap.entries.length, 1);
  assert.equal(f.select(first.id).id, first.id);
  f.context.handleSwipeLeft(); f.render();
  assert.equal(f.context.mapOverviewVisible, true);
  assert.equal(f.context.index, position);
  assert.equal(f.calls.swipes, 1);
  assert.equal(f.calls.histories.length, historyCount);
  assert.equal(f.calls.events.length, eventCount);
  assert.equal(f.context.sessionMap.entries.length, 1);
  f.open();
  assert.equal(f.context.sessionMapOpen, false);
  assert.equal(f.context.index, position);
  assert.equal(f.context.current.id, returnCardId);
});

test('ads and unsuccessful paid swipes never enter the map collection', () => {
  const f = fixture();
  f.context.deck = [activity('advert', { source: 'ad' }), activity('normal')]; f.render();
  f.context.handleSwipeLeft(); f.render();
  assert.equal(f.calls.swipes, 0);
  assert.equal(f.context.sessionMap.entries.length, 0);
  f.context.actions.spendSwipe = () => false;
  f.context.handleSwipeLeft();
  assert.equal(f.context.index, 1);
  assert.equal(f.context.sessionMap.entries.length, 0);
  assert.equal(f.calls.alerts.length, 1);
});

test('quick heart collects as saved and advances only the deck that was hearted', () => {
  const f = fixture();
  f.context.deck = [activity('first'), activity('second')]; f.render();
  f.context.handleSaveQuick();
  assert.deepEqual(collected(f), ['first']);
  assert.equal(f.context.sessionMap.entries[0].saved, true);
  assert.equal(f.context.sessionMap.unreadCount, 1);
  assert.equal(f.calls.saves.length, 1);
  assert.equal(f.context.index, 0);
  f.calls.animations[0](); f.render();
  assert.equal(f.context.index, 1);
  f.open(); f.select('first');
  f.context.handleSaveQuick(); f.render();
  assert.equal(f.calls.saves.length, 1, 'Already saved activity does not create a second library entry');
  assert.equal(f.context.mapOverviewVisible, true);
  assert.equal(f.context.index, 1);
});

test('hearting a revisited skipped activity updates saved status without advancing its original deck', () => {
  const f = fixture();
  f.context.deck = [activity('current')];
  f.context.collectSessionActivities([activity('skipped')]);
  f.open(); f.select('skipped');
  f.context.handleSaveQuick();
  assert.equal(f.context.sessionMap.entries[0].saved, true);
  assert.equal(f.context.sessionMap.unreadCount, 0);
  f.calls.animations[0](); f.render();
  assert.equal(f.context.index, 0);
  assert.equal(f.context.mapOverviewVisible, true);
  assert.equal(f.calls.swipes, 0);
});

test('New set archives only the presented remaining activities and preserves earlier saved flags', async () => {
  const f = fixture({ adsFreeUser: false });
  const pending = deferred();
  f.context.deck = [activity('already-passed'), activity('hearted'), activity('current'), activity('ad', { source: 'ad' }), activity('remaining')];
  f.context.index = 2;
  f.context.collectSessionActivities([f.context.deck[0]]);
  f.context.collectSessionActivities([f.context.deck[1]], true);
  f.context.state.preloadedDeck = deckResult(100);
  f.context.buildFilteredDeck = () => pending.promise;
  f.render();
  const next = f.context.handleNewSet();
  assert.deepEqual(collected(f), ['already-passed', 'hearted', 'current', 'remaining']);
  assert.equal(f.context.sessionMap.entries[1].saved, true);
  assert.equal(f.context.sessionMap.entries.some(entry => entry.suggestion.id === 'home_100'), false);
  pending.resolve(deckResult(20)); await next; f.render();
  assert.deepEqual(collected(f), ['already-passed', 'hearted', 'current', 'remaining']);
  assert.equal(f.context.current.id, 'home_20');
});

test('rapid New set presses share one build and cannot duplicate collection badges', async () => {
  const f = fixture({ adsFreeUser: false });
  const pending = deferred(); let builds = 0;
  f.context.deck = [activity('current')]; f.render();
  f.context.buildFilteredDeck = () => { builds++; return pending.promise; };
  const first = f.context.handleNewSet(); await f.context.handleNewSet();
  assert.equal(builds, 1); assert.equal(f.context.newSetCount, 1);
  assert.equal(f.context.sessionMap.unreadCount, 1);
  pending.resolve(deckResult()); await first;
  assert.equal(f.context.newSetBusyRef.current, false);
});

test('a chosen map destination commits the real activity, keeps travel mode and ends the session', async () => {
  const f = fixture();
  f.context.deck = [activity('still-current')];
  f.context.collectSessionActivities([place(1), activity('another')]);
  f.open(); const selected = f.select('osm_1');
  await f.context.handleCommit();
  assert.equal(f.calls.navigation.length, 1);
  const [screen, payload] = f.calls.navigation[0];
  assert.equal(screen, 'Plan');
  assert.equal(payload.suggestion, selected);
  assert.equal(payload.suggestion.meta.travelMode, 'walk');
  assert.equal(f.context.index, 0);
  assert.equal(f.context.sessionMap.entries.length, 0);
  assert.equal(f.context.sessionMapOpen, false);
  assert.equal(f.collection.snapshot().entries.length, 0);
});

test('scheduling a collected activity removes only that activity and keeps the session active', async () => {
  const f = fixture();
  f.context.collectSessionActivities([activity('pick'), activity('keep')]);
  f.open(); f.select('pick');
  await f.context.commitSuggestion('later', new Date(Date.now() + 3600000)); f.render();
  assert.equal(f.calls.schedule.length, 1);
  assert.equal(f.calls.schedule[0].suggestion.id, 'pick');
  assert.deepEqual(collected(f), ['keep']);
  assert.equal(f.context.mapOverviewVisible, true);
  assert.equal(f.calls.navigation.length, 0);
});

test('the overview and unavailable activity IDs cannot commit, save or select a phantom card', async () => {
  const f = fixture();
  f.context.collectSessionActivities([activity('kept')]);
  f.open(); f.select('unknown');
  assert.equal(f.context.selectedMapActivityId, null);
  assert.equal(f.context.current, null);
  await f.context.handleCommit(); f.context.handleSaveQuick();
  assert.equal(f.calls.swipes, 0); assert.equal(f.calls.saves.length, 0); assert.equal(f.calls.navigation.length, 0);
});

test('Home exit, account change and navigator removal clear the collection; Bank and Settings preserve it', () => {
  for (const exit of ['back', 'account', 'beforeRemove', 'unmount']) {
    const f = fixture();
    const account = effectRunner(f.context, (_source, node) => node.arguments[1]?.getText(deckTree) === '[state.userId, resetSessionMap]', 'account reset');
    const remove = effectRunner(f.context, source => source.includes("navigation.addListener('beforeRemove'"), 'navigation removal');
    account.render(); remove.render();
    f.context.collectSessionActivities([activity('one')]);
    f.context.navigation.navigate('Bank'); f.context.navigation.navigate('Settings', { fromRefine: true });
    assert.equal(f.collection.snapshot().entries.length, 1, exit);
    const epoch = f.context.sessionEpochRef.current;
    if (exit === 'back') f.context.goBack();
    if (exit === 'account') { f.context.state.userId = 'bob'; account.render(); }
    if (exit === 'beforeRemove') f.calls.listeners.get('beforeRemove')();
    if (exit === 'unmount') f.unmount();
    assert.equal(f.collection.snapshot().entries.length, 0, exit);
    assert.ok(f.context.sessionEpochRef.current > epoch, exit);
  }
});

test('a late heart animation cannot advance or reopen the next session', () => {
  const f = fixture();
  f.context.deck = [activity('first')]; f.render(); f.context.handleSaveQuick();
  f.context.resetSessionMap();
  const writes = f.calls.writes.length;
  f.calls.animations[0]();
  assert.equal(f.calls.writes.length, writes);
  assert.equal(f.context.index, 0);
  assert.equal(f.context.sessionMap.entries.length, 0);
});

test('older rebuilds and late results after unmount cannot replace or reserve the active deck', async () => {
  const f = fixture();
  const first = deferred(), second = deferred(); const queue = [first, second];
  f.context.buildFilteredDeck = () => queue.shift().promise;
  const a = f.context.rebuildDeck(), b = f.context.rebuildDeck();
  second.resolve(deckResult(20)); await b;
  const active = f.context.deck;
  first.resolve(deckResult()); await a;
  assert.equal(f.context.deck, active); assert.equal(f.calls.reservations.length, 1);
  const last = deferred(); f.context.buildFilteredDeck = () => last.promise;
  const after = f.context.rebuildDeck(); f.unmount(); const writes = f.calls.writes.length;
  last.resolve(deckResult(40)); await after;
  assert.equal(f.calls.writes.length, writes); assert.equal(f.context.deck, active);
  assert.equal(f.calls.reservations.length, 1);
});

test('a late commit cannot navigate, save history or repopulate a session after exit', async () => {
  const pending = deferred();
  const f = fixture({ Haptics: { notificationAsync: () => pending.promise, NotificationFeedbackType: { Success: 'success' } } });
  f.context.collectSessionActivities([activity('pick')]); f.open(); f.select('pick');
  const commit = f.context.commitSuggestion('now'); await tick();
  f.context.goBack(); const histories = f.calls.histories.length;
  pending.resolve(); await commit;
  assert.equal(f.calls.navigation.some(([name]) => name === 'Plan'), false);
  assert.equal(f.calls.histories.length, histories);
  assert.equal(f.collection.snapshot().entries.length, 0);
});

test('grid skips, saves and acceptance use the same collection and session boundary', () => {
  const f = fixture();
  f.context.inspectedGridCard = activity('passed-grid'); f.context.declineInspectedCard();
  f.context.saveInspectedSuggestion(activity('hearted-grid'));
  assert.deepEqual(collected(f), ['passed-grid', 'hearted-grid']);
  assert.equal(f.context.sessionMap.entries[1].saved, true);
  f.context.acceptInspectedCard(activity('start-grid'));
  assert.equal(f.collection.snapshot().entries.length, 0);
  assert.equal(f.calls.navigation[0][0], 'Plan');
});

const attribute = (node, name) => node.attributes.properties.find(item =>
  ts.isJsxAttribute(item) && item.name.text === name)?.initializer?.expression;
function jsxContext(f) {
  Object.assign(f.context, {
    React: { createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) }; } },
    theme: { colors: { background: '#fff' }, spacing: { sm: 8, md: 16 } },
    styles: new Proxy({}, { get: (_target, key) => key }), insets: { top: 0, bottom: 0 },
    showLoadingBackButton: false, nextNewSetPlaysAd: false, videoAd: null, closeVideoAd() {}, deckColors: {},
    LinearGradient: 'LinearGradient', View: 'View', Text: 'Text', Pressable: 'Pressable',
    PrimaryButton: 'PrimaryButton', DeckLoader: 'DeckLoader', VideoAdModal: 'VideoAdModal',
    SessionMapButton: 'SessionMapButton', SessionMapPanel: 'SessionMapPanel', SwipeDeck: 'SwipeDeck',
    deckRef: { current: null }, hasMapCoordinates: (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng),
  });
  f.context.sessionMapControl = evaluate(expression('sessionMapControl'), f.context);
}
function renderTerminalState(f) {
  jsxContext(f);
  const branches = component.body.statements.filter(node => ts.isIfStatement(node)
    && ['loading && !sessionMapOpen', '!current && !sessionMapOpen'].includes(node.expression.getText(deckTree)));
  assert.equal(branches.length, 2);
  return evaluate(`() => { ${branches.map(node => node.getText(deckTree)).join('\n')} return null; }`, f.context)();
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...tree.children.flatMap(elements)];
}
function content(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  return tree.children.map(content).join(' ');
}

test('the persistent button opens the collection while loading and after deck exhaustion', () => {
  for (const loading of [true, false]) {
    const f = fixture({ loading, controlsDisabled: true });
    f.context.collectSessionActivities([activity('prior')]); f.render();
    const tree = renderTerminalState(f);
    const button = only(elements(tree).filter(node => node.type === 'SessionMapButton'), 'terminal map button');
    assert.equal(button.props.unreadCount, 1);
    assert.equal(button.props.disabled, false, 'No swipe credit or pending deck must not disable browsing');
    button.props.onPress(); f.render();
    assert.equal(f.context.mapOverviewVisible, true);
    assert.equal(f.context.sessionMap.unreadCount, 0);
    assert.equal(renderTerminalState(f), null, 'An open map must bypass loading/empty returns');
  }
});

test('overview renders a panel and pin selection renders the normal swipe card with no preview deck', () => {
  const f = fixture({ controlsDisabled: true });
  f.context.collectSessionActivities([place(1), activity('home')]); f.open();
  jsxContext(f);
  const panelBranch = only(findAll(deckTree, node => ts.isConditionalExpression(node)
    && node.condition.getText(deckTree) === 'mapOverviewVisible'
    && node.whenTrue.getText(deckTree).startsWith('<SessionMapPanel')), 'map/card surface');
  let surface = evaluate(panelBranch.getText(deckTree), f.context);
  assert.equal(surface.type, 'SessionMapPanel');
  assert.equal(surface.props.entries.length, 2);
  assert.equal(surface.props.activities.length, 1);
  assert.equal(surface.props.onSelect, f.context.selectSessionMapActivity);
  surface.props.onSelect('home'); f.render();
  surface = evaluate(panelBranch.getText(deckTree), f.context);
  assert.equal(surface.type, 'SwipeDeck');
  assert.equal(surface.props.current.id, 'home');
  assert.equal(surface.props.next, null);
  assert.equal(surface.props.disabled, false, 'Zero-credit users may still dismiss/review a collected card');
  assert.equal(surface.props.rightSwipeEnabled, false, 'A new commitment retains the normal credit check');
  assert.equal(surface.props.onSwipeLeft, f.context.handleSwipeLeft);
});

test('map button is centered directly above the controls and available inside the out-of-swipes overlay', () => {
  const controls = only(findAll(deckTree, node => ts.isJsxElement(node)
    && /\bstyles\.controls\b/.test(attribute(node.openingElement, 'style')?.getText(deckTree) ?? '')), 'main controls');
  const siblings = controls.parent.children.filter(node => !ts.isJsxText(node) || node.text.trim());
  const at = siblings.indexOf(controls);
  assert.equal(siblings[at - 1].getText(deckTree), '{sessionMapControl}');
  const stylesNode = only(findAll(deckTree, node => ts.isPropertyAssignment(node)
    && node.name.getText(deckTree) === 'sessionMapControl'), 'map control style');
  const style = evaluate(stylesNode.initializer.getText(deckTree), vm.createContext({ exports: {} }));
  assert.equal(style.alignItems, 'center');
  const overlay = only(findAll(deckTree, node => ts.isJsxExpression(node)
    && node.expression?.getText(deckTree).startsWith('outOfSwipesGridVisible && !sessionMapOpen &&')), 'credit overlay');
  assert.ok(findAll(overlay, node => ts.isJsxExpression(node)
    && node.expression?.getText(deckTree) === 'sessionMapControl').length > 0);
});

test('terminal Home buttons reset session data while Refine preserves it', () => {
  for (const loading of [true, false]) {
    const f = fixture({ loading }); f.context.collectSessionActivities([activity('kept')]);
    jsxContext(f); f.context.showLoadingBackButton = true;
    const branches = component.body.statements.filter(node => ts.isIfStatement(node)
      && ['loading && !sessionMapOpen', '!current && !sessionMapOpen'].includes(node.expression.getText(deckTree)));
    const tree = evaluate(`() => { ${branches.map(node => node.getText(deckTree)).join('\n')} return null; }`, f.context)();
    f.context.setShowLoadingBackButton = () => {};
    if (!loading) {
      const refine = only(elements(tree).filter(node => node.type === 'Pressable'
        && node.props.onPress !== f.context.handleNewSet && content(node).includes('Expand your interests')), 'Refine');
      refine.props.onPress(); assert.equal(f.collection.snapshot().entries.length, 1);
    }
    const home = only(elements(tree).filter(node => node.type === 'PrimaryButton'
      ? node.props.label === 'deck_back_home'
      : node.type === 'Pressable' && content(node) === 'deck_back_home'), 'terminal Home');
    home.props.onPress(); assert.equal(f.collection.snapshot().entries.length, 0);
  }
});

test('Tomorrow waits for calendar preparation and only the completed deck request ends loading', async () => {
  const f = fixture({ planDate: 'tomorrow', tomorrowAvailability: null });
  const calendar = deferred(), deck = deferred(); let builds = 0;
  Object.assign(f.context.state, { permissions: { calendarGranted: true }, disabledCalendars: [], ignoredExternalEventKeys: [] });
  Object.assign(f.context, {
    getAvailabilityForDate: () => calendar.promise, getUpcomingEvents: async () => [],
    applyIgnoredEventsToAvailability: value => value,
    buildTomorrowFallbackAvailability: () => ({ ...f.context.availability, contextEventTitles: [] }),
    setTomorrowAvailability: value => { f.context.tomorrowAvailability = value; }, setTomorrowCalendarEvents() {},
    buildFilteredDeck() { builds++; return deck.promise; },
  });
  const prepare = effectRunner(f.context, source => source.includes('const availabilityForTomorrow'), 'Tomorrow preparation');
  const load = effectRunner(f.context, source => source.includes('if (didLoadDeck.current) return;'), 'initial deck loading');
  prepare.render(); load.render();
  assert.equal(builds, 0); assert.equal(f.context.loading, true);
  calendar.resolve({ ...f.context.availability, contextEventTitles: [] }); await tick();
  assert.ok(f.context.tomorrowAvailability);
  assert.equal(f.context.loading, true, 'Calendar completion must not reveal a false empty state');
  load.render(); assert.equal(builds, 1); load.render(); assert.equal(builds, 1);
  deck.resolve({ deck: [], usedFallback: true }); await tick();
  assert.equal(f.context.loading, false); assert.equal(f.context.didLoadDeck.current, true);
  assert.equal(f.calls.reservations.length, 1); prepare.unmount(); load.unmount();
});

test('a changed plan date invalidates the old deck and empty Tomorrow decks provide a working retry', () => {
  const f = fixture();
  const reset = effectRunner(f.context, source => source.includes('didLoadDeck.current = false;'), 'context reset');
  reset.render();
  f.context.deck = [activity('old-context')]; f.context.didLoadDeck.current = true; f.context.loading = false;
  const before = f.context.deckRequestRef.current; f.context.planDate = 'tomorrow'; reset.render();
  assert.equal(f.context.deckRequestRef.current, before + 1); assert.equal(f.context.deck.length, 0);
  assert.equal(f.context.didLoadDeck.current, false); assert.equal(f.context.loading, true);
  f.context.applyDeck({ deck: [], usedFallback: true }, false); f.render();
  const tree = renderTerminalState(f);
  assert.equal(elements(tree).some(node => node.type === 'DeckLoader'), false);
  const retry = only(elements(tree).filter(node => node.type === 'PrimaryButton'
    && node.props.label === 'smart_new_set'), 'empty-state retry');
  assert.equal(retry.props.onPress, f.context.handleNewSet);
});

test('late inspected-card animations and stale commit failures cannot mutate the next session', async () => {
  const f = fixture(); f.context.saveInspectedSuggestion(activity('grid')); f.context.resetSessionMap();
  let writes = f.calls.writes.length; f.calls.animations[0]();
  assert.equal(f.calls.writes.length, writes);
  const pending = deferred();
  f.context.Haptics.notificationAsync = () => pending.promise;
  f.context.collectSessionActivities([activity('pick')]); f.open(); f.select('pick');
  const work = f.context.commitSuggestion('now'); await tick();
  f.context.resetSessionMap(); writes = f.calls.writes.length;
  pending.reject(new Error('Old failed request')); await work;
  assert.equal(f.calls.writes.length, writes);
  assert.equal(f.calls.alerts.length, 0);
  assert.equal(f.context.confirming, false);
  assert.equal(f.context.swipeLockRef.current, false);
  assert.equal(f.calls.timers.size, 0);
});

test('SwipeDeck guards disabled commitments and cancels callbacks from removed card layers', async () => {
  const calls = { right: 0, resets: 0, animations: [] };
  const controlledAnimation = () => ({
    start(callback) { this.finish = callback; calls.animations.push(this); },
    stop() { this.stopped = true; },
  });
  const context = vm.createContext({
    exports: {}, Promise, console: { warn() {} },
    busy: { current: false }, generation: { current: 0 }, animation: { current: null }, recoveryFrame: { current: null },
    live: { current: { active: true, disabled: false, rightSwipeEnabled: false,
      onSwipeLeft() {}, onSwipeRight() { calls.right++; } } },
    active: true, width: 350, CARD_HEIGHT: 500, useNativeDriver: true, pan: { x: {}, setValue() {} }, reveal: {},
    resetPosition() { calls.resets++; }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    Easing: { cubic: {}, out: value => value },
    // Both shipped parallel reveal animation and the newer single slide animation
    // use the same cancellation boundary. Count started composites, not children.
    Animated: { timing: controlledAnimation, parallel: controlledAnimation },
  });
  const swipe = evaluate(expression('completeSwipe', swipeTree), context);
  const effect = only(findAll(swipeTree, node => ts.isCallExpression(node)
    && node.expression.getText(swipeTree) === 'useLayoutEffect'
    && node.arguments[0]?.getText(swipeTree).includes('generation.current += 1')), 'swipe generation cleanup');
  const cleanup = evaluate(effect.arguments[0].getText(swipeTree), context)();
  swipe('right'); assert.equal(calls.resets, 1); assert.equal(calls.animations.length, 0);
  context.live.current.rightSwipeEnabled = true; swipe('right'); assert.equal(calls.animations.length, 1);
  cleanup(); calls.animations[0].finish({ finished: true }); await tick();
  assert.equal(calls.right, 0); assert.equal(calls.animations[0].stopped, true);
});
