import { ActivityLog } from '../types';
import { BadgeDefinition, badgeDefinitions } from '../data/badges';

export type BadgeProgress = BadgeDefinition & {
  count: number;
  level: number;
  progress: number;
  currentTarget: number;
  nextTarget: number | null;
};

const computeLevel = (count: number, levels: number[]) => {
  let level = 0;
  for (const threshold of levels) {
    if (count >= threshold) level += 1;
  }
  const currentTarget = level === 0 ? 0 : levels[level - 1];
  const nextTarget = level < levels.length ? levels[level] : null;
  const progress = nextTarget
    ? (count - currentTarget) / Math.max(1, nextTarget - currentTarget)
    : 1;
  return { level, currentTarget, nextTarget, progress: Math.min(1, Math.max(0, progress)) };
};

export const buildBadgeProgress = (activityLog: ActivityLog[]): BadgeProgress[] => {
  return badgeDefinitions.map((badge) => {
    const count = activityLog.filter((entry) => (
      entry.tags?.some((tag) => badge.tags.includes(tag))
    )).length;
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
