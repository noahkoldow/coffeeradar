const test = require('node:test');
const assert = require('node:assert/strict');
const { createBraveSourceSearch } = require('../lib/eventSourceSearch');
const { reserveEventDiscovery } = require('../lib/eventDiscoveryBudget');

test('search uses a fixed API endpoint and private header, returning candidate links without treating snippets as event facts', async () => {
  let request;
  const search = createBraveSourceSearch(() => 'test-key', async (url, init) => {
    request = { url: new URL(url), init };
    return new Response(JSON.stringify({ web: { results: [
      { url: 'https://city.gov/events/1#tickets', title: 'Calendar', description: 'An invented event in a search snippet' },
      { url: 'http://insecure.org/event', title: 'Bad scheme' },
      { url: 'https://user:password@publisher.org/event', title: 'Credentials' },
      { url: 'javascript:alert(1)' },
    ] } }));
  });
  const signal = new AbortController().signal;
  const results = await search('Berlin 2026-09-27 sport', 'de', signal);
  assert.equal(request.url.origin, 'https://api.search.brave.com');
  assert.equal(request.url.searchParams.get('q'), 'Berlin 2026-09-27 sport');
  assert.equal(request.url.searchParams.get('search_lang'), 'de');
  assert.equal(request.url.searchParams.has('country'), false);
  assert.equal(request.init.headers['X-Subscription-Token'], 'test-key');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.signal, signal);
  assert.deepEqual(results, [{ url: 'https://city.gov/events/1', title: 'Calendar' }]);
});

test('missing configuration, provider errors, malformed or oversized responses fail without exposing credentials', async () => {
  let calls = 0;
  await assert.rejects(createBraveSourceSearch(() => '', async () => { calls++; })('q', 'en', new AbortController().signal), /not configured/);
  assert.equal(calls, 0);
  for (const response of [new Response('test-key upstream details', { status: 429 }),
    new Response('not json'), new Response('x'.repeat(513 * 1024))]) {
    await assert.rejects(createBraveSourceSearch(() => 'test-key', async () => response)('q', 'en', new AbortController().signal),
      error => !error.message.includes('test-key'));
  }
  assert.deepEqual(await createBraveSourceSearch(() => 'key', async () => new Response('{}'))('q', 'en', new AbortController().signal), []);
});

function budgetFixture(global = {}, user = {}) {
  const writes = [];
  const db = {
    doc: path => ({ path }),
    runTransaction: callback => callback({
      get: async ref => ({ data: () => ref.path.endsWith('/global') ? global : user }),
      set: (ref, data) => writes.push({ path: ref.path, data }),
    }),
  };
  return { db, writes };
}

test('discovery reserves both possible searches against user and global quotas without charging cache hits', async () => {
  const f = budgetFixture();
  assert.equal(await reserveEventDiscovery(f.db, 'test/user'), true);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].data.searches, 2);
  assert.equal(f.writes[1].data.searches, 2);
  assert.match(f.writes[1].path, /^web_discovery_quotas\/user_[a-f0-9]{64}$/);
  const day = new Date().toISOString().slice(0, 10);
  for (const [global, user] of [[{ day, searches: 999 }, {}], [{}, { day, searches: 39 }], [{}, { lastAt: Date.now() }]]) {
    const limited = budgetFixture(global, user);
    assert.equal(await reserveEventDiscovery(limited.db, 'user'), false);
    assert.equal(limited.writes.length, 0);
  }
  const yesterday = budgetFixture({ day: '2000-01-01', searches: 1000 }, { day: '2000-01-01', searches: 40 });
  assert.equal(await reserveEventDiscovery(yesterday.db, 'user'), true);
  assert.equal(await reserveEventDiscovery(yesterday.db, ''), false);
});
