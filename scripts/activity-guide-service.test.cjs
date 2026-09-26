const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/services/geminiSuggestions.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function loadGuideService(generate = async () => JSON.stringify({ steps: ['Take a walk.'] })) {
  const calls = [];
  const debugMessages = [];
  const dependencies = {
    './debug': { addDebugMessage: (...args) => debugMessages.push(args) },
    '../utils/time': {},
    './discoveryTiming': {},
    '../utils/storage': {
      loadPremiumActive: async () => false,
      loadGeminiUsage: async () => null,
      saveGeminiUsage: async () => {},
    },
    '../utils/challengeMode': {},
    './firebaseAiLogic': {
      generateJsonWithFirebaseAiLogic: async request => {
        calls.push(JSON.parse(JSON.stringify(request)));
        return generate(request);
      },
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console, Date, Error, Intl, Promise, Map, Set, setTimeout, clearTimeout,
    require(name) {
      assert.ok(dependencies[name], `Unexpected module ${name}`);
      return dependencies[name];
    },
  });
  return { generateActivityGuide: exports.generateActivityGuide, calls, debugMessages };
}

const activity = {
  title: 'Riverside sketching',
  hook: 'Draw one small detail',
  description: 'Sketch a bridge beside the river.',
  type: 'GO_OUT',
  durationMin: 30,
  tags: ['creative', 'outdoors'],
  placeName: 'Riverside Park',
  placeAddress: 'River Street 1',
  eventStartAt: '2026-09-25T16:00:00Z',
  eventVenue: 'Park entrance',
  language: 'de',
};

const plain = value => JSON.parse(JSON.stringify(value));

test('requests a bounded checklist with time for backend routing and activity context', async () => {
  const service = loadGuideService();
  assert.deepEqual(plain(await service.generateActivityGuide(activity, 'user-1')), ['Take a walk.']);
  assert.equal(service.calls.length, 1);
  const request = service.calls[0];
  assert.equal(request.timeoutMs, 25000);
  assert.equal(request.maxOutputTokens, 700);
  assert.deepEqual(request.responseSchema, {
    type: 'object',
    properties: { steps: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', minLength: 1 } } },
    required: ['steps'],
  });
  for (const context of [activity.title, activity.hook, activity.description, activity.type,
    '30 minutes', 'creative, outdoors', activity.placeName, activity.placeAddress,
    activity.eventStartAt, activity.eventVenue, 'natural German']) {
    assert.ok(request.prompt.includes(context), `Prompt includes ${context}`);
  }
});

test('keeps only trimmed nonblank strings and caps generated steps at six', async () => {
  const service = loadGuideService(async () => JSON.stringify({
    steps: [null, {}, 42, false, '  ', '  Start here.  ', 'Next.', 'Third.', 'Fourth.', 'Fifth.', 'Sixth.', 'Seventh.'],
  }));
  assert.deepEqual(plain(await service.generateActivityGuide(activity, 'user-1')), [
    'Start here.', 'Next.', 'Third.', 'Fourth.', 'Fifth.', 'Sixth.',
  ]);
});

test('returns null for malformed, empty, or nonstring checklist responses', async () => {
  const responses = ['not json', 'null', '{}', '[]', '{"steps":null}', '{"steps":"Go outside."}',
    '{"steps":[]}', '{"steps":[null,42,{},false," "]}'];
  for (const response of responses) {
    const service = loadGuideService(async () => response);
    assert.equal(await service.generateActivityGuide(activity, 'user-1'), null, response);
    assert.equal(service.calls.length, 1, 'Does not retry invalid output automatically');
  }
});

test('does not request a checklist without a signed-in user', async () => {
  const service = loadGuideService();
  assert.equal(await service.generateActivityGuide(activity, null), null);
  assert.equal(await service.generateActivityGuide(activity), null);
  assert.equal(service.calls.length, 0);
});

test('returns null and logs transport failure without making another request', async () => {
  const service = loadGuideService(async () => {
    throw Object.assign(new Error('Timed out'), { code: 'functions/deadline-exceeded' });
  });
  assert.equal(await service.generateActivityGuide(activity, 'user-1'), null);
  assert.equal(service.calls.length, 1);
  assert.equal(service.debugMessages.length, 1);
  assert.match(service.debugMessages[0][1], /generateActivityGuide failed: Timed out/);
});
