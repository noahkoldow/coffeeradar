const MINUTE_MS = 60 * 1000;

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * MINUTE_MS);
};

export const minutesBetween = (start: Date, end: Date): number => {
  return Math.round((end.getTime() - start.getTime()) / MINUTE_MS);
};

export const formatDuration = (minutes: number): string => {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
};

export const formatTime = (date: Date): string => {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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

export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};
