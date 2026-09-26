const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Render the actual screen with a small hook scheduler. Effects run after each
// render; their dependency lists and cleanups behave like React's. Native views,
// animations, storage and remote calls are controlled without a device/network.
const compiled = ts.transpileModule(
  fs.readFileSync(path.resolve(__dirname, '../src/screens/PlanScreen.tsx'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } },
).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const generatedSteps = ['Fill a glass with cold water.', 'Sketch the glass for five minutes.', 'Sign and date your drawing.'];

function screen({ generate = async () => generatedSteps, analytics = async () => {}, session = null,
  mode = 'at_home', todo = false, fromDoSomethingNow = true } = {}) {
  const calls = [];
  const writes = [];
  const events = [];
  const alerts = [];
  const lateUpdates = [];
  const hooks = [];
  const intervals = new Map();
  let cursor = 0;
  let pendingEffects = [];
  let dirty = true;
  let mounted = true;
  let incarnation = 0;
  let activeKey;
  let tree;
  const suggestion = session?.suggestion ?? {
    id: 'draw-water', title: 'Draw a glass of water', hook: 'A quick drawing exercise',
    description: 'Look closely and draw what you see.', type: 'AT_HOME', durationMin: 15,
    tags: todo ? ['todo'] : ['creative'], instructions: ['Get ready.', 'Try the activity.'],
  };
  const commitment = session?.commitment ?? {
    type: 'AT_HOME', suggestionId: suggestion.id,
    startAt: '2026-09-25T08:00:00.000Z', endAt: '2026-09-25T08:15:00.000Z',
  };
  let state = { userId: 'user-1', location: {}, scheduledActivities: [], inProgressPlanSession: session };
  const actions = {
    setInProgressPlanSession(value) {
      writes.push(plain(value));
      state = { ...state, inProgressPlanSession: value };
      dirty = true;
    },
  };
  const depsChanged = (previous, next) => !previous || !next
    || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) {
        const createdIn = incarnation;
        hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
        hooks[index].set = next => {
          if (!mounted || createdIn !== incarnation) { lateUpdates.push(index); return; }
          const value = typeof next === 'function' ? next(hooks[index].value) : next;
          if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; dirty = true; }
        };
      }
      return [hooks[index].value, hooks[index].set];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!hooks[index] || depsChanged(hooks[index].deps, deps)) hooks[index] = { value: factory(), deps };
      return hooks[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || depsChanged(hooks[index].deps, deps)) {
        const previous = hooks[index];
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => {
          hooks[index].cleanup?.();
          hooks[index].cleanup = effect();
        });
      }
    },
  };
  react.default = react;
  const animate = () => ({ start(callback) { callback?.({ finished: true }); } });
  const native = {
    ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
    StyleSheet: { create: styles => styles, absoluteFillObject: {} },
    Animated: { Value: class { constructor(value) { this.value = value; } setValue(value) { this.value = value; } },
      View: 'Animated.View', timing: animate, spring: animate, parallel: animate },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    useWindowDimensions: () => ({ width: 390 }),
    Alert: { alert(title, message, buttons) { alerts.push({ title, message, buttons }); } }, Linking: {},
  };
  const theme = { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xxl: 32 }, fonts: {}, radius: {} };
  const dependencies = {
    react,
    'react-native': native,
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    '../components/PrimaryButton': { PrimaryButton: 'PrimaryButton' },
    '../components/BrandLoader': { BrandLoader: 'BrandLoader' },
    '../components/MapThumbnail': { MapThumbnail: 'MapThumbnail' },
    '../theme/ThemeProvider': { useTheme: () => theme },
    '../utils/time': { formatTime: date => date.toISOString() },
    '../services/analytics': { logEvent(name, details) { events.push({ name, details }); return analytics(name, details); } },
    '../services/calendar': {},
    '../state/AppState': { useAppState: () => ({ state, actions }) },
    '../services/location': { getCurrentLocation: async () => ({}) },
    '../services/travel': {},
    '../utils/social': { getConfirmedSocialProofCount: () => 0 },
    '../utils/planSession': { buildPlanSessionKey: (_commitment, activity) => `${activity.id}-session` },
    '../i18n/I18nProvider': { useI18n: () => ({ t: key => key, language: 'en' }) },
    '../services/activityChat': { getActivityChatRegionLabel: () => '', makeActivityChatThreadId: () => 'chat' },
    '../services/geminiSuggestions': { generateActivityGuide(...args) { calls.push(plain(args)); return generate(...args); } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Promise, console,
    setInterval(callback) { const id = intervals.size + 1; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    require(name) { assert.ok(dependencies[name], `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  const props = { navigation: { reset() {} }, route: { params: {
    commitment, suggestion, ...(mode == null ? {} : { activityMode: mode }), fromDoSomethingNow,
  } } };
  function render() {
    let renders = 0;
    while (dirty && mounted) {
      assert.ok(renders++ < 30, 'screen effects settle without a render loop');
      dirty = false;
      cursor = 0;
      pendingEffects = [];
      tree = exports.PlanScreen(props);
      if (activeKey !== tree.props.key) {
        hooks.forEach(hook => hook.cleanup?.());
        hooks.length = 0;
        incarnation++;
        activeKey = tree.props.key;
        cursor = 0;
      }
      while (typeof tree.type === 'function') tree = tree.type(tree.props);
      for (const effect of pendingEffects) effect();
    }
  }
  function nodes() {
    const result = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      result.push(node);
      node.children.forEach(visit);
    }
    visit(tree);
    return result;
  }
  function text(node = tree) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node !== 'object') return String(node);
    return node.children.map(child => text(child)).join(' ');
  }
  function button(label) {
    return nodes().find(node => node.props.onPress && (node.props.label === label || text(node).includes(label)));
  }
  function press(node) {
    assert.ok(node, 'requested control is rendered');
    assert.ok(!node.props.disabled, 'requested control is enabled');
    const result = node.props.onPress();
    render();
    return result;
  }
  render();
  return {
    calls, writes, events, alerts, lateUpdates, text, button, press,
    get session() { return state.inProgressPlanSession; },
    checklist() { return nodes().filter(node => /^guide_\d+$/.test(node.props.key ?? '')); },
    start() { return press(button('plan_start')); },
    switchActivity(overrides) {
      props.route.params = { ...props.route.params, suggestion: { ...suggestion, ...overrides } };
      dirty = true;
      render();
    },
    rerender() { dirty = true; render(); },
    async settle() { await flush(); render(); await flush(); render(); },
    unmount() { mounted = false; hooks.forEach(hook => hook.cleanup?.()); },
  };
}

test('starting displays checklist loading and requests its guide even while analytics is pending', async () => {
  const logging = deferred();
  const generating = deferred();
  const instance = screen({ analytics: () => logging.promise, generate: () => generating.promise });
  assert.equal(instance.calls.length, 0, 'generation waits for the activity to start');
  instance.start();
  await instance.settle();
  assert.ok(instance.session?.manualStartAt, 'the activity starts without waiting on analytics');
  assert.equal(instance.button('plan_start'), undefined);
  assert.equal(instance.calls.length, 1);
  assert.ok(instance.checklist().every(row => row.props.disabled), 'provisional rows cannot be checked while loading');
  assert.ok(instance.button('plan_finish_activity').props.disabled);
  assert.match(instance.text(), /plan_checklist_loading/);
  logging.resolve();
  generating.resolve(generatedSteps);
  await instance.settle();
  assert.doesNotMatch(instance.text(), /plan_checklist_loading/);
  assert.ok(instance.checklist().every(row => !row.props.disabled));
  instance.unmount();
});

test('a drop-in plan displays and guides the committed visit time rather than the event opening time', async () => {
  const session = {
    suggestion: { id: 'city-market', title: 'Explore the craft market', type: 'EVENT', durationMin: 60,
      tags: ['art'], event: { startAt: '2026-09-25T06:00:00.000Z', endAt: '2026-09-25T18:00:00.000Z',
        venue: 'Market Square', attendanceMode: 'drop_in', ticketUrl: '', sourceUrl: 'https://example.test/market' } },
    commitment: { type: 'EVENT', suggestionId: 'city-market',
      startAt: '2026-09-25T10:00:00.000Z', endAt: '2026-09-25T11:00:00.000Z' },
  };
  const instance = screen({ session, mode: 'tomorrow', fromDoSomethingNow: false });
  assert.match(instance.text(), /2026-09-25T10:00:00.000Z/);
  assert.doesNotMatch(instance.text(), /2026-09-25T06:00:00.000Z/);
  instance.start();
  await instance.settle();
  assert.equal(instance.calls[0][0].eventStartAt, session.commitment.startAt);
  instance.unmount();
});

test('rerenders while generation is pending do not duplicate its request', async () => {
  const generating = deferred();
  const instance = screen({ generate: () => generating.promise });
  instance.start();
  await instance.settle();
  for (let i = 0; i < 5; i++) { instance.rerender(); await instance.settle(); }
  assert.equal(instance.calls.length, 1);
  generating.resolve(generatedSteps);
  await instance.settle();
  assert.equal(instance.calls.length, 1);
  instance.unmount();
});

for (const failure of ['null', 'empty', 'rejected', 'thrown']) {
  test(`${failure} guide generation shows an error and retries only when explicitly requested`, async () => {
    let attempts = 0;
    const instance = screen({ generate: () => {
      if (++attempts > 1) return Promise.resolve(generatedSteps);
      if (failure === 'thrown') throw new Error('Synchronous failure');
      if (failure === 'rejected') return Promise.reject(new Error('Offline'));
      return Promise.resolve(failure === 'null' ? null : []);
    } });
    instance.start();
    await instance.settle();
    assert.match(instance.text(), /plan_checklist_error/);
    assert.doesNotMatch(instance.text(), /plan_checklist_loading/);
    assert.equal(instance.checklist().length, 2, 'fallback checklist remains available');
    for (let i = 0; i < 3; i++) { instance.rerender(); await instance.settle(); }
    assert.equal(instance.calls.length, 1, 'failure does not trigger an automatic request loop');
    instance.press(instance.button('plan_checklist_retry'));
    await instance.settle();
    assert.equal(instance.calls.length, 2);
    assert.equal(instance.checklist().length, generatedSteps.length);
    assert.doesNotMatch(instance.text(), /plan_checklist_error/);
    instance.unmount();
  });
}

test('generated steps and their checked state persist and resume without regeneration', async () => {
  const instance = screen();
  instance.start();
  await instance.settle();
  assert.deepEqual(plain(instance.session.aiGuideSteps), generatedSteps);
  instance.press(instance.checklist()[1]);
  await instance.settle();
  assert.deepEqual(plain(instance.session.guideChecks), [false, true, false]);
  const saved = plain(instance.session);
  instance.unmount();

  const resumed = screen({ session: saved, generate() { throw new Error('Saved guide must be reused'); } });
  await resumed.settle();
  assert.equal(resumed.calls.length, 0);
  assert.ok(resumed.writes.every(value => value !== null), 'hydration never erases the saved activity');
  assert.deepEqual(plain(resumed.session.aiGuideSteps), generatedSteps);
  assert.deepEqual(plain(resumed.session.guideChecks), [false, true, false]);
  assert.equal(resumed.checklist().length, generatedSteps.length);
  assert.match(resumed.text(resumed.checklist()[1]), /☑/);
  assert.ok(resumed.checklist().every(row => !row.props.disabled));
  resumed.unmount();
});

test('resuming a legacy session fetches the missing guide and resets provisional checkmarks', async () => {
  const existing = screen({ generate: async () => null });
  existing.start();
  await existing.settle();
  existing.press(existing.checklist()[0]);
  await existing.settle();
  const saved = plain(existing.session);
  delete saved.aiGuideSteps;
  existing.unmount();

  const generating = deferred();
  const resumed = screen({ session: saved, generate: () => generating.promise });
  await resumed.settle();
  assert.equal(resumed.calls.length, 1);
  assert.ok(resumed.session?.manualStartAt);
  assert.ok(resumed.writes.every(value => value !== null));
  assert.match(resumed.text(), /plan_checklist_loading/);
  generating.resolve(generatedSteps);
  await resumed.settle();
  assert.deepEqual(plain(resumed.session.aiGuideSteps), generatedSteps);
  assert.deepEqual(plain(resumed.session.guideChecks), [false, false, false]);
  resumed.unmount();
});

test('a guide arriving after unmount cannot update screen state or overwrite the saved session', async () => {
  const generating = deferred();
  const instance = screen({ generate: () => generating.promise });
  instance.start();
  await instance.settle();
  const saved = plain(instance.session);
  const writeCount = instance.writes.length;
  instance.unmount();
  generating.resolve(generatedSteps);
  await instance.settle();
  assert.deepEqual(instance.lateUpdates, []);
  assert.equal(instance.writes.length, writeCount);
  assert.deepEqual(plain(instance.session), saved);
});

test('switching activity remounts its checklist and ignores the old pending guide', async () => {
  const oldGuide = deferred();
  const newGuide = deferred();
  let attempts = 0;
  const instance = screen({ generate: () => ++attempts === 1 ? oldGuide.promise : newGuide.promise });
  instance.start();
  await instance.settle();
  instance.switchActivity({ id: 'new-activity', title: 'Fold a paper crane' });
  assert.ok(instance.button('plan_start'), 'a new activity has its own start state');
  instance.start();
  await instance.settle();
  assert.equal(instance.calls.length, 2);
  assert.equal(instance.calls[1][0].title, 'Fold a paper crane');
  const currentSession = plain(instance.session);
  oldGuide.resolve(['An old activity step must never appear.']);
  await instance.settle();
  assert.deepEqual(plain(instance.session), currentSession);
  assert.deepEqual(instance.lateUpdates, []);
  assert.match(instance.text(), /plan_checklist_loading/);
  assert.doesNotMatch(instance.text(), /An old activity step/);
  newGuide.resolve(['Crease the paper diagonally.', 'Fold and spread the wings.']);
  await instance.settle();
  assert.equal(instance.session.suggestion.id, 'new-activity');
  assert.deepEqual(plain(instance.session.aiGuideSteps), ['Crease the paper diagonally.', 'Fold and spread the wings.']);
  instance.unmount();
});

test('a pending guide finishing after cancellation cannot recreate the saved session', async () => {
  const generating = deferred();
  const instance = screen({ generate: () => generating.promise });
  instance.start();
  await instance.settle();
  instance.press(instance.button('plan_cancel_cta'));
  const confirmation = instance.alerts.at(-1);
  assert.equal(confirmation.title, 'plan_cancel_title');
  await confirmation.buttons.find(button => button.style === 'destructive').onPress();
  await instance.settle();
  assert.equal(instance.session, null);
  const writeCount = instance.writes.length;
  generating.resolve(generatedSteps);
  await instance.settle();
  assert.equal(instance.session, null);
  assert.equal(instance.writes.length, writeCount);
  assert.doesNotMatch(instance.text(), /Fill a glass with cold water/);
  instance.unmount();
});

test('challenge activities request a challenge guide while to-dos retain their single task', async () => {
  const challenge = screen({ mode: 'challenge_me' });
  challenge.start();
  await challenge.settle();
  assert.equal(challenge.calls.length, 1);
  assert.equal(challenge.calls[0][0].isChallenge, true);
  assert.equal(challenge.checklist().length, generatedSteps.length);
  challenge.unmount();

  const todo = screen({ todo: true });
  todo.start();
  await todo.settle();
  assert.equal(todo.calls.length, 0);
  assert.equal(todo.checklist().length, 1);
  assert.match(todo.text(todo.checklist()[0]), /Draw a glass of water/);
  todo.unmount();
});

test('resuming a challenge restores its countdown and saved guide when the route omits its mode', async () => {
  const challenge = screen({ mode: 'challenge_me' });
  challenge.start();
  await challenge.settle();
  const saved = plain(challenge.session);
  assert.equal(saved.activityMode, 'challenge_me');
  challenge.unmount();

  const resumed = screen({ session: saved, mode: null });
  await resumed.settle();
  assert.match(resumed.text(), /plan_timer_challenge/);
  assert.doesNotMatch(resumed.text(), /plan_timer_elapsed/);
  assert.equal(resumed.calls.length, 0);
  assert.deepEqual(plain(resumed.session.aiGuideSteps), generatedSteps);
  resumed.unmount();

  delete saved.aiGuideSteps;
  const missingGuide = screen({ session: saved, mode: null });
  await missingGuide.settle();
  assert.equal(missingGuide.calls.length, 1);
  assert.equal(missingGuide.calls[0][0].isChallenge, true);
  assert.match(missingGuide.text(), /plan_timer_challenge/);
  assert.deepEqual(plain(missingGuide.session.aiGuideSteps), generatedSteps);
  missingGuide.unmount();
});
