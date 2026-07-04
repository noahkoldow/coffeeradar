/**
 * Generates contextual, motivating "why now" copy for each suggestion
 * using calendar context, weather, time-of-day, and anti-procrastination framing.
 */

import { Availability, DeckSuggestion, Habit } from '../types';
import { WeatherInfo } from './weather';
import { formatDuration, getTimeZoneParts } from '../utils/time';

type WhyNowContext = {
  availability: Availability;
  weather: WeatherInfo | null;
  now: Date;
  habits: Habit[];
  timeZone?: string | null;
};

const timeOfDayLabel = (hour: number): string => {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
};

const PROCRASTINATION_NUDGES = [
  "Just the first 5 minutes — that's all it takes.",
  'Your future self will thank you.',
  'Momentum starts with one step.',
  "You won't regret starting, only not starting.",
  'Starting is the hardest part — after that it flows.',
  'This is the exact right moment.',
  'Done is better than perfect.',
  'Small action now beats big plans later.',
];

const pickNudge = (id: string): string => {
  // Deterministic pick based on suggestion id so it's stable per card
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return PROCRASTINATION_NUDGES[Math.abs(hash) % PROCRASTINATION_NUDGES.length];
};

const weatherLine = (weather: WeatherInfo | null, type: string): string | null => {
  if (!weather || weather.condition === 'unknown') return null;
  if (type === 'AT_HOME') {
    if (weather.condition === 'drizzle') return `Light drizzle outside — cozy indoor time still works.`;
    if (weather.condition === 'rain') return `It's raining outside — perfect time for this.`;
    if (weather.condition === 'snow') return `It's snowing — cozy indoor time.`;
    return null;
  }
  if (type === 'GO_OUT' || type === 'EVENT') {
    if (weather.condition === 'clear') return `${weather.label} — great weather to be outside.`;
    if (weather.condition === 'cloudy') return `${weather.label} — still nice to go out.`;
    if (weather.condition === 'drizzle') return `A light drizzle outside — still doable with a jacket.`;
    if (weather.condition === 'rain') return `Bring an umbrella — ${weather.label.toLowerCase()}.`;
    if (weather.condition === 'snow') return `Bundle up — ${weather.label.toLowerCase()}.`;
  }
  return null;
};

export const generateWhyNow = (
  suggestion: DeckSuggestion,
  ctx: WhyNowContext,
): string => {
  const parts: string[] = [];
  // Get local hour using proper timezone handling (not UTC)
  const tzParts = getTimeZoneParts(ctx.now, ctx.timeZone);
  const hour = tzParts.hour;
  const tod = timeOfDayLabel(hour);

  // 1. Calendar-aware urgency
  if (ctx.availability.nextEventTitle) {
    const mins = ctx.availability.durationMin;
    if (mins <= suggestion.durationMin + 15) {
      parts.push(
        `You have ${formatDuration(mins)} before ${ctx.availability.nextEventTitle} — this fits perfectly.`,
      );
    } else {
      parts.push(
        `${formatDuration(mins)} free before ${ctx.availability.nextEventTitle}.`,
      );
    }
  } else if (ctx.availability.durationMin <= 30) {
    parts.push(`Quick window — only ${formatDuration(ctx.availability.durationMin)} free. This fits.`);
  }

  // 2. Weather context
  const wLine = weatherLine(ctx.weather, suggestion.type);
  if (wLine) parts.push(wLine);

  // 3. Time-of-day motivation
  if (suggestion.type === 'AT_HOME') {
    if (tod === 'morning' && /stretch|yoga|breath|reset/.test(suggestion.title.toLowerCase())) {
      parts.push('Great way to start your morning.');
    } else if (tod === 'evening' && /journal|rest|calm|breath/.test(suggestion.title.toLowerCase())) {
      parts.push('Wind down your evening with this.');
    }
  }

  // 4. Open/close urgency for places
  if (suggestion.type === 'GO_OUT') {
    if (suggestion.meta?.openStatus === 'open_now' && suggestion.meta?.closesInMin) {
      if (suggestion.meta.closesInMin <= 90) {
        parts.push(`Closes in ${suggestion.meta.closesInMin}m — go now or wait until tomorrow.`);
      }
    }
    if (suggestion.meta?.openStatus === 'opens_soon' && suggestion.meta?.opensInMin) {
      parts.push(`Opens in ${suggestion.meta.opensInMin}m — time your walk.`);
    }
  }

  // 5. Event urgency
  if (suggestion.type === 'EVENT' && suggestion.meta?.startInMin) {
    if (suggestion.meta.startInMin <= 30) {
      parts.push(`Starts in ${suggestion.meta.startInMin}m — move now!`);
    } else if (suggestion.meta.startInMin <= 90) {
      parts.push(`Starts in ${suggestion.meta.startInMin}m — plenty of time to get there.`);
    }
  }

  // 6. Habit-specific motivation
  if (suggestion.source === 'habit') {
    const habit = ctx.habits.find((h) => h.id === suggestion.habitId);
    if (habit && habit.lastCompletedAt) {
      const daysSince = Math.floor(
        (ctx.now.getTime() - new Date(habit.lastCompletedAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSince >= 7) {
        parts.push(`It's been ${daysSince} days — keep the streak alive.`);
      } else if (daysSince >= 2) {
        parts.push(`Last done ${daysSince} days ago — stay on track.`);
      }
    } else if (habit && !habit.lastCompletedAt) {
      parts.push(`First time doing this one — let's go!`);
    }
  }

  // 7. Anti-procrastination nudge (always add one if we have few lines)
  if (parts.length < 2) {
    parts.push(pickNudge(suggestion.id));
  }

  // Keep it concise: max 2 lines
  return parts.slice(0, 2).join(' ');
};
