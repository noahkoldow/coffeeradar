const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the screen's actual request function and cache-dependent effect with
// controlled UI state. No React Native device or live AI request is required.
const sourcePath = path.resolve(__dirname, '../src/screens/SmartCalendarScreen.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let requestFunction;
let selectionEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'fetchGapSuggestions') {
    requestFunction = node.initializer.getText(tree);
  }
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[0]?.getText(tree).includes('fetchGapSuggestions(selectedGap, batchIndex)')) {
    selectionEffect = node.arguments[0].getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(requestFunction, 'screen request function found');
assert.ok(selectionEffect, 'screen selection effect found');
const compiled = ts.transpileModule(
  `const fetchGapSuggestions = ${requestFunction}; exports.request = fetchGapSuggestions; exports.effect = ${selectionEffect};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText;

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function screen(generate = async () => []) {
  const calls = [];
  const writes = [];
  const ui = { suggestions: null, loading: false, updates: 0 };
  const context = {
    exports: {}, Promise, Set,
    premiumEnabled: true,
    selectedGap: { id: 'gap' },
    gapBatchIndexByKey: {},
    gapSuggestionCache: {},
    gapSuggestionRequestRef: { current: { pending: new Set(), activeKey: 'user::gap::0', mounted: true } },
    state: { userId: 'user', scheduledActivities: [], habits: [], smartTodos: [], location: {}, prefs: {} },
    language: 'en', timeZone: 'UTC', DAY_START_HOUR: 7, DAY_END_HOUR: 22, PREMIUM_GENERATION_SPEED_FACTOR: 0.9,
    gapCacheKey: gap => gap.id,
    gapBatchCacheKey: (gap, batch) => `${gap.id}::${batch}`,
    normalizeSuggestionTitleKey: title => title.toLowerCase(),
    parseHourMinute: (_input, fallback) => fallback * 60,
    aiCountForBatch: () => 3,
    showPremiumInfo() { throw new Error('Unexpected premium prompt'); },
    toDeckEntries: (_gap, items) => items,
    setGapSuggestions(items) { ui.suggestions = items; ui.updates++; },
    setSuggestionIndex() {},
    setDeckExhausted() {},
    setSuggestionsLoading(value) { ui.loading = value; },
    setGapSuggestionCache(update) { context.gapSuggestionCache = update(context.gapSuggestionCache); },
    persistGapCache(cache) { writes.push(cache); },
    buildGapSuggestions(...args) { calls.push(args); return generate(...args); },
  };
  vm.runInNewContext(compiled, context);
  return { context, ui, calls, writes, ...context.exports };
}

test('an empty AI/heuristic result stays cached instead of triggering a render/request loop', async () => {
  const instance = screen();
  instance.effect();
  await flush();
  assert.equal(instance.calls.length, 1);
  assert.equal(instance.writes.length, 1);
  assert.equal(instance.context.gapSuggestionCache['gap::0'].length, 0);
  // Every cache change reruns the real screen effect. An empty hit must settle.
  for (let i = 0; i < 5; i++) { instance.effect(); await flush(); }
  assert.equal(instance.calls.length, 1);
  assert.equal(instance.writes.length, 1);
  assert.equal(instance.ui.loading, false);
});

test('rerenders while generation is pending reuse one request for the same gap', async () => {
  const pending = deferred();
  const instance = screen(() => pending.promise);
  instance.effect();
  await flush();
  instance.effect();
  instance.effect();
  await flush();
  assert.equal(instance.calls.length, 1);
  pending.resolve([]);
  await flush();
  assert.equal(instance.writes.length, 1);
  assert.equal(instance.context.gapSuggestionRequestRef.current.pending.size, 0);
  assert.equal(instance.ui.loading, false);
});

test('explicit refresh can retry a completed empty result', async () => {
  const instance = screen();
  instance.effect();
  await flush();
  instance.request(instance.context.selectedGap, 0, true);
  await flush();
  assert.equal(instance.calls.length, 2);
  assert.equal(instance.writes.length, 2);
});

test('a late result cannot overwrite another gap, account, or unmounted screen', async () => {
  for (const next of ['user::other-gap::0', 'different-user::gap::0', 'unmounted']) {
    const pending = deferred();
    const instance = screen(() => pending.promise);
    instance.effect();
    await flush();
    if (next === 'unmounted') instance.context.gapSuggestionRequestRef.current.mounted = false;
    else instance.context.gapSuggestionRequestRef.current.activeKey = next;
    pending.resolve([{ title: 'Old private context' }]);
    await flush();
    assert.equal(instance.writes.length, 0);
    assert.equal(instance.ui.updates, 0);
    assert.equal(instance.context.gapSuggestionRequestRef.current.pending.size, 0);
  }
});

test('synchronous generation errors are caught and release the pending request', async () => {
  const instance = screen(() => { throw new Error('Invalid local task data'); });
  assert.doesNotThrow(() => instance.effect());
  await flush();
  assert.equal(instance.calls.length, 1);
  assert.equal(instance.ui.loading, false);
  assert.equal(instance.ui.suggestions.length, 0);
  assert.equal(instance.context.gapSuggestionRequestRef.current.pending.size, 0);
});
