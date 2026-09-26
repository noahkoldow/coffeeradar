import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { IncomingHttpHeaders } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { URL } from 'node:url';

export type PublicWebPage = { url: string; html: string };
type ResolvedAddress = { address: string; family: number };
export type PublicWebFetchOptions = {
  /** One deadline covers DNS, robots.txt, redirects and the document body. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: typeof httpsRequest;
};

const USER_AGENT = 'BitsActivityDiscovery';
const deniedV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) deniedV4.addSubnet(address, prefix, 'ipv4');
deniedV4.addAddress('168.63.129.16', 'ipv4'); // Azure's virtual platform endpoint.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) deniedV6.addSubnet(address, prefix, 'ipv6');

function publicAddress(value: ResolvedAddress): boolean {
  const family = isIP(value.address);
  if (family !== value.family) return false;
  if (family === 4) return !deniedV4.check(value.address, 'ipv4');
  // Global unicast only; this also excludes IPv4-mapped/compatible IPv6,
  // NAT64, unique-local, loopback, link-local and multicast addresses.
  return family === 6 && globalV6.check(value.address, 'ipv6') && !deniedV6.check(value.address, 'ipv6');
}

function publicUrl(raw: string): URL | null {
  if (raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.')
      || /(?:^|\.)(?:localhost|local|internal|home|lan|onion)$/.test(host)) return null;
    url.hostname = host;
    url.hash = '';
    return url;
  } catch { return null; }
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
}

function withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Public page request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

type WireResponse = { status: number; headers: IncomingHttpHeaders; body: string };
type RobotsRule = { allow: boolean; pattern: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[]; delay: number };

function normalizedRobotsPath(value: string): string {
  // Compare percent-encoded UTF-8 and reserved bytes consistently, while RFC
  // 9309 requires decoding percent-encoded unreserved ASCII before matching.
  return encodeURI(value).replace(/%25([\da-f]{2})/gi, '%$1').replace(/%([\da-f]{2})/gi, (_, hex: string) => {
    const character = String.fromCharCode(parseInt(hex, 16));
    return /^[a-z\d._~-]$/i.test(character) ? character : `%${hex.toUpperCase()}`;
  });
}

/** Match robots wildcards without compiling publisher input into a regexp. */
function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const chunks = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  if (!path.startsWith(chunks[0])) return false;
  let offset = chunks[0].length;
  for (let index = 1; index < chunks.length; index++) {
    const chunk = chunks[index];
    if (anchored && index === chunks.length - 1) {
      return path.endsWith(chunk) && path.length - chunk.length >= offset;
    }
    const next = path.indexOf(chunk, offset);
    if (next < 0) return false;
    offset = next + chunk.length;
  }
  return !anchored || offset === path.length;
}

function parseRobots(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let group: RobotsGroup | undefined;
  let directivesStarted = false;
  for (const line of body.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const clean = line.split('#', 1)[0].trim();
    const separator = clean.indexOf(':');
    if (separator < 0) continue;
    const key = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!group || directivesStarted) {
        group = { agents: [], rules: [], delay: 0 };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      directivesStarted = false;
    } else if (group && (key === 'allow' || key === 'disallow')) {
      directivesStarted = true;
      if (value) group.rules.push({ allow: key === 'allow', pattern: normalizedRobotsPath(value) });
    } else if (group && key === 'crawl-delay') {
      directivesStarted = true;
      const delay = Number(value);
      if (Number.isFinite(delay) && delay > 0) group.delay = Math.max(group.delay, delay);
    }
  }
  return groups;
}

function robotsAllows(groups: RobotsGroup[], url: URL): boolean {
  const bot = USER_AGENT.toLowerCase();
  const specific = groups.filter(group => group.agents.some(agent => agent !== '*' && agent && bot.includes(agent)));
  const selected = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  // Crawl-delay is outside RFC 9309; conservatively skip sites requesting one
  // instead of issuing parallel, on-demand requests that cannot honour it.
  if (selected.some(group => group.delay > 0)) return false;
  const path = normalizedRobotsPath(url.pathname + url.search);
  let longest = -1;
  let allowed = true;
  for (const group of selected) for (const rule of group.rules) {
    if (!robotsMatch(rule.pattern, path)) continue;
    const specificity = Buffer.byteLength(rule.pattern.replace(/\*/g, '').replace(/\$$/, ''));
    if (specificity > longest || (specificity === longest && rule.allow)) {
      longest = specificity;
      allowed = rule.allow;
    }
  }
  return allowed;
}

/** Fetch a public, crawlable HTML page; failures are simply unavailable sources. */
export function createPublicWebFetcher(options: PublicWebFetchOptions = {}) {
  const timeoutMs = boundedInteger(options.timeoutMs, 7000, 15000);
  const maxBytes = boundedInteger(options.maxBytes, 750_000, 2_000_000);
  const maxRedirects = Math.min(5, Math.max(0, Math.floor(options.maxRedirects ?? 3)));
  const resolve = options.resolve ?? (hostname => lookup(hostname, { all: true, verbatim: true }));
  const request = options.request ?? httpsRequest;

  return async function fetchPage(raw: string, externalSignal?: AbortSignal): Promise<PublicWebPage | null> {
    const initialUrl = publicUrl(raw);
    if (!initialUrl || externalSignal?.aborted) return null;
    let pageUrl: URL = initialUrl;
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    // Per operation only: no stale permissions or shared promises tied to
    // another caller's cancellation signal.
    const robotsByOrigin = new Map<string, RobotsGroup[] | null>();

    async function get(url: URL, robots: boolean): Promise<WireResponse> {
      if (signal.aborted) throw new Error('Public page request aborted');
      const addresses = await withAbort(resolve(url.hostname), signal);
      // Reject the whole answer set, not just the selected record: a hostname
      // resolving to both public and internal addresses is never eligible.
      if (!addresses.length || addresses.length > 32 || !addresses.every(publicAddress)) throw new Error('Non-public DNS');
      const pinned = addresses[0];
      if (signal.aborted) throw new Error('Public page request aborted');
      return withAbort(new Promise<WireResponse>((resolveResponse, reject) => {
        let settled = false;
        const req = request(url, {
          method: 'GET', agent: false, signal, family: pinned.family,
          servername: url.hostname, rejectUnauthorized: true, maxHeaderSize: 16_384,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: robots ? 'text/plain' : 'text/html,application/xhtml+xml',
            'Accept-Encoding': 'identity',
          },
          // Socket resolution must use the exact validated address. Keeping
          // the original hostname preserves TLS identity verification and SNI.
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
            else callback(null, pinned.address, pinned.family);
          },
        }, response => {
          const finish = (body: string) => {
            if (settled) return;
            settled = true;
            resolveResponse({ status: response.statusCode ?? 0, headers: response.headers, body });
          };
          const fail = (message: string) => {
            if (settled) return;
            settled = true;
            reject(new Error(message));
            response.destroy();
            req.destroy();
          };
          response.on('error', () => fail('Public page response error'));
          response.on('aborted', () => fail('Public page response aborted'));
          const status = response.statusCode ?? 0;
          if (status !== 200) { finish(''); response.destroy(); return; }
          const mime = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
          if (robots ? mime !== 'text/plain' : !['text/html', 'application/xhtml+xml'].includes(mime)) {
            fail('Unexpected public page content type'); return;
          }
          const encoding = response.headers['content-encoding'];
          if (encoding && encoding !== 'identity') { fail('Unexpected public page encoding'); return; }
          const limit = robots ? 512_000 : maxBytes;
          const advertisedSize = Number(response.headers['content-length']);
          if (Number.isFinite(advertisedSize) && advertisedSize > limit) { fail('Public page too large'); return; }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > limit) { fail('Public page too large'); return; }
            chunks.push(buffer);
          });
          response.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.end();
      }), signal);
    }

    async function permission(url: URL): Promise<boolean> {
      if (!robotsByOrigin.has(url.origin)) {
        let robotsUrl = new URL('/robots.txt', url.origin);
        let rules: RobotsGroup[] | null = null;
        for (let redirect = 0; redirect <= maxRedirects; redirect++) {
          const response = await get(robotsUrl, true);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const target = response.headers.location && publicUrl(new URL(response.headers.location, robotsUrl).href);
            if (!target || redirect === maxRedirects) break;
            robotsUrl = target;
            continue;
          }
          if (response.status === 404 || response.status === 410) rules = [];
          else if (response.status === 200) rules = parseRobots(response.body);
          // Auth, rate limits, challenges, server errors and unavailable robots
          // all fail closed; there is no fallback browser or identity spoofing.
          break;
        }
        robotsByOrigin.set(url.origin, rules);
      }
      const rules = robotsByOrigin.get(url.origin);
      return rules != null && robotsAllows(rules, url);
    }

    try {
      for (let redirect = 0; redirect <= maxRedirects; redirect++) {
        if (!await permission(pageUrl)) return null;
        const response = await get(pageUrl, false);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const target = response.headers.location && publicUrl(new URL(response.headers.location, pageUrl).href);
          if (!target || redirect === maxRedirects) return null;
          pageUrl = target;
          continue;
        }
        if (response.status !== 200) return null;
        // Do not pass access-challenge pages on as event evidence.
        if (/<title[^>]*>\s*(?:just a moment|access denied|verify (?:you are|you're) human|attention required)/i.test(response.body)) return null;
        return { url: pageUrl.href, html: response.body };
      }
      return null;
    } catch { return null; }
    finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
      controller.abort();
    }
  };
}
