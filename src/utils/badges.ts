import { ActivityLog, Habit } from '../types';
import { BadgeDefinition, badgeDefinitions } from '../data/badges';

export type BadgeProgress = BadgeDefinition & {
  count: number;
  level: number;
  progress: number;
  currentTarget: number;
  nextTarget: number | null;
};

const MINUTES_PER_ACTIVITY_UNIT = 50;

export const badgeLevelThresholdMinutes = (levels: number[]): number[] =>
  levels.map((level) => level * MINUTES_PER_ACTIVITY_UNIT);

const computeLevel = (count: number, levels: number[]) => {
  const minuteThresholds = badgeLevelThresholdMinutes(levels);
  let level = 0;
  for (const threshold of minuteThresholds) {
    if (count >= threshold) level += 1;
  }
  const currentTarget = level === 0 ? 0 : minuteThresholds[level - 1];
  const nextTarget = level < minuteThresholds.length ? minuteThresholds[level] : null;
  const progress = nextTarget
    ? (count - currentTarget) / Math.max(1, nextTarget - currentTarget)
    : 1;
  return { level, currentTarget, nextTarget, progress: Math.min(1, Math.max(0, progress)) };
};

export const buildBadgeProgress = (activityLog: ActivityLog[], habits?: Habit[]): BadgeProgress[] => {
  return badgeDefinitions.map((badge) => {
    let count: number;
    if (badge.id === 'habits') {
      // Track total time spent on habits.
      count = (habits ?? []).reduce((sum, h) => {
        const completionCount = h.completionHistory?.length ?? 0;
        return sum + completionCount * (h.lengthMin ?? 0);
      }, 0);
    } else {
      count = activityLog.reduce((sum, entry) => {
        const matchesBadge = entry.tags?.some((tag) => badge.tags.includes(tag));
        if (!matchesBadge) return sum;
        return sum + (entry.durationMin ?? 0);
      }, 0);
    }
    const { level, currentTarget, nextTarget, progress } = computeLevel(count, badge.levels);
    return {
      ...badge,
      count,
      level,
      currentTarget,
      nextTarget,
      progress,
    };
  });
};

export const getBadgeById = (badgeId: string): BadgeDefinition | undefined =>
  badgeDefinitions.find((badge) => badge.id === badgeId);
