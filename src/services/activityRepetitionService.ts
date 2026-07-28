import { HistoryState, Suggestion, HabitFrequency } from '../types';
import { addDebugMessage } from './debug';

const normalizePromptKey = (value?: string): string => (value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ');

/**
 * Activity Repetition Service
 *
 * Enables activities to be shown multiple times (at strategic intervals)
 * to support habit formation. This is the KEY DIFFERENCE from the old system
 * which tried to avoid all repeats.
 *
 * Philosophy:
 * - Normal activities: hide repeats within 7–14 days to maximize variety
 * - Habit-friendly activities (tagged): show again if >3 days + right time context
 * - Time-of-day sensitive (e.g., morning walk): stack them during optimal hours
 */

/**
 * Should this activity be eligible for repeat showing?
 *
 * Returns true if:
 * - It's tagged as repetition-friendly, AND
 * - Enough time has passed since last shown
 */
export function isEligibleForRepetition(
  activityId: string,
  lastShownDates: Record<string, string> | undefined,
  now = new Date()
): boolean {
  if (!lastShownDates?.[activityId]) {
    // Never shown before = always eligible
    return true;
  }

  const lastShown = new Date(lastShownDates[activityId]);
  const hoursSinceShown = (now.getTime() - lastShown.getTime()) / (1000 * 60 * 60);

  // Habit-forming activities: show again after 72 hours (3 days)
  // This allows them to build frequency without feeling overwhelming
  return hoursSinceShown >= 72;
}

/**
 * Check if activity should be filtered based on repetition rules.
 *
 * Normal flow:
 * 1. buildDeck fetches candidates
 * 2. Filters out seen IDs (lastShownIds, lastRejectedIds, lastAcceptedIds)
 * 3. NOW: Also filters using isHabitRepeatEligible
 *
 * This allows returning suggested activities to reappear strategically.
 */
export function shouldFilterOutForRepetition(
  activityId: string,
  isRepetitionFriendly: boolean | undefined,
  source: Suggestion['source'] | undefined,
  history: HistoryState,
  now = new Date()
): boolean {
  // Gemini output is often cached for short windows to avoid duplicate API calls.
  // If we hard-block by lastShownIds here, rapid "new set" actions can wipe
  // valid Gemini cards and force fallback-heavy decks.
  if (source === 'gemini') {
    return false;
  }

  // If never marked as repetition-friendly, use old logic:
  // filter if it's been shown before (within current session)
  if (!isRepetitionFriendly) {
    return history.lastShownIds?.includes(activityId) ?? false;
  }

  // For repetition-friendly activities (habits):
  // Allow re-showing if enough time has passed
  return !isEligibleForRepetition(activityId, history.lastShownDates, now);
}

/**
 * Record that an activity was shown.
 * Used to track last-shown date for repetition eligibility.
 */
export function recordActivityShown(
  activityId: string,
  history: HistoryState,
  now = new Date()
): HistoryState {
  return {
    ...history,
    lastShownDates: {
      ...(history.lastShownDates ?? {}),
      [activityId]: now.toISOString(),
    },
  };
}

/**
 * Record that an activity was completed by the user.
 * Tracks completion count for habit conversion detection.
 */
export function recordActivityCompleted(
  activityId: string,
  history: HistoryState
): HistoryState {
  const current = history.completedActivityIds?.[activityId] ?? 0;
  return {
    ...history,
    completedActivityIds: {
      ...(history.completedActivityIds ?? {}),
      [activityId]: current + 1,
    },
  };
}

/**
 * Check if an activity has been completed enough times to suggest habit conversion.
 * Threshold: 3+ times (different dates are ideal, but we track count here)
 */
export function shouldSuggestHabitConversion(
  activityId: string,
  completedCount: number | undefined,
  minCompletions = 3
): boolean {
  return (completedCount ?? 0) >= minCompletions;
}

export function getHabitPromptKey(activityId?: string, title?: string): string {
  if (activityId?.trim()) return activityId.trim();
  return normalizePromptKey(title);
}

export function shouldShowHabitConversionPrompt(
  history: HistoryState,
  promptKey: string,
  now = new Date(),
  cooldownDays = 7,
): boolean {
  if (!promptKey) return false;
  const promptedAt = history.habitPromptedAtByActivityId?.[promptKey];
  if (!promptedAt) return true;
  const last = new Date(promptedAt).getTime();
  if (!Number.isFinite(last)) return true;
  const elapsedDays = (now.getTime() - last) / (1000 * 60 * 60 * 24);
  return elapsedDays >= cooldownDays;
}

export function markHabitConversionPromptShown(
  history: HistoryState,
  promptKey: string,
  now = new Date(),
): HistoryState {
  if (!promptKey) return history;
  return {
    ...history,
    habitPromptedAtByActivityId: {
      ...(history.habitPromptedAtByActivityId ?? {}),
      [promptKey]: now.toISOString(),
    },
  };
}

/**
 * Filter deck candidates using repetition logic.
 *
 * Before: seenIds = lastShownIds.filter() → hardwaits all repeats
 * After: seenIds = only items never shown + repetition-eligible items
 */
export function filterForHabitRepetition(
  candidates: Suggestion[],
  history: HistoryState,
  now = new Date()
): Suggestion[] {
  return candidates.filter((item) => {
    // Always show new items
    if (!history.lastShownIds?.includes(item.id)) {
      return true;
    }

    // Previously shown items: only show if repetition-eligible
    return shouldFilterOutForRepetition(item.id, item.isRepetitionFriendly, item.source, history, now) === false;
  });
}

/**
 * Mark activities that should be repetition-friendly based on their tags/type.
 * This is called during suggestion generation to tag activities for habit learning.
 */
export function markRepetitionFriendly(suggestion: Suggestion): Suggestion {
  // Activities suitable for repetition:
  // - Habit-source activities (already recurring)
  // - AT_HOME activities (always doable)
  // - Activities with habit-relevant tags (fitness, wellness, learning, meditation)
  const habitTags = new Set([
    'fitness',
    'wellness',
    'meditation',
    'learning',
    'creative',
    'nature',
    'coffee',
    'morning_routine',
    'evening_routine',
  ]);

  const isHabitSource = suggestion.source === 'habit';
  const isAtHome = suggestion.type === 'AT_HOME';
  const hasHabitTag = (suggestion.tags ?? []).some((t) => habitTags.has(t));

  const shouldBeRepetitionFriendly = isHabitSource || isAtHome || hasHabitTag;

  return {
    ...suggestion,
    isRepetitionFriendly: shouldBeRepetitionFriendly,
  };
}

/**
 * Debug: log repetition eligibility for a suggestion
 */
export function debugRepetitionStatus(
  suggestion: Suggestion,
  history: HistoryState,
  now = new Date()
): void {
  const lastShown = history.lastShownDates?.[suggestion.id];
  const eligible = isEligibleForRepetition(suggestion.id, history.lastShownDates, now);
  const shouldFilter = shouldFilterOutForRepetition(
    suggestion.id,
    suggestion.isRepetitionFriendly,
    suggestion.source,
    history,
    now
  );

  addDebugMessage(
    'repetition',
    `${suggestion.title}: friendly=${suggestion.isRepetitionFriendly}, lastShown=${lastShown}, eligible=${eligible}, filter=${shouldFilter}`
  );
}
