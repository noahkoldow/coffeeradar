/**
 * Tag affinity engine — learns user taste from swipe behaviour.
 *
 * Signals:
 *   accept (swipe right)   → tags get +1.0
 *   complete (activity done)→ tags get +1.5  (strongest positive signal)
 *   reject (swipe left)    → tags get −0.3  (mild penalty)
 *
 * All scores decay toward 0 over time so stale preferences fade out.
 * The resulting TagAffinities map is { [tag]: number } where positive = like,
 * negative = dislike.  Typical range after a few sessions: −2 … +8.
 */

import { TagAffinities } from '../types';

// ── Weights ────────────────────────────────────────────────────────────
const ACCEPT_WEIGHT = 1.0;
const COMPLETE_WEIGHT = 1.5;
const REJECT_WEIGHT = -0.3;

/**
 * Exponential decay factor applied per day since last update.
 * 0.95 means a tag score loses ~5 % of its magnitude per day,
 * so after ~14 days of inactivity a score of 5 drops to ≈2.4.
 */
const DECAY_PER_DAY = 0.95;

// ── Helpers ────────────────────────────────────────────────────────────

/** Apply time-based decay to every tag score. */
export const decayAffinities = (
  affinities: TagAffinities,
  lastUpdated: string | undefined,
): TagAffinities => {
  if (!lastUpdated) return affinities;
  const daysSince = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 0.04) return affinities; // less than ~1 hour — skip
  const factor = Math.pow(DECAY_PER_DAY, daysSince);
  const decayed: TagAffinities = {};
  for (const [tag, score] of Object.entries(affinities)) {
    const v = score * factor;
    // Drop negligible scores to keep the map tidy
    if (Math.abs(v) > 0.01) decayed[tag] = v;
  }
  return decayed;
};

/** Bump tags by a given delta and return updated affinities. */
const bumpTags = (
  affinities: TagAffinities,
  tags: string[],
  delta: number,
): TagAffinities => {
  const updated = { ...affinities };
  for (const tag of tags) {
    updated[tag] = (updated[tag] ?? 0) + delta;
  }
  return updated;
};

// ── Public API ─────────────────────────────────────────────────────────

/** Call when the user swipes right (accepts) a card. */
export const recordAccept = (
  affinities: TagAffinities,
  tags: string[],
): TagAffinities => bumpTags(affinities, tags, ACCEPT_WEIGHT);

/** Call when the user completes an activity (strongest signal). */
export const recordComplete = (
  affinities: TagAffinities,
  tags: string[],
): TagAffinities => bumpTags(affinities, tags, COMPLETE_WEIGHT);

/** Call when the user swipes left (rejects) a card. */
export const recordReject = (
  affinities: TagAffinities,
  tags: string[],
): TagAffinities => bumpTags(affinities, tags, REJECT_WEIGHT);

/**
 * Convert raw tag affinities into a 0–1 score for a suggestion.
 * Returns 0.5 (neutral) when no signal exists.
 */
export const affinityScore = (
  affinities: TagAffinities,
  suggestionTags: string[] | undefined,
): number => {
  if (!suggestionTags?.length) return 0.5;
  if (!Object.keys(affinities).length) return 0.5;

  let sum = 0;
  let count = 0;
  for (const tag of suggestionTags) {
    if (tag in affinities) {
      sum += affinities[tag];
      count++;
    }
  }
  if (count === 0) return 0.5;

  const avg = sum / count;
  // Sigmoid-like mapping: avg in [-5, +5] → output in [0.1, 0.9]
  // This keeps the score bounded and smooth.
  return 0.1 + 0.8 / (1 + Math.exp(-avg * 0.6));
};

/**
 * Also boost by suggestion *type* affinity.
 * Tracks implicit AT_HOME vs GO_OUT vs EVENT preference.
 */
export const recordTypeAccept = (
  affinities: TagAffinities,
  type: string,
): TagAffinities => bumpTags(affinities, [`__type_${type}`], ACCEPT_WEIGHT * 0.5);

export const recordTypeReject = (
  affinities: TagAffinities,
  type: string,
): TagAffinities => bumpTags(affinities, [`__type_${type}`], REJECT_WEIGHT * 0.5);

export const typeAffinityScore = (
  affinities: TagAffinities,
  type: string,
): number => {
  const key = `__type_${type}`;
  if (!(key in affinities)) return 0.5;
  const val = affinities[key];
  return 0.1 + 0.8 / (1 + Math.exp(-val * 0.6));
};
