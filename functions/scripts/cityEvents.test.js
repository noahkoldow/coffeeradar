const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createCityEventDiscovery, discoverCityEvents, validateDiscoveryInput,
  buildDiscoveryQueries, selectSourcePages,
} = require('../lib/cityEvents');

const detail = fs.readFileSync(path.join(__dirname, 'fixtures', 'city-event-detail.html'), 'utf8');
const event = JSON.parse(detail.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const schemaHtml = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const input = {
  areaLabel: 'Berlin, Mitte', start: '2026-09-27T00:00:00+02:00', end: '2026-09-28T00:00:00+02:00',
  timeZone: 'Europe/Berlin', language: 'de', interests: ['art', 'social'], discoveryMode: 'plan_ahead',
};
const sources = urls => urls.map(url => ({ url, title: 'Search title is not event evidence' }));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('worldwide queries use the requested city, local date and interests without a fixed publisher', () => {
  for (const [areaLabel, timeZone, start, end, expectedDate] of [
    ['New York', 'America/New_York', '2026-09-28T01:00:00Z', '2026-09-28T03:00:00Z', '2026-09-27'],
    ['Tokyo', 'Asia/Tokyo', '2026-09-26T23:00:00Z', '2026-09-27T15:00:00Z', '2026-09-27'],
    ['São Paulo', 'America/Sao_Paulo', '2026-09-27T03:00:00Z', '2026-09-28T03:00:00Z', '2026-09-27'],
  ]) {
    const queries = buildDiscoveryQueries(validateDiscoveryInput({ ...input, areaLabel, timeZone, start, end,
      language: 'en', interests: ['art', 'running'], lat: 52.54321, lng: 13.45678 }));
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.ok(query.includes(areaLabel));
      assert.ok(query.includes(expectedDate));
      assert.doesNotMatch(query, /rausgegangen|site:|52\.54321|13\.45678/i);
    }
    assert.match(queries[1], /exhibition workshop/);
    assert.match(queries[1], /running club/);
  }
  const dstQueries = buildDiscoveryQueries(validateDiscoveryInput({ ...input,
    start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z' }));
  assert.match(dstQueries[0], /2026-10-25/);
  assert.doesNotMatch(dstQueries[0], /2026-10-26/);
  assert.match(dstQueries[1], /Ausstellung Workshop/);
});

test('input normalization limits interests and rejects invalid dates, coordinates and timezones', () => {
  const validated = validateDiscoveryInput({ ...input, interests: ['art', 'art', 'invented', 'site:evil.example', 'social'] });
  assert.deepEqual(validated.interests, ['art', 'social']);
  for (const changes of [
    { start: '2026-09-27' }, { start: '2026-02-30T11:00+0100' }, { end: input.start },
    { end: '2026-10-28T00:00:00+02:00' }, { lat: '52.5' }, { lng: 181 },
    { areaLabel: 'x'.repeat(161) }, { timeZone: 'Somewhere/Imaginary' },
  ]) assert.throws(() => validateDiscoveryInput({ ...input, ...changes }), { code: 'invalid-argument' });
});

test('source selection rotates across publishers and groups aggregator subdomains', () => {
  const results = sources([
    ...Array.from({ length: 8 }, (_, index) => `https://${index ? `city${index}` : 'www'}.aggregator.example/event-${index}/`),
    'https://museum.example/calendar/', 'https://community.example/events/', 'https://city.example/whats-on/',
    'https://festival.example/programme/', 'http://insecure.example/event/', 'javascript:alert(1)',
  ]);
  const selected = selectSourcePages(results);
  assert.equal(selected.length, 6);
  assert.equal(selected.filter(url => new URL(url).hostname.endsWith('aggregator.example')).length, 2);
  for (const publisher of ['museum', 'community', 'city', 'festival']) {
    assert.ok(selected.some(url => new URL(url).hostname === `${publisher}.example`));
  }
  assert.equal(new Set(selected).size, selected.length);
  assert.ok(selected.every(url => url.startsWith('https://')));
  assert.deepEqual(selectSourcePages(sources([
    'https://museum.example/event/#one', 'https://museum.example/event/#two',
    'https://user:secret@museum.example/event/', 'https://museum.example:8443/event/',
  ])), ['https://museum.example/event/']);
});

test('search titles and snippets never become invented event facts', async () => {
  let fetched = 0;
  const discover = createCityEventDiscovery({
    search: async () => [{ url: 'https://calendar.example/event/', title: 'Berlin Marathon tomorrow at 9',
      ...event, startAt: '2026-09-27T07:00:00Z', venue: 'Berlin' }],
    fetchPage: async url => { fetched++; return { url, html: '<h1>Undated editorial recommendations for Berlin</h1>' }; },
  });
  assert.deepEqual(await discover(input), { events: [], status: 'ok' });
  assert.equal(fetched, 1);
});

test('fetched structured events from independent publishers retain their own attribution', async () => {
  const urls = ['https://museum.example/calendar/', 'https://neighbourhood.example/run/'];
  const discover = createCityEventDiscovery({ search: async () => sources(urls),
    fetchPage: async url => ({ url, html: schemaHtml({ ...event,
      name: url.includes('museum') ? 'Museum drawing workshop' : 'Community run' }) }),
  });
  const result = await discover(input);
  assert.equal(result.status, 'ok');
  assert.equal(result.events.length, 2);
  assert.deepEqual(new Set(result.events.map(item => item.sourceUrl)), new Set(urls));
  assert.deepEqual(new Set(result.events.map(item => item.sourceName)), new Set(['museum.example', 'neighbourhood.example']));
  assert.ok(result.events.every(item => !item.description.includes('editorial text')));
});

test('the same event syndicated across sites is deduplicated by normalized title, date and venue', async () => {
  const urls = ['https://organizer.example/run/', 'https://aggregator.example/run/'];
  const discover = createCityEventDiscovery({ search: async () => sources(urls), fetchPage: async url => ({ url,
    html: schemaHtml({ ...event, name: url.includes('aggregator') ? 'GEMEINSAM -- láufen' : event.name }),
  }) });
  const result = await discover(input);
  assert.equal(result.events.length, 1);
  assert.ok(urls.includes(result.events[0].sourceUrl));
});

test('events in the wrong city or outside the requested dates are rejected after fetching', async () => {
  const records = [event,
    { ...event, name: 'Wrong city', location: { ...event.location, address: { addressLocality: 'Hamburg' } } },
    { ...event, name: 'Expired yesterday', startDate: '2026-09-26T11:00+0200', endDate: '2026-09-26T13:00+0200' },
    { ...event, name: 'Tomorrow only', startDate: '2026-09-28T11:00+0200', endDate: '2026-09-28T13:00+0200' },
  ];
  const discover = createCityEventDiscovery({ search: async () => sources(['https://travelling-show.example/events/']),
    fetchPage: async url => ({ url, html: schemaHtml(records) }),
  });
  assert.deepEqual((await discover(input)).events.map(item => item.title), [event.name]);
});

test('verified coordinates admit city-wide events but reject remote locations despite matching city text', async () => {
  const records = [
    { ...event, name: 'Across the city', location: { ...event.location, geo: { latitude: 52.4, longitude: 13.25 } } },
    { ...event, name: 'Actually in Hamburg', location: { ...event.location, geo: { latitude: 53.55, longitude: 9.99 } } },
  ];
  const discover = createCityEventDiscovery({ search: async () => sources(['https://city.example/calendar/']),
    fetchPage: async url => ({ url, html: schemaHtml(records) }),
  });
  assert.deepEqual((await discover({ ...input, lat: 52.52, lng: 13.405 })).events.map(item => item.title), ['Across the city']);
});

test('same-day requests share search and raw-event cache while exact time windows stay caller-specific', async () => {
  let searches = 0;
  let pages = 0;
  let authorizations = 0;
  let now = 0;
  const records = [event, { ...event, name: 'Evening meetup', startDate: '2026-09-27T17:00+0200', endDate: '2026-09-27T18:00+0200' }];
  const discover = createCityEventDiscovery({ now: () => now,
    search: async () => { searches++; await tick(); return sources(['https://community.example/events/']); },
    fetchPage: async url => { pages++; return { url, html: schemaHtml(records) }; },
  });
  const authorize = async () => { authorizations++; return true; };
  const afternoon = { ...input, start: '2026-09-27T16:00+0200', end: '2026-09-27T19:00+0200' };
  const [all, later] = await Promise.all([discover(input, authorize), discover(afternoon, authorize)]);
  assert.equal(all.events.length, 2);
  assert.deepEqual(later.events.map(item => item.title), ['Evening meetup']);
  assert.equal(searches, 2);
  assert.equal(pages, 1);
  assert.equal(authorizations, 1);
  assert.deepEqual((await discover(afternoon, authorize)).events, later.events);
  assert.equal(searches, 2);
  now = 16 * 60_000;
  await discover(input, authorize);
  assert.equal(searches, 4);
  assert.equal(pages, 2);
  assert.equal(authorizations, 2);
});

test('changed preferences, language, timezone and mode invalidate discovery cache', async () => {
  const queries = [];
  const discover = createCityEventDiscovery({ search: async query => { queries.push(query); return []; } });
  await discover(input);
  await discover({ ...input, interests: ['social', 'art', 'art'] });
  assert.equal(queries.length, 2);
  for (const changes of [{ interests: ['running'] }, { language: 'en' }, { timeZone: 'UTC' }, { discoveryMode: 'now' }]) {
    await discover({ ...input, ...changes });
  }
  assert.equal(queries.length, 10);
  assert.ok(queries.some(query => query.includes('Lauftreff')));
  assert.ok(queries.some(query => query.includes('events city local event calendar')));
});

test('missing configuration and exhausted authorization budget perform no external work', async () => {
  let external = 0;
  const search = async () => { external++; return []; };
  const fetchPage = async () => { external++; return null; };
  assert.deepEqual(await createCityEventDiscovery({ fetchPage })(input), { events: [], status: 'not_configured' });
  assert.deepEqual(await createCityEventDiscovery({ search, fetchPage, configured: () => false })(input),
    { events: [], status: 'not_configured' });
  const discover = createCityEventDiscovery({ search, fetchPage });
  assert.deepEqual(await discover(input, async () => false), { events: [], status: 'unavailable' });
  assert.deepEqual(await discover(input, async () => { throw new Error('quota database unavailable'); }), { events: [], status: 'unavailable' });
  assert.equal(external, 0);
  await discover(input, async () => true);
  assert.equal(external, 2);
});

test('search failures and one broken publisher remain fail-soft', async () => {
  const failed = createCityEventDiscovery({ search: async () => { throw new Error('search down'); } });
  assert.deepEqual(await failed(input), { events: [], status: 'unavailable' });
  let attempts = 0;
  const urls = ['https://broken.example/calendar/', 'https://working.example/event/'];
  const discover = createCityEventDiscovery({ search: async () => {
    if (++attempts === 1) throw new Error('one search failed');
    return sources(urls);
  }, fetchPage: async url => {
    if (url.includes('broken')) throw new Error('publisher down');
    return { url, html: detail };
  } });
  const result = await discover(input);
  assert.equal(result.status, 'ok');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].sourceName, 'working.example');
});

test('crawl caps total pages, per-publisher pages, depth and fetch concurrency', async () => {
  const roots = Array.from({ length: 6 }, (_, index) => `https://publisher${index}.example/calendar/`);
  let active = 0;
  let peak = 0;
  const calls = [];
  const discover = createCityEventDiscovery({ search: async () => sources(roots), fetchPage: async url => {
    calls.push(url); active++; peak = Math.max(peak, active);
    await tick(); active--;
    const origin = new URL(url).origin;
    const suffix = url.includes('/calendar/') ? 'first' : 'second';
    return { url, html: schemaHtml({ '@type': 'ItemList', itemListElement: Array.from({ length: 40 }, (_, index) =>
      ({ '@type': 'ListItem', url: `${origin}/${suffix}-${index}/` })) }) };
  } });
  assert.equal((await discover(input)).status, 'ok');
  assert.equal(calls.length, 10);
  assert.equal(peak, 3);
  assert.ok(calls.every(url => !url.includes('/second-')));
  for (const root of roots) assert.ok(calls.filter(url => new URL(url).origin === new URL(root).origin).length <= 3);
  const onePublisherCalls = [];
  const samePublisher = createCityEventDiscovery({ search: async () => sources([
    'https://city.aggregator.example/calendar/', 'https://www.aggregator.example/calendar/',
  ]), fetchPage: async url => {
    onePublisherCalls.push(url);
    return { url, html: schemaHtml({ '@type': 'ItemList', itemListElement: [
      { url: `${new URL(url).origin}/detail-one/` }, { url: `${new URL(url).origin}/detail-two/` },
    ] }) };
  } });
  await samePublisher(input);
  assert.equal(onePublisherCalls.length, 3);
});

test('event output remains capped per publisher and in total', async () => {
  const roots = Array.from({ length: 6 }, (_, index) => `https://publisher${index}.example/events/`);
  const discover = createCityEventDiscovery({ search: async () => sources(roots), fetchPage: async url => ({ url,
    html: schemaHtml(Array.from({ length: 10 }, (_, index) => ({ ...event, name: `${new URL(url).hostname} Activity ${index}` }))),
  }) });
  const result = await discover(input);
  assert.equal(result.events.length, 20);
  for (const root of roots) assert.ok(result.events.filter(item => item.sourceUrl === root).length <= 4);
});

test('deadline returns completed sources and aborts slow fetches even when they ignore cancellation', async () => {
  let signal;
  const discover = createCityEventDiscovery({ budgetMs: 25,
    search: async () => sources(['https://working.example/event/', 'https://slow.example/event/']),
    fetchPage: async (url, incomingSignal) => {
      signal = incomingSignal;
      if (url.includes('slow')) return new Promise(() => {});
      return { url, html: detail };
    },
  });
  const started = Date.now();
  const result = await discover(input);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(result.status, 'ok');
  assert.equal(result.events.length, 1);
  assert.equal(signal.aborted, true);
});

test('partial search success survives another hanging query within the search budget', async () => {
  let attempts = 0;
  let searchSignal;
  const discover = createCityEventDiscovery({ budgetMs: 500, searchBudgetMs: 20,
    search: async (query, language, signal) => {
      searchSignal = signal;
      if (++attempts === 1) return sources(['https://working.example/event/']);
      return new Promise(() => {});
    }, fetchPage: async url => ({ url, html: detail }),
  });
  const result = await discover(input);
  assert.equal(result.status, 'ok');
  assert.equal(result.events.length, 1);
  assert.equal(searchSignal.aborted, true);
});

test('the overall deadline aborts hanging search before its longer search timeout', async () => {
  let searchSignal;
  let fetched = 0;
  const discover = createCityEventDiscovery({ budgetMs: 20,
    search: async (query, language, signal) => { searchSignal = signal; return new Promise(() => {}); },
    fetchPage: async () => { fetched++; return null; },
  });
  const started = Date.now();
  assert.deepEqual(await discover(input), { events: [], status: 'unavailable' });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(searchSignal.aborted, true);
  assert.equal(fetched, 0);
});

test('distinct pending discovery requests are bounded and overload performs no extra search', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let searches = 0;
  const discover = createCityEventDiscovery({ search: async () => { searches++; await gate; return []; } });
  const dayInput = day => ({ ...input,
    start: `2026-10-${String(day).padStart(2, '0')}T00:00:00+02:00`,
    end: `2026-10-${String(day).padStart(2, '0')}T23:59:00+02:00`,
  });
  const pending = Array.from({ length: 16 }, (_, index) => discover(dayInput(index + 1)));
  try {
    await tick();
    assert.deepEqual(await discover(dayInput(17)), { events: [], status: 'unavailable' });
    assert.equal(searches, 32);
  } finally { release(); }
  await Promise.all(pending);
});

test('unauthenticated callable requests are rejected before search or quota access', async () => {
  await assert.rejects(discoverCityEvents.run({ data: input }), { code: 'unauthenticated' });
});
