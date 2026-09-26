const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/services/activityChat.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));
const signedInUser = { uid: 'signed-in-user', isAnonymous: false };
const thread = {
  threadId: 'walk_berlin', suggestionId: 'walk', title: 'A walk',
  expiresAt: '2026-10-01T12:00:00.000Z', regionLabel: 'Berlin',
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadChatService(options = {}) {
  const calls = [];
  const listeners = [];
  let authReadyCalls = 0;
  const auth = options.auth === null ? null : {
    currentUser: Object.hasOwn(options, 'user') ? options.user : signedInUser,
    authStateReady() {
      authReadyCalls += 1;
      return options.authReady ?? Promise.resolve();
    },
  };
  const record = (name, fallback) => (...args) => {
    calls.push({ name, args });
    return options[name] ? options[name](...args) : fallback(...args);
  };
  const firestore = {
    collection: (_, ...segments) => ({ path: segments.join('/') }),
    doc: (_, ...segments) => ({ path: segments.join('/') }),
    query: (ref, ...constraints) => ({ ...ref, constraints }),
    orderBy: (field, direction) => ({ field, direction }),
    serverTimestamp: () => ({ sentinel: 'server-timestamp' }),
    Timestamp: { fromDate: date => ({ milliseconds: date.getTime() }) },
    addDoc: record('addDoc', async () => ({ id: 'new-message' })),
    setDoc: record('setDoc', async () => undefined),
    updateDoc: record('updateDoc', async () => undefined),
    getDoc: record('getDoc', async () => ({ exists: () => false })),
    getDocs: record('getDocs', async () => ({ size: 0 })),
    onSnapshot: record('onSnapshot', (query, onChange, onError) => {
      const listener = { query, onChange, onError, unsubscribed: false };
      listeners.push(listener);
      return () => { listener.unsubscribed = true; };
    }),
  };
  const dependencies = {
    'firebase/firestore': firestore,
    './firebase': {
      auth,
      db: options.db === null ? null : {},
      firebaseEnabled: options.firebaseEnabled ?? true,
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Error, Promise,
    require(name) {
      assert.ok(dependencies[name], `Unexpected module ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return {
    ...exports, auth, calls, listeners,
    get authReadyCalls() { return authReadyCalls; },
    callsOf: name => calls.filter(call => call.name === name),
    writes: () => calls.filter(call => ['addDoc', 'setDoc', 'updateDoc'].includes(call.name)),
  };
}

test('send waits for the restored authenticated session and uses its user ID', async () => {
  const restoration = deferred();
  const service = loadChatService({ user: null, authReady: restoration.promise });
  const sending = service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada');
  await Promise.resolve();
  assert.equal(service.authReadyCalls, 1);
  assert.equal(service.writes().length, 0, 'No write before authentication finishes');

  service.auth.currentUser = { uid: 'restored-user', isAnonymous: false };
  restoration.resolve();
  await sending;
  assert.equal(service.callsOf('addDoc').length, 1);
  const [reference, message] = service.callsOf('addDoc')[0].args;
  assert.equal(reference.path, 'activity_chats/walk_berlin/messages');
  assert.equal(message.authorId, 'restored-user');
});

for (const [label, options, expectedCode] of [
  ['signed out', { user: null }, 'activity-chat/unauthenticated'],
  ['anonymous', { user: { uid: 'guest', isAnonymous: true } }, 'activity-chat/unauthenticated'],
  ['disabled Firebase', { firebaseEnabled: false }, 'activity-chat/unavailable'],
  ['missing auth', { auth: null }, 'activity-chat/unavailable'],
  ['missing database', { db: null }, 'activity-chat/unavailable'],
]) {
  test(`${label}: send, load and ensure report failure without accessing Firestore`, async () => {
    const service = loadChatService(options);
    for (const operation of [
      () => service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada'),
      () => service.loadActivityChatThread(thread.threadId),
      () => service.ensureActivityChatThread(thread),
    ]) {
      await assert.rejects(operation, { code: expectedCode });
    }
    assert.equal(service.calls.length, 0);
  });
}

test('authentication restoration failures reach send, load and ensure callers', async () => {
  const restoration = deferred();
  const service = loadChatService({ authReady: restoration.promise });
  const operations = [
    service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada'),
    service.loadActivityChatThread(thread.threadId),
    service.ensureActivityChatThread(thread),
  ];
  const error = new Error('Session restoration failed');
  const assertions = operations.map(operation => assert.rejects(operation, failure => failure === error));
  restoration.reject(error);
  await Promise.all(assertions);
  assert.equal(service.calls.length, 0);
});

test('send trims the body, normalizes whitespace and caps the author name at 32 characters', async () => {
  const service = loadChatService();
  const name = '  Ada   Lovelace\n' + 'Long name '.repeat(5);
  await service.sendActivityChatMessage(thread.threadId, '  Hello everyone!\n ', name);
  const message = service.callsOf('addDoc')[0].args[1];
  assert.equal(message.body, 'Hello everyone!');
  assert.equal(message.authorName, name.trim().replace(/\s+/g, ' ').slice(0, 32));
  assert.equal(message.authorName.length, 32);
  assert.equal(message.authorId, signedInUser.uid);
  assert.deepEqual(plain(message.createdAt), { sentinel: 'server-timestamp' });
});

test('invalid bodies and blank display names reject without writing', async () => {
  for (const [body, authorName, code] of [
    [' \n\t ', 'Ada', 'activity-chat/empty-message'],
    ['x'.repeat(1001), 'Ada', 'activity-chat/message-too-long'],
    ['Hello', ' \n\t ', 'activity-chat/display-name-required'],
  ]) {
    const service = loadChatService();
    await assert.rejects(service.sendActivityChatMessage(thread.threadId, body, authorName), { code });
    assert.equal(service.writes().length, 0);
  }
});

test('a trimmed message at the 1000-character limit is accepted', async () => {
  const service = loadChatService();
  await service.sendActivityChatMessage(thread.threadId, `  ${'x'.repeat(1000)}  `, 'Ada');
  assert.equal(service.callsOf('addDoc')[0].args[1].body.length, 1000);
});

test('a failed message write reaches the caller and does not update thread metadata', async () => {
  const error = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
  const service = loadChatService({ addDoc: async () => { throw error; } });
  await assert.rejects(service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada'), failure => failure === error);
  assert.equal(service.callsOf('addDoc').length, 1);
  assert.equal(service.callsOf('updateDoc').length, 0);
});

test('send completes after persistence while the optional metadata update is still pending', async () => {
  const metadata = deferred();
  const service = loadChatService({ updateDoc: () => metadata.promise });
  let outcome = 'pending';
  const sending = service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada').then(
    () => { outcome = 'sent'; },
    () => { outcome = 'failed'; },
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.callsOf('addDoc').length, 1);
  assert.equal(service.callsOf('updateDoc').length, 1);
  assert.equal(outcome, 'sent', 'A persisted message must not wait on thread metadata');
  metadata.resolve();
  await sending;
});

test('failed optional metadata does not turn a persisted message into a failed send', async () => {
  const service = loadChatService({ updateDoc: async () => { throw new Error('Metadata unavailable'); } });
  await service.sendActivityChatMessage(thread.threadId, 'Hello', 'Ada');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.callsOf('addDoc').length, 1);
  assert.equal(service.callsOf('updateDoc').length, 1);
});

test('subscription errors reach onError without clearing previously received messages', () => {
  const service = loadChatService();
  const changes = [];
  const errors = [];
  const unsubscribe = service.subscribeActivityChatMessages(thread.threadId,
    messages => changes.push(plain(messages)), error => errors.push(error));
  const listener = service.listeners[0];
  assert.equal(listener.query.path, 'activity_chats/walk_berlin/messages');
  assert.deepEqual(plain(listener.query.constraints), [{ field: 'createdAt', direction: 'asc' }]);
  listener.onChange({ docs: [{ id: 'message-1', data: () => ({ authorId: 'Ada', authorName: 'Ada', body: 'Hello' }) }] });
  const error = new Error('Connection lost');
  listener.onError(error);
  assert.deepEqual(changes, [[{ id: 'message-1', authorId: 'Ada', authorName: 'Ada', body: 'Hello' }]]);
  assert.deepEqual(errors, [error]);
  unsubscribe();
  assert.equal(listener.unsubscribed, true);
});

test('an unauthenticated subscription reports an error without emitting a false empty result', () => {
  const service = loadChatService({ user: null });
  const changes = [];
  const errors = [];
  const unsubscribe = service.subscribeActivityChatMessages(thread.threadId,
    messages => changes.push(messages), error => errors.push(error));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'activity-chat/unauthenticated');
  assert.equal(changes.length, 0);
  assert.equal(service.callsOf('onSnapshot').length, 0);
  assert.doesNotThrow(unsubscribe);
});

test('load and ensure propagate database read errors instead of pretending a thread is missing', async () => {
  const error = new Error('Database unavailable');
  const service = loadChatService({ getDoc: async () => { throw error; } });
  await assert.rejects(service.loadActivityChatThread(thread.threadId), failure => failure === error);
  await assert.rejects(service.ensureActivityChatThread(thread), failure => failure === error);
  assert.equal(service.writes().length, 0);
});

test('ensure reports a failed thread creation', async () => {
  const error = new Error('Thread creation rejected');
  const service = loadChatService({ setDoc: async () => { throw error; } });
  await assert.rejects(service.ensureActivityChatThread(thread), failure => failure === error);
  assert.equal(service.callsOf('setDoc').length, 1);
});
