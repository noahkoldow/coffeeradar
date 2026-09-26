const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/components/ads/NativeAdSlide.tsx');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const hooks = [];
  const requests = [];
  let cursor = 0;
  let effects = [];
  let dirty = true;
  let mounted = true;
  let tree;
  let props = { suggestion: { id: 'sponsored-card', adKeywords: ['coffee'] }, preview: false };
  const react = {
    createElement(type, props, ...children) {
      if (type === 'NativeAdView') assert.equal(props.nativeAd.destroyed, false, 'never render a destroyed native ad');
      return { type, props, children };
    },
    useMemo(factory) { cursor++; return factory(); },
    useRef(initial) {
      const slot = cursor++;
      return hooks[slot] ?? (hooks[slot] = { current: initial });
    },
    useState(initial) {
      const slot = cursor++;
      if (!hooks[slot]) hooks[slot] = { value: initial };
      return [hooks[slot].value, value => {
        assert.ok(mounted, 'no state writes after unmount');
        if (!Object.is(hooks[slot].value, value)) {
          hooks[slot].value = value;
          dirty = true;
        }
      }];
    },
    useEffect(effect, dependencies) {
      const slot = cursor++;
      const previous = hooks[slot];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          hooks[slot] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  react.default = react;
  const theme = { colors: {}, spacing: {}, fonts: {}, radius: {} };
  const dependencies = {
    react,
    'react-native': {
      View: 'View', Text: 'Text', Image: 'Image',
      StyleSheet: { create: styles => styles },
    },
    '../BrandLoader': { BrandLoader: 'BrandLoader' },
    '../../theme/ThemeProvider': { useTheme: () => theme },
    '../cardConstants': { CARD_HEIGHT: 500 },
    '../../services/ads/adConfig': { AD_UNIT_IDS: { native: 'test-ad' } },
    '../../services/ads/consent': { buildAdRequestOptions: () => ({}) },
    '../../services/ads/mobileAds': {
      isAdsAvailable: true,
      adsSdk: {
        NativeAdView: 'NativeAdView', NativeAsset: 'NativeAsset', NativeMediaView: 'NativeMediaView', NativeAssetType: {},
        NativeAd: { createForAdRequest() {
          let resolve;
          const promise = new Promise(done => { resolve = done; });
          requests.push({ resolve });
          return promise;
        } },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  }, { filename });
  function render() {
    let renders = 0;
    while (dirty && mounted) {
      assert.ok(renders++ < 10, 'effects settle');
      cursor = 0;
      dirty = false;
      effects = [];
      tree = exports.NativeAdSlide(props);
      effects.forEach(effect => effect());
    }
    return tree;
  }
  render();
  return {
    requests,
    render,
    preview(value) { props = { ...props, preview: value }; dirty = true; return render(); },
    unmount() { mounted = false; hooks.forEach(slot => slot?.cleanup?.()); },
  };
}

function ad(headline) {
  return { headline, destroyed: false, destroyCalls: 0, destroy() { this.destroyed = true; this.destroyCalls++; } };
}

test('undo hides and releases the active ad, then promotion requests a fresh ad', async () => {
  const card = fixture();
  const first = ad('First ad');
  card.requests[0].resolve(first);
  await tick();
  assert.equal(card.render().props.nativeAd, first);

  assert.equal(card.preview(true).type, 'View');
  assert.equal(first.destroyCalls, 1);
  assert.equal(card.requests.length, 1, 'background preview does not request an ad');

  assert.equal(card.preview(false).type, 'View', 'promotion waits for a fresh ad');
  assert.equal(card.requests.length, 2);
  const replacement = ad('Replacement ad');
  card.requests[1].resolve(replacement);
  await tick();
  assert.equal(card.render().props.nativeAd, replacement);
  card.unmount();
  assert.equal(replacement.destroyCalls, 1);
});

test('late ads from a previous active period are destroyed and never replace the new ad', async () => {
  const card = fixture();
  card.preview(true);
  card.preview(false);
  const replacement = ad('Current ad');
  card.requests[1].resolve(replacement);
  await tick();
  assert.equal(card.render().props.nativeAd, replacement);

  const stale = ad('Late stale ad');
  card.requests[0].resolve(stale);
  await tick();
  assert.equal(stale.destroyCalls, 1);
  assert.equal(card.render().props.nativeAd, replacement);
  card.unmount();
});
