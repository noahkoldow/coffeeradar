const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWebEvents, extractEventPageLinks } = require('../lib/webEventParser');

const page = 'https://www.city-culture.example/calendar/';
const event = {
  '@context': 'https://schema.org', '@type': 'MusicEvent',
  name: 'Community &amp; Music', description: 'Long protected editorial copy which must not be reproduced.',
  startDate: '2026-09-27T15:00:00+02:00', endDate: '2026-09-27T17:00:00+02:00',
  url: '/events/community-music/',
  location: { '@type': 'Place', name: 'Culture Hall', address: {
    '@type': 'PostalAddress', streetAddress: 'Example Street 5', postalCode: '10178', addressLocality: 'Berlin',
  } },
};
const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const parse = changes => parseWebEvents(html({ ...event, ...changes }), page);

test('unrelated publishers yield attributed, factual events without copied editorial text', () => {
  for (const origin of ['https://www.city-culture.example', 'https://museum.example', 'https://local-association.example']) {
    const [parsed] = parseWebEvents(html(event), `${origin}/calendar/`);
    assert.equal(parsed.sourceUrl, `${origin}/events/community-music/`);
    assert.equal(parsed.sourceName, new URL(origin).hostname.replace(/^www\./, ''));
    assert.equal(parsed.title, 'Community & Music');
    assert.equal(parsed.description, 'Community & Music · Culture Hall');
    assert.equal(parsed.startAt, '2026-09-27T13:00:00.000Z');
    assert.equal(parsed.endAt, '2026-09-27T15:00:00.000Z');
    assert.equal(parsed.address, 'Example Street 5, 10178 Berlin');
    assert.equal(parsed.attendanceMode, undefined);
  }
});

test('Event subclasses work with full schema URLs and multiple types', () => {
  for (const type of ['Event', 'SportsEvent', 'Festival', 'ExhibitionEvent', 'CourseInstance', 'SocialEvent']) {
    assert.equal(parse({ '@type': ['Thing', `https://schema.org/${type}`] }).length, 1);
  }
  assert.deepEqual(parse({ '@type': 'Article' }), []);
});

test('graph references resolve places, addresses, coordinates, offers and list entries', () => {
  const graph = { '@graph': [
    { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@id': '#concert' } }] },
    { ...event, '@id': '#concert', location: { '@id': '#hall' }, offers: { '@id': '#ticket' } },
    { '@id': '#hall', '@type': 'Place', name: 'Culture Hall', address: { '@id': '#address' }, geo: { '@id': '#geo' } },
    { '@id': '#address', '@type': 'PostalAddress', streetAddress: 'Example Street 5', addressLocality: 'Berlin' },
    { '@id': '#geo', '@type': 'GeoCoordinates', latitude: '52.52', longitude: '13.4' },
    { '@id': '#ticket', '@type': 'Offer', price: '0.00', priceCurrency: 'EUR', availability: 'https://schema.org/InStock' },
  ] };
  const events = parseWebEvents(html(graph), page);
  assert.equal(events.length, 1);
  assert.equal(events[0].venue, 'Culture Hall');
  assert.equal(events[0].address, 'Example Street 5, Berlin');
  assert.equal(events[0].lat, 52.52);
  assert.equal(events[0].lng, 13.4);
  assert.equal(events[0].priceHint, '0.00 EUR');
  assert.deepEqual(extractEventPageLinks(html(graph), page), ['https://www.city-culture.example/events/community-music/']);
});

test('direct ItemList events are parsed and same-origin detail links are selectively extracted', () => {
  const list = { '@type': 'ItemList', itemListElement: [
    event,
    { '@type': 'ListItem', item: { '@type': 'Event', url: '/events/second/' } },
    { '@type': 'ListItem', url: '/events/third/' },
    { '@type': 'ListItem', item: '/events/fourth/' },
    { '@type': 'ListItem', item: { '@type': 'Product', url: '/buy/' } },
    { '@type': 'ListItem', url: 'https://other.example/event/' },
    { '@type': 'ListItem', url: 'https://www.city-culture.example:8443/event/' },
    { '@type': 'ListItem', url: 'https://user:secret@www.city-culture.example/event/' },
    { '@type': 'ListItem', url: 'http://www.city-culture.example/event/' },
    { '@type': 'ListItem', url: 'javascript:alert(1)' },
    { '@type': 'ListItem', url: '#calendar' },
    { '@type': 'ListItem', url: '/events/third/#about' },
  ] };
  const source = `${html(list)}<a href="/events/arbitrary/">Navigation</a>`;
  assert.equal(parseWebEvents(source, page).length, 1);
  assert.deepEqual(extractEventPageLinks(source, page), [
    'https://www.city-culture.example/events/community-music/',
    'https://www.city-culture.example/events/second/',
    'https://www.city-culture.example/events/third/',
    'https://www.city-culture.example/events/fourth/',
  ]);
});

test('IDs preserve distinct occurrences and same-page events while removing duplicate markup', () => {
  const secondDay = { ...event, startDate: '2026-09-28T15:00+0200', endDate: '2026-09-28T17:00+0200' };
  const secondEvent = { ...event, name: 'Meet & make' };
  const results = parseWebEvents(html([event, event, secondDay, secondEvent]), page);
  assert.equal(results.length, 3);
  assert.equal(new Set(results.map(item => item.id)).size, 3);
  assert.equal(results[0].id, parse({})[0].id);
});

test('explicit offsets distinguish the repeated daylight-saving hour without guessed timezones', () => {
  const events = parseWebEvents(html([
    { ...event, startDate: '2026-10-25T02:30+0200', endDate: undefined },
    { ...event, startDate: '2026-10-25T02:30+0100', endDate: undefined },
  ]), page);
  assert.deepEqual(events.map(item => item.startAt), ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
});

test('invalid dates, timezone-free dates and impossible or malformed end times are not guessed', () => {
  for (const startDate of ['2026-09-27', '2026-09-27T15:00', '2026-02-30T15:00+0100',
    '2026-09-27T24:00+0200', '2026-09-27T15:60+0200', '2026-09-27T15:00+2460', 'garbage']) {
    assert.deepEqual(parse({ startDate }), []);
  }
  for (const endDate of ['2026-09-27', 'nonsense', '2026-09-27T12:00+0200']) assert.deepEqual(parse({ endDate }), []);
  assert.equal(parse({ endDate: undefined }).length, 1);
});

test('cancelled, postponed, online-only and fully sold-out events are excluded', () => {
  for (const changes of [
    { eventStatus: 'https://schema.org/EventCancelled' },
    { eventStatus: { '@id': 'https://schema.org/EventPostponed' } },
    { eventAttendanceMode: ['https://schema.org/OnlineEventAttendanceMode'] },
    { location: { '@type': 'VirtualLocation', name: 'Online' } },
    { offers: [{ availability: 'https://schema.org/SoldOut' }, { availability: 'https://schema.org/Discontinued' }] },
    { offers: { '@type': 'AggregateOffer', offers: [{ availability: 'https://schema.org/SoldOut' }] } },
  ]) assert.deepEqual(parse(changes), []);
  assert.equal(parse({ offers: [{ availability: 'SoldOut' }, { availability: 'InStock', price: 5, priceCurrency: 'EUR' }] })[0].priceHint, '5 EUR');
  assert.equal(parse({ eventAttendanceMode: 'MixedEventAttendanceMode' }).length, 1);
});

test('physical places are preferred to virtual alternatives and incomplete coordinates stay absent', () => {
  assert.equal(parse({ location: [{ '@type': 'VirtualLocation', name: 'Online' }, event.location] })[0].venue, 'Culture Hall');
  assert.equal(parse({ location: 'Neighbourhood hall' })[0].venue, 'Neighbourhood hall');
  assert.deepEqual(parse({ location: 'https://streaming.example/room' }), []);
  for (const geo of [{ latitude: true, longitude: 13 }, { latitude: '0x32', longitude: 13 },
    { latitude: 52, longitude: null }, { latitude: 91, longitude: 13 }, { latitude: '', longitude: '' }]) {
    const [parsed] = parse({ location: { ...event.location, geo } });
    assert.equal(parsed.lat, undefined);
    assert.equal(parsed.lng, undefined);
  }
});

test('source attribution cannot be replaced by publisher text or an unrelated canonical URL', () => {
  const [parsed] = parse({ url: 'https://unrelated.example/fake/', publisher: { name: 'Official City Government' } });
  assert.equal(parsed.sourceUrl, page);
  assert.equal(parsed.sourceName, 'city-culture.example');
  assert.equal(parse({ url: undefined, '@id': '_:event' })[0].sourceUrl, page);
  assert.deepEqual(parseWebEvents(html(event), 'http://city-culture.example/events/'), []);
});

test('malformed scripts, plain editorial text and non-JSON-LD scripts do not create events', () => {
  const source = '<h1>Join a marathon tomorrow at 9am in Berlin</h1>'
    + '<script type="application/ld+json">invalid</script>'
    + `<script type="application/json">${JSON.stringify(event)}</script>`;
  assert.deepEqual(parseWebEvents(source, page), []);
  assert.equal(parseWebEvents(`${source}${html(event)}`, page).length, 1);
});

test('large and cyclic-reference documents remain bounded', () => {
  const list = { '@type': 'ItemList', itemListElement: Array.from({ length: 500 }, (_, index) => ({ '@type': 'ListItem', url: `/events/${index}/` })) };
  assert.equal(extractEventPageLinks(html(list), page).length, 30);
  const refs = { '@graph': [{ ...event, location: { '@id': '#cycle' } }, { '@id': '#cycle', address: { '@id': '#cycle' } }] };
  assert.deepEqual(parseWebEvents(html(refs), page), []);
  assert.deepEqual(parseWebEvents(' '.repeat(4 * 1024 * 1024 + 1) + html(event), page), []);
});
