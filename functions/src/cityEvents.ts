import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { createBraveSourceSearch, type WebSourceSearch, type SourceSearchResult } from './eventSourceSearch';
import { createPublicWebFetcher } from './publicWebFetch';
import { parseWebEvents, extractEventPageLinks, type WebEvent } from './webEventParser';
import { reserveEventDiscovery } from './eventDiscoveryBudget';

export type CityEvent = WebEvent;
export interface DiscoveryInput {
  areaLabel: string; lat?: number; lng?: number; start: string; end: string;
  interests: string[]; language: 'de' | 'en'; timeZone: string; discoveryMode: 'now' | 'plan_ahead';
}
export type DiscoveryResult = { events: WebEvent[]; status: 'ok' | 'unavailable' | 'not_configured' };
type PageFetcher = (url: string, signal?: AbortSignal) => Promise<{ url: string; html: string } | null>;

const INTERESTS: Record<string, [string, string]> = {
  fitness: ['Sport Mitmachen', 'community sport'], cycling: ['Radtour', 'cycling'], running: ['Lauftreff', 'running club'],
  swimming: ['Schwimmen', 'swimming'], hiking: ['Wanderung', 'hiking'], wellness: ['Yoga Entspannung', 'yoga wellbeing'],
  nature: ['Naturführung', 'nature walk'], beaches: ['Strand', 'beach'], parks: ['Park', 'park'],
  explore: ['Stadtführung', 'city walk'], coffee: ['Kaffeeverkostung', 'coffee tasting'], food: ['Kochkurs Markt', 'cooking market'],
  street_food: ['Streetfood Markt', 'street food market'], art: ['Ausstellung Workshop', 'exhibition workshop'],
  music: ['Konzert', 'concert'], movies: ['Kino', 'cinema'], learning: ['Workshop Vortrag', 'workshop lecture'],
  focus: ['Bibliothek Workshop', 'library workshop'], social: ['Nachbarschaft Treff', 'community meetup'],
};
const MAX_PAGES = 10;
const MAX_ROOTS = 6;
const MAX_CACHE = 128;
const MAX_PENDING = 16;
const REQUEST_BUDGET_MS = 15000;

function normalized(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) return undefined;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)!;
  const [, year, month, day, hour, minute, second = '0'] = parts.map(Number);
  if (hour > 23 || minute > 59 || Number(second) > 59
    || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined;
  return new Date(value).toISOString();
}

export function validateDiscoveryInput(data: unknown): DiscoveryInput {
  const input = data as Partial<DiscoveryInput> | null;
  if (!input || typeof input.areaLabel !== 'string' || input.areaLabel.length > 160) {
    throw new HttpsError('invalid-argument', 'A short area label is required.');
  }
  const start = iso(input.start);
  const end = iso(input.end);
  if (!start || !end || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 7 * 86400000) {
    throw new HttpsError('invalid-argument', 'Choose a valid time window of at most seven days, including its timezone.');
  }
  for (const [value, limit] of [[input.lat, 90], [input.lng, 180]] as const) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit)) {
      throw new HttpsError('invalid-argument', 'Invalid location.');
    }
  }
  const timeZone = typeof input.timeZone === 'string' && input.timeZone.length < 80 ? input.timeZone : 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw new HttpsError('invalid-argument', 'Invalid timezone.'); }
  return { areaLabel: input.areaLabel.trim(), start, end, lat: input.lat, lng: input.lng, timeZone,
    interests: [...new Set(Array.isArray(input.interests) ? input.interests.filter(tag => typeof tag === 'string' && Object.prototype.hasOwnProperty.call(INTERESTS, tag)) : [])].slice(0, 8).sort(),
    language: input.language === 'de' ? 'de' : 'en', discoveryMode: input.discoveryMode === 'plan_ahead' ? 'plan_ahead' : 'now' };
}

function localDay(isoDate: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(isoDate));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Public search context contains no coordinates, calendar titles, profile text or arbitrary search operators. */
export function buildDiscoveryQueries(input: DiscoveryInput): string[] {
  const area = input.areaLabel.replace(/[^\p{L}\p{N}, .-]/gu, ' ').replace(/\s+/g, ' ').slice(0, 120).trim();
  if (!area || !/\p{L}/u.test(area)) return [];
  const firstDay = localDay(input.start, input.timeZone);
  const lastDay = localDay(new Date(Date.parse(input.end) - 1).toISOString(), input.timeZone);
  const dates = firstDay === lastDay ? firstDay : `${firstDay} ${lastDay}`;
  const lang = input.language === 'de' ? 0 : 1;
  const topics = input.interests.slice(0, 3).map(tag => INTERESTS[tag][lang]);
  return [
    `${area} ${dates} ${lang === 0 ? 'Veranstaltungen Stadt Veranstaltungskalender' : 'events city local event calendar'}`,
    `${area} ${dates} ${topics.length ? topics.join(' OR ') : (lang === 0 ? 'kostenlos Nachbarschaft Workshop Sport' : 'free community workshop sport')} ${lang === 0 ? 'Veranstalter Termine' : 'organizer events'}`,
  ];
}

/** Group common subdomain variants together so one aggregator cannot occupy every slot. */
function sourceSite(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const labels = host.split('.');
    return labels.slice(/\.(?:co\.uk|org\.uk|com\.au|co\.nz|com\.br|co\.jp|co\.za)$/.test(host) ? -3 : -2).join('.');
  } catch { return ''; }
}

export function selectSourcePages(results: SourceSearchResult[]): string[] {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const item of results.slice(0, 30)) {
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2000) continue;
      url.hash = '';
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      const site = sourceSite(url.href);
      if (!groups.has(site)) groups.set(site, []);
      groups.get(site)!.push(url.href);
    } catch { /* Ignore malformed search results. The fetcher validates DNS and robots. */ }
  }
  const selected: string[] = [];
  for (let round = 0; round < 2 && selected.length < MAX_ROOTS; round++) {
    for (const group of groups.values()) {
      if (group[round]) selected.push(group[round]);
      if (selected.length === MAX_ROOTS) break;
    }
  }
  return selected;
}

function eventInArea(event: WebEvent, input: DiscoveryInput): boolean {
  if (input.lat != null && input.lng != null && event.lat != null && event.lng != null) {
    const rad = Math.PI / 180;
    const a = Math.sin((event.lat - input.lat) * rad / 2) ** 2 + Math.cos(input.lat * rad) * Math.cos(event.lat * rad)
      * Math.sin((event.lng - input.lng) * rad / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 40;
  }
  // Search relevance alone is insufficient evidence that a travelling show is in this city.
  const place = ` ${normalized(`${event.address ?? ''} ${event.venue}`)} `;
  const areaParts = input.areaLabel.split(',').map(normalized).filter(part => part.length >= 3);
  return areaParts.some(part => place.includes(` ${part} `));
}

export function selectDiscoveredEvents(events: WebEvent[], input: DiscoveryInput): WebEvent[] {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  const seen = new Set<string>();
  const perSite = new Map<string, number>();
  return events.filter(event => {
    if (!(Date.parse(event.startAt) < end && (event.endAt ? Date.parse(event.endAt) > start : Date.parse(event.startAt) >= start))
      || !eventInArea(event, input)) return false;
    const key = [normalized(event.title), event.startAt, normalized(event.venue)].join('|');
    const site = sourceSite(event.sourceUrl);
    if (seen.has(key) || (perSite.get(site) ?? 0) >= 4) return false;
    seen.add(key); perSite.set(site, (perSite.get(site) ?? 0) + 1);
    return true;
  }).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 20);
}

export function createCityEventDiscovery(options: {
  search?: WebSourceSearch; fetchPage?: PageFetcher; configured?: () => boolean; now?: () => number; budgetMs?: number; searchBudgetMs?: number;
} = {}) {
  const fetchPage = options.fetchPage ?? createPublicWebFetcher({ timeoutMs: 3000, maxBytes: 2 * 1024 * 1024 });
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; events: WebEvent[] }>();
  const pending = new Map<string, Promise<DiscoveryResult>>();

  async function load(input: DiscoveryInput, authorizeSearch: () => Promise<boolean>): Promise<DiscoveryResult> {
    const controller = new AbortController();
    const events: WebEvent[] = [];
    let timer: ReturnType<typeof setTimeout>;
    let searchSucceeded = false;
    const deadline = new Promise<DiscoveryResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ events: [...events], status: searchSucceeded ? 'ok' : 'unavailable' }); }, options.budgetMs ?? REQUEST_BUDGET_MS);
    });
    const work = (async (): Promise<DiscoveryResult> => {
      if (!await authorizeSearch() || controller.signal.aborted) return { events: [], status: 'unavailable' };
      const queries = buildDiscoveryQueries(input);
      const searchController = new AbortController();
      let searchTimer: ReturnType<typeof setTimeout>;
      const searchGroups: SourceSearchResult[][] = queries.map(() => []);
      const combinedResults = () => {
        const combined: SourceSearchResult[] = [];
        for (let rank = 0; rank < 12; rank++) {
          for (const group of searchGroups) if (group[rank]) combined.push(group[rank]);
        }
        return combined;
      };
      let finishSearch: (results: SourceSearchResult[]) => void = () => {};
      const abort = () => { searchController.abort(); finishSearch(combinedResults()); };
      const searchDeadline = new Promise<SourceSearchResult[]>(resolve => {
        finishSearch = resolve;
        searchTimer = setTimeout(abort, options.searchBudgetMs ?? 5500);
      });
      controller.signal.addEventListener('abort', abort, { once: true });
      let results: SourceSearchResult[];
      try {
        results = await Promise.race([Promise.all(queries.map(async (query, index) => {
          try {
            const found = await options.search!(query, input.language, searchController.signal);
            if (searchController.signal.aborted) return [];
            searchSucceeded = true; searchGroups[index] = found.slice(0, 12); return found;
          }
          catch { return []; }
        })).then(combinedResults), searchDeadline]);
      } finally { clearTimeout(searchTimer!); controller.signal.removeEventListener('abort', abort); }
      const queue = selectSourcePages(results).map(url => ({ url, depth: 0 }));
      const visited = new Set(queue.map(page => page.url));
      const processedPages = new Set<string>();
      const sitePages = new Map<string, number>();
      let next = 0;
      let fetched = 0;
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (!controller.signal.aborted && next < queue.length && fetched < MAX_PAGES) {
          const entry = queue[next++];
          const site = sourceSite(entry.url);
          if ((sitePages.get(site) ?? 0) >= 3) continue;
          sitePages.set(site, (sitePages.get(site) ?? 0) + 1); fetched++;
          try {
            const page = await fetchPage(entry.url, controller.signal);
            if (!page || controller.signal.aborted) continue;
            if (processedPages.has(page.url)) continue;
            const finalSite = sourceSite(page.url);
            if (finalSite !== site) {
              if ((sitePages.get(finalSite) ?? 0) >= 3) continue;
              sitePages.set(finalSite, (sitePages.get(finalSite) ?? 0) + 1);
            }
            processedPages.add(page.url); visited.add(page.url);
            events.push(...parseWebEvents(page.html, page.url));
            if (entry.depth === 0) {
              for (const url of extractEventPageLinks(page.html, page.url).slice(0, 2)) {
                if (!visited.has(url) && visited.size < MAX_PAGES + MAX_ROOTS) {
                  visited.add(url); queue.push({ url, depth: 1 });
                }
              }
            }
          } catch { /* An unavailable publisher does not erase other sources. */ }
        }
      }));
      return { events, status: searchSucceeded ? 'ok' : 'unavailable' };
    })().catch((): DiscoveryResult => ({ events, status: 'unavailable' }));
    try { return await Promise.race([work, deadline]); }
    finally { clearTimeout(timer!); controller.abort(); }
  }

  return async (data: unknown, authorizeSearch: () => Promise<boolean> = async () => true): Promise<DiscoveryResult> => {
    const input = validateDiscoveryInput(data);
    if (!options.search || options.configured?.() === false) return { events: [], status: 'not_configured' };
    if (!buildDiscoveryQueries(input).length) return { events: [], status: 'ok' };
    const key = JSON.stringify([normalized(input.areaLabel), input.timeZone, localDay(input.start, input.timeZone),
      localDay(new Date(Date.parse(input.end) - 1).toISOString(), input.timeZone), input.interests, input.language, input.discoveryMode]);
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return { events: selectDiscoveredEvents(cached.events, input), status: 'ok' };
    let running = pending.get(key);
    if (!running) {
      if (pending.size >= MAX_PENDING) return { events: [], status: 'unavailable' };
      running = load(input, authorizeSearch).then(result => {
        if (result.status === 'ok') {
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, { events: result.events, expires: now() + (result.events.length ? 15 * 60000 : 60000) });
        }
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, running);
    }
    const result = await running;
    return { events: selectDiscoveredEvents(result.events, input), status: result.status };
  };
}

export const WEB_SEARCH_API_KEY = defineSecret('WEB_SEARCH_API_KEY');
const discover = createCityEventDiscovery({ search: createBraveSourceSearch(() => WEB_SEARCH_API_KEY.value()),
  configured: () => Boolean(WEB_SEARCH_API_KEY.value()) });

export const discoverCityEvents = onCall({
  region: 'us-central1', invoker: 'public', timeoutSeconds: 25, maxInstances: 5, concurrency: 8,
  secrets: [WEB_SEARCH_API_KEY], enforceAppCheck: String(process.env.ENFORCE_APP_CHECK || 'false').toLowerCase() === 'true',
}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  return discover(request.data, () => reserveEventDiscovery(admin.firestore(), request.auth!.uid));
});
