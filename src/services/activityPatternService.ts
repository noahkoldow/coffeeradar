import { ActivityLog } from '../types';
import { getTimeZoneParts } from '../utils/time';

type HabitPatternTarget = {
  suggestionId?: string;
  title?: string;
  tags?: string[];
};

export type HabitPatternStats = {
  completionCount: number;
  distinctDays: number;
  preferredMinuteOfDay: number | null;
  sameTimeHitCount: number;
  sameTimeRatio: number;
  matchingTagHitCount: number;
  matchingTagRatio: number;
  isHabitWorthy: boolean;
};

const TIME_WINDOW_MIN = 90;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeKey = (value?: string | null): string => (value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ');

const toLocalDayKey = (date: Date, timeZone?: string | null): string => {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const minuteOfDay = (date: Date, timeZone?: string | null): number => {
  const parts = getTimeZoneParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
};

const circularDistanceMin = (a: number, b: number): number => {
  const direct = Math.abs(a - b);
  return Math.min(direct, 1440 - direct);
};

const computeMedian = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
};

const matchesTarget = (entry: ActivityLog, target: HabitPatternTarget): boolean => {
  if (target.suggestionId && entry.suggestionId === target.suggestionId) return true;
  if (normalizeKey(target.title) && normalizeKey(entry.title) === normalizeKey(target.title)) return true;
  return false;
};

const overlapCount = (a: string[] | undefined, b: string[] | undefined): number => {
  if (!a?.length || !b?.length) return 0;
  const setB = new Set(b.map((item) => item.toLowerCase()));
  let count = 0;
  for (const tag of a) {
    if (setB.has(tag.toLowerCase())) count += 1;
  }
  return count;
};

export const analyzeHabitPattern = (
  activityLog: ActivityLog[],
  target: HabitPatternTarget,
  timeZone?: string | null,
): HabitPatternStats => {
  const hits = activityLog.filter((entry) => matchesTarget(entry, target));
  const completionCount = hits.length;
  if (!completionCount) {
    return {
      completionCount: 0,
      distinctDays: 0,
      preferredMinuteOfDay: null,
      sameTimeHitCount: 0,
      sameTimeRatio: 0,
      matchingTagHitCount: 0,
      matchingTagRatio: 0,
      isHabitWorthy: false,
    };
  }

  const dayKeys = new Set(hits.map((entry) => toLocalDayKey(new Date(entry.timestamp), timeZone)));
  const minutes = hits.map((entry) => minuteOfDay(new Date(entry.timestamp), timeZone));
  const preferredMinuteOfDay = computeMedian(minutes);
  const sameTimeHitCount = preferredMinuteOfDay == null
    ? 0
    : minutes.filter((value) => circularDistanceMin(value, preferredMinuteOfDay) <= TIME_WINDOW_MIN).length;
  const sameTimeRatio = completionCount ? sameTimeHitCount / completionCount : 0;
  const matchingTagHitCount = hits.filter((entry) => overlapCount(entry.tags, target.tags) > 0).length;
  const matchingTagRatio = completionCount ? matchingTagHitCount / completionCount : 0;
  const distinctDays = dayKeys.size;

  const readinessScore =
    clamp(distinctDays / 4, 0, 1) * 0.4 +
    clamp(sameTimeRatio, 0, 1) * 0.35 +
    clamp(matchingTagRatio, 0, 1) * 0.25;
  const isHabitWorthy = completionCount >= 3 && distinctDays >= 2 && readinessScore >= 0.62;

  return {
    completionCount,
    distinctDays,
    preferredMinuteOfDay,
    sameTimeHitCount,
    sameTimeRatio,
    matchingTagHitCount,
    matchingTagRatio,
    isHabitWorthy,
  };
};

export const computeGapPatternBoost = (
  activityLog: ActivityLog[],
  gapStartAt: Date,
  gapEndAt: Date,
  suggestion: HabitPatternTarget,
  timeZone?: string | null,
): { scoreBoost: number; shouldNudge: boolean } => {
  const stats = analyzeHabitPattern(activityLog, suggestion, timeZone);
  if (!stats.completionCount || stats.preferredMinuteOfDay == null) {
    return { scoreBoost: 0, shouldNudge: false };
  }

  const gapMid = new Date((gapStartAt.getTime() + gapEndAt.getTime()) / 2);
  const gapMinute = minuteOfDay(gapMid, timeZone);
  const dist = circularDistanceMin(gapMinute, stats.preferredMinuteOfDay);
  const timeFit = clamp(1 - dist / TIME_WINDOW_MIN, 0, 1);
  const frequencyStrength = clamp((stats.completionCount - 1) / 5, 0, 1);
  const boost = clamp(
    timeFit * 0.22 + frequencyStrength * 0.12 + stats.matchingTagRatio * 0.08,
    0,
    0.35,
  );

  return {
    scoreBoost: boost,
    shouldNudge: boost >= 0.12 && stats.isHabitWorthy,
  };
};
