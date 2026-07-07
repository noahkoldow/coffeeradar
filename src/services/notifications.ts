import * as Notifications from 'expo-notifications';
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { Habit } from '../types';

/* ── Permission ─────────────────────────────────────────── */

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/* ── Channel (Android) ──────────────────────────────────── */

export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('habit-reminders', {
      name: 'Habit reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }
}

/* ── Time-of-day → time ranges (start hour, end hour) ──── */

/** Ranges for each timeOfDay category (24h) */
const TIME_RANGES: Record<string, { start: number; end: number }> = {
  morning:   { start: 6,  end: 11 },
  afternoon: { start: 12, end: 17 },
  evening:   { start: 17, end: 21 },
  any:       { start: 8,  end: 20 },
};

/** Midpoint hour for each timeOfDay (used as ideal when no preferredTime) */
const MID_HOUR: Record<string, number> = {
  morning: 8,
  afternoon: 14,
  evening: 19,
  any: 10,
};

/* ── Calendar helpers ───────────────────────────────────── */

type CalendarEvent = { start: number; end: number };

/**
 * Fetch tomorrow's calendar events as epoch-ms intervals.
 * Returns empty array if calendar permission isn't granted.
 */
async function getTomorrowEvents(): Promise<CalendarEvent[]> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status !== 'granted') return [];

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    if (!calendars.length) return [];
    const calendarIds = calendars.map((c) => c.id);

    const now = new Date();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);

    const events = await Calendar.getEventsAsync(calendarIds, tomorrowStart, tomorrowEnd);

    return events
      .filter((e) => e.startDate && e.endDate)
      .map((e) => ({
        start: new Date(e.startDate as string | Date).getTime(),
        end: new Date(e.endDate as string | Date).getTime(),
      }))
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

/* ── Smart scheduling algorithm ─────────────────────────── */

/**
 * Parse "HH:MM" → { hour, minute } or null.
 */
function parseHHMM(s?: string): { hour: number; minute: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Calculate overlap in minutes between two intervals [aStart,aEnd] and [bStart,bEnd].
 */
function overlapMin(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  return Math.max(0, overlap / 60000);
}

/**
 * Total overlap a candidate slot [slotStart, slotEnd] has with all events.
 */
function totalOverlap(slotStart: number, slotEnd: number, events: CalendarEvent[]): number {
  return events.reduce((sum, e) => sum + overlapMin(slotStart, slotEnd, e.start, e.end), 0);
}

/**
 * Find the best notification time for a habit based on calendar availability.
 *
 * Algorithm:
 * 1. Determine the "ideal" time from preferredTime or timeOfDay midpoint.
 * 2. Calculate a threshold window: idealTime ± 250% of habitDuration.
 * 3. Clamp the window to the timeOfDay range (or 06:00-22:00 for preferredTime).
 * 4. Scan the window in 15-min increments to find:
 *    a) A fully free slot → return it immediately.
 *    b) The slot with least overlap → use it as fallback.
 * 5. If nothing fits, return the original ideal time.
 */
function findBestTime(
  habit: Habit,
  tomorrowDate: Date,
  events: CalendarEvent[],
): { hour: number; minute: number } {
  const durationMs = habit.lengthMin * 60000;
  const thresholdMs = durationMs * 2.5; // 250% of duration

  // 1. Determine ideal time
  const parsed = parseHHMM(habit.preferredTime);
  let idealHour: number;
  let idealMinute: number;
  if (parsed) {
    idealHour = parsed.hour;
    idealMinute = parsed.minute;
  } else {
    idealHour = MID_HOUR[habit.timeOfDay] ?? 10;
    idealMinute = 0;
  }

  // No events → just use ideal time
  if (events.length === 0) {
    return { hour: idealHour, minute: idealMinute };
  }

  // 2. Build threshold window in epoch-ms
  const idealMs = new Date(
    tomorrowDate.getFullYear(), tomorrowDate.getMonth(), tomorrowDate.getDate(),
    idealHour, idealMinute,
  ).getTime();

  let windowStart = idealMs - thresholdMs;
  let windowEnd = idealMs + thresholdMs;

  // 3. Clamp to the allowed range
  const range = parsed
    ? { start: 6, end: 22 } // broad range for exact preferred time
    : TIME_RANGES[habit.timeOfDay] ?? TIME_RANGES.any;

  const rangeStart = new Date(
    tomorrowDate.getFullYear(), tomorrowDate.getMonth(), tomorrowDate.getDate(),
    range.start, 0,
  ).getTime();

  const rangeEnd = new Date(
    tomorrowDate.getFullYear(), tomorrowDate.getMonth(), tomorrowDate.getDate(),
    range.end, 0,
  ).getTime();

  windowStart = Math.max(windowStart, rangeStart);
  windowEnd = Math.min(windowEnd, rangeEnd - durationMs); // slot must end before range end

  if (windowEnd <= windowStart) {
    return { hour: idealHour, minute: idealMinute };
  }

  // 4. Scan in 15-min steps
  const STEP = 15 * 60000;
  let bestTime = idealMs;
  let bestOverlap = Infinity;

  for (let t = windowStart; t <= windowEnd; t += STEP) {
    const slotEnd = t + durationMs;
    const overlap = totalOverlap(t, slotEnd, events);

    if (overlap === 0) {
      // Free slot found — pick the one closest to ideal
      const dist = Math.abs(t - idealMs);
      const bestDist = Math.abs(bestTime - idealMs);
      if (bestOverlap > 0 || dist < bestDist) {
        bestTime = t;
        bestOverlap = 0;
      }
    } else if (bestOverlap > 0 && overlap < bestOverlap) {
      // No free slot yet — track least overlap
      bestTime = t;
      bestOverlap = overlap;
    }
  }

  const bestDate = new Date(bestTime);
  return { hour: bestDate.getHours(), minute: bestDate.getMinutes() };
}

/* ── Main scheduling entry point ────────────────────────── */

/**
 * Cancel all existing habit reminders and reschedule based on current habits.
 * Uses calendar awareness to avoid conflicts.
 * Call this whenever habits change (add/remove/update/complete).
 */
export async function rescheduleHabitReminders(habits: Habit[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const granted = await requestNotificationPermission();
  if (!granted) return;

  await setupNotificationChannel();

  // Fetch tomorrow's events once for all habits
  const events = await getTomorrowEvents();

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const mapWeekdayToExpo = (weekday: number): number => {
    // Expo uses 1=Sunday ... 7=Saturday
    const normalized = ((weekday % 7) + 7) % 7;
    return normalized === 0 ? 1 : normalized + 1;
  };

  for (const habit of habits) {
    const streakBody = habit.currentStreak > 0
      ? `🔥 ${habit.currentStreak}-day streak — keep it going!`
      : 'Start building your streak today!';

    const best = findBestTime(habit, tomorrow, events);
    const scheduledWeekdays = Array.from(new Set(habit.scheduledWeekdays ?? [])).filter((d) => d >= 0 && d <= 6);

    if (scheduledWeekdays.length > 0) {
      for (const day of scheduledWeekdays) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Time for: ${habit.name}`,
            body: streakBody,
            sound: 'default',
            data: { habitId: habit.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday: mapWeekdayToExpo(day),
            hour: best.hour,
            minute: best.minute,
          },
        });
      }
    } else if (habit.frequency === 'daily') {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Time for: ${habit.name}`,
          body: streakBody,
          sound: 'default',
          data: { habitId: habit.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: best.hour,
          minute: best.minute,
        },
      });
    } else if (habit.frequency === 'weekly') {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Weekly: ${habit.name}`,
          body: habit.currentStreak > 0
            ? `🔥 ${habit.currentStreak}-week streak — keep it going!`
            : 'Time for your weekly habit!',
          sound: 'default',
          data: { habitId: habit.id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: 2,
          hour: best.hour,
          minute: best.minute,
        },
      });
    } else if (habit.frequency === 'fortnightly' || habit.frequency === 'monthly') {
      // Schedule as a one-shot for tomorrow, then re-evaluated next time habits change
      const triggerDate = new Date(
        tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(),
        best.hour, best.minute,
      );
      if (triggerDate.getTime() > Date.now()) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Reminder: ${habit.name}`,
            body: streakBody,
            sound: 'default',
            data: { habitId: habit.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: triggerDate,
          },
        });
      }
    }
  }
}
