const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'src/screens/ActivityChatScreen.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const start = Date.parse('2026-09-26T10:00:00Z');
const thread = (expires = start + 60_000) => ({ title: 'Stored title', expiresAt: { toDate: () => new Date(expires) } });

// Execute the actual screen and its effects, replacing only native rendering and
// Firebase calls. The harness runs effect cleanup on dependency changes/unmount.
function fixture(options = {}) {
  let index = 0, tree, now = start, unmounted = false;
  const slots = [], effects = [], pendingEffects = [], intervals = new Set();
  const calls = { loads: [], ensures: [], participants: [], sends: [], subscriptions: [], cleanup: 0, stateAfterUnmount: 0 };
  const state = { userId: 'alice', prefs: { chatDisplayName: options.displayName ?? 'Alice' } };
  const route = { params: { threadId: 'thread-1', title: 'Route title', suggestionId: 'coffee', expiresAt: new Date(options.routeExpiry ?? start + 86_400_000).toISOString() } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useMemo: factory => { index++; return factory(); },
    useRef: initial => { const position = index++; return slots[position] ?? (slots[position] = { current: initial }); },
    useState: initial => {
      const position = index++;
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
      return [slots[position], value => {
        if (unmounted) calls.stateAfterUnmount++;
        slots[position] = typeof value === 'function' ? value(slots[position]) : value;
      }];
    },
    useEffect: (callback, dependencies) => {
      const position = index++;
      const previous = effects[position];
      if (!previous || dependencies.some((value, at) => !Object.is(value, previous.dependencies[at]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[position] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const theme = { colors: {}, fonts: {}, spacing: { sm: 8, md: 16, lg: 24, xxl: 48 }, radius: { sm: 8, md: 12, lg: 16 } };
  const dependencies = {
    react,
    'react-native': {
      Platform: { OS: options.platform ?? 'ios' }, StyleSheet: { create: styles => styles },
      KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
    },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 34 }) },
    '../theme/ThemeProvider': { useTheme: () => theme },
    '../i18n/I18nProvider': { useI18n: () => ({ language: options.language ?? 'en' }) },
    '../state/AppState': { useAppState: () => ({ state, actions: { setPrefs: prefs => { state.prefs = prefs; } } }) },
    '../utils/time': { formatDuration: minutes => `${minutes} min` },
    '../services/activityChat': {
      ACTIVITY_CHAT_MESSAGE_MAX_LENGTH: 1000,
      normalizeActivityChatDisplayName: value => value.trim().replace(/\s+/g, ' ').slice(0, 32),
      loadActivityChatThread: async id => { calls.loads.push(id); return options.load ? options.load(id) : thread(); },
      ensureActivityChatThread: async value => { calls.ensures.push(value); return options.ensure?.(value); },
      markActivityChatParticipant: async (...args) => { calls.participants.push(args); return options.mark?.(...args); },
      sendActivityChatMessage: async (...args) => { calls.sends.push(args); return options.send?.(...args); },
      subscribeActivityChatMessages: (id, onChange, onError) => {
        calls.subscriptions.push({ id, onChange, onError });
        return () => { calls.cleanup++; };
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    Date: class extends Date { static now() { return now; } },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
    require: name => { if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`); return dependencies[name]; },
  }, { filename });
  const render = () => {
    assert.equal(unmounted, false);
    index = 0;
    tree = exports.ActivityChatScreen({ route, navigation: { goBack() {} } });
    pendingEffects.splice(0).forEach(run => run());
  };
  const nodes = (node = tree) => node && typeof node === 'object'
    ? [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(child => nodes(child))] : [];
  const text = node => typeof node === 'string' ? node : (node?.props?.children ?? []).flat(Infinity).map(text).join('');
  const button = label => {
    const matches = nodes().filter(node => node.type === 'Pressable' && text(node) === label);
    assert.equal(matches.length, 1, `Expected one button: ${label}`);
    return matches[0];
  };
  const composer = () => nodes().find(node => node.type === 'TextInput' && node.props.multiline);
  render();
  return {
    calls, button, nodes, composer, render, state, route,
    get text() { return text(tree); },
    type: value => { composer().props.onChangeText(value); render(); },
    press: label => { const node = button(label); assert.notEqual(node.props.disabled, true); const promise = node.props.onPress(); render(); return promise; },
    settle: async () => { await tick(); render(); await tick(); render(); },
    advance: milliseconds => { now += milliseconds; intervals.forEach(callback => callback()); render(); },
    unmount: () => { unmounted = true; effects.forEach(effect => effect?.cleanup?.()); },
  };
}

test('send waits for participant initialization and duplicate taps share one request', async () => {
  const registration = deferred(), write = deferred();
  const f = fixture({ mark: () => registration.promise, send: () => write.promise });
  f.type('  Hello  ');
  assert.equal(f.button('Send').props.disabled, true);
  // Also exercise a queued/stale native handler before the disabled render.
  const send = f.button('Send').props.onPress;
  const pending = send();
  send();
  await f.settle();
  assert.deepEqual(f.calls.sends, []);
  registration.resolve();
  await f.settle();
  assert.deepEqual(f.calls.sends, [['thread-1', 'Hello', 'Alice']]);
  assert.equal(f.button('Sending…').props.disabled, true);
  f.type('Next message');
  write.resolve();
  await pending;
  await f.settle();
  assert.equal(f.composer().props.value, 'Next message');
  assert.equal(f.button('Send').props.disabled, false);
  f.unmount();
});

for (const language of ['en', 'de']) {
  test(`${language}: rejected sends preserve the draft, expose an error, and can be retried`, async () => {
    let attempts = 0;
    const f = fixture({ language, send: async () => { if (!attempts++) throw new Error('permission-denied'); } });
    await f.settle();
    f.type('Keep this message');
    const sendLabel = language === 'de' ? 'Senden' : 'Send';
    await f.press(sendLabel);
    await f.settle();
    assert.equal(f.composer().props.value, 'Keep this message');
    assert.match(f.text, language === 'de' ? /Dein Text bleibt erhalten/ : /Your text has been kept/);
    await f.press(sendLabel);
    await f.settle();
    assert.equal(f.calls.sends.length, 2);
    assert.equal(f.composer().props.value, '');
    assert.doesNotMatch(f.text, /could not be sent|konnte nicht gesendet werden/);
    f.unmount();
  });
}

test('load failures are visible and retry reconnects before enabling Send', async () => {
  let attempts = 0;
  const f = fixture({ load: async () => { if (!attempts++) throw { code: 'activity-chat/unauthenticated' }; return thread(); } });
  await f.settle();
  f.type('Hello');
  assert.match(f.text, /Please sign in again/);
  assert.equal(f.button('Send').props.disabled, true);
  f.press('Try again');
  await f.settle();
  assert.equal(f.calls.loads.length, 2);
  assert.equal(f.button('Send').props.disabled, false);
  f.unmount();
});

test('participant registration failures expose retry and do not subscribe or send', async () => {
  let attempts = 0;
  const f = fixture({ mark: async () => { if (!attempts++) throw new Error('registration rejected'); } });
  await f.settle();
  assert.match(f.text, /Could not connect/);
  assert.equal(f.calls.subscriptions.length, 0);
  f.press('Try again');
  await f.settle();
  assert.equal(f.calls.subscriptions.length, 1);
  f.unmount();
});

test('listener failures retain messages and retry replaces the listener', async () => {
  const f = fixture();
  await f.settle();
  const listener = f.calls.subscriptions[0];
  listener.onChange([{ id: 'm1', authorId: 'alice', authorName: 'Alice', body: 'Already received' }]);
  listener.onError(new Error('permission-denied'));
  f.render();
  assert.match(f.text, /Already received/);
  assert.match(f.text, /Could not connect/);
  f.type('Queued');
  assert.equal(f.button('Send').props.disabled, true);
  f.press('Try again');
  await f.settle();
  assert.equal(f.calls.cleanup, 1);
  assert.equal(f.calls.subscriptions.length, 2);
  assert.match(f.text, /Already received/);
  f.unmount();
  assert.equal(f.calls.cleanup, 2);
  listener.onChange([]);
  listener.onError(new Error('late callback'));
  assert.equal(f.calls.stateAfterUnmount, 0);
});

for (const boundary of ['load', 'ensure', 'mark']) {
  test(`unmount while ${boundary} is pending never creates a listener or updates state`, async () => {
    const pending = deferred();
    const options = boundary === 'load' ? { load: () => pending.promise }
      : boundary === 'ensure' ? { load: async () => null, ensure: () => pending.promise }
        : { mark: () => pending.promise };
    const f = fixture(options);
    await f.settle();
    f.unmount();
    pending.resolve(boundary === 'load' ? thread() : undefined);
    await tick();
    assert.equal(f.calls.subscriptions.length, 0);
    assert.equal(f.calls.stateAfterUnmount, 0);
  });
}

test('stored expiration controls the countdown and sending even when the route grants another day', async () => {
  const f = fixture();
  await f.settle();
  f.type('Too late');
  assert.match(f.text, /1 min left/);
  f.advance(60_001);
  assert.match(f.text, /This chat has expired/);
  assert.equal(f.button('Send').props.disabled, true);
  await f.button('Send').props.onPress();
  assert.equal(f.calls.sends.length, 0);
  f.unmount();
});

test('a still-active stored thread is not expired by an obsolete route timestamp', async () => {
  const f = fixture({ routeExpiry: start - 1 });
  await f.settle();
  f.type('Hello');
  assert.equal(f.button('Send').props.disabled, false);
  f.advance(15_000);
  assert.equal(f.button('Send').props.disabled, false);
  f.unmount();
});

test('expired stored threads are not recreated or joined', async () => {
  const f = fixture({ load: async () => thread(start - 1) });
  await f.settle();
  assert.match(f.text, /This chat has expired/);
  assert.equal(f.calls.ensures.length, 0);
  assert.equal(f.calls.participants.length, 0);
  assert.equal(f.calls.subscriptions.length, 0);
  f.unmount();
});

test('concurrent creation reloads the stored expiry before joining', async () => {
  let reads = 0;
  const f = fixture({ load: async () => reads++ === 0 ? null : thread(start - 1) });
  await f.settle();
  assert.equal(f.calls.ensures.length, 1);
  assert.equal(f.calls.loads.length, 2);
  assert.equal(f.calls.participants.length, 0);
  assert.match(f.text, /This chat has expired/);
  f.unmount();
});

test('the composer applies message limits and shares keyboard avoidance with the message list', async () => {
  const f = fixture();
  await f.settle();
  assert.equal(f.composer().props.maxLength, 1000);
  const keyboard = f.nodes().find(node => node.type === 'KeyboardAvoidingView');
  const descendants = f.nodes(keyboard);
  assert.ok(descendants.includes(f.composer()));
  assert.equal(descendants.find(node => node.type === 'ScrollView').props.keyboardShouldPersistTaps, 'handled');
  assert.ok(descendants.some(node => Array.isArray(node.props.style) && node.props.style.some(style => style?.paddingBottom === 34)));
  f.unmount();
});
