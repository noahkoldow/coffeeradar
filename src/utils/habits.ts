import { Habit, HabitFrequency, HabitTimeOfDay, Suggestion } from '../types';

const frequencyDays: Record<HabitFrequency, number> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
};

export const getFrequencyDays = (frequency: HabitFrequency): number => frequencyDays[frequency];

export const isHabitDue = (habit: Habit, now = new Date()): boolean => {
  if (!habit.lastCompletedAt) return true;
  const last = new Date(habit.lastCompletedAt);
  const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  return days >= getFrequencyDays(habit.frequency);
};

/**
 * Returns true if the habit's streak was broken (overdue by more
 * than 1 full frequency period without completing).
 */
export const isStreakBroken = (habit: Habit, now = new Date()): boolean => {
  if (!habit.lastCompletedAt) return false; // no streak to break
  const last = new Date(habit.lastCompletedAt);
  const days = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  // Allow a grace period of 1 extra day
  return days > getFrequencyDays(habit.frequency) + 1;
};

/**
 * Complete a habit: update lastCompletedAt, bump streak (or reset if broken),
 * push to completion history.
 */
export const completeHabitEntry = (habit: Habit, now = new Date()): Habit => {
  const iso = now.toISOString();
  const broken = isStreakBroken(habit, now);
  const newStreak = broken ? 1 : (habit.currentStreak ?? 0) + 1;
  const longest = Math.max(habit.longestStreak ?? 0, newStreak);
  const history = [iso, ...(habit.completionHistory ?? [])].slice(0, 90);
  return {
    ...habit,
    lastCompletedAt: iso,
    currentStreak: newStreak,
    longestStreak: longest,
    completionHistory: history,
  };
};

/**
 * Reverse the most recent completion if it happened today.
 * Restores lastCompletedAt to the previous entry and decrements the streak.
 */
export const uncompleteHabitEntry = (habit: Habit, now = new Date()): Habit => {
  const history = [...(habit.completionHistory ?? [])];
  if (history.length === 0) return habit;

  // Only allow undo if the most recent completion was today
  const lastDate = new Date(history[0]);
  const sameDay =
    lastDate.getFullYear() === now.getFullYear() &&
    lastDate.getMonth() === now.getMonth() &&
    lastDate.getDate() === now.getDate();
  if (!sameDay) return habit;

  // Remove today's entry
  history.shift();

  const previousLast = history.length > 0 ? history[0] : null;
  const newStreak = Math.max(0, (habit.currentStreak ?? 1) - 1);

  return {
    ...habit,
    lastCompletedAt: previousLast,
    currentStreak: newStreak,
    // longestStreak stays — we don't lower the all-time best
    completionHistory: history,
  };
};

/** How many completions in the last 7 days */
export const weeklyCompletionCount = (habit: Habit, now = new Date()): number => {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return (habit.completionHistory ?? []).filter((d) => new Date(d).getTime() >= weekAgo).length;
};

/** Which days of the week (0=Sun) had a completion in the last 7 days */
export const weeklyDots = (habit: Habit, now = new Date()): boolean[] => {
  const result = [false, false, false, false, false, false, false];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  // Build 7-day window starting from Mon
  const monOffset = ((dayOfWeek + 6) % 7); // days since last Mon
  const monday = new Date(today.getTime() - monOffset * 86400000);
  for (const ts of habit.completionHistory ?? []) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((d.getTime() - monday.getTime()) / 86400000);
    if (diff >= 0 && diff < 7) {
      result[diff] = true;
    }
  }
  return result;
};

export const matchesTimeOfDay = (habit: Habit, now = new Date()): boolean => {
  if (habit.timeOfDay === 'any') return true;
  const hour = now.getHours();
  if (habit.timeOfDay === 'morning') return hour >= 5 && hour < 12;
  if (habit.timeOfDay === 'afternoon') return hour >= 12 && hour < 17;
  if (habit.timeOfDay === 'evening') return hour >= 17 && hour < 23;
  return true;
};

/**
 * Returns the habit's scheduled start hour for today based on preferredTime or timeOfDay.
 * null if no clear schedule (timeOfDay === 'any' and no preferredTime).
 */
const getScheduledHour = (habit: Habit): number | null => {
  if (habit.preferredTime) {
    const [h] = habit.preferredTime.split(':').map(Number);
    return h;
  }
  switch (habit.timeOfDay) {
    case 'morning': return 8;
    case 'afternoon': return 14;
    case 'evening': return 19;
    default: return null;
  }
};

/**
 * Determine urgency state of a habit:
 * - 'approaching': within 1h before the scheduled time
 * - 'overdue':     within 1h after the scheduled time (and still due)
 * - 'normal':      outside that 2h window
 */
export type HabitUrgency = 'approaching' | 'overdue' | 'normal';

export const getHabitUrgency = (habit: Habit, now = new Date()): HabitUrgency => {
  if (!isHabitDue(habit, now)) return 'normal';
  const scheduledHour = getScheduledHour(habit);
  if (scheduledHour === null) return 'normal';

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const scheduledMinutes = scheduledHour * 60;

  if (currentMinutes >= scheduledMinutes) {
    // Past the scheduled time — only count as overdue within 1h
    if (currentMinutes <= scheduledMinutes + 60) return 'overdue';
    return 'normal'; // more than 1h past → back to normal
  }

  // Before the scheduled time — approaching if within 1h
  if (scheduledMinutes - currentMinutes <= 60) return 'approaching';

  return 'normal';
};

export const habitToSuggestion = (habit: Habit): Suggestion => ({
  id: `habit_${habit.id}`,
  habitId: habit.id,
  type: habit.type,
  source: 'habit',
  title: habit.name,
  description: habit.description,
  durationMin: habit.lengthMin,
  instructions: [habit.description],
  tags: habit.tags,
  whyNow: habit.currentStreak > 1
    ? `${habit.currentStreak}-day streak — keep it going! 🔥`
    : 'This habit is due and fits your time window.',
  confidence: 0.85,
});

export const formatHabitFrequency = (frequency: HabitFrequency): string => {
  switch (frequency) {
    case 'daily':
      return 'Every day';
    case 'weekly':
      return 'Weekly';
    case 'fortnightly':
      return 'Fortnightly';
    case 'monthly':
      return 'Monthly';
    default:
      return 'Flexible';
  }
};

export const formatHabitTimeOfDay = (time: HabitTimeOfDay): string => {
  switch (time) {
    case 'morning':
      return 'Morning';
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Evening';
    default:
      return 'Any time';
  }
};

/** Emoji for streak milestones */
export const streakEmoji = (streak: number): string => {
  if (streak >= 30) return '💎';
  if (streak >= 14) return '🏆';
  if (streak >= 7) return '🔥';
  if (streak >= 3) return '⚡';
  return '✨';
};

/** Day labels starting from Monday */
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export type WeekRow = {
  /** Label like "Feb 10 – 16" */
  label: string;
  /** 7 values Mon–Sun: true = completed, false = missed (was due & past), null = not applicable (future or not scheduled) */
  days: (boolean | null)[];
};

/**
 * Build an array of week rows from the habit's createdAt to now,
 * marking each day as completed, missed, or not applicable.
 * Most recent week first.
 */
export const buildWeeklyHistory = (habit: Habit, now = new Date()): WeekRow[] => {
  const created = new Date(habit.createdAt);
  created.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Build a set of completion dates as YYYY-MM-DD strings
  const completionSet = new Set<string>();
  for (const ts of habit.completionHistory ?? []) {
    const d = new Date(ts);
    completionSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }

  // Find the Monday of the week the habit was created
  const createdDay = created.getDay(); // 0=Sun
  const createdMonOffset = (createdDay + 6) % 7;
  const firstMonday = new Date(created.getTime() - createdMonOffset * 86400000);

  // Find the Monday of this week
  const todayDay = today.getDay();
  const todayMonOffset = (todayDay + 6) % 7;
  const thisMonday = new Date(today.getTime() - todayMonOffset * 86400000);

  // Determine how often the habit is due (in days)
  const freqDays = getFrequencyDays(habit.frequency);

  const weeks: WeekRow[] = [];
  let monday = new Date(thisMonday);

  while (monday.getTime() >= firstMonday.getTime()) {
    const days: (boolean | null)[] = [];
    const weekStart = new Date(monday);
    const weekEnd = new Date(monday.getTime() + 6 * 86400000);

    for (let i = 0; i < 7; i++) {
      const day = new Date(monday.getTime() + i * 86400000);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

      if (day.getTime() > today.getTime()) {
        // Future day — not applicable
        days.push(null);
      } else if (day.getTime() < created.getTime()) {
        // Before habit was created — not applicable
        days.push(null);
      } else if (completionSet.has(key)) {
        // Completed this day
        days.push(true);
      } else if (freqDays > 1) {
        // For non-daily habits, only mark as missed if enough days have passed
        // since the last completion before this day (or since creation)
        // Simplification: only show missed (false) for daily habits;
        // for weekly/fortnightly/monthly, show null unless completed
        days.push(null);
      } else {
        // Daily habit, past day, not completed — missed
        days.push(false);
      }
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const label = `${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} – ${weekEnd.getMonth() !== weekStart.getMonth() ? monthNames[weekEnd.getMonth()] + ' ' : ''}${weekEnd.getDate()}`;

    weeks.push({ label, days });
    monday = new Date(monday.getTime() - 7 * 86400000);
  }

  return weeks;
};

export { DAY_LABELS };

/**
 * Migrate legacy habits that don't have the new fields.
 * Call once during init to ensure backward compatibility.
 */
export const migrateHabit = (h: Habit): Habit => ({
  ...h,
  currentStreak: h.currentStreak ?? 0,
  longestStreak: h.longestStreak ?? 0,
  completionHistory: h.completionHistory ?? [],
  // preferredTime is optional — no default needed
});
