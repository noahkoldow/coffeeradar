const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '..', 'src/screens/PremiumScreen.tsx');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const APPLE_URL = 'https://apps.apple.com/account/subscriptions';
const GOOGLE_URL = 'https://play.google.com/store/account/subscriptions';
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual screen's press handlers with local hook state. Native URL
// opening is replaced with a spy, so these tests never visit a store or network.
function fixture({ platform = 'ios', isPremium = true, language = 'en', onOpen = async () => {} } = {}) {
  let index = 0, tree;
  const slots = [], urls = [], entitlementMutations = [];
  const state = new Proxy({ isPremium }, {
    set: (_target, key, value) => { entitlementMutations.push({ key, value }); return true; },
  });
  const actions = new Proxy({}, {
    get: (_target, key) => (...args) => entitlementMutations.push({ key, args }),
  });
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
      return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
    },
  };
  const dependencies = {
    react,
    'react-native': {
      Platform: { OS: platform },
      Linking: { openURL: url => { urls.push(url); return onOpen(url); } },
      Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
      StyleSheet: { create: styles => styles },
    },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../components/PrimaryButton': { PrimaryButton: 'PrimaryButton' },
    '../components/BrandLogo': { BrandLogo: 'BrandLogo' },
    '../state/AppState': { useAppState: () => ({ state, actions }) },
    '../theme/ThemeProvider': { useTheme: () => ({ colors: {}, fonts: {}, spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 }, radius: { md: 12, lg: 16 } }) },
    '../i18n/I18nProvider': { useI18n: () => ({ language }) },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
  }, { filename });
  const render = () => { index = 0; tree = exports.PremiumScreen({ navigation: { goBack() {} } }); };
  const nodes = (node = tree) => node && typeof node === 'object'
    ? [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(child => nodes(child))] : [];
  const text = node => typeof node === 'string' ? node
    : node?.type === 'PrimaryButton' ? node.props.label
      : (node?.props?.children ?? []).flat(Infinity).map(text).join('');
  const buttons = () => nodes().filter(node => ['Pressable', 'PrimaryButton'].includes(node.type));
  const button = label => {
    const matches = buttons().filter(node => text(node) === label);
    assert.equal(matches.length, 1, `Expected one ${label}; found ${buttons().map(text).join(', ')}`);
    return matches[0];
  };
  render();
  return {
    urls, button, render,
    get text() { return text(tree); },
    press: label => { const node = button(label); assert.notEqual(node.props.disabled, true); node.props.onPress(); render(); },
    settle: async () => { await tick(); render(); },
    assertUnchangedEntitlement: () => {
      assert.deepEqual(entitlementMutations, []);
      assert.equal(state.isPremium, isPremium);
    },
  };
}

for (const platform of ['ios', 'android', 'web']) {
  for (const isPremium of [true, false]) {
    test(`${platform}: cancellation is visible before benefits when premium is ${isPremium}`, () => {
      const f = fixture({ platform, isPremium });
      const label = platform === 'web' ? 'Cancel Premium in App Store' : 'Cancel Premium';
      assert.notEqual(f.button(label).props.disabled, true);
      if (platform === 'web') assert.notEqual(f.button('Cancel Premium in Google Play').props.disabled, true);
      assert.ok(f.text.indexOf(label) < f.text.indexOf('Smart Calendar auto-planning'));
      assert.match(f.text, /confirm cancellation of the next renewal/);
      assert.match(f.text, /Premium stays available until the end of your paid period/);
      assert.deepEqual(f.urls, []);
      f.assertUnchangedEntitlement();
    });
  }
}

for (const [platform, preferredUrl, alternateLabel, alternateUrl] of [
  ['ios', APPLE_URL, 'Subscribed on Google Play? Manage there', GOOGLE_URL],
  ['android', GOOGLE_URL, 'Subscribed on the App Store? Manage there', APPLE_URL],
]) {
  test(`${platform}: cancellation opens the correct preferred and alternate stores`, async () => {
    const f = fixture({ platform });
    f.press('Cancel Premium');
    await f.settle();
    assert.deepEqual(f.urls, [preferredUrl]);
    f.press(alternateLabel);
    await f.settle();
    assert.deepEqual(f.urls, [preferredUrl, alternateUrl]);
    f.assertUnchangedEntitlement();
  });

  test(`${platform}: store failure is explained and cancellation can be retried`, async () => {
    let attempts = 0;
    const f = fixture({ platform, onOpen: async () => { if (attempts++ === 0) throw new Error('store unavailable'); } });
    f.press('Cancel Premium');
    await f.settle();
    assert.match(f.text, platform === 'ios' ? /Could not open the App Store/ : /Could not open Google Play/);
    assert.match(f.text, /Subscriptions > Bits/);
    f.press('Cancel Premium');
    await f.settle();
    assert.deepEqual(f.urls, [preferredUrl, preferredUrl]);
    assert.doesNotMatch(f.text, /Could not open/);
    f.assertUnchangedEntitlement();
  });
}

test('web: both store choices open their respective subscription centers', async () => {
  const f = fixture({ platform: 'web', isPremium: false });
  f.press('Cancel Premium in App Store');
  await f.settle();
  f.press('Cancel Premium in Google Play');
  await f.settle();
  assert.deepEqual(f.urls, [APPLE_URL, GOOGLE_URL]);
  f.assertUnchangedEntitlement();
});

for (const platform of ['ios', 'web']) {
  test(`${platform}: rapid duplicate and alternate-store taps open only one pending request`, async () => {
    let finishOpen;
    const f = fixture({ platform, onOpen: () => new Promise(resolve => { finishOpen = resolve; }) });
    const firstLabel = platform === 'ios' ? 'Cancel Premium' : 'Cancel Premium in App Store';
    const otherLabel = platform === 'ios' ? 'Subscribed on Google Play? Manage there' : 'Cancel Premium in Google Play';
    const first = f.button(firstLabel).props.onPress;
    const other = f.button(otherLabel).props.onPress;
    first(); first(); other();
    f.render();
    assert.deepEqual(f.urls, [APPLE_URL]);
    assert.equal(f.button(platform === 'ios' ? 'Opening store…' : firstLabel).props.disabled, true);
    assert.equal(f.button(otherLabel).props.disabled, true);
    finishOpen();
    await f.settle();
    assert.equal(f.button(firstLabel).props.disabled, false);
    f.press(otherLabel);
    assert.deepEqual(f.urls, [APPLE_URL, GOOGLE_URL]);
    finishOpen();
    await f.settle();
    f.assertUnchangedEntitlement();
  });
}

test('German cancellation action and store choices are translated', () => {
  for (const platform of ['ios', 'android', 'web']) {
    const f = fixture({ platform, language: 'de', isPremium: false });
    if (platform === 'web') {
      f.button('Premium im App Store kündigen');
      f.button('Premium in Google Play kündigen');
    } else f.button('Premium kündigen');
    assert.match(f.text, /Premium bleibt bis zum Ende des bezahlten Zeitraums verfügbar/);
  }
});
