import type { DeckSuggestion } from '../types';

type MapPayload = NonNullable<DeckSuggestion['mapDiscovery']>;

/** Replace the three represented activities with one slide; never duplicate them beside the map. */
export const groupMapActivities = (
  activities: DeckSuggestion[],
  options: MapPayload['activities'],
  origin: MapPayload['origin'],
): DeckSuggestion[] => {
  if (options.length !== 3 || new Set(options.map(option => option.suggestion.id)).size !== 3) return activities;
  const selectedIds = new Set(options.map(option => option.suggestion.id));
  if (options.some(option => !activities.some(activity => activity.id === option.suggestion.id))) return activities;
  const remaining = activities.filter(activity => !selectedIds.has(activity.id));
  const mapCard: DeckSuggestion = {
    id: `map_discovery_${options.map(option => option.suggestion.id).join('_')}`,
    type: 'GO_OUT',
    title: 'Nearby possibilities',
    description: 'Choose a pin to explore an activity.',
    durationMin: 0,
    confidence: 1,
    emojis: ['🗺️'],
    mapDiscovery: { activities: options, origin },
  };
  // One ordinary card introduces the set before the change of pace.
  remaining.splice(Math.min(1, remaining.length), 0, mapCard);
  return remaining;
};
