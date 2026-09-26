const test = require('node:test');
const assert = require('node:assert/strict');
const { AiRouter, validateAiRequest, parseRetryAfter } = require('../lib/aiRouter');
const { readAiRoutes } = require('../lib/aiRouterConfig');
const { normalizeAiSchema, matchesAiSchema } = require('../lib/aiSchema');
const { reserveProviderBudget, FirestoreProviderBudget } = require('../lib/aiProviderBudget');

const NOW = Date.parse('2026-09-24T12:00:00Z');
const route = (provider, overrides = {}) => ({ id: provider, provider,
  model: provider === 'gemini' ? 'gemini-3.5-flash-lite' : 'openai/gpt-oss-20b',
  rpm: 100, tpm: 1000000, dailyRequests: 1000, concurrency: 20, shards: 4,
  timeoutMs: 1000, ...overrides });
const schema = { type: 'object', properties: { title: { type: 'string', minLength: 1 } }, required: ['title'] };
const request = (overrides = {}) => validateAiRequest({ prompt: 'Suggest a short walk.', responseSchema: schema, ...overrides });
const response = (provider, text = '{"title":"Walk by the river"}', reason) => new Response(JSON.stringify(
  provider === 'gemini'
    ? { candidates: [{ finishReason: reason || 'STOP', content: { parts: [{ text }] } }] }
    : { choices: [{ finish_reason: reason || 'stop', message: { content: text } }] },
), { status: 200, headers: { 'Content-Type': 'application/json' } });

function budgetWith({ denied = {} } = {}) {
  const acquisitions = [];
  const releases = [];
  const cooldowns = [];
  return { acquisitions, releases, cooldowns,
    async acquire(current, tokens) {
      acquisitions.push({ provider: current.provider, tokens });
      if (denied[current.provider]) return { retryAfterMs: denied[current.provider] };
      return { release: async () => { releases.push(current.provider); } };
    },
    async cooldown(current, milliseconds) { cooldowns.push({ provider: current.provider, milliseconds }); },
  };
}

function setup(replies, options = {}) {
  const calls = [];
  const budget = options.budget || budgetWith();
  const routes = options.routes || [route('groq'), route('gemini')];
  const keys = options.keys || { groq: 'test-groq-key', gemini: 'test-gemini-key' };
  const transport = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const reply = replies.shift();
    if (typeof reply === 'function') return reply(url, init);
    if (!reply) throw new Error('Unexpected provider attempt');
    return reply;
  };
  return { router: new AiRouter(routes, keys, budget, transport), calls, budget };
}

test('router calls only the cheapest configured route on success and keeps keys out of URLs', async () => {
  const { router, calls, budget } = setup([response('groq')]);
  assert.deepEqual(await router.generate(request(), ['groq', 'gemini']), {
    text: '{"title":"Walk by the river"}', provider: 'groq', model: 'openai/gpt-oss-20b',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-groq-key');
  assert.equal(calls[0].body.response_format.type, 'json_object');
  assert.equal(calls[0].body.reasoning_effort, 'low');
  assert.equal(calls[0].body.max_completion_tokens, request().maxOutputTokens);
  assert.equal(calls[0].body.messages[1].content, request().prompt);
  assert.deepEqual(budget.releases, ['groq']);
  assert.equal(budget.cooldowns.length, 0);
  assert.ok(budget.acquisitions[0].tokens >= request().maxOutputTokens);
});

test('Gemini thinking options follow server-selected model capabilities', async () => {
  for (const [model, expected] of [
    ['gemini-3.5-flash-lite', { thinkingLevel: 'minimal' }],
    ['gemini-3.6-flash', { thinkingLevel: 'low' }],
    ['gemini-2.5-flash-lite', { thinkingBudget: 0 }],
    ['gemini-2.0-flash', undefined],
  ]) {
    const { router, calls } = setup([response('gemini')], { routes: [route('gemini', { model })] });
    await router.generate(request(), ['gemini']);
    assert.deepEqual(calls[0].body.generationConfig.thinkingConfig, expected);
    assert.equal(calls[0].body.generationConfig.maxOutputTokens, request().maxOutputTokens);
    assert.deepEqual(calls[0].body.generationConfig.responseJsonSchema, normalizeAiSchema(schema));
  }
});

test('429 applies Retry-After cooldown and retries once on the next provider', async () => {
  const { router, calls, budget } = setup([
    new Response('Rate limit', { status: 429, headers: { 'Retry-After': '7' } }), response('gemini'),
  ]);
  const result = await router.generate(request(), ['groq', 'gemini']);
  assert.equal(result.provider, 'gemini');
  assert.equal(calls.length, 2);
  assert.deepEqual(budget.cooldowns, [{ provider: 'groq', milliseconds: 7000 }]);
  assert.deepEqual(budget.releases, ['groq', 'gemini']);
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(new URL(calls[1].url).search, '');
});

test('400 request errors stop immediately instead of spending on another provider', async () => {
  const { router, calls, budget } = setup([new Response('Bad input', { status: 400 }), response('gemini')]);
  await assert.rejects(router.generate(request(), ['groq', 'gemini']), { code: 'failed-precondition' });
  assert.equal(calls.length, 1);
  assert.deepEqual(budget.releases, ['groq']);
  assert.deepEqual(budget.cooldowns, []);
});

test('provider safety blocks and refusals never bypass the block through another route', async () => {
  for (const [first, blocked] of [
    ['groq', response('groq', '', 'content_filter')],
    ['groq', new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'Blocked' } }] }))],
    ['gemini', response('gemini', '', 'SAFETY')],
    ['gemini', new Response(JSON.stringify({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }))],
  ]) {
    const second = first === 'groq' ? 'gemini' : 'groq';
    const { router, calls, budget } = setup([blocked, response(second)], { routes: [route(first), route(second)] });
    await assert.rejects(router.generate(request(), ['groq', 'gemini']), { code: 'permission-denied' });
    assert.equal(calls.length, 1);
    assert.deepEqual(budget.releases, [first]);
  }
});

test('provider authentication, missing model, and server failure cool down and fall back', async () => {
  for (const status of [401, 403, 404, 408, 500, 503]) {
    const { router, calls, budget } = setup([new Response('', { status }), response('gemini')]);
    assert.equal((await router.generate(request(), ['groq', 'gemini'])).provider, 'gemini');
    assert.equal(calls.length, 2);
    assert.ok(budget.cooldowns[0].milliseconds >= 10000);
    assert.deepEqual(budget.releases, ['groq', 'gemini']);
  }
});

const untilAborted = (_url, init) => new Promise((_resolve, reject) => {
  const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
  if (init.signal.aborted) abort();
  else init.signal.addEventListener('abort', abort, { once: true });
});

test('a timed-out cheap attempt can fall back within the same total request deadline', async () => {
  const { router, calls, budget } = setup([untilAborted, response('gemini')], {
    routes: [route('groq', { timeoutMs: 15 }), route('gemini', { timeoutMs: 100 })],
  });
  assert.equal((await router.generate({ ...request(), timeoutMs: 1000 }, ['groq', 'gemini'])).provider, 'gemini');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.signal.aborted, true);
  assert.deepEqual(budget.releases, ['groq', 'gemini']);
});

test('an exhausted total deadline aborts without starting another provider', async () => {
  const { router, calls, budget } = setup([untilAborted, response('gemini')], {
    routes: [route('groq', { timeoutMs: 1000 }), route('gemini')],
  });
  await assert.rejects(router.generate({ ...request(), timeoutMs: 15 }, ['groq', 'gemini']), { code: 'deadline-exceeded' });
  assert.equal(calls.length, 1);
  assert.deepEqual(budget.releases, ['groq']);
});

test('image requests skip text-only providers and forward inline image to Gemini', async () => {
  const image = { mimeType: 'image/png', data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64') };
  const { router, calls, budget } = setup([response('gemini')]);
  assert.equal((await router.generate(request({ image }), ['groq', 'gemini'])).provider, 'gemini');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.contents[0].parts[1].inlineData, image);
  assert.deepEqual(budget.acquisitions.map(item => item.provider), ['gemini']);
});

test('malformed, truncated, oversized, or schema-invalid output falls back and is not returned', async () => {
  const malformed = [
    new Response('not provider JSON'),
    response('groq', 'not generated JSON'),
    response('groq', '{"title":"unfinished"}', 'length'),
    response('groq', '{"title":17}'),
    response('groq', '{}'),
    response('groq', 'null'),
    response('groq', '"only a string"'),
    response('groq', JSON.stringify({ title: 'x'.repeat(128001) })),
    new Response('x'.repeat(512 * 1024 + 1)),
  ];
  for (const bad of malformed) {
    const { router, calls, budget } = setup([bad, response('gemini')]);
    assert.equal((await router.generate(request(), ['groq', 'gemini'])).provider, 'gemini');
    assert.equal(calls.length, 2);
    assert.deepEqual(budget.releases, ['groq', 'gemini']);
  }
});

test('Gemini thought content is ignored when validating and returning JSON', async () => {
  const reply = new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { thought: true, text: 'private reasoning' }, { text: '{"title":"Walk"}' },
  ] } }] }));
  const { router } = setup([reply], { routes: [route('gemini')] });
  assert.equal((await router.generate(request(), ['gemini'])).text, '{"title":"Walk"}');
});

test('missing credentials or user-authorized providers fail before budget or network calls', async () => {
  for (const options of [{ keys: {} }, { allowed: [] }, { keys: { groq: 'test' }, allowed: ['gemini'] }]) {
    const { router, calls, budget } = setup([], options);
    await assert.rejects(router.generate(request(), options.allowed || ['groq', 'gemini']), { code: 'failed-precondition' });
    assert.equal(calls.length, 0);
    assert.equal(budget.acquisitions.length, 0);
  }
});

test('exhausted route capacity skips HTTP and tries the other configured provider', async () => {
  const budget = budgetWith({ denied: { groq: 30000 } });
  const { router, calls } = setup([response('gemini')], { budget });
  assert.equal((await router.generate(request(), ['groq', 'gemini'])).provider, 'gemini');
  assert.equal(calls.length, 1);
  assert.deepEqual(budget.releases, ['gemini']);
  const allDenied = setup([], { budget: budgetWith({ denied: { groq: 30000, gemini: 60000 } }) });
  await assert.rejects(allDenied.router.generate(request(), ['groq', 'gemini']),
    error => error.code === 'resource-exhausted' && error.details.retryAfterMs === 30000);
  assert.equal(allDenied.calls.length, 0);
});

test('request validation rejects unbounded prompt/schema/image input before inference', async () => {
  const invalid = [null, {}, { prompt: '' }, { prompt: ' '.repeat(5) }, { prompt: 'x'.repeat(24001) },
    { prompt: 'ok', image: { mimeType: 'image/svg+xml', data: 'PHN2Zz4=' } },
    { prompt: 'ok', responseSchema: { type: 'string', pattern: '(a+)+' } },
    { prompt: 'ok', responseSchema: { $ref: 'https://untrusted.example/schema' } }];
  const { router, calls, budget } = setup([]);
  for (const input of invalid) {
    await assert.rejects(async () => router.generate(validateAiRequest(input), ['groq', 'gemini']), { code: 'invalid-argument' });
  }
  assert.equal(calls.length, 0);
  assert.equal(budget.acquisitions.length, 0);
  const bounded = validateAiRequest({ prompt: 'ok', maxOutputTokens: 1000000, timeoutMs: 999999, temperature: 5, model: 'untrusted-model' });
  assert.equal(bounded.maxOutputTokens, 8192);
  assert.equal(bounded.timeoutMs, 25000);
  assert.equal(bounded.temperature, 1);
  assert.equal(bounded.model, undefined);
});

test('Retry-After accepts seconds/date values, bounds cooldowns, and rejects invalid or past values', () => {
  assert.equal(parseRetryAfter('7', NOW), 7000);
  assert.equal(parseRetryAfter('0.1', NOW), 1000);
  assert.equal(parseRetryAfter('999999', NOW), 3600000);
  assert.equal(parseRetryAfter(new Date(NOW + 120000).toUTCString(), NOW), 120000);
  for (const invalid of [null, '', '0', '-1', 'invalid', new Date(NOW - 1000).toUTCString()]) {
    assert.equal(parseRetryAfter(invalid, NOW), undefined);
  }
});

test('route configuration validates provider identity, bounded capacities, and operator model selection', () => {
  const routes = [route('groq'), route('gemini')];
  assert.deepEqual(readAiRoutes({ AI_ROUTER_ROUTES: JSON.stringify(routes) }), routes);
  assert.equal(readAiRoutes({ AI_GEMINI_MODEL: 'operator-model' })[0].model, 'operator-model');
  for (const invalid of [[], [route('groq'), route('groq')], [route('groq', { id: 'other' })],
    [route('groq', { model: '../invalid?url' })], [route('groq', { timeoutMs: 999 })],
    [route('groq', { concurrency: 10001 })], [route('groq', { shards: 21 })], [route('groq', { rpm: 0 })]]) {
    assert.throws(() => readAiRoutes({ AI_ROUTER_ROUTES: JSON.stringify(invalid) }));
  }
});

test('schema normalization preserves nullability and enforces nested types, required fields, and bounds', () => {
  const normalized = normalizeAiSchema({ type: 'object', additionalProperties: false, required: ['name', 'scores'], properties: {
    name: { type: 'string', nullable: true, minLength: 1, maxLength: 2 },
    scores: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'integer', minimum: 0, maximum: 5 } },
    mode: { type: 'string', enum: ['walk', 'read'] },
  } });
  assert.deepEqual(normalized.properties.name.type, ['string', 'null']);
  assert.equal(matchesAiSchema({ name: '🚶', scores: [2], mode: 'walk' }, normalized), true);
  assert.equal(matchesAiSchema({ name: null, scores: [0, 5] }, normalized), true);
  for (const value of [{ name: '', scores: [1] }, { name: 'abc', scores: [1] }, { name: 'ok', scores: [] },
    { name: 'ok', scores: [1.5] }, { name: 'ok', scores: [6] }, { name: 'ok', scores: [1, 2, 3] },
    { name: 'ok' }, { name: 'ok', scores: [1], extra: true }, { name: 'ok', scores: [1], mode: 'drive' }]) {
    assert.equal(matchesAiSchema(value, normalized), false);
  }
  for (const invalid of [{ type: 'unknown' }, { type: 'object', required: ['missing'] },
    { type: 'string', enum: [] }, { type: 'string', nullable: 'yes' }, { type: 'array', minItems: -1 }]) {
    assert.throws(() => normalizeAiSchema(invalid), { code: 'invalid-argument' });
  }
  let deep = { type: 'string' };
  for (let i = 0; i < 14; i++) deep = { type: 'array', items: deep };
  assert.throws(() => normalizeAiSchema(deep), { code: 'invalid-argument' });
});

function exhaustPartitions(current, tokenCost, { release = false, advanceMinute = false } = {}) {
  const states = Array.from({ length: current.shards }, () => ({}));
  let admitted = 0;
  for (let shard = 0; shard < current.shards; shard++) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const now = NOW + (advanceMinute ? attempt * 60000 : 0);
      const decision = reserveProviderBudget(states[shard], current, shard, tokenCost, now, `r-${shard}-${attempt}`);
      if (!decision.allowed) break;
      admitted++;
      states[shard] = release ? { ...decision.state, active: {} } : decision.state;
    }
  }
  return { admitted, states };
}

test('provider budget shard shares sum exactly to request, token, daily, and concurrency caps', () => {
  const base = route('groq', { rpm: 10000, tpm: 10000, dailyRequests: 10000, concurrency: 10000 });
  assert.equal(exhaustPartitions({ ...base, rpm: 11 }, 1, { release: true }).admitted, 11);
  assert.equal(exhaustPartitions({ ...base, tpm: 11 }, 1, { release: true }).admitted, 11);
  assert.equal(exhaustPartitions({ ...base, dailyRequests: 11 }, 1, { release: true, advanceMinute: true }).admitted, 11);
  assert.equal(exhaustPartitions({ ...base, concurrency: 11 }, 1).admitted, 11);
});

test('minute and UTC-day windows reset independently and failed attempts remain counted', () => {
  const current = route('groq', { shards: 1, rpm: 1, dailyRequests: 2 });
  const first = reserveProviderBudget({}, current, 0, 10, NOW, 'first');
  assert.equal(first.allowed, true);
  const released = { ...first.state, active: {} };
  const minuteDenied = reserveProviderBudget(released, current, 0, 10, NOW + 1000, 'second');
  assert.equal(minuteDenied.allowed, false);
  assert.equal(minuteDenied.retryAfterMs, 59000);
  const nextMinute = reserveProviderBudget(released, current, 0, 10, NOW + 60000, 'second');
  assert.equal(nextMinute.allowed, true);
  assert.equal(nextMinute.state.requests, 1);
  assert.equal(nextMinute.state.dailyRequests, 2);
  const dailyDenied = reserveProviderBudget({ ...nextMinute.state, active: {} }, current, 0, 10, NOW + 120000, 'third');
  assert.equal(dailyDenied.allowed, false);
  assert.equal(dailyDenied.retryAfterMs, 12 * 3600000 - 120000);
  const nextDay = reserveProviderBudget(nextMinute.state, current, 0, 10, NOW + 86400000, 'third');
  assert.equal(nextDay.allowed, true);
  assert.equal(nextDay.state.dailyRequests, 1);
});

test('crashed provider concurrency leases expire after 45 seconds without refunding usage', () => {
  const current = route('groq', { shards: 1, concurrency: 1 });
  const first = reserveProviderBudget({}, current, 0, 10, NOW, 'crashed');
  assert.equal(first.allowed, true);
  const before = reserveProviderBudget(first.state, current, 0, 10, NOW + 44000, 'waiting');
  assert.equal(before.allowed, false);
  assert.equal(before.retryAfterMs, 1000);
  const after = reserveProviderBudget(first.state, current, 0, 10, NOW + 45000, 'replacement');
  assert.equal(after.allowed, true);
  assert.deepEqual(Object.keys(after.state.active), ['replacement']);
  assert.equal(after.state.requests, 2);
  assert.equal(after.state.dailyRequests, 2);
});

test('1,000 synthetic simultaneous requests respect the atomic in-memory concurrency gate', async () => {
  // This is a deterministic routing/admission test, not a production provider or Firestore load test.
  const current = route('groq', { concurrency: 16, rpm: 10000, tpm: 100000000, dailyRequests: 10000 });
  const states = Array.from({ length: current.shards }, () => ({}));
  let sequence = 0;
  let active = 0;
  let peak = 0;
  let httpCalls = 0;
  let finish;
  const completionGate = new Promise(resolve => { finish = resolve; });
  const budget = {
    async acquire(r, tokens) {
      const id = `request-${sequence++}`;
      const shard = (sequence - 1) % r.shards;
      const decision = reserveProviderBudget(states[shard], r, shard, tokens, NOW, id);
      if (!decision.allowed) return { retryAfterMs: decision.retryAfterMs };
      states[shard] = decision.state;
      active++;
      peak = Math.max(peak, active);
      return { release: async () => { delete states[shard].active[id]; active--; } };
    },
    async cooldown() {},
  };
  const router = new AiRouter([current], { groq: 'test-only-key' }, budget, async () => {
    httpCalls++;
    await completionGate;
    return response('groq');
  });
  const pending = Array.from({ length: 1000 }, () => router.generate(request(), ['groq']));
  const all = Promise.allSettled(pending);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(httpCalls, 16);
  assert.equal(peak, 16);
  finish();
  const results = await all;
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 16);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'resource-exhausted').length, 984);
  assert.equal(active, 0);
  assert.equal(states.reduce((sum, state) => sum + state.dailyRequests, 0), 16);
});

test('Firestore adapter retains cross-instance cooldown and releases only its own active lease', async () => {
  const records = new Map();
  const db = { doc: id => id, runTransaction: async handler => handler({
    get: async id => ({ data: () => records.get(id) }),
    set: (id, value) => records.set(id, structuredClone(value)),
  }) };
  const current = route('groq', { shards: 1 });
  const firstInstance = new FirestoreProviderBudget(db);
  const first = await firstInstance.acquire(current, 100);
  const second = await firstInstance.acquire(current, 100);
  assert.equal('release' in first, true);
  assert.equal('release' in second, true);
  assert.equal(Object.keys(records.get('ai_provider_budgets/groq_0').active).length, 2);
  await first.release();
  assert.equal(Object.keys(records.get('ai_provider_budgets/groq_0').active).length, 1);
  assert.equal(records.get('ai_provider_budgets/groq_0').requests, 2);
  await firstInstance.cooldown(current, 120000);
  const secondInstance = new FirestoreProviderBudget(db);
  const denied = await secondInstance.acquire(current, 100);
  assert.equal('retryAfterMs' in denied, true);
  await second.release();
  assert.equal(Object.keys(records.get('ai_provider_budgets/groq_0').active).length, 0);
});

test('slow provider lease cleanup cannot hang a successful inference', async () => {
  let releaseStarted = false;
  const budget = { acquire: async () => ({ release: () => { releaseStarted = true; return new Promise(() => {}); } }),
    cooldown: async () => {} };
  const { router } = setup([response('groq')], { budget, routes: [route('groq')] });
  const start = Date.now();
  assert.equal((await router.generate(request({ timeoutMs: 1000 }), ['groq'])).provider, 'groq');
  assert.equal(releaseStarted, true);
  assert.ok(Date.now() - start < 1500);
});

test('provider admission resolving after deadline releases its lease without calling inference', async () => {
  let resolveAdmission;
  let releases = 0;
  const admission = new Promise(resolve => { resolveAdmission = resolve; });
  const budget = { acquire: () => admission, cooldown: async () => {} };
  const { router, calls } = setup([], { budget, routes: [route('groq')] });
  await assert.rejects(router.generate({ ...request(), timeoutMs: 10 }, ['groq']), { code: 'deadline-exceeded' });
  resolveAdmission({ release: async () => { releases++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases, 1);
  assert.equal(calls.length, 0);
});
