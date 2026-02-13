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

export const matchesTimeOfDay = (habit: Habit, now = new Date()): boolean => {
  if (habit.timeOfDay === 'any') return true;
  const hour = now.getHours();
  if (habit.timeOfDay === 'morning') return hour >= 5 && hour < 12;
  if (habit.timeOfDay === 'afternoon') return hour >= 12 && hour < 17;
  if (habit.timeOfDay === 'evening') return hour >= 17 && hour < 23;
  return true;
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
  whyNow: 'This habit is due and fits your time window.',
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
