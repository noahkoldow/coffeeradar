const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the real screen handler with a deferred AI response. In particular,
// Firebase can switch accounts before React has rerendered the old screen.
const sourcePath = path.resolve(__dirname, '../src/screens/CompletionScreen.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleAddAsHabit') {
    handler = node.initializer.getText(tree);
  }
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(handler, 'completion habit handler found');
const compiled = ts.transpileModule(`exports.add = ${handler};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));

function screen() {
  let resolve;
  let reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const added = [];
  const updated = [];
  const requests = [];
  const events = [];
  const context = {
    exports: {},
    useCallback: callback => callback,
    addedAsHabit: false,
    title: "Ramen at Otto's",
    description: 'Try this restaurant.',
    suggestionType: 'GO_OUT',
    durationMin: 30,
    tags: ['food'],
    isGerman: false,
    state: { userId: 'account-a' },
    auth: { currentUser: { uid: 'account-a' } },
    actions: {
      addHabit: habit => added.push(habit),
      updateHabit: habit => updated.push(habit),
    },
    setAddedAsHabit() {},
    Haptics: { notificationAsync() {}, NotificationFeedbackType: { Success: 'success' } },
    logEvent: name => events.push(name),
    generalizeActivityIntoHabit(...args) { requests.push(args); return pending; },
  };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, context, added, updated, requests, events, resolve, reject };
}

const result = {
  name: 'Try a new noodle spot',
  description: 'Explore a nearby restaurant.',
  adaptationGuidance: 'Choose a nearby place when time is short.',
  wasGeneralized: true,
};

test('the active account receives its generalized habit after the immediate save', async () => {
  const instance = screen();
  instance.add();
  assert.equal(instance.added.length, 1);
  assert.equal(instance.added[0].name, "Ramen at Otto's");
  assert.equal(instance.updated.length, 0);
  assert.equal(instance.requests[0][1], 'account-a');
  instance.resolve(result);
  await flush();
  assert.equal(instance.updated.length, 1);
  assert.equal(instance.updated[0].id, instance.added[0].id);
  assert.equal(instance.updated[0].name, result.name);
  assert.equal(instance.updated[0].isGeneralized, true);
});

test('account switch or sign-out discards the late result before any old action writes', async () => {
  for (const nextUser of [{ uid: 'account-b' }, null]) {
    const instance = screen();
    instance.add();
    instance.context.auth.currentUser = nextUser;
    // Deliberately leave state.userId unchanged, reproducing the auth/render gap.
    instance.resolve(result);
    await flush();
    assert.equal(instance.added.length, 1);
    assert.equal(instance.updated.length, 0);
    assert.equal(instance.events.includes('habit_generalized'), false);
  }
});

test('failed or unnecessary AI generalization retains the original saved habit', async () => {
  for (const outcome of [null, { ...result, wasGeneralized: false }, 'reject']) {
    const instance = screen();
    instance.add();
    if (outcome === 'reject') instance.reject(new Error('Provider unavailable'));
    else instance.resolve(outcome);
    await flush();
    assert.equal(instance.added.length, 1);
    assert.equal(instance.updated.length, 0);
  }
});
