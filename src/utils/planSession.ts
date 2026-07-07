import { Commitment, DeckSuggestion } from '../types';

/**
 * Build a deterministic key so Home/Plan can identify the exact same planned activity session.
 */
export const buildPlanSessionKey = (commitment: Commitment, suggestion: DeckSuggestion): string => {
  return [
    suggestion.id,
    commitment.type,
    commitment.startAt,
    commitment.endAt,
    commitment.calendarEventId ?? 'no_calendar',
  ].join('|');
};
