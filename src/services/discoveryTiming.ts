import type { Availability, DeckSuggestion, UserPrefs } from '../types';

export const discoveryReferenceTime = (availability: Availability, now = new Date()): Date => {
  const start = Date.parse(availability.start);
  return new Date(Number.isFinite(start) ? Math.max(start, now.getTime()) : now.getTime());
};

export const isPlanningAhead = (availability: Availability, now = new Date()): boolean =>
  availability.discoveryMode === 'plan_ahead'
  || (availability.discoveryMode !== 'now' && Date.parse(availability.start) > now.getTime() + 6 * 60 * 60000);

/** Only event discovery expands to city scale; ordinary venue searches keep the chosen radius. */
export const eventSearchRadiusKm = (prefs: UserPrefs, availability: Availability): number => {
  const localRadius = Math.max(1, Math.min(prefs.radiusKm || 5, 50));
  if (!isPlanningAhead(availability)) return localRadius;
  const travelBudgetMin = Math.min(60, Math.max(0, (availability.durationMin - 45 - 10) / 2));
  const reachableKm = Math.max(1, (travelBudgetMin - 11) * 25 / 60);
  return Math.min(35, Math.max(localRadius, reachableKm));
};

/** A fixed show cannot move; an explicitly drop-in event can be visited during its published hours. */
export const eventVisitWindow = (
  suggestion: DeckSuggestion,
  availability: Availability,
  now = new Date(),
  preferredStart?: Date,
): { start: Date; end: Date; departure: Date } | null => {
  const event = suggestion.event;
  if (!event || suggestion.type !== 'EVENT') return null;
  const eventStart = Date.parse(event.startAt);
  const windowEnd = Date.parse(availability.end);
  const durationMs = suggestion.durationMin * 60000;
  // Missing coordinates do not imply instant travel to a physical event.
  const returnTravelMs = (suggestion.meta?.etaMin ?? 25) * 60000;
  const travelMs = returnTravelMs + 10 * 60000;
  const earliest = discoveryReferenceTime(availability, now).getTime() + travelMs;
  if (!Number.isFinite(eventStart) || !Number.isFinite(windowEnd) || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const requestedStart = preferredStart?.getTime() ?? earliest;
  if (event.attendanceMode === 'drop_in' && !Number.isFinite(requestedStart)) return null;
  const start = event.attendanceMode === 'drop_in' ? Math.max(eventStart, earliest, requestedStart) : eventStart;
  if (start < earliest) return null;
  const publishedEnd = event.endAt ? Date.parse(event.endAt) : NaN;
  const end = event.attendanceMode === 'drop_in' ? start + durationMs
    : Number.isFinite(publishedEnd) ? publishedEnd : start + durationMs;
  if (end <= start || end + returnTravelMs > windowEnd || (Number.isFinite(publishedEnd) && end > publishedEnd)) return null;
  // A drop-in interval needs a verified end time; otherwise it is treated as a fixed appointment.
  if (event.attendanceMode === 'drop_in' && !Number.isFinite(publishedEnd)) return null;
  return { start: new Date(start), end: new Date(end), departure: new Date(start - travelMs) };
};
