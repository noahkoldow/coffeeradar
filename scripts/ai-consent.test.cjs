const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(relativePath, dependencies, globals = {}) {
  const filename = path.join(__dirname, '..', relativePath);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unmocked import: ${name}`);
      return dependencies[name];
    },
    ...globals,
  }, { filename });
  return exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function client({ receipt, web = false, onWrite } = {}) {
  const auth = { currentUser: { uid: 'alice' }, onAuthStateChanged: () => () => {} };
  const notices = [];
  const writes = [];
  let reads = 0;
  const service = loadSource('src/services/aiConsent.ts', {
    react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    'react-native': {
      Platform: { OS: web ? 'web' : 'ios' },
      Alert: { alert: (title, message, buttons) => notices.push({ title, message, buttons }) },
    },
    'firebase/functions': {
      httpsCallable: (_functions, name) => async payload => {
        if (name === 'getCoreAiConsent') {
          reads++;
          return { data: receipt ?? { userId: 'alice', allowed: null, version: null, providers: [] } };
        }
        writes.push(payload);
        if (onWrite) await onWrite(payload);
        return { data: { ...payload, providers: payload.allowed ? ['gemini', 'groq'] : [] } };
      },
    },
    './firebase': { auth, ensureAuth: async () => auth.currentUser.uid, functions: {} },
    '../utils/time': { getPreferredLocale: () => 'en-US' },
  }, { window: { confirm: message => { notices.push({ message }); return false; } } });
  return { service, auth, notices, writes, get reads() { return reads; } };
}

test('parallel first AI uses show one notice and wait for one consent write', async () => {
  const c = client();
  const pending = Array.from({ length: 10 }, () => c.service.ensureCoreAiConsent());
  await tick();
  assert.equal(c.notices.length, 1);
  assert.equal(c.reads, 1);
  assert.equal(c.writes.length, 0);
  assert.match(c.notices[0].message, /Google Gemini/);
  assert.match(c.notices[0].message, /Groq/);
  c.notices[0].buttons[1].onPress();
  assert.ok((await Promise.all(pending)).every(Boolean));
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].version, 'multi-provider-v1');
});

test('declining on native or web persists refusal and suppresses later prompts', async () => {
  for (const web of [false, true]) {
    const c = client({ web });
    const pending = c.service.ensureCoreAiConsent();
    if (!web) { await tick(); c.notices[0].buttons[0].onPress(); }
    assert.equal(await pending, false);
    assert.equal(await c.service.ensureCoreAiConsent(), false);
    assert.equal(c.notices.length, 1);
    assert.equal(c.writes[0].allowed, false);
  }
});

test('a saved refusal survives restart but can be changed explicitly in Settings', async () => {
  const c = client({ receipt: { userId: 'alice', allowed: false, version: null, providers: [] } });
  assert.equal(await c.service.ensureCoreAiConsent(), false);
  assert.equal(c.notices.length, 0);
  const pending = c.service.requestCoreAiConsent();
  await tick();
  c.notices[0].buttons[1].onPress();
  assert.equal(await pending, true);
});

test('legacy grants require the multi-provider notice', async () => {
  const c = client({ receipt: { userId: 'alice', allowed: true, version: 'old', providers: ['gemini'] } });
  const pending = c.service.ensureCoreAiConsent();
  await tick();
  assert.equal(c.notices.length, 1);
  c.notices[0].buttons[0].onPress();
  assert.equal(await pending, false);
});

test('revocation wins over an already open consent prompt', async () => {
  const c = client();
  const pending = c.service.ensureCoreAiConsent();
  await tick();
  await c.service.setCoreAiConsent(false);
  c.notices[0].buttons[1].onPress();
  assert.equal(await pending, false);
  assert.equal(c.writes.length, 1);
  assert.equal(c.writes[0].allowed, false);
});

test('an account change while reading the notice cannot consent for a different user', async () => {
  const c = client();
  const pending = c.service.ensureCoreAiConsent();
  await tick();
  c.auth.currentUser = { uid: 'bob' };
  c.notices[0].buttons[1].onPress();
  await assert.rejects(pending, { code: 'functions/unauthenticated' });
  assert.equal(c.writes.length, 0);
});

test('an in-flight grant cannot overwrite a later revocation', async () => {
  let finishGrant;
  const c = client({ onWrite: payload => payload.allowed ? new Promise(resolve => { finishGrant = resolve; }) : undefined });
  const grant = c.service.ensureCoreAiConsent();
  await tick();
  c.notices[0].buttons[1].onPress();
  await tick();
  const revoke = c.service.setCoreAiConsent(false);
  await tick();
  assert.equal(c.service.useCoreAiConsent(), 'disabled');
  finishGrant();
  await Promise.all([grant, revoke]);
  assert.equal(c.writes.length, 2);
  assert.equal(c.writes[1].allowed, false);
  assert.equal(await c.service.ensureCoreAiConsent(), false);
});

test('failed revocation remains disabled on the device until explicitly enabled', async () => {
  const c = client({ onWrite: async () => { throw new Error('offline'); } });
  await assert.rejects(c.service.setCoreAiConsent(false), /offline/);
  assert.equal(await c.service.ensureCoreAiConsent(), false);
  assert.equal(c.notices.length, 0);
});

test('unsaved revocation remains account-scoped and clears after successful retry', async () => {
  let fail = true;
  const c = client({ onWrite: async () => { if (fail) throw new Error('offline'); } });
  await assert.rejects(c.service.setCoreAiConsent(false), /offline/);
  assert.equal(c.service.useCoreAiRevocationPending(), true);
  c.auth.currentUser = { uid: 'bob' };
  assert.equal(c.service.useCoreAiRevocationPending(), false);
  c.auth.currentUser = { uid: 'alice' };
  assert.equal(c.service.useCoreAiRevocationPending(), true);
  fail = false;
  await c.service.setCoreAiConsent(false);
  assert.equal(c.service.useCoreAiRevocationPending(), false);
  assert.equal(c.service.useCoreAiConsent(), 'disabled');
});

test('an older successful grant does not clear a newer pending revocation', async () => {
  let finishGrant, finishRevoke;
  const c = client({ onWrite: payload => new Promise(resolve => {
    if (payload.allowed) finishGrant = resolve;
    else finishRevoke = resolve;
  }) });
  const grant = c.service.requestCoreAiConsent();
  await tick();
  c.notices[0].buttons[1].onPress();
  await tick();
  const revoke = c.service.setCoreAiConsent(false);
  await tick();
  assert.equal(c.service.useCoreAiRevocationPending(), true);
  finishGrant();
  await tick();
  assert.equal(c.service.useCoreAiRevocationPending(), true);
  finishRevoke();
  await Promise.all([grant, revoke]);
  assert.equal(c.service.useCoreAiRevocationPending(), false);
  assert.equal(c.service.useCoreAiConsent(), 'disabled');
});

test('explicit successful re-enable resolves an earlier unsaved revocation', async () => {
  const c = client({ onWrite: async payload => { if (!payload.allowed) throw new Error('offline'); } });
  await assert.rejects(c.service.setCoreAiConsent(false), /offline/);
  const grant = c.service.requestCoreAiConsent();
  await tick();
  c.notices[0].buttons[1].onPress();
  assert.equal(await grant, true);
  assert.equal(c.service.useCoreAiRevocationPending(), false);
  assert.equal(c.service.useCoreAiConsent(), 'enabled');
});

function server() {
  const writes = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const firestore = Object.assign(() => ({ doc: path => ({
    get: async () => ({ data: () => undefined }),
    set: async receipt => writes.push({ path, receipt }),
  }) }), { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } });
  const handlers = loadSource('functions/src/aiConsent.ts', {
    'firebase-admin': { firestore },
    'firebase-functions/v2/https': { HttpsError, onCall: (_options, handler) => handler },
  });
  return { handlers, writes };
}

test('server rejects unauthenticated, cross-account, and outdated consent grants', async () => {
  const { handlers, writes } = server();
  await assert.rejects(handlers.setCoreAiConsent({ data: {} }), { code: 'unauthenticated' });
  await assert.rejects(handlers.setCoreAiConsent({ auth: { uid: 'alice' }, data: { userId: 'bob', allowed: true, version: 'multi-provider-v1' } }), { code: 'permission-denied' });
  await assert.rejects(handlers.setCoreAiConsent({ auth: { uid: 'alice' }, data: { userId: 'alice', allowed: true, version: 'old' } }), { code: 'failed-precondition' });
  assert.equal(writes.length, 0);
});

test('server controls receipt providers and timestamps, and accepts legacy revocation', async () => {
  const { handlers, writes } = server();
  await handlers.setCoreAiConsent({ auth: { uid: 'alice' }, data: { userId: 'alice', allowed: true, version: 'multi-provider-v1', providers: ['unapproved'], acceptedAt: 'forged' } });
  assert.deepEqual(Array.from(writes[0].receipt.providers), ['gemini', 'groq']);
  assert.equal(writes[0].receipt.acceptedAt, 'SERVER_TIMESTAMP');
  await handlers.setCoreAiConsent({ auth: { uid: 'alice' }, data: { userId: 'alice', allowed: false, version: 'old' } });
  assert.equal(writes[1].receipt.allowed, false);
  assert.equal(writes[1].receipt.providers.length, 0);
});
