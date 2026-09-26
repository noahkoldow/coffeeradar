const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createPublicWebFetcher } = require('../lib/publicWebFetch');

const address = { address: '93.184.216.34', family: 4 };
const origin = 'https://culture.example';
const eventUrl = `${origin}/events/community-run`;
const html = '<html><title>Community run</title></html>';

function harness(routes = {}, overrides = {}) {
  const calls = [];
  let destroyed = 0;
  const request = (url, options, callback) => {
    const req = new EventEmitter();
    let dead = false;
    const abort = () => req.destroy(new Error('aborted'));
    req.destroy = error => {
      if (dead) return req;
      dead = true;
      destroyed++;
      options.signal.removeEventListener('abort', abort);
      if (error) queueMicrotask(() => req.emit('error', error));
      return req;
    };
    options.signal.addEventListener('abort', abort, { once: true });
    req.end = () => queueMicrotask(() => {
      if (dead) return;
      const call = { url: url.href, options };
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.equal(error, null);
        call.pinned = addresses;
      });
      calls.push(call);
      const route = routes[url.href] ?? (url.pathname === '/robots.txt'
        ? { body: 'User-agent: *\nAllow: /', type: 'text/plain' }
        : { body: html });
      if (route.hang) return;
      const response = new PassThrough();
      response.statusCode = route.status ?? 200;
      response.headers = {
        'content-type': route.type ?? 'text/html; charset=utf-8',
        ...route.headers,
      };
      callback(response);
      for (const chunk of route.chunks ?? [route.body ?? '']) response.write(chunk);
      if (!route.bodyHang) response.end();
    });
    return req;
  };
  const fetch = createPublicWebFetcher({ resolve: async () => [address], request, ...overrides });
  return { fetch, calls, destroyed: () => destroyed };
}

test('fetches generic publishers after robots and pins every socket lookup without cookies or auth', async () => {
  const { fetch, calls } = harness();
  assert.deepEqual(await fetch(`${eventUrl}#details`), { url: eventUrl, html });
  assert.deepEqual(calls.map(call => call.url), [`${origin}/robots.txt`, eventUrl]);
  for (const call of calls) {
    assert.deepEqual(call.pinned, [address]);
    assert.equal(call.options.agent, false);
    assert.equal(call.options.rejectUnauthorized, true);
    assert.equal(call.options.servername, 'culture.example');
    assert.equal(call.options.headers['User-Agent'], 'BitsActivityDiscovery');
    assert.equal(call.options.headers.Cookie, undefined);
    assert.equal(call.options.headers.Authorization, undefined);
    call.options.lookup('culture.example', {}, (error, pinned, family) => {
      assert.equal(error, null);
      assert.equal(pinned, address.address);
      assert.equal(family, 4);
    });
  }
});

test('rejects non-HTTPS, credentials, all literal IP forms, local hosts and alternate ports before DNS', async () => {
  let lookups = 0;
  const { fetch, calls } = harness({}, { resolve: async () => { lookups++; return [address]; } });
  for (const url of [
    'http://culture.example/events', 'ftp://culture.example/events',
    'https://user:password@culture.example/', 'https://culture.example:8443/',
    'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/',
    'https://0177.0.0.1/', 'https://93.184.216.34/', 'https://[::1]/',
    'https://[::ffff:127.0.0.1]/', 'https://[2606:4700:4700::1111]/',
    'https://metadata.google.internal/', 'https://localhost./', 'https://service.local/',
    'https://intranet/', 'file:///private', 'not a url',
  ]) assert.equal(await fetch(url), null, url);
  assert.equal(lookups, 0);
  assert.equal(calls.length, 0);
});

test('rejects private, metadata, special and mapped DNS answers, including mixed public/private records', async () => {
  for (const blocked of [
    '0.1.2.3', '10.0.0.1', '100.100.100.200', '127.0.0.1', '169.254.169.254',
    '172.31.0.1', '192.0.0.192', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '168.63.129.16', '203.0.113.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:93.184.216.34',
    'fc00::1', 'fd00:ec2::254', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1',
    '2001:db8::1', '2002:7f00:1::', '3fff::1',
  ]) {
    const bad = { address: blocked, family: blocked.includes(':') ? 6 : 4 };
    for (const answers of [[bad], [address, bad]]) {
      const { fetch, calls } = harness({}, { resolve: async () => answers });
      assert.equal(await fetch(eventUrl), null, blocked);
      assert.equal(calls.length, 0, blocked);
    }
  }
  const { fetch } = harness({}, { resolve: async () => [{ address: '2606:4700:4700::1111', family: 6 }] });
  assert.equal((await fetch(eventUrl)).html, html);
});

test('DNS rebinding between robots and document fails before a second connection', async () => {
  let resolutions = 0;
  const { fetch, calls } = harness({}, {
    resolve: async () => ++resolutions === 1 ? [address] : [{ address: '127.0.0.1', family: 4 }],
  });
  assert.equal(await fetch(eventUrl), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].pinned, [address]);
});

test('redirects revalidate HTTPS, DNS and robots for the destination origin', async () => {
  const target = 'https://museum.example/exhibitions/open-day';
  const { fetch, calls } = harness({ [eventUrl]: { status: 302, headers: { location: target } } });
  assert.deepEqual(await fetch(eventUrl), { url: target, html });
  assert.deepEqual(calls.map(call => call.url), [
    `${origin}/robots.txt`, eventUrl, 'https://museum.example/robots.txt', target,
  ]);
  for (const location of ['http://culture.example/events', 'https://127.0.0.1/', 'https://user:pass@culture.example/']) {
    const h = harness({ [eventUrl]: { status: 302, headers: { location } } });
    assert.equal(await h.fetch(eventUrl), null);
    assert.equal(h.calls.length, 2);
  }
  const denied = harness({
    [eventUrl]: { status: 301, headers: { location: target } },
    'https://museum.example/robots.txt': { body: 'User-agent: *\nDisallow: /', type: 'text/plain' },
  });
  assert.equal(await denied.fetch(eventUrl), null);
  assert.equal(denied.calls.length, 3);
  const internal = harness({ [eventUrl]: { status: 302, headers: { location: target } } }, {
    resolve: async host => host === 'museum.example' ? [{ address: '10.0.0.2', family: 4 }] : [address],
  });
  assert.equal(await internal.fetch(eventUrl), null);
  assert.equal(internal.calls.length, 2);
});

test('page and robots redirects have finite limits; robots redirects cannot reach private networks', async () => {
  const pageLoop = harness({ [eventUrl]: { status: 302, headers: { location: eventUrl } } }, { maxRedirects: 2 });
  assert.equal(await pageLoop.fetch(eventUrl), null);
  assert.equal(pageLoop.calls.length, 4);
  const robotsLoop = harness({ [`${origin}/robots.txt`]: { status: 302, headers: { location: '/robots.txt' } } }, { maxRedirects: 1 });
  assert.equal(await robotsLoop.fetch(eventUrl), null);
  assert.equal(robotsLoop.calls.length, 2);
  const privateRobots = harness({ [`${origin}/robots.txt`]: { status: 302, headers: { location: 'https://169.254.169.254/robots.txt' } } });
  assert.equal(await privateRobots.fetch(eventUrl), null);
  assert.equal(privateRobots.calls.length, 1);
});

test('robots honours agent groups, merging, allow specificity, wildcard/query rules and encoded paths', async () => {
  const checks = [
    ['User-agent: *\nDisallow: /events', eventUrl, false],
    ['User-agent: OtherBot\nDisallow: /\nUser-agent: *\nAllow: /', eventUrl, true],
    ['User-agent: *\nDisallow: /\nUser-agent: BitsActivityDiscovery\nAllow: /events', eventUrl, true],
    ['User-agent: BitsActivityDiscovery\nDisallow: /events\nUser-agent: BitsActivityDiscovery\nAllow: /events/community', eventUrl, true],
    ['User-agent: *\nDisallow: /events\nAllow: /events', eventUrl, true],
    ['User-agent: *\nDisallow: /events/*?private=*', `${eventUrl}?private=yes`, false],
    ['User-agent: *\nDisallow: /events/*$', eventUrl, false],
    ['User-agent: *\nDisallow: /events$', eventUrl, true],
    ['User-agent: *\nDisallow: /events/caf%C3%A9', `${origin}/events/café`, false],
    ['User-agent: *\nDisallow: /events/%63ommunity', eventUrl, false],
    ['User-agent: *\nDisallow:\nAllow: /', eventUrl, true],
    ['User-agent: *\nCrawl-delay: 2\nAllow: /', eventUrl, false],
  ];
  for (const [body, url, allowed] of checks) {
    const h = harness({ [`${origin}/robots.txt`]: { body, type: 'text/plain' } });
    assert.equal(Boolean(await h.fetch(url)), allowed, body);
    if (!allowed) assert.equal(h.calls.length, 1);
  }
});

test('missing robots is allowed; blocked, unavailable or non-text robots are never bypassed', async () => {
  for (const status of [404, 410]) {
    const h = harness({ [`${origin}/robots.txt`]: { status } });
    assert.ok(await h.fetch(eventUrl));
  }
  for (const route of [
    { status: 401 }, { status: 403 }, { status: 429 }, { status: 500 },
    { body: '<html>Challenge</html>', type: 'text/html' },
  ]) {
    const h = harness({ [`${origin}/robots.txt`]: route });
    assert.equal(await h.fetch(eventUrl), null);
    assert.equal(h.calls.length, 1);
  }
});

test('enforces HTML content, challenge rejection and advertised/streamed byte limits', async () => {
  for (const route of [
    { type: 'application/json', body: '{}' },
    { headers: { 'content-encoding': 'gzip' }, body: html },
    { headers: { 'content-length': '999999' }, body: html },
    { chunks: [Buffer.alloc(200), Buffer.alloc(200)] },
    { body: '<html><title>Just a moment...</title></html>' },
    { status: 403 },
  ]) {
    const h = harness({ [eventUrl]: route }, { maxBytes: 250 });
    assert.equal(await h.fetch(eventUrl), null);
  }
  const oversizedRobots = harness({ [`${origin}/robots.txt`]: { body: 'x'.repeat(512001), type: 'text/plain' } });
  assert.equal(await oversizedRobots.fetch(eventUrl), null);
  assert.equal(oversizedRobots.calls.length, 1);
});

test('one deadline bounds stalled DNS, responses and bodies; external abort cancels requests', async () => {
  const dns = harness({}, { timeoutMs: 20, resolve: async () => new Promise(() => {}) });
  assert.equal(await dns.fetch(eventUrl), null);
  assert.equal(dns.calls.length, 0);
  for (const route of [{ hang: true }, { body: 'partial', bodyHang: true }]) {
    const h = harness({ [eventUrl]: route }, { timeoutMs: 20 });
    assert.equal(await h.fetch(eventUrl), null);
    assert.ok(h.destroyed() > 0);
  }
  const controller = new AbortController();
  const h = harness({ [eventUrl]: { hang: true } });
  const pending = h.fetch(eventUrl, controller.signal);
  setImmediate(() => controller.abort());
  assert.equal(await pending, null);
  assert.ok(h.destroyed() > 0);
  const stopped = harness();
  assert.equal(await stopped.fetch(eventUrl, controller.signal), null);
  assert.equal(stopped.calls.length, 0);
});
