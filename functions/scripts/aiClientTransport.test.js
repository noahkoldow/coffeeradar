const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/services/firebaseAiLogic.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function transport({ allowed = true, response = { data: { text: ' {"ok":true} ' } }, failure, authFailure,
  switchDuringConsent = false, switchDuringGeneration = false } = {}) {
  const events = [];
  const calls = [];
  const functions = {};
  const auth = { currentUser: { uid: 'test-user' } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require(name) {
      if (name === './firebase') return {
        functions,
        auth,
        ensureAuth: async () => {
          events.push('auth');
          if (authFailure) throw authFailure;
          return 'test-user';
        },
      };
      if (name === './aiConsent') return {
        ensureCoreAiConsent: async () => {
          events.push('consent');
          if (switchDuringConsent) auth.currentUser = { uid: 'another-user' };
          return allowed;
        },
      };
      if (name === 'firebase/functions') return {
        httpsCallable(instance, name, options) {
          assert.equal(instance, functions);
          return async (payload) => {
            events.push('inference');
            calls.push({ name, options, payload });
            if (failure) throw failure;
            if (switchDuringGeneration) auth.currentUser = { uid: 'another-user' };
            return response;
          };
        },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { generate: module.exports.generateJsonWithFirebaseAiLogic, events, calls };
}

test('client authenticates and obtains consent before routing JSON and images through the callable', async () => {
  const client = transport();
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  const image = { mimeType: 'image/png', data: 'example-base64' };
  const result = await client.generate({ prompt: 'Test', model: 'client-model', topP: 0.8, topK: 12,
    timeoutMs: 12000, maxOutputTokens: 300, temperature: 0, responseSchema: schema, image });
  assert.equal(result, '{"ok":true}');
  assert.deepEqual(client.events, ['auth', 'consent', 'inference']);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, 'generateAiJson');
  assert.equal(client.calls[0].options.timeout, 27000);
  assert.deepEqual(JSON.parse(JSON.stringify(client.calls[0].payload)), {
    prompt: 'Test', timeoutMs: 12000, maxOutputTokens: 300, temperature: 0, responseSchema: schema, image,
  });
});

test('client clamps provider deadlines and reserves infrastructure time', async () => {
  for (const [requested, expected] of [[undefined, 20000], [NaN, 20000], [Infinity, 20000], [0, 1000], [-1, 1000], [1234.9, 1234], [30000, 25000]]) {
    const client = transport();
    await client.generate({ prompt: 'Test', timeoutMs: requested });
    assert.equal(client.calls[0].payload.timeoutMs, expected);
    assert.equal(client.calls[0].options.timeout, expected + 15000);
    assert.deepEqual(Object.keys(client.calls[0].payload).sort(), ['prompt', 'timeoutMs']);
  }
});

test('client preserves server error identity and retry details without direct-model fallback', async () => {
  const failure = Object.assign(new Error('Capacity unavailable'), {
    code: 'functions/resource-exhausted', details: { retryAfterMs: 60000 },
  });
  const client = transport({ failure });
  await assert.rejects(client.generate({ prompt: 'Test' }), (error) => error === failure);
  assert.equal(client.calls.length, 1);
});

test('client never submits prompts when authentication or consent is missing', async () => {
  const authFailure = new Error('User not authenticated');
  const anonymous = transport({ authFailure });
  await assert.rejects(anonymous.generate({ prompt: 'Private context' }), (error) => error === authFailure);
  assert.deepEqual(anonymous.events, ['auth']);
  assert.equal(anonymous.calls.length, 0);
  const declined = transport({ allowed: false });
  await assert.rejects(declined.generate({ prompt: 'Private context' }), (error) => error.code === 'functions/permission-denied');
  assert.deepEqual(declined.events, ['auth', 'consent']);
  assert.equal(declined.calls.length, 0);
});

test('client rejects malformed or empty callable responses', async () => {
  for (const response of [{ data: { text: '  ' } }, { data: { text: 17 } }, { data: {} }, {}]) {
    await assert.rejects(transport({ response }).generate({ prompt: 'Test' }), /empty response/);
  }
});

test('client does not submit prompts or return private results across account switches', async () => {
  const consentSwitch = transport({ switchDuringConsent: true });
  await assert.rejects(consentSwitch.generate({ prompt: 'Private context' }), (error) => error.code === 'functions/unauthenticated');
  assert.equal(consentSwitch.calls.length, 0);
  const resultSwitch = transport({ switchDuringGeneration: true });
  await assert.rejects(resultSwitch.generate({ prompt: 'Private context' }), (error) => error.code === 'functions/unauthenticated');
  assert.equal(resultSwitch.calls.length, 1);
});
