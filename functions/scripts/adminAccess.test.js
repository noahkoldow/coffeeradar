const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../src/services/adminAccess.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function client(options = {}) {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const calls = [];
  const tokenRequests = [];
  const user = { uid: 'admin-user', email: 'bitsapp.admin@gmail.com', emailVerified: false,
    isAnonymous: false, providerData: [], ...options.user,
    getIdTokenResult: async force => {
      tokenRequests.push(force);
      if (options.token) return options.token();
      return { claims: { admin: options.claim ?? true }, expirationTime: new Date(now + 3600000).toISOString() };
    } };
  const auth = { currentUser: options.signedOut ? null : user };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, Date: Clock,
    require(name) {
      if (name === './firebase') return { auth, functions: {}, ensureAuth: async () => {
        if (!auth.currentUser) throw new Error('No user');
        return auth.currentUser.uid;
      } };
      if (name === 'firebase/functions') return { httpsCallable: (_instance, name) => async payload => {
        calls.push({ name, payload });
        if (options.access) return options.access();
        return { data: { admin: options.serverAdmin ?? true, claimsChanged: false } };
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { ...module.exports, auth, user, calls, tokenRequests, advance: milliseconds => { now += milliseconds; } };
}

test('admin recovery reconciles server authority and refreshes stale claims even when claimsChanged is false', async () => {
  const app = client();
  assert.equal(app.getCachedAdminAccess('bitsapp.admin@gmail.com'), false);
  assert.equal(await app.resolveAdminAccess(), true);
  assert.deepEqual(app.calls, [{ name: 'getAccountAccess', payload: undefined }]);
  assert.deepEqual(app.tokenRequests, [true]);
  assert.equal(app.getCachedAdminAccess('BITSAPP.ADMIN@gmail.com'), true);
  assert.equal(app.getCachedAdminAccess('other@example.com'), false);
});

test('email identity or UI configuration cannot grant admin without server authority and a boolean token claim', async () => {
  for (const options of [{ serverAdmin: false }, { claim: false }, { claim: 'true' }, { claim: 1 }]) {
    const app = client(options);
    assert.equal(await app.resolveAdminAccess(), false);
    assert.equal(app.getCachedAdminAccess('bitsapp.admin@gmail.com'), false);
  }
});

test('an explicitly provisioned server admin is respected without pretending the email was verified', async () => {
  const app = client({ user: { emailVerified: false }, serverAdmin: true, claim: true });
  assert.equal(await app.resolveAdminAccess(), true);
  assert.equal(app.user.emailVerified, false);
});

test('signed-out and anonymous accounts never trigger admin reconciliation', async () => {
  for (const options of [{ signedOut: true }, { user: { isAnonymous: true } }]) {
    const app = client(options);
    assert.equal(await app.resolveAdminAccess(), false);
    assert.equal(app.calls.length, 0);
    assert.equal(app.getCachedAdminAccess(), false);
  }
});

test('concurrent screens share one account reconciliation and token refresh', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const app = client({ access: () => response });
  const requests = Array.from({ length: 20 }, () => app.resolveAdminAccess());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, 1);
  release({ data: { admin: true } });
  assert.equal((await Promise.all(requests)).every(Boolean), true);
  assert.equal(app.tokenRequests.length, 1);
});

test('a transient callable failure falls back to a freshly issued claim, never email matching', async () => {
  for (const claim of [true, false]) {
    const app = client({ claim, access: async () => { throw Object.assign(new Error('Offline'), { code: 'functions/unavailable' }); } });
    assert.equal(await app.resolveAdminAccess(), claim);
    assert.deepEqual(app.tokenRequests, [true]);
  }
});

test('explicit server denial clears a cached role even if token refresh is temporarily unavailable', async () => {
  let deny = false;
  const app = client({ access: async () => ({ data: { admin: !deny } }), token: async () => {
    if (deny) throw new Error('Offline');
    return { claims: { admin: true }, expirationTime: new Date(Date.now() + 3600000).toISOString() };
  } });
  assert.equal(await app.resolveAdminAccess(), true);
  deny = true;
  assert.equal(await app.resolveAdminAccess(), false);
  assert.equal(app.getCachedAdminAccess(), false);
});

test('permission-denied and unauthenticated replies never fall back to a token claim', async () => {
  for (const code of ['functions/permission-denied', 'functions/unauthenticated']) {
    const app = client({ access: async () => { throw Object.assign(new Error('Denied'), { code }); } });
    assert.equal(await app.resolveAdminAccess(), false);
    assert.equal(app.tokenRequests.length, 0);
  }
});

test('display authority remains after one minute, expires with the signed token, and never crosses accounts', async () => {
  const app = client();
  await app.resolveAdminAccess();
  app.advance(60001);
  assert.equal(app.getCachedAdminAccess(), true);
  app.advance(3600000);
  assert.equal(app.getCachedAdminAccess(), false);
  await app.resolveAdminAccess();
  assert.equal(app.getCachedAdminAccess(), true);
  app.auth.currentUser = { ...app.user };
  assert.equal(app.getCachedAdminAccess(), false);
  app.auth.currentUser = null;
  assert.equal(app.getCachedAdminAccess(), false);
});

test('an account switch during reconciliation cannot populate another user role', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const app = client({ access: () => response });
  const request = app.resolveAdminAccess();
  await new Promise(resolve => setImmediate(resolve));
  app.auth.currentUser = { ...app.user, uid: 'ordinary-user', email: 'ordinary@example.com' };
  release({ data: { admin: true } });
  assert.equal(await request, false);
  assert.equal(app.tokenRequests.length, 0);
  assert.equal(app.getCachedAdminAccess(), false);
});

test('role subscribers receive server-verified updates and can unsubscribe', async () => {
  const app = client();
  const states = [];
  const unsubscribe = app.subscribeAdminAccess(() => states.push(app.getCachedAdminAccess()));
  await app.resolveAdminAccess();
  unsubscribe();
  await app.resolveAdminAccess();
  assert.deepEqual(states, [true]);
});

test('screen admin hook rechecks on focus, foreground and bounded interval without trusting stale app identity', async () => {
  const hookSource = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../../src/services/useAdminAccess.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const states = [];
  const focusCallbacks = [];
  let onForeground;
  let onInterval;
  let intervalCleared = false;
  let removed = false;
  let calls = 0;
  const module = { exports: {} };
  vm.runInNewContext(hookSource, { exports: module.exports, module,
    setInterval: (callback, delay) => { assert.equal(delay, 300000); onInterval = callback; return 1; },
    clearInterval: () => { intervalCleared = true; },
    require(name) {
      if (name === 'react') return { useCallback: callback => callback,
        useState: initial => [initial(), value => states.push(value)], useEffect: callback => callback() };
      if (name === 'react-native') return { AppState: { addEventListener: (_event, callback) => {
        onForeground = callback;
        return { remove: () => { removed = true; } };
      } } };
      if (name === '@react-navigation/native') return { useFocusEffect: callback => focusCallbacks.push(callback) };
      if (name === './firebase') return { auth: { currentUser: { uid: 'current-admin' } } };
      if (name === './adminAccess') return {
        getCachedAdminAccess: () => true,
        subscribeAdminAccess: () => () => {},
        resolveAdminAccess: async () => { calls++; return true; },
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  assert.equal(module.exports.useAdminAccess('previous-account', null), false);
  const cleanupWrongIdentity = focusCallbacks.pop()();
  assert.equal(calls, 0);
  cleanupWrongIdentity();
  assert.equal(module.exports.useAdminAccess('current-admin', null), true);
  const cleanup = focusCallbacks.pop()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  onForeground('active');
  onInterval();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(states.at(-1), true);
  cleanup();
  assert.equal(removed, true);
  assert.equal(intervalCleared, true);
});
