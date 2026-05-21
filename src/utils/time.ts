const MINUTE_MS = 60 * 1000;
let preferredTimeZone: string | null = null;

export type Daypart = 'morning' | 'afternoon' | 'evening' | 'night';

export type TimeWindowContext = {
  timeZone: string;
  localTimeLabel: string;
  weekday: string;
  daypart: Daypart;
  currentMinutes: number;
  wakeStartMinutes: number;
  wakeEndMinutes: number;
  wakeStartTime: string;
  wakeEndTime: string;
  isWithinWakeWindow: boolean;
  minutesUntilWakeEnd: number;
  isNearWakeEnd: boolean;
  isIrregularWake: boolean;
  isWeekend: boolean;
  isFridayNight: boolean;
};

export const setPreferredTimeZone = (timeZone?: string | null): void => {
  preferredTimeZone = timeZone ?? null;
};

export const getPreferredTimeZone = (): string | null => preferredTimeZone;

export const parseClockTime = (value?: string | null): number | null => {
  if (!value) return null;
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const normalizeClockTime = (value?: string | null, fallback = '07:00'): string => {
  const minutes = parseClockTime(value);
  if (minutes == null) return fallback;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const getTimeZoneFormatter = (timeZone?: string | null, options: Intl.DateTimeFormatOptions = {}) => {
  const resolved = timeZone ?? preferredTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat('en-AU', { timeZone: resolved, ...options });
};

export const formatTime = (date: Date, timeZone?: string | null): string => {
  return getTimeZoneFormatter(timeZone, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export const getTimeZoneParts = (date: Date, timeZone?: string | null): {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
} => {
  const resolved = timeZone ?? preferredTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: resolved,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    timeZone: resolved,
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    hour: Number(pick('hour')),
    minute: Number(pick('minute')),
    weekday: pick('weekday') || 'Unknown',
  };
};

const minutesSinceMidnight = (hour: number, minute: number): number => hour * 60 + minute;

export const getTimeWindowContext = (
  date: Date,
  timeZone?: string | null,
  wakeStartTime = '07:00',
  wakeEndTime = '23:00',
): TimeWindowContext => {
  const parts = getTimeZoneParts(date, timeZone);
  const currentMinutes = minutesSinceMidnight(parts.hour, parts.minute);
  const wakeStartMinutes = parseClockTime(wakeStartTime) ?? 7 * 60;
  const wakeEndMinutes = parseClockTime(wakeEndTime) ?? 23 * 60;
  const isWithinWakeWindow = currentMinutes >= wakeStartMinutes && currentMinutes <= wakeEndMinutes;
  const minutesUntilWakeEnd = Math.max(0, wakeEndMinutes - currentMinutes);
  const isNearWakeEnd = isWithinWakeWindow && minutesUntilWakeEnd <= 90;
  const isIrregularWake = !isWithinWakeWindow || isNearWakeEnd;
  const weekday = parts.weekday;
  const daypart: Daypart = parts.hour < 12 ? 'morning' : parts.hour < 17 ? 'afternoon' : parts.hour < 21 ? 'evening' : 'night';
  const isWeekend = weekday === 'Saturday' || weekday === 'Sunday';
  const isFridayNight = weekday === 'Friday' && (daypart === 'evening' || daypart === 'night');

  return {
    timeZone: parts.timeZone,
    localTimeLabel: formatTime(date, parts.timeZone),
    weekday,
    daypart,
    currentMinutes,
    wakeStartMinutes,
    wakeEndMinutes,
    wakeStartTime: normalizeClockTime(wakeStartTime, '07:00'),
    wakeEndTime: normalizeClockTime(wakeEndTime, '23:00'),
    isWithinWakeWindow,
    minutesUntilWakeEnd,
    isNearWakeEnd,
    isIrregularWake,
    isWeekend,
    isFridayNight,
  };
};

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * MINUTE_MS);
};

export const minutesBetween = (start: Date, end: Date): number => {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
};

export const formatDuration = (minutes: number): string => {
  if (minutes <= 0) return '0m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

export const formatCountdown = (target: Date, now = new Date()): string => {
  const diff = Math.max(0, target.getTime() - now.getTime());
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const toISO = (date: Date): string => date.toISOString();

export const fromISO = (value?: string | null): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const isSameCalendarDayInTimeZone = (
  left: Date,
  right: Date,
  timeZone?: string | null,
): boolean => {
  const leftParts = getTimeZoneParts(left, timeZone);
  const rightParts = getTimeZoneParts(right, timeZone);
  return leftParts.year === rightParts.year && leftParts.month === rightParts.month && leftParts.day === rightParts.day;
};

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};
