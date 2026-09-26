const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { HttpsError } = require('firebase-functions/v2/https');
const { validateAiRequest } = require('../lib/aiRouter');
const { beforeDeadline, releaseBeforeDeadline } = require('../lib/aiDeadline');

const compiled = fs.readFileSync(path.resolve(__dirname, '../lib/aiGateway.js'), 'utf8');
const VERSION = 'multi-provider-v1';
const validConsent = () => ({ allowed: true, version: VERSION, providers: ['gemini', 'groq'] });
const result = (text = '{"title":"Walk"}') => ({ text, provider: 'groq', model: 'test-model' });

function gateway({ work = async () => result(), keys = '{"groq":"test-key"}', quotaFailure } = {}) {
  const reads = [];
  const generations = [];
  const reservations = [];
  const releases = [];
  const consents = new Map();
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const db = { doc: name => ({ get: async () => {
    reads.push(name);
    return { data: () => consents.has(name) ? consents.get(name) : validConsent() };
  } }) };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, Buffer, Date: Clock, process: { env: {} },
    require(name) {
      if (name === 'crypto') return require('node:crypto');
      if (name === 'firebase-admin') return { firestore: () => db };
      if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => keys }) };
      if (name === 'firebase-functions/v2/https') return { HttpsError, onCall: (_options, handler) => handler };
      if (name === './aiQuota') return { acquireAiBudget: async (database, uid) => {
        assert.equal(database, db);
        reservations.push(uid);
        if (quotaFailure) throw quotaFailure;
        return async () => { releases.push(uid); };
      } };
      if (name === './aiRouter') return { validateAiRequest, AiRouter: class {
        async generate(request, providers) { generations.push({ request, providers }); return work(request, providers); }
      } };
      if (name === './aiProviderBudget') return { FirestoreProviderBudget: class {} };
      if (name === './aiRouterConfig') return { readAiRoutes: () => [] };
      if (name === './aiConsent') return { CORE_AI_CONSENT_VERSION: VERSION };
      if (name === './aiDeadline') return { beforeDeadline, releaseBeforeDeadline };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { ...module.exports, reads, generations, reservations, releases, consents,
    advance: milliseconds => { now += milliseconds; } };
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('gateway validates identity/input and current consent before reserving budget or invoking a provider', async () => {
  const app = gateway();
  await assert.rejects(app.generateForUser('', { prompt: 'Private' }), { code: 'unauthenticated' });
  await assert.rejects(app.generateAiJson({ data: { prompt: 'Private' } }), { code: 'unauthenticated' });
  await assert.rejects(app.generateForUser('alice', { prompt: '' }), { code: 'invalid-argument' });
  assert.equal(app.reads.length, 0);
  for (const receipt of [undefined, { allowed: false, version: VERSION }, { allowed: true, version: 'old' }]) {
    app.consents.set('users/alice/consents/coreAI', receipt);
    await assert.rejects(app.generateForUser('alice', { prompt: 'Private' }), { code: 'permission-denied' });
  }
  assert.equal(app.reservations.length, 0);
  assert.equal(app.generations.length, 0);
});

test('gateway deduplicates identical simultaneous requests for one identity and caches successful text', async () => {
  const gate = deferred();
  const app = gateway({ work: () => gate.promise });
  const pending = Array.from({ length: 100 }, () => app.generateForUser('alice', { prompt: 'Private' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.generations.length, 1);
  assert.equal(app.reservations.length, 1);
  gate.resolve(result());
  await Promise.all(pending);
  await app.generateForUser('alice', { prompt: 'Private' });
  assert.equal(app.generations.length, 1);
  assert.deepEqual(app.releases, ['alice']);
  assert.equal(app.reads.length, 101);
});

test('gateway cache never crosses identities or changes in consented providers', async () => {
  const app = gateway();
  await app.generateForUser('alice', { prompt: 'Same request' });
  await app.generateForUser('bob', { prompt: 'Same request' });
  assert.equal(app.generations.length, 2);
  app.consents.set('users/alice/consents/coreAI', { ...validConsent(), providers: ['gemini'] });
  await app.generateForUser('alice', { prompt: 'Same request' });
  assert.equal(app.generations.length, 3);
  assert.deepEqual([...app.generations[2].providers], ['gemini']);
  assert.deepEqual(app.reservations, ['alice', 'bob', 'alice']);
});

test('revoking consent blocks a previously cached response without another inference', async () => {
  const app = gateway();
  await app.generateForUser('alice', { prompt: 'Private' });
  app.consents.set('users/alice/consents/coreAI', { allowed: false, version: VERSION });
  await assert.rejects(app.generateForUser('alice', { prompt: 'Private' }), { code: 'permission-denied' });
  assert.equal(app.generations.length, 1);
  assert.equal(app.reads.length, 2);
});

test('failed inference releases the user quota and is not cached, allowing a later retry', async () => {
  let attempts = 0;
  const failure = new HttpsError('unavailable', 'Temporary provider error');
  const app = gateway({ work: async () => { if (++attempts === 1) throw failure; return result(); } });
  await assert.rejects(app.generateForUser('alice', { prompt: 'Private' }), error => error === failure);
  assert.equal((await app.generateForUser('alice', { prompt: 'Private' })).text, result().text);
  assert.equal(app.generations.length, 2);
  assert.deepEqual(app.releases, ['alice', 'alice']);
});

test('invalid configuration and rejected user quota never contact a provider', async () => {
  for (const keys of ['not-json', '[]', 'null', '{"groq":123}']) {
    const app = gateway({ keys });
    await assert.rejects(app.generateForUser('alice', { prompt: 'Private' }), { code: 'failed-precondition' });
    assert.equal(app.generations.length, 0);
    assert.equal(app.reservations.length, 0);
  }
  const failure = new HttpsError('resource-exhausted', 'User quota exhausted');
  const app = gateway({ quotaFailure: failure });
  await assert.rejects(app.generateForUser('alice', { prompt: 'Private' }), error => error === failure);
  assert.equal(app.generations.length, 0);
  assert.equal(app.releases.length, 0);
});

test('photo inference deduplicates pending requests but never caches image results', async () => {
  const gate = deferred();
  const app = gateway({ work: () => gate.promise });
  const input = { prompt: 'Read tasks', image: { mimeType: 'image/png',
    data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') } };
  const first = app.generateForUser('alice', input);
  const second = app.generateForUser('alice', input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.generations.length, 1);
  gate.resolve(result());
  await Promise.all([first, second]);
  await app.generateForUser('alice', input);
  assert.equal(app.generations.length, 2);
  assert.equal(app.reservations.length, 2);
});

test('short response cache expires at 30 seconds and bounds entry count', async () => {
  const app = gateway();
  const cache = new app.AiRequestCache();
  let count = 0;
  const work = async () => { count++; return result(); };
  await cache.run('one', true, work);
  app.advance(29999);
  await cache.run('one', true, work);
  assert.equal(count, 1);
  app.advance(1);
  await cache.run('one', true, work);
  assert.equal(count, 2);
  for (let i = 0; i < 64; i++) await cache.run(`new-${i}`, true, work);
  await cache.run('one', true, work);
  assert.equal(count, 67);
});

test('cache bounds response bytes and rejects overflow pending work while allowing existing deduplication', async () => {
  const app = gateway();
  const cache = new app.AiRequestCache();
  let attempts = 0;
  const oversized = async () => { attempts++; return result('x'.repeat(128001)); };
  await cache.run('large', true, oversized);
  await cache.run('large', true, oversized);
  assert.equal(attempts, 2);
  for (let i = 0; i < 18; i++) await cache.run(`sized-${i}`, true, async () => result('x'.repeat(120000)));
  let recomputed = false;
  await cache.run('sized-0', true, async () => { recomputed = true; return result(); });
  assert.equal(recomputed, true);
  const gate = deferred();
  const pending = Array.from({ length: 80 }, (_, i) => cache.run(`pending-${i}`, true, () => gate.promise));
  const duplicate = cache.run('pending-0', true, async () => { throw new Error('Duplicate must not execute'); });
  await assert.rejects(cache.run('overflow', true, async () => result()), { code: 'resource-exhausted' });
  gate.resolve(result());
  await Promise.all([...pending, duplicate]);
});

test('public callable returns only text, with account identity taken from authenticated context', async () => {
  const app = gateway();
  const output = await app.generateAiJson({ auth: { uid: 'alice' }, data: { uid: 'bob', prompt: 'Private' } });
  assert.deepEqual(JSON.parse(JSON.stringify(output)), { text: result().text });
  assert.deepEqual(app.reservations, ['alice']);
  assert.deepEqual(app.reads, ['users/alice/consents/coreAI']);
});

test('deadline helper cleans up leases admitted after the caller has timed out', async () => {
  const late = deferred();
  let released = 0;
  const pending = beforeDeadline(late.promise, Date.now() + 10, lease => lease.release());
  await assert.rejects(pending, { code: 'deadline-exceeded' });
  late.resolve({ release: async () => { released++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(released, 1);
});

test('late operation and cleanup failures are observed without unhandled rejections', async () => {
  const lateFailure = deferred();
  await assert.rejects(beforeDeadline(lateFailure.promise, Date.now() + 10), { code: 'deadline-exceeded' });
  lateFailure.reject(new Error('Late Firestore failure'));
  const lateCleanup = deferred();
  await assert.rejects(beforeDeadline(lateCleanup.promise, Date.now() + 10,
    async () => { throw new Error('Lease release unavailable'); }), { code: 'deadline-exceeded' });
  lateCleanup.resolve({});
  await new Promise(resolve => setImmediate(resolve));
});

test('lease cleanup failures or stalled cleanup are bounded and do not replace a paid result', async () => {
  await releaseBeforeDeadline(async () => { throw new Error('Cleanup failed'); }, Date.now() + 1000);
  let releaseStarted = false;
  const start = Date.now();
  await releaseBeforeDeadline(() => { releaseStarted = true; return new Promise(() => {}); }, Date.now() + 20);
  assert.equal(releaseStarted, true);
  assert.ok(Date.now() - start < 1000);
});
