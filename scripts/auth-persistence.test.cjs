const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { initializeApp, deleteApp } = require('firebase/app');
const authPackage = path.dirname(require.resolve('@firebase/auth/package.json'));
const nativeAuth = require(path.join(authPackage, 'dist/rn/index.js'));

function loadNativeAuth(storage) {
  const filename = path.join(__dirname, '../src/services/firebaseAuth.native.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'firebase/auth') return nativeAuth;
    if (name === '@react-native-async-storage/async-storage') return storage;
    throw new Error(`Unexpected module: ${name}`);
  } }, { filename });
  return exports.getFirebaseAuth;
}

test('native login survives a cold restart; sign-out clears the persisted session', async () => {
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  const getFirebaseAuth = loadNativeAuth(storage);
  const originalFetch = global.fetch;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'test-user', aud: 'test-project', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
  global.fetch = async url => {
    if (String(url).includes('/accounts:signInWithPassword')) {
      return new Response(JSON.stringify({ localId: 'test-user', email: 'test@example.invalid', idToken: token, refreshToken: 'fake-refresh-token', expiresIn: '3600' }));
    }
    if (String(url).includes('/accounts:lookup')) {
      return new Response(JSON.stringify({ users: [{ localId: 'test-user', email: 'test@example.invalid', emailVerified: true, providerUserInfo: [{ providerId: 'password', email: 'test@example.invalid' }] }] }));
    }
    throw new Error('Unexpected network request in persistence test');
  };
  let app;
  const start = async () => {
    app = initializeApp({ apiKey: 'fake-api-key', projectId: 'test-project' }, 'native-persistence-test');
    const auth = getFirebaseAuth(app);
    await auth.authStateReady();
    return auth;
  };
  try {
    let auth = await start();
    assert.equal(auth.currentUser, null);
    await nativeAuth.signInWithEmailAndPassword(auth, 'test@example.invalid', 'fake-password');
    assert.equal(auth.currentUser.uid, 'test-user');
    assert.ok([...values.keys()].some(key => key.includes('authUser')));
    assert.equal(getFirebaseAuth(app), auth, 'reinitialization keeps the same auth instance');
    await deleteApp(app);
    auth = await start();
    assert.equal(auth.currentUser.uid, 'test-user', 'cold start restores the signed-in user');
    await nativeAuth.signOut(auth);
    await deleteApp(app);
    auth = await start();
    assert.equal(auth.currentUser, null, 'sign-out stays signed out after restart');
  } finally {
    if (app) await deleteApp(app);
    global.fetch = originalFetch;
  }
});
