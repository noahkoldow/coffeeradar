import type { Suggestion } from '../types';

/** Ignore presentation differences, while retaining words that distinguish activities/venues. */
const normalizeText = (value?: string): string => (value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/ß/g, 'ss')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const normalizeTitle = (value?: string): string => normalizeText((value ?? '')
  .replace(/^\s*\d+[.)]\s+/, '')
  // A changed duration does not make the same activity a new suggestion.
  .replace(/\b(?:(?:for|fur|für|fuer)\s+)?\d+(?:[.,]\d+)?\s*[-–—]?\s*(?:minutes?|mins?|minuten|hours?|stunden?|std)\b\s*[-–—]?/gi, ' '));

/** A generated ID is only one alias; content identifies regenerated copies of the same activity. */
export const getSuggestionIdentityKeys = (suggestion: Suggestion): string[] => {
  if (suggestion.source === 'ad') return [];
  const keys: string[] = [];
  if (suggestion.id?.trim()) keys.push(`id:${suggestion.id.trim()}`);
  if (suggestion.habitId?.trim()) keys.push(`habit:${suggestion.habitId.trim()}`);
  const title = normalizeTitle(suggestion.title) || normalizeText(suggestion.description);
  if (!title) return keys;

  const placeName = normalizeText(suggestion.place?.name || suggestion.event?.venue);
  const address = normalizeText(suggestion.place?.address);
  const latitude = suggestion.place?.lat;
  const longitude = suggestion.place?.lng;
  const coordinates = typeof latitude === 'number' && Number.isFinite(latitude)
    && typeof longitude === 'number' && Number.isFinite(longitude)
    ? `${latitude.toFixed(4)},${longitude.toFixed(4)}` : '';
  // Distinct venues and event occurrences remain distinct activities. Do not
  // collapse two generic "Coffee break" cards at different physical places.
  const place = [placeName, address].filter(Boolean).join('|') || coordinates;
  const start = suggestion.event?.startAt;
  const parsedStart = start ? Date.parse(start) : NaN;
  const occurrence = start ? (Number.isFinite(parsedStart) ? new Date(parsedStart).toISOString() : normalizeText(start)) : '';
  keys.push(`activity:${title}|place:${place}|event:${occurrence}`);
  // Coordinates also match a venue whose address formatting changed, without
  // conflating separately named venues in the same building.
  if (coordinates && placeName) keys.push(`activity:${title}|venue:${placeName}|geo:${coordinates}|event:${occurrence}`);
  return keys;
};

/** Filter both earlier reservations and duplicates within this batch; never mutate the snapshot. */
export const filterUnseenSuggestions = <T extends Suggestion>(
  candidates: readonly T[], exclusions: ReadonlySet<string> = new Set<string>(),
): T[] => {
  const seen = new Set(exclusions);
  return candidates.filter(candidate => {
    const keys = getSuggestionIdentityKeys(candidate);
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
};

/** Bounded prompt context; the full identity ledger still enforces every exclusion. */
export const getExcludedActivityTitles = (exclusions: ReadonlySet<string>): string[] => {
  const titles = new Set<string>();
  for (const key of exclusions) {
    const match = /^activity:(.+?)\|(?:place|venue):/.exec(key);
    const title = match?.[1].slice(0, 100).trim();
    if (!title) continue;
    // A title can have multiple venue/coordinate aliases. Keep its latest position.
    titles.delete(title);
    titles.add(title);
  }
  return [...titles].slice(-40);
};

/** Kept in AppState's ref: screen remounts and new sets do not reset the app-session ledger. */
export const createSessionSuggestionLedger = (initialOwner: string | null = null) => {
  let owner = initialOwner;
  const seen = new Set<string>();
  return {
    isForUser: (userId: string | null) => owner === userId,
    resetForUser(userId: string | null): boolean {
      if (owner === userId) return false;
      owner = userId;
      seen.clear();
      return true;
    },
    snapshot: (): ReadonlySet<string> => new Set(seen),
    filter: <T extends Suggestion>(candidates: readonly T[]): T[] => filterUnseenSuggestions(candidates, seen),
    reserve<T extends Suggestion>(candidates: readonly T[]): T[] {
      // Filtering and recording contain no await/state update, so two consumers
      // cannot both reserve the same activity before a React render occurs.
      const fresh = filterUnseenSuggestions(candidates, seen);
      fresh.forEach(candidate => getSuggestionIdentityKeys(candidate).forEach(key => seen.add(key)));
      return fresh;
    },
  };
};
