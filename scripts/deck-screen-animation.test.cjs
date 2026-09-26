const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function sourceTree(filename) {
  const absolute = path.join(__dirname, '..', filename);
  return ts.createSourceFile(absolute, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findAll(root, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function only(matches, description) {
  assert.equal(matches.length, 1, `Expected one ${description}`);
  return matches[0];
}

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

const deckTree = sourceTree('src/screens/DeckScreen.tsx');
const calendarTree = sourceTree('src/screens/SmartCalendarScreen.tsx');

// Execute the real effect AND its dependency expression. Only this effect is
// isolated; dependency comparisons and cleanup follow React's Object.is rules.
function entranceFixture() {
  const effect = only(findAll(deckTree, node => ts.isCallExpression(node)
    && node.expression.getText(deckTree) === 'useEffect'
    && node.arguments[0]?.getText(deckTree).includes('uiAppear.setValue')), 'screen entrance effect');
  const script = new vm.Script(compile(effect.getText(deckTree)));
  const resets = [], animations = [];
  const uiAppear = { value: 0, setValue(value) { this.value = value; resets.push(value); } };
  let previousDependencies, cleanup;
  const context = vm.createContext({
    loading: true, index: 0, state: { swipeBank: { current: 10 } }, uiAppear,
    Animated: {
      timing(value, options) {
        const animation = {
          options, starts: 0, stops: 0,
          start() { this.starts++; value.value = options.toValue; },
          stop() { this.stops++; },
        };
        animations.push(animation);
        return animation;
      },
    },
    useEffect(callback, dependencies) {
      if (previousDependencies && dependencies.length === previousDependencies.length
        && dependencies.every((value, index) => Object.is(value, previousDependencies[index]))) return;
      cleanup?.();
      previousDependencies = [...dependencies];
      cleanup = callback();
    },
  });
  return {
    resets, animations, uiAppear,
    render(values = {}) { Object.assign(context, values); script.runInContext(context); },
    unmount() { cleanup?.(); cleanup = undefined; },
  };
}

test('DeckScreen fades in once when the first deck becomes ready', () => {
  const fixture = entranceFixture();
  fixture.render();
  assert.equal(fixture.animations.length, 0);
  fixture.render({ loading: false });
  assert.deepEqual(fixture.resets, [0]);
  assert.equal(fixture.animations.length, 1);
  assert.equal(fixture.animations[0].starts, 1);
  assert.equal(fixture.animations[0].options.toValue, 1);
  assert.equal(fixture.animations[0].options.useNativeDriver, true);
  assert.equal(fixture.uiAppear.value, 1);
});

test('swipes, credit updates, and undo keep the whole screen visible without replaying its entrance', () => {
  const fixture = entranceFixture();
  fixture.render({ loading: false });
  fixture.render({ index: 1 });
  fixture.render({ state: { swipeBank: { current: 9 } } });
  fixture.render({ index: 2, state: { swipeBank: { current: 8 } } });
  fixture.render({ index: 1 });
  fixture.render({ state: { swipeBank: { current: 0 } } });
  fixture.render();
  assert.deepEqual(fixture.resets, [0], 'card changes must never reset screen opacity to zero');
  assert.equal(fixture.animations.length, 1);
  assert.equal(fixture.animations[0].stops, 0);
  assert.equal(fixture.uiAppear.value, 1);
});

test('a genuinely new loading cycle replays the entrance and cleans up its animation', () => {
  const fixture = entranceFixture();
  fixture.render({ loading: false });
  fixture.render({ loading: true });
  assert.equal(fixture.animations[0].stops, 1);
  fixture.render({ index: 0, state: { swipeBank: { current: 10 } } });
  assert.equal(fixture.animations.length, 1);
  fixture.render({ loading: false });
  assert.deepEqual(fixture.resets, [0, 0]);
  assert.equal(fixture.animations.length, 2);
  assert.equal(fixture.animations[1].starts, 1);
  fixture.unmount();
  assert.equal(fixture.animations[1].stops, 1);
});

function attribute(element, name) {
  return element.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.text === name)
    ?.initializer?.expression;
}

function evaluate(expression, context) {
  const exports = {};
  vm.runInNewContext(compile(`exports.handler = (${expression});`), { ...context, exports });
  return exports.handler;
}

function calendarRightSwipe(context) {
  const deck = only(findAll(calendarTree, node => ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(calendarTree) === 'SwipeDeck'
    && attribute(node, 'ref')?.getText(calendarTree) === 'suggestionDeckRef'), 'calendar suggestion deck');
  return evaluate(attribute(deck, 'onSwipeRight').getText(calendarTree), context);
}

test('Smart Calendar returns the scheduling promise so the deck can wait for the result', async () => {
  const selectedGap = { id: 'gap' }, suggestion = { id: 'suggestion' };
  const calls = [];
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const handler = calendarRightSwipe({
    selectedGap, gapSuggestions: [suggestion], suggestionIndex: 0,
    scheduleSuggestion(...args) { calls.push(args); return pending; },
  });
  const result = handler();
  assert.equal(typeof result?.then, 'function');
  assert.deepEqual(calls, [[selectedGap, suggestion]]);
  let settled = false;
  result.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolve('scheduled');
  assert.equal(await result, 'scheduled');
});

test('Smart Calendar exposes scheduling failures and ignores unavailable suggestions', async () => {
  const context = {
    selectedGap: { id: 'gap' }, gapSuggestions: [{ id: 'suggestion' }], suggestionIndex: 0,
    scheduleSuggestion: () => Promise.reject(new Error('Calendar unavailable')),
  };
  await assert.rejects(calendarRightSwipe(context)(), /Calendar unavailable/);
  for (const overrides of [{ selectedGap: null }, { suggestionIndex: 1 }]) {
    const handler = calendarRightSwipe({
      ...context, ...overrides,
      scheduleSuggestion() { assert.fail('Cannot schedule without a selected gap and suggestion'); },
    });
    assert.equal(handler(), undefined);
  }
});

for (const [tree, reference] of [[deckTree, 'deckRef'], [deckTree, 'inspectDeckRef'], [calendarTree, 'suggestionDeckRef']]) {
  test(`${reference} buttons route both actions through the swipe animation`, () => {
    for (const direction of ['swipeLeft', 'swipeRight']) {
      const handler = only(findAll(tree, node => ts.isJsxAttribute(node) && node.name.text === 'onPress'
        && node.initializer?.expression?.getText(tree).includes(`${reference}.current?.${direction}()`)), `${reference} ${direction} button`);
      const calls = [];
      const ref = { current: { [direction]: () => calls.push(direction) } };
      const press = evaluate(handler.initializer.expression.getText(tree), { [reference]: ref });
      press();
      assert.deepEqual(calls, [direction]);
      ref.current = null;
      assert.doesNotThrow(press, 'a removed deck must not receive a late button press');
      assert.deepEqual(calls, [direction]);
    }
  });
}
