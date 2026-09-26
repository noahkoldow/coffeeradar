export type SourceSearchResult = { url: string; title: string };
export type WebSourceSearch = (query: string, language: 'de' | 'en', signal: AbortSignal) => Promise<SourceSearchResult[]>;

/** Search supplies candidate URLs only. Event facts must come from the fetched publisher page. */
export function createBraveSourceSearch(apiKey: () => string, transport: typeof fetch = fetch): WebSourceSearch {
  return async (query, language, signal) => {
    const key = apiKey().trim();
    if (!key) throw new Error('Web search is not configured.');
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query.slice(0, 400));
    url.searchParams.set('count', '12');
    url.searchParams.set('search_lang', language);
    url.searchParams.set('safesearch', 'moderate');
    // No fixed country: the requested city supplies geographic context.
    const response = await transport(url.href, { signal, redirect: 'error',
      headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Web search is temporarily unavailable.');
    }
    const reader = response.body?.getReader();
    if (!reader) return [];
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512 * 1024) { await reader.cancel(); throw new Error('Search response too large.'); }
      chunks.push(chunk.value);
    }
    let data: any;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Web search returned an invalid response.'); }
    if (!Array.isArray(data.web?.results)) return [];
    return data.web.results.slice(0, 12).flatMap((item: any) => {
      if (typeof item?.url !== 'string' || item.url.length > 2000) return [];
      try {
        const result = new URL(item.url);
        if (result.protocol !== 'https:' || result.username || result.password || result.port) return [];
        result.hash = '';
        return [{ url: result.href, title: typeof item.title === 'string' ? item.title.slice(0, 180) : '' }];
      } catch { return []; }
    });
  };
}
