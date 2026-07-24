const MINUTE_MS = 60 * 1000;
let preferredTimeZone: string | null = null;
let preferredLocale: string | null = null;
let deviceTimezoneInitialized = false;
const TWELVE_HOUR_TIMEZONE_PREFIXES = ['America/', 'Australia/', 'Pacific/'];
const TWENTY_FOUR_HOUR_TIMEZONE_PREFIXES = ['Europe/', 'Africa/', 'Asia/', 'Atlantic/', 'Etc/', 'Indian/', 'Antarctica/', 'UTC'];

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

/** Initialize the device's native timezone. Call this once on app startup. */
export const initializeDeviceTimeZone = (): void => {
  if (deviceTimezoneInitialized) return;
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (deviceTz && !preferredTimeZone) {
    preferredTimeZone = deviceTz;
  }
  deviceTimezoneInitialized = true;
};

export const setPreferredTimeZone = (timeZone?: string | null): void => {
  if (timeZone == null) {
    preferredTimeZone = null;
    return;
  }
  if (timeZone && timeZone.trim().length > 0) {
    preferredTimeZone = timeZone;
  }
};

export const setPreferredLocale = (locale?: string | null): void => {
  if (locale == null) {
    preferredLocale = null;
    return;
  }
  if (locale && locale.trim().length > 0) {
    preferredLocale = locale;
  }
};

export const getPreferredLocale = (): string => {
  return preferredLocale ?? Intl.DateTimeFormat().resolvedOptions().locale ?? 'en-US';
};

export const getPreferredTimeZone = (): string | null => {
  // If not yet initialized, do it now (emergency fallback)
  if (!deviceTimezoneInitialized) {
    initializeDeviceTimeZone();
  }
  return preferredTimeZone;
};

export const resolveTimeZone = (timeZone?: string | null): string => {
  return timeZone ?? getPreferredTimeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
};

export const parseClockTime = (value?: string | null): number | null => {
  if (!value) return null;
  const normalized = value.trim().replace(/\./g, '').replace(/\s+/g, ' ');

  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) {
    return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
  }

  const amPm = normalized.match(/^([1-9]|1[0-2])(?::([0-5]\d))?\s*([AaPp][Mm])$/);
  if (!amPm) return null;

  const hour12 = Number(amPm[1]);
  const minute = Number(amPm[2] ?? '0');
  const meridiem = amPm[3].toLowerCase();
  const hour24 = hour12 % 12 + (meridiem === 'pm' ? 12 : 0);
  return hour24 * 60 + minute;
};

export const extractClockLabelFromText = (text?: string | null): string | null => {
  if (!text) return null;
  const match = text.match(/\b((?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[AaPp]\.?[Mm]\.?)?|(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[AaPp]\.?[Mm]\.?)\b/);
  if (!match) return null;
  return match[1].replace(/\./g, '').replace(/\s+/g, ' ').trim();
};

export const normalizeClockTime = (value?: string | null, fallback = '07:00'): string => {
  const minutes = parseClockTime(value);
  if (minutes == null) return fallback;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const getTimeZoneFormatter = (timeZone?: string | null, options: Intl.DateTimeFormatOptions = {}) => {
  const resolved = resolveTimeZone(timeZone);
  return new Intl.DateTimeFormat(getPreferredLocale(), { timeZone: resolved, ...options });
};

const clockModeFromTimeZone = (resolvedTimeZone: string): boolean | null => {
  if (TWENTY_FOUR_HOUR_TIMEZONE_PREFIXES.some((prefix) => resolvedTimeZone.startsWith(prefix))) {
    return true;
  }
  if (TWELVE_HOUR_TIMEZONE_PREFIXES.some((prefix) => resolvedTimeZone.startsWith(prefix))) {
    return false;
  }
  return null;
};

const prefers24HourClock = (timeZone?: string | null): boolean => {
  const resolved = resolveTimeZone(timeZone);
  const regionalPreference = clockModeFromTimeZone(resolved);
  if (regionalPreference != null) return regionalPreference;

  const localePreference = new Intl.DateTimeFormat(getPreferredLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    localeMatcher: 'best fit',
  }).resolvedOptions().hour12;
  return localePreference === false;
};

export const formatTime = (date: Date, timeZone?: string | null): string => {
  return getTimeZoneFormatter(timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !prefers24HourClock(timeZone),
  }).format(date);
};

export const formatClockMinutes = (minutes: number, timeZone?: string | null): string => {
  const safeMinutes = ((Math.round(minutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour24 = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;

  if (prefers24HourClock(timeZone)) {
    return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const hour12 = hour24 % 12 || 12;
  const meridiem = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12}:${String(minute).padStart(2, '0')} ${meridiem}`;
};

export const formatClockTime = (value?: string | null, timeZone?: string | null, fallback = '07:00'): string => {
  const minutes = parseClockTime(value ?? fallback);
  if (minutes == null) {
    return formatClockMinutes(parseClockTime(fallback) ?? 7 * 60, timeZone);
  }
  return formatClockMinutes(minutes, timeZone);
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
  const resolved = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat(getPreferredLocale(), {
    localeMatcher: 'best fit',
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

export const formatLocalDateTime = (date: Date, timeZone?: string | null): string => {
  const parts = getTimeZoneParts(date, timeZone);
  const offsetPart = new Intl.DateTimeFormat(getPreferredLocale(), {
    timeZone: parts.timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value
    .replace('GMT', 'UTC');

  const localDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const localTime = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const zoneLabel = offsetPart ? `${parts.timeZone}, ${offsetPart}` : parts.timeZone;
  return `${localDate} ${localTime} (${parts.weekday}, ${zoneLabel})`;
};

export const dateFromLocalClockTime = (
  clockTime: string,
  referenceDate = new Date(),
  timeZone?: string | null,
): Date | null => {
  const minutes = parseClockTime(clockTime);
  if (minutes == null) return null;

  const targetHour = Math.floor(minutes / 60);
  const targetMinute = minutes % 60;
  const referenceParts = getTimeZoneParts(referenceDate, timeZone);
  const targetAsUtc = Date.UTC(
    referenceParts.year,
    referenceParts.month - 1,
    referenceParts.day,
    targetHour,
    targetMinute,
  );

  const firstGuess = new Date(targetAsUtc);
  const guessParts = getTimeZoneParts(firstGuess, referenceParts.timeZone);
  const guessLocalAsUtc = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
  );

  return new Date(firstGuess.getTime() + targetAsUtc - guessLocalAsUtc);
};

const minutesSinceMidnight = (hour: number, minute: number): number => hour * 60 + minute;

const isWithinCircularWindow = (currentMinutes: number, startMinutes: number, endMinutes: number): boolean => {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

const minutesUntilWindowEnd = (currentMinutes: number, startMinutes: number, endMinutes: number): number => {
  if (startMinutes <= endMinutes) {
    return Math.max(0, endMinutes - currentMinutes);
  }
  if (currentMinutes >= startMinutes) {
    return totalMinutesUntilEndOfDay(currentMinutes) + endMinutes;
  }
  return Math.max(0, endMinutes - currentMinutes);
};

const totalMinutesUntilEndOfDay = (currentMinutes: number): number => (24 * 60) - currentMinutes;

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
  const isWithinWakeWindow = isWithinCircularWindow(currentMinutes, wakeStartMinutes, wakeEndMinutes);
  const minutesUntilWakeEnd = minutesUntilWindowEnd(currentMinutes, wakeStartMinutes, wakeEndMinutes);
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
