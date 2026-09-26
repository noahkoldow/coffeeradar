const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Isolate the real screen and consent service: no Firebase or native modules run.
// The hook runner exposes the screen's rendered press handlers and effects.
function loadSource(relativePath, dependencies) {
  const filename = path.join(__dirname, '..', relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function screenFixture({ allowed = true, failWrites = 0, failReads = 0, userId = 'alice', language = 'en' } = {}) {
  let slots = [], effects = [], index = 0, dirty = true, tree, currentKey;
  let writeFailures = failWrites, readFailures = failReads, savedAllowed = allowed;
  const notices = [], writes = [];
  let reads = 0;
  const auth = { currentUser: userId ? { uid: userId } : null, onAuthStateChanged: () => () => {} };
  const state = { userId };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: 'Fragment',
    useMemo: factory => { index++; return factory(); },
    useRef: initial => {
      const position = index++;
      return slots[position] ?? (slots[position] = { current: initial });
    },
    useState: initial => {
      const position = index++;
      if (!(position in slots)) slots[position] = initial;
      return [slots[position], value => {
        const next = typeof value === 'function' ? value(slots[position]) : value;
        if (!Object.is(slots[position], next)) { slots[position] = next; dirty = true; }
      }];
    },
    useEffect: (effect, dependencies) => {
      const position = index++;
      const previous = slots[position];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[position] = { dependencies, cleanup: effect() };
        });
      }
    },
    useSyncExternalStore: (_subscribe, snapshot) => { index++; return snapshot(); },
  };
  const native = {
    Platform: { OS: 'ios' },
    Alert: { alert: (title, message, buttons) => notices.push({ title, message, buttons }) },
    Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: styles => styles },
  };
  const consent = loadSource('src/services/aiConsent.ts', {
    react,
    'react-native': native,
    'firebase/functions': { httpsCallable: (_functions, name) => async payload => {
      if (name === 'getCoreAiConsent') {
        reads++;
        if (readFailures-- > 0) throw new Error('offline');
        return { data: { userId: payload.userId, allowed: savedAllowed, version: 'multi-provider-v1', providers: savedAllowed ? ['gemini', 'groq'] : [] } };
      }
      writes.push(payload);
      if (writeFailures-- > 0) throw new Error('offline');
      savedAllowed = payload.allowed;
      return { data: { ...payload, providers: payload.allowed ? ['gemini', 'groq'] : [] } };
    } },
    './firebase': { auth, ensureAuth: async () => { if (!auth.currentUser) throw new Error('signed out'); return auth.currentUser.uid; }, functions: {} },
    '../utils/time': { getPreferredLocale: () => language },
  });
  const theme = {
    colors: {}, spacing: { sm: 8, md: 16, lg: 24 }, radius: { md: 12 }, fonts: {},
  };
  const screen = loadSource('src/screens/AIPrivacyScreen.tsx', {
    react,
    'react-native': native,
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../theme/ThemeProvider': { useTheme: () => theme },
    '../i18n/I18nProvider': { useI18n: () => ({ language, t: key => ({ common_back: 'Back', common_cancel: 'Cancel' })[key] }) },
    '../state/AppState': { useAppState: () => ({ state }) },
    '../services/aiConsent': consent,
  });
  const cleanup = () => {
    for (const slot of slots) slot?.cleanup?.();
    slots = []; effects = []; currentKey = undefined;
  };
  const render = () => {
    const content = screen.AIPrivacyScreen({ navigation: { goBack() {} } });
    if (currentKey !== content.props.key) { cleanup(); currentKey = content.props.key; }
    index = 0; dirty = false;
    tree = content.type(content.props);
    const pending = effects; effects = [];
    pending.forEach(effect => effect());
  };
  const all = (node = tree) => node && typeof node === 'object'
    ? [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(child => all(child))] : [];
  const text = node => typeof node === 'string' ? node : (node?.props?.children ?? []).flat(Infinity).map(text).join('');
  const buttons = () => all().filter(node => node.type === 'Pressable');
  const settle = async () => {
    for (let i = 0; i < 5; i++) { render(); await tick(); }
    if (dirty) render();
  };
  return {
    notices, writes, consent,
    get reads() { return reads; },
    get savedAllowed() { return savedAllowed; },
    get text() { return text(tree); },
    buttonLabels: () => buttons().map(text),
    press: label => {
      const matches = buttons().filter(node => text(node) === label);
      assert.equal(matches.length, 1, `Expected one button named ${label}; found ${buttons().map(text).join(', ')}`);
      assert.notEqual(matches[0].props.disabled, true, `${label} is disabled`);
      matches[0].props.onPress();
      render();
    },
    settle,
    remount: async () => { cleanup(); await settle(); },
    switchAccount: async next => { state.userId = next; auth.currentUser = next ? { uid: next } : null; await settle(); },
  };
}

test('AI disable warning can be cancelled without writing; confirmation revokes', async () => {
  const f = screenFixture();
  await f.settle();
  f.press('Turn off AI');
  assert.match(f.text, /The app will not function as intended/);
  assert.deepEqual(f.writes, []);
  f.press('Cancel');
  assert.deepEqual(f.writes, []);
  assert.match(f.text, /AI is enabled/);
  f.press('Turn off AI');
  f.press('Turn off AI');
  await f.settle();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].allowed, false);
  assert.equal(f.savedAllowed, false);
  assert.match(f.text, /AI is off/);
});

test('failed revocation stays locally off and can be retried', async () => {
  const f = screenFixture({ failWrites: 1 });
  await f.settle();
  f.press('Turn off AI'); f.press('Turn off AI');
  await f.settle();
  assert.equal(f.savedAllowed, true);
  assert.equal(await f.consent.ensureCoreAiConsent(), false);
  assert.match(f.text, /We could not save your revocation/);
  f.press('Retry saving revocation');
  await f.settle();
  assert.equal(f.savedAllowed, false);
  assert.equal(f.writes.length, 2);
});

test('failed revocation remains retryable after leaving and reopening AI privacy', async () => {
  const f = screenFixture({ failWrites: 1 });
  await f.settle();
  f.press('Turn off AI'); f.press('Turn off AI');
  await f.settle();
  await f.remount();
  assert.match(f.text, /We could not save your revocation/);
  f.press('Retry saving revocation');
  await f.settle();
  assert.equal(f.savedAllowed, false);
});

test('a failed re-enable attempt does not hide an unsaved revocation', async () => {
  const f = screenFixture({ failWrites: 2 });
  await f.settle();
  f.press('Turn off AI'); f.press('Turn off AI');
  await f.settle();
  f.press('Allow AI');
  await f.settle();
  f.notices[0].buttons[1].onPress();
  await f.settle();
  assert.match(f.text, /We could not save your revocation/);
  assert.equal(await f.consent.ensureCoreAiConsent(), false);
  f.press('Retry saving revocation');
  await f.settle();
  assert.equal(f.savedAllowed, false);
  assert.equal(f.writes.length, 3);
});

test('re-enabling AI presents the real consent notice before granting access', async () => {
  const f = screenFixture({ allowed: false });
  await f.settle();
  f.press('Allow AI');
  await f.settle();
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0].message, /Google Gemini/);
  assert.match(f.notices[0].message, /Groq/);
  assert.match(f.notices[0].message, /Settings > Privacy > AI privacy/);
  assert.equal(f.writes.length, 0);
  f.notices[0].buttons[1].onPress();
  await f.settle();
  assert.equal(f.savedAllowed, true);
  assert.match(f.text, /AI is enabled/);
});

test('signed-out AI privacy displays its explanation without account controls', async () => {
  const f = screenFixture({ userId: null });
  await f.settle();
  assert.match(f.text, /How Bits uses AI/);
  assert.match(f.text, /Sign in to manage your AI privacy choices/);
  assert.deepEqual(f.buttonLabels(), ['Back']);
  assert.equal(f.reads, 0);
  assert.equal(f.writes.length, 0);
});

test('a failed consent read has an explicit retry that reloads choices', async () => {
  const f = screenFixture({ failReads: 1 });
  await f.settle();
  assert.match(f.text, /Unable to load your AI choice/);
  assert.equal(f.buttonLabels().includes('Turn off AI'), false);
  f.press('Try again');
  await f.settle();
  assert.equal(f.reads, 2);
  assert.match(f.text, /AI is enabled/);
});

test('switching accounts closes a pending disable confirmation', async () => {
  const f = screenFixture();
  await f.settle();
  f.press('Turn off AI');
  await f.switchAccount('bob');
  assert.equal(f.buttonLabels().includes('Cancel'), false);
  assert.equal(f.writes.length, 0);
});
