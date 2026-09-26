import { httpsCallable } from 'firebase/functions';
import { ensureAuth, functions } from './firebase';
import { Availability, LocationState, Suggestion, UserPrefs } from '../types';
import { addDebugMessage } from './debug';

type CityEvent = {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt?: string;
  venue: string;
  address?: string;
  lat?: number;
  lng?: number;
  sourceUrl: string;
  sourceName: string;
  priceHint?: string;
  attendanceMode?: 'fixed' | 'drop_in';
};

const text = (value: unknown, max = 240): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
// Settings also adds free-text interests to interestTags. Only the public search
// categories below leave the app; profile text and calendar titles never do.
const DISCOVERY_INTERESTS = new Set([
  'fitness', 'cycling', 'running', 'swimming', 'hiking', 'wellness', 'nature', 'beaches',
  'parks', 'explore', 'coffee', 'food', 'street_food', 'art', 'music', 'movies', 'learning', 'focus', 'social',
]);

const publicSourceUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string' || value.length > 1500 || /[\s\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!host.includes('.') || /[\[\]:]/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host)) return null;
    // The server additionally checks DNS, redirects and page-level event evidence.
    return url;
  } catch { return null; }
};

const eventTags = (title: string): string[] => {
  const tags = ['event', 'explore'];
  if (/konzert|concert|musik|music|jazz|band/i.test(title)) tags.push('music');
  if (/workshop|kurs|class|lernen|führung|tour/i.test(title)) tags.push('learning');
  if (/kunst|art\b|museum|ausstellung|exhibit|theater|theatre/i.test(title)) tags.push('art');
  if (/sport|lauf|run\b|marathon|yoga|dance|tanz/i.test(title)) tags.push('fitness');
  if (/treff|meet|comedy|markt|market|fest/i.test(title)) tags.push('social');
  return tags;
};

export const toCityEventSuggestion = (raw: CityEvent, language: UserPrefs['language']): Suggestion | null => {
  const title = text(raw?.title, 160);
  const venue = text(raw?.venue);
  const start = Date.parse(raw?.startAt);
  const end = raw?.endAt ? Date.parse(raw.endAt) : NaN;
  const source = publicSourceUrl(raw?.sourceUrl);
  if (!title || !venue || !text(raw?.id) || !Number.isFinite(start)) return null;
  if (!source) return null;
  const sourceUrl = source.href;
  const sourceName = text(raw.sourceName, 80) || source.hostname.replace(/^www\./, '');
  if (raw.endAt && (!Number.isFinite(end) || end <= start)) return null;
  const knownDuration = Number.isFinite(end) ? Math.ceil((end - start) / 60000) : undefined;
  const dropIn = raw.attendanceMode === 'drop_in' && knownDuration != null;
  const durationMin = dropIn ? Math.min(60, knownDuration!) : (knownDuration ?? 120);
  if (durationMin > 24 * 60) return null;
  const coordinates = typeof raw.lat === 'number' && Number.isFinite(raw.lat) && Math.abs(raw.lat) <= 90
    && typeof raw.lng === 'number' && Number.isFinite(raw.lng) && Math.abs(raw.lng) <= 180
    && !(raw.lat === 0 && raw.lng === 0);
  return {
    id: text(raw.id), source: 'web', type: 'EVENT', title,
    description: language === 'de'
      ? `${title} bei ${venue}. Schau dir die Veranstaltungsdetails an und plane deinen Besuch.`
      : `${title} at ${venue}. Check the event details and plan your visit.`,
    durationMin, tags: eventTags(title), confidence: 0.85, isRepetitionFriendly: false,
    openStatus: 'unknown',
    place: { name: venue, address: text(raw.address) || undefined, costHint: text(raw.priceHint) || undefined,
      ...(coordinates ? { lat: raw.lat, lng: raw.lng, coordinateSource: 'source' as const } : {}) },
    event: { startAt: new Date(start).toISOString(),
      ...(Number.isFinite(end) ? { endAt: new Date(end).toISOString() } : {}),
      venue, ticketUrl: '', sourceUrl, sourceName, attendanceMode: dropIn ? 'drop_in' : 'fixed',
      priceRange: text(raw.priceHint) || undefined },
  };
};

/** The server discovers dated public pages using only bounded, public search context. */
export const fetchCityEventSuggestions = async (
  location: LocationState, prefs: UserPrefs, availability: Availability,
): Promise<Suggestion[]> => {
  if (!prefs.openToGoingOut || (!location.areaLabel && location.lat == null)) return [];
  try {
    await ensureAuth();
    const discover = httpsCallable<{
      areaLabel: string; lat?: number; lng?: number; start: string; end: string;
      interests: string[]; language?: 'de' | 'en'; timeZone?: string; discoveryMode?: 'now' | 'plan_ahead';
    }, { events: CityEvent[]; status?: 'ok' | 'unavailable' | 'not_configured' }>(functions, 'discoverCityEvents', { timeout: 20000 });
    const result = await discover({
      areaLabel: location.areaLabel ?? '', start: availability.start, end: availability.end,
      interests: [...new Set((prefs.interestTags ?? []).filter(tag => DISCOVERY_INTERESTS.has(tag)))].slice(0, 8),
      ...(prefs.language === 'de' || prefs.language === 'en' ? { language: prefs.language } : {}),
      ...(location.timeZone ? { timeZone: location.timeZone.slice(0, 100) } : {}),
      ...(availability.discoveryMode ? { discoveryMode: availability.discoveryMode } : {}),
      ...(location.lat != null && location.lng != null ? { lat: location.lat, lng: location.lng } : {}),
    });
    if (result.data?.status === 'not_configured' || result.data?.status === 'unavailable') {
      addDebugMessage('events', `City event discovery ${result.data.status}; continuing with other activity sources.`);
    }
    if (!Array.isArray(result.data?.events)) return [];
    return result.data.events.slice(0, 20).map(event => toCityEventSuggestion(event, prefs.language))
      .filter((item): item is Suggestion => item !== null);
  } catch {
    addDebugMessage('events', 'City event source unavailable; continuing with other activity sources.');
    return [];
  }
};
