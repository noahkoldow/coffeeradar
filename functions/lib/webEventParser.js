"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWebEvents = parseWebEvents;
exports.extractEventPageLinks = extractEventPageLinks;
const node_crypto_1 = require("node:crypto");
const MAX_HTML_CHARACTERS = 4 * 1024 * 1024;
const MAX_SCRIPT_CHARACTERS = 512 * 1024;
const MAX_OBJECTS = 3_000;
const MAX_EVENTS = 100;
const MAX_LINKS = 30;
const EVENT_TYPES = new Set([
    'Event', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent',
    'EducationEvent', 'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent',
    'MusicEvent', 'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent',
]);
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function values(value) {
    return Array.isArray(value) ? value.slice(0, 200) : value === undefined ? [] : [value];
}
function schemaName(value) {
    const name = typeof value === 'string' ? value : record(value)['@id'];
    return typeof name === 'string' ? name.replace(/^https?:\/\/schema\.org\//i, '') : '';
}
function hasType(value, type) {
    return values(value['@type']).some(item => schemaName(item) === type);
}
function isEvent(value) {
    return values(value['@type']).some(item => EVENT_TYPES.has(schemaName(item)));
}
function httpsUrl(value, base) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2_048)
        return undefined;
    try {
        const url = new URL(value, base);
        if (url.protocol !== 'https:' || url.username || url.password || url.port)
            return undefined;
        return url;
    }
    catch {
        return undefined;
    }
}
function pageUrl(value, base) {
    if (typeof value === 'string' && value.startsWith('_:'))
        return undefined;
    const url = httpsUrl(value, base.href);
    // Only the fetched publisher may identify a source page or a page to crawl next.
    if (!url || url.origin !== base.origin)
        return undefined;
    url.hash = '';
    return url.href;
}
function structuredPage(html, fetchedUrl) {
    const objects = [];
    const ids = new Map();
    const idKey = (value) => {
        if (typeof value !== 'string' || value.length > 2_048)
            return undefined;
        if (value.startsWith('_:'))
            return value;
        return httpsUrl(value, fetchedUrl.href)?.href;
    };
    let visited = 0;
    const visit = (value, depth) => {
        if (++visited > 12_000 || depth > 12 || objects.length >= MAX_OBJECTS)
            return;
        if (Array.isArray(value)) {
            for (const item of value.slice(0, 200))
                visit(item, depth + 1);
            return;
        }
        if (!value || typeof value !== 'object')
            return;
        const object = value;
        objects.push(object);
        const key = idKey(object['@id']);
        if (key && Object.keys(object).length > Object.keys(ids.get(key) ?? {}).length)
            ids.set(key, object);
        for (const [name, child] of Object.entries(object).slice(0, 80)) {
            // Contexts declare vocabulary; they are never fetched or interpreted as events.
            if (name !== '@context' && child && typeof child === 'object')
                visit(child, depth + 1);
        }
    };
    if (typeof html === 'string' && html.length <= MAX_HTML_CHARACTERS) {
        let scripts = 0;
        const pattern = /<script\b[^>]*\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json(?=[\s>]))[^>]*>([\s\S]*?)<\/script\s*>/gi;
        for (const match of html.matchAll(pattern)) {
            if (++scripts > 40 || objects.length >= MAX_OBJECTS || visited > 12_000)
                break;
            if (match[1].length > MAX_SCRIPT_CHARACTERS)
                continue;
            try {
                visit(JSON.parse(match[1]), 0);
            }
            catch { /* Broken publisher markup is not evidence. */ }
        }
    }
    return {
        objects,
        resolve(value) {
            let object = record(value);
            const seen = new Set();
            for (let depth = 0; depth < 8; depth++) {
                const key = idKey(object['@id']);
                if (!key || seen.has(key))
                    break;
                seen.add(key);
                const target = ids.get(key);
                if (!target || target === object)
                    break;
                object = { ...target, ...object };
            }
            return object;
        },
    };
}
function plain(value, limit) {
    if (typeof value !== 'string')
        return '';
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return value.slice(0, 8_000).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
        if (entity[0] !== '#')
            return entities[entity.toLowerCase()] ?? match;
        const codepoint = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return codepoint > 0 && codepoint <= 0x10ffff && !(codepoint >= 0xd800 && codepoint <= 0xdfff)
            ? String.fromCodePoint(codepoint) : '';
    }).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function iso(value) {
    if (typeof value !== 'string' || value.length > 40)
        return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):?(\d{2}))$/i.exec(value);
    if (!match)
        return undefined;
    const [, y, m, d, h, minute, second = '0', , offsetHour = '0', offsetMinute = '0'] = match;
    const [year, month, day, hour, minutes, seconds] = [y, m, d, h, minute, second].map(Number);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minutes > 59 || seconds > 59
        || Number(offsetHour) > 23 || Number(offsetMinute) > 59
        || day > new Date(Date.UTC(year, month, 0)).getUTCDate())
        return undefined;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
function coordinate(value, limit) {
    if (typeof value !== 'string' && typeof value !== 'number')
        return undefined;
    if (typeof value === 'string' && (!value.trim() || value.length > 30 || !/^[+-]?\d+(?:\.\d+)?$/.test(value)))
        return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : undefined;
}
function addressOf(value, resolve) {
    if (typeof value === 'string')
        return plain(value, 240);
    const address = resolve(value);
    return [plain(address.streetAddress, 120),
        [plain(address.postalCode, 16), plain(address.addressLocality, 80)].filter(Boolean).join(' '),
        plain(address.addressRegion, 60)].filter(Boolean).join(', ').slice(0, 240);
}
function leafOffers(value, resolve) {
    const offers = [];
    let examined = 0;
    const visit = (input, depth) => {
        for (const item of values(input).slice(0, 40)) {
            if (++examined > 100)
                return;
            const offer = resolve(item);
            // Aggregators commonly wrap ticket categories in AggregateOffer. Their unavailable
            // child tickets must not look bookable merely because the wrapper has no status.
            if (depth < 3 && hasType(offer, 'AggregateOffer') && values(offer.offers).length) {
                visit(offer.offers, depth + 1);
            }
            else if (Object.keys(offer).length)
                offers.push(offer);
        }
    };
    visit(value, 0);
    return offers;
}
/** Parse only explicit publisher facts. Undated copy and search snippets never become events. */
function parseWebEvents(html, fetchedUrl) {
    const base = httpsUrl(fetchedUrl);
    if (!base)
        return [];
    const { objects, resolve } = structuredPage(html, base);
    const events = new Map();
    for (const candidate of objects) {
        const value = resolve(candidate);
        if (!isEvent(value))
            continue;
        const blockedStatus = values(value.eventStatus).some(item => ['EventCancelled', 'EventPostponed'].includes(schemaName(item)));
        const online = values(value.eventAttendanceMode).some(item => schemaName(item) === 'OnlineEventAttendanceMode');
        if (blockedStatus || online)
            continue;
        const title = plain(value.name, 180);
        const startAt = iso(value.startDate);
        const endAt = value.endDate == null || value.endDate === '' ? undefined : iso(value.endDate);
        if (!title || !startAt || (value.endDate != null && value.endDate !== '' && !endAt) || (endAt && endAt <= startAt))
            continue;
        const locations = values(value.location);
        const physical = locations.find(item => {
            if (typeof item === 'string')
                return !!plain(item, 160) && !/^https?:\/\//i.test(item);
            const location = resolve(item);
            return !hasType(location, 'VirtualLocation') && !!(plain(location.name, 160) || addressOf(location.address, resolve));
        });
        const location = resolve(physical);
        const address = addressOf(location.address, resolve);
        const venue = typeof physical === 'string' ? plain(physical, 160) : plain(location.name, 160) || address;
        if (!venue)
            continue;
        const geo = resolve(location.geo);
        const lat = coordinate(geo.latitude, 90);
        const lng = coordinate(geo.longitude, 180);
        const offers = leafOffers(value.offers, resolve);
        const available = offers.filter(offer => !['SoldOut', 'Discontinued', 'OutOfStock'].includes(schemaName(offer.availability)));
        if (offers.length && !available.length)
            continue;
        const offer = available.find(item => /^\d+(?:\.\d{1,2})?$/.test(String(item.price)) && /^[A-Z]{3}$/.test(String(item.priceCurrency)));
        const priceHint = offer ? `${offer.price} ${offer.priceCurrency}` : value.isAccessibleForFree === true ? 'Free' : undefined;
        const sourceUrl = pageUrl(value.url, base) ?? pageUrl(value['@id'], base) ?? pageUrl(base.href, base);
        const identity = `${sourceUrl}|${startAt}|${title.toLowerCase()}|${venue.toLowerCase()}`;
        const id = `web_event_${(0, node_crypto_1.createHash)('sha256').update(identity).digest('hex').slice(0, 24)}`;
        events.set(id, {
            id, title, description: `${title} · ${venue}`, startAt, venue, sourceUrl,
            sourceName: base.hostname.replace(/^www\./i, ''),
            ...(endAt ? { endAt } : {}), ...(address ? { address } : {}),
            ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
            ...(priceHint ? { priceHint } : {}),
            // A broad opening interval is not evidence that visitors may drop in at any time.
        });
        if (events.size >= MAX_EVENTS)
            break;
    }
    return [...events.values()].sort((left, right) => left.startAt.localeCompare(right.startAt));
}
/** Follow bounded structured calendar entries, never arbitrary navigation or off-site links. */
function extractEventPageLinks(html, fetchedUrl) {
    const base = httpsUrl(fetchedUrl);
    if (!base)
        return [];
    const { objects, resolve } = structuredPage(html, base);
    const links = new Set();
    const fetched = pageUrl(base.href, base);
    for (const object of objects) {
        const list = resolve(object);
        if (!hasType(list, 'ItemList'))
            continue;
        for (const entry of values(list.itemListElement)) {
            const wrapper = resolve(entry);
            const item = resolve(wrapper.item);
            const typed = values(item['@type']).length ? item : wrapper;
            if (values(typed['@type']).length && !isEvent(typed) && !hasType(typed, 'ListItem'))
                continue;
            const raw = typeof entry === 'string' ? entry : typeof wrapper.item === 'string' ? wrapper.item
                : item.url ?? item['@id'] ?? wrapper.url ?? wrapper['@id'];
            const link = pageUrl(raw, base);
            if (link && link !== fetched)
                links.add(link);
            if (links.size >= MAX_LINKS)
                return [...links];
        }
    }
    return [...links];
}
