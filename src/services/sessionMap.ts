import type { MapActivityOption } from '../components/ActivityMap.types';
import type { DeckSuggestion, LocationProfile, LocationState } from '../types';
import { hasMapCoordinates, hasProviderDestination, toMapActivityOption } from './mapDiscovery';
import { getSuggestionIdentityKeys } from './suggestionIdentity';

export type SessionMapEntry = {
  suggestion: DeckSuggestion;
  saved: boolean;
  addedAt: number;
  unread: boolean;
};

export type SessionMapSnapshot = {
  entries: SessionMapEntry[];
  unreadCount: number;
};

type StoredEntry = { entry: SessionMapEntry; aliases: Set<string> };

// Suggestion data is plain data. Copy nested presentation fields so callers cannot
// change collection state by editing either the supplied card or a snapshot.
const copySuggestion = (suggestion: DeckSuggestion): DeckSuggestion => ({
  ...suggestion,
  ...(suggestion.place ? { place: { ...suggestion.place } } : {}),
  ...(suggestion.event ? { event: { ...suggestion.event } } : {}),
  ...(suggestion.meta ? { meta: { ...suggestion.meta } } : {}),
  ...(suggestion.steps ? { steps: suggestion.steps.map(step => ({ ...step })) } : {}),
  ...(suggestion.equipment ? { equipment: [...suggestion.equipment] } : {}),
  ...(suggestion.tags ? { tags: [...suggestion.tags] } : {}),
  ...(suggestion.emojis ? { emojis: [...suggestion.emojis] } : {}),
  ...(suggestion.moodFit ? { moodFit: [...suggestion.moodFit] } : {}),
  ...(suggestion.instructions ? { instructions: [...suggestion.instructions] } : {}),
  ...(suggestion.adKeywords ? { adKeywords: [...suggestion.adKeywords] } : {}),
});

const eligibleKeys = (suggestion: DeckSuggestion): string[] => (
  suggestion.source === 'ad' || suggestion.mapDiscovery
    ? [] : getSuggestionIdentityKeys(suggestion)
);

/**
 * The caller owns the swiping-session boundary. New decks, map dismissal and
 * temporary navigation do not clear this collection; only reset() does.
 */
export const createSessionMapCollection = () => {
  let stored: StoredEntry[] = [];
  const snapshot = (): SessionMapSnapshot => ({
    entries: stored.map(({ entry }) => ({ ...entry, suggestion: copySuggestion(entry.suggestion) })),
    unreadCount: stored.reduce((count, { entry }) => count + Number(entry.unread), 0),
  });

  const add = (
    suggestions: readonly DeckSuggestion[],
    options: { saved?: boolean } = {},
  ): SessionMapSnapshot => {
    for (const suggestion of suggestions) {
      const keys = eligibleKeys(suggestion);
      if (!keys.length) continue;
      const matches = stored.filter(record => keys.some(key => record.aliases.has(key)));
      if (!matches.length) {
        stored.push({
          entry: { suggestion: copySuggestion(suggestion), saved: !!options.saved, addedAt: Date.now(), unread: true },
          aliases: new Set(keys),
        });
        continue;
      }

      // Keep every identity alias even when the same idea gets a fresh provider
      // ID. A later save/remove can therefore still find the original entry.
      const first = matches[0];
      keys.forEach(key => first.aliases.add(key));
      // A later provider lookup can fill a card's missing/unverified destination
      // without adding a second entry or changing its saved/read state and ID.
      if (hasProviderDestination(suggestion) && hasMapCoordinates(suggestion.place?.lat, suggestion.place?.lng)
        && (!hasProviderDestination(first.entry.suggestion)
          || !hasMapCoordinates(first.entry.suggestion.place?.lat, first.entry.suggestion.place?.lng))) {
        first.entry.suggestion = { ...first.entry.suggestion, place: { ...suggestion.place! } };
        // Provider-based legacy cards encode provenance in their ID. Preserve
        // that information when enriching the original generated activity.
        first.entry.suggestion.place!.coordinateSource ??= 'geocoded';
      }
      first.entry.saved = first.entry.saved || !!options.saved;
      for (const duplicate of matches.slice(1)) {
        duplicate.aliases.forEach(key => first.aliases.add(key));
        first.entry.saved = first.entry.saved || duplicate.entry.saved;
        first.entry.unread = first.entry.unread || duplicate.entry.unread;
      }
      if (matches.length > 1) {
        const duplicates = new Set(matches.slice(1));
        stored = stored.filter(record => !duplicates.has(record));
      }
    }
    return snapshot();
  };

  return {
    snapshot,
    add,
    markRead(): SessionMapSnapshot {
      stored.forEach(({ entry }) => { entry.unread = false; });
      return snapshot();
    },
    setSaved(suggestion: DeckSuggestion): SessionMapSnapshot {
      return add([suggestion], { saved: true });
    },
    remove(suggestion: DeckSuggestion): SessionMapSnapshot {
      const keys = eligibleKeys(suggestion);
      stored = stored.filter(record => !keys.some(key => record.aliases.has(key)));
      return snapshot();
    },
    reset(): SessionMapSnapshot {
      stored = [];
      return snapshot();
    },
  };
};

/** Every reliable session destination gets a pin; other entries remain in the list. */
export const getSessionMapOptions = (
  entries: readonly SessionMapEntry[],
  location: LocationState | null | undefined,
  locationProfile?: LocationProfile | null,
): MapActivityOption[] => {
  const seen = new Set<string>();
  const options: MapActivityOption[] = [];
  for (const { suggestion } of entries) {
    const keys = eligibleKeys(suggestion);
    if (!keys.length || keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    const option = toMapActivityOption(suggestion, location, locationProfile);
    if (option) options.push(option);
  }
  return options;
};
