import { Habit, SmartTodoItem } from '../types';
import { chooseTravelMode, estimateEtaMinutes, haversineKm } from './travel';
import { formatTime } from '../utils/time';

export type LocationHint = {
  title?: string;
  lat?: number;
  lng?: number;
};

export type CalendarBlock = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  source: 'calendar' | 'scheduled';
  /** True for all-day calendar entries (reminders/markers). These are shown above
   * the timed schedule and do NOT block any time slots. */
  allDay?: boolean;
  lat?: number;
  lng?: number;
};

export type CalendarGap = {
  id: string;
  dayLabel: string;
  startAt: Date;
  endAt: Date;
  durationMin: number;
  before?: CalendarBlock;
  after?: CalendarBlock;
};

export type SmartCalendarSuggestion = {
  id: string;
  title: string;
  reason: string;
  durationMin: number;
  travelBufferMin: number;
  score: number;
  source: 'todo' | 'habit' | 'smart';
  category: 'Exercise' | 'Productivity' | 'Self-care';
};

type BuildGapOptions = {
  defaultLocation?: LocationHint;
  dayStartMin?: number;
  dayEndMin?: number;
  generationSpeedFactor?: number;
  aiTargetCount?: number;
  totalSuggestions?: number;
};

const MIN_GAP_MINUTES = 20;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 22;
const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};
const GEMINI_KEY = env.EXPO_PUBLIC_GEMINI_API_KEY as string | undefined;
const GEMINI_MODEL = (env.EXPO_PUBLIC_GEMINI_MODEL as string | undefined) || 'gemini-2.5-flash-lite';

const locationHintToKm = (title?: string): number => {
  if (!title) return 2.2;
  const text = title.toLowerCase();

  if (/(home|zuhause|dishwasher|laundry|clean|kochen|dinner at home)/.test(text)) return 0.4;
  if (/(work|office|uni|university|campus|meeting)/.test(text)) return 2.6;
  if (/(gym|workout|run|yoga|fitness)/.test(text)) return 3.2;
  if (/(restaurant|dinner|date|bar|cafe|coffee)/.test(text)) return 4.0;
  if (/(library|study|coworking)/.test(text)) return 2.0;
  if (/(shopping|supermarket|grocer)/.test(text)) return 1.6;

  return 2.2;
};

const minutesBetween = (a: Date, b: Date): number => {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
};

const clampDuration = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, Math.round(value)));
};

const buildGapId = (date: Date, index: number): string => {
  return `gap_${date.toISOString().slice(0, 10)}_${index}`;
};

const estimateLegKm = (from?: LocationHint, to?: LocationHint): number => {
  if (
    from?.lat != null
    && from?.lng != null
    && to?.lat != null
    && to?.lng != null
  ) {
    const geoKm = haversineKm(from.lat, from.lng, to.lat, to.lng);
    return Math.max(0.3, geoKm * 1.25);
  }

  return Math.abs(locationHintToKm(from?.title) - locationHintToKm(to?.title)) + 0.3;
};

export const computeTravelBufferMin = (
  before: LocationHint | undefined,
  suggestion: LocationHint,
  after: LocationHint | undefined,
): number => {
  const toSuggestionKm = estimateLegKm(before, suggestion);
  const fromSuggestionKm = estimateLegKm(suggestion, after);

  const toSuggestionEta = estimateEtaMinutes(toSuggestionKm, chooseTravelMode(toSuggestionKm));
  const fromSuggestionEta = estimateEtaMinutes(fromSuggestionKm, chooseTravelMode(fromSuggestionKm));

  return Math.round((toSuggestionEta + fromSuggestionEta) / 2);
};

export const findCalendarGaps = (
  date: Date,
  blocks: CalendarBlock[],
  options?: Pick<BuildGapOptions, 'dayStartMin' | 'dayEndMin'>,
): CalendarGap[] => {
  const startMin = Math.max(0, Math.min(23 * 60 + 59, options?.dayStartMin ?? DAY_START_HOUR * 60));
  const endMin = Math.max(startMin + 1, Math.min(24 * 60, options?.dayEndMin ?? DAY_END_HOUR * 60));
  const dayStart = new Date(date);
  dayStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

  const sorted = blocks
    .filter((block) => !block.allDay)
    .map((block) => ({
      ...block,
      startAt: new Date(Math.max(block.startAt.getTime(), dayStart.getTime())),
      endAt: new Date(Math.min(block.endAt.getTime(), dayEnd.getTime())),
    }))
    .filter((block) => block.endAt.getTime() > block.startAt.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const merged: CalendarBlock[] = [];
  for (const block of sorted) {
    const last = merged[merged.length - 1];
    if (!last || block.startAt.getTime() > last.endAt.getTime()) {
      merged.push({ ...block });
      continue;
    }
    last.endAt = new Date(Math.max(last.endAt.getTime(), block.endAt.getTime()));
    if (last.source !== 'calendar' && block.source === 'calendar') {
      last.source = 'calendar';
    }
  }

  const gaps: CalendarGap[] = [];
  let cursor = dayStart;
  let previous: CalendarBlock | undefined;
  let idx = 0;

  const pushGap = (startAt: Date, endAt: Date, before?: CalendarBlock, after?: CalendarBlock) => {
    const durationMin = minutesBetween(startAt, endAt);
    if (durationMin < MIN_GAP_MINUTES) return;

    gaps.push({
      id: buildGapId(date, idx++),
      dayLabel: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      startAt,
      endAt,
      durationMin,
      before,
      after,
    });
  };

  for (const block of merged) {
    if (block.startAt.getTime() > cursor.getTime()) {
      pushGap(cursor, block.startAt, previous, block);
    }
    cursor = new Date(Math.max(cursor.getTime(), block.endAt.getTime()));
    previous = block;
  }

  if (cursor.getTime() < dayEnd.getTime()) {
    pushGap(cursor, dayEnd, previous, undefined);
  }

  return gaps;
};

const todoDeadlineScore = (todo: SmartTodoItem): number => {
  if (!todo.deadlineAt) return 0.2;
  const deadlineMs = new Date(todo.deadlineAt).getTime();
  if (Number.isNaN(deadlineMs)) return 0.2;
  const deltaHours = (deadlineMs - Date.now()) / 3600000;
  if (deltaHours <= 0) return 2.2;
  if (deltaHours <= 24) return 1.8;
  if (deltaHours <= 72) return 1.2;
  return 0.6;
};

const scoreByTodoUrgency = (title: string, todos: SmartTodoItem[]): number => {
  const lowerTitle = title.toLowerCase();
  return todos.reduce((sum, todo) => {
    if (todo.done) return sum;
    const tokens = todo.title.toLowerCase().split(/\s+/).filter((token) => token.length > 3);
    const match = tokens.some((token) => lowerTitle.includes(token));
    if (!match) return sum;
    return sum + todoDeadlineScore(todo);
  }, 0);
};

type RawGeminiSuggestion = {
  title?: string;
  reason?: string;
  source?: 'todo' | 'habit' | 'smart' | string;
  durationMin?: number;
};

type GeminiPayload = {
  suggestions?: RawGeminiSuggestion[];
};

const parseGeminiJson = (text: string): GeminiPayload | null => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as GeminiPayload;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]) as GeminiPayload;
      } catch {
        return null;
      }
    }
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as GeminiPayload;
      } catch {
        return null;
      }
    }
    return null;
  }
};

const sourceRank = (source?: string): SmartCalendarSuggestion['source'] => {
  if (source === 'todo' || source === 'habit' || source === 'smart') return source;
  return 'smart';
};

const classifyCategory = (title: string, source: SmartCalendarSuggestion['source']): SmartCalendarSuggestion['category'] => {
  const text = title.toLowerCase();
  if (/(run|workout|gym|walk|stretch|yoga|exercise|bike|swim)/.test(text)) return 'Exercise';
  if (source === 'todo' || /(study|write|plan|organize|email|project|deadline|review|focus)/.test(text)) return 'Productivity';
  return 'Self-care';
};

const normalizeGeminiSuggestions = (
  payload: GeminiPayload | null,
  gap: CalendarGap,
  todos: SmartTodoItem[],
  options?: BuildGapOptions,
): SmartCalendarSuggestion[] => {
  if (!payload?.suggestions?.length) return [];

  const beforeLocation: LocationHint | undefined = {
    title: gap.before?.title,
    lat: gap.before?.lat,
    lng: gap.before?.lng,
  };
  const afterLocation: LocationHint | undefined = {
    title: gap.after?.title,
    lat: gap.after?.lat,
    lng: gap.after?.lng,
  };

  return payload.suggestions
    .map((item, idx) => {
      const title = String(item.title ?? '').trim();
      const reason = String(item.reason ?? '').trim();
      if (!title || !reason) return null;

      const requestedDuration = Number(item.durationMin);
      const suggestionLocation: LocationHint = {
        title,
        lat: options?.defaultLocation?.lat,
        lng: options?.defaultLocation?.lng,
      };
      const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);
      const usableMin = gap.durationMin - travelBufferMin;
      if (usableMin < 15) return null;

      const durationMin = clampDuration(
        Number.isFinite(requestedDuration) ? requestedDuration : Math.min(40, usableMin),
        15,
        usableMin,
      );
      const source = sourceRank(item.source);
      const urgencyBoost = scoreByTodoUrgency(title, todos);

      return {
        id: `gemini_${gap.id}_${idx}`,
        title,
        reason,
        durationMin,
        travelBufferMin,
        source,
        score: (source === 'todo' ? 2 : source === 'habit' ? 1.5 : 1.2) + urgencyBoost,
        category: classifyCategory(title, source),
      } satisfies SmartCalendarSuggestion;
    })
    .filter((item): item is SmartCalendarSuggestion => !!item)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const buildGapPrompt = (
  gap: CalendarGap,
  habits: Habit[],
  todos: SmartTodoItem[],
  options?: BuildGapOptions,
): string => {
  const pendingTodos = todos
    .filter((todo) => !todo.done)
    .slice(0, 10)
    .map((todo) => `- ${todo.title}${todo.deadlineAt ? ` (deadline: ${new Date(todo.deadlineAt).toLocaleString()})` : ''}`)
    .join('\n') || '- none';

  const habitLines = habits
    .slice(0, 12)
    .map((habit) => `- ${habit.name} (${habit.lengthMin} min, ${habit.type}, ${habit.timeOfDay})`)
    .join('\n') || '- none';

  const before = gap.before
    ? `${gap.before.title} (${formatTime(gap.before.startAt)}-${formatTime(gap.before.endAt)})`
    : 'none';
  const after = gap.after
    ? `${gap.after.title} (${formatTime(gap.after.startAt)}-${formatTime(gap.after.endAt)})`
    : 'none';

  return [
    'Return ONLY valid JSON.',
    'Schema: {"suggestions":[{"title":string,"reason":string,"durationMin":number,"source":"todo"|"habit"|"smart"}]}',
    'Goal: propose activities and to-dos that are appropriate for this specific free-time gap.',
    'Hard constraints:',
    `- Gap duration is ${gap.durationMin} minutes.`,
    '- Each suggestion must realistically fit between before and after events.',
    '- Prioritize pending to-dos with near deadlines.',
    '- Consider likely travel and transition time.',
    '- Prefer concrete actions over generic fillers.',
    '- Return 3 to 5 suggestions max.',
    '',
    `Gap: ${gap.dayLabel}, ${formatTime(gap.startAt)}-${formatTime(gap.endAt)}`,
    `Before event: ${before}`,
    `After event: ${after}`,
    `Default user coordinates: ${options?.defaultLocation?.lat ?? 'unknown'}, ${options?.defaultLocation?.lng ?? 'unknown'}`,
    '',
    'Pending to-dos:',
    pendingTodos,
    '',
    'Habit candidates:',
    habitLines,
  ].join('\n');
};

const requestGeminiGapSuggestions = async (
  gap: CalendarGap,
  habits: Habit[],
  todos: SmartTodoItem[],
  options?: BuildGapOptions,
): Promise<SmartCalendarSuggestion[]> => {
  if (!GEMINI_KEY) return [];

  const speedFactor = Math.max(0.5, Math.min(1, options?.generationSpeedFactor ?? 1));
  const controller = new AbortController();
  const timeoutMs = Math.round(12000 * speedFactor);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const prompt = buildGapPrompt(gap, habits, todos, options);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          topP: 0.9,
          topK: 32,
          maxOutputTokens: Math.round(900 * speedFactor),
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) return [];
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text ?? '')).join('') ?? '';
    const parsed = parseGeminiJson(text);
    return normalizeGeminiSuggestions(parsed, gap, todos, options);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildHeuristicSuggestions = (
  gap: CalendarGap,
  habits: Habit[],
  todos: SmartTodoItem[],
  options?: BuildGapOptions,
): SmartCalendarSuggestion[] => {
  const suggestions: SmartCalendarSuggestion[] = [];
  const beforeLocation: LocationHint | undefined = {
    title: gap.before?.title,
    lat: gap.before?.lat,
    lng: gap.before?.lng,
  };
  const afterLocation: LocationHint | undefined = {
    title: gap.after?.title,
    lat: gap.after?.lat,
    lng: gap.after?.lng,
  };

  const pendingTodos = todos.filter((todo) => !todo.done).slice(0, 10);
  for (const todo of pendingTodos) {
    const title = todo.title.trim();
    if (!title) continue;

    const suggestionLocation: LocationHint = {
      title,
      lat: options?.defaultLocation?.lat,
      lng: options?.defaultLocation?.lng,
    };
    const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);
    const usableMin = gap.durationMin - travelBufferMin;
    if (usableMin < 15) continue;

    const durationMin = Math.min(Math.max(20, Math.round(usableMin * 0.75)), Math.max(20, usableMin));
    suggestions.push({
      id: `todo_${todo.id}`,
      title,
      reason: todo.deadlineAt
        ? 'Deadline-aware task selected for this slot.'
        : 'Pending task that matches this free slot.',
      durationMin,
      travelBufferMin,
      source: 'todo',
      score: 1.6 + todoDeadlineScore(todo),
      category: classifyCategory(title, 'todo'),
    });
  }

  const habitCandidates = habits.slice(0, 8);
  for (const habit of habitCandidates) {
    const suggestionLocation: LocationHint = {
      title: habit.name,
      lat: habit.type === 'AT_HOME' ? options?.defaultLocation?.lat : undefined,
      lng: habit.type === 'AT_HOME' ? options?.defaultLocation?.lng : undefined,
    };
    const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);
    const usableMin = gap.durationMin - travelBufferMin;
    if (usableMin < Math.min(15, habit.lengthMin)) continue;

    suggestions.push({
      id: `habit_${habit.id}`,
      title: habit.name,
      reason: 'Habit that fits this slot duration and context.',
      durationMin: Math.min(habit.lengthMin, Math.max(20, usableMin)),
      travelBufferMin,
      source: 'habit',
      score: 1.1,
      category: classifyCategory(habit.name, 'habit'),
    });
  }

  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

export const buildGapSuggestions = (
  gap: CalendarGap,
  habits: Habit[],
  todos: SmartTodoItem[],
  options?: BuildGapOptions,
): Promise<SmartCalendarSuggestion[]> => {
  const desiredCount = Math.max(1, Math.min(5, options?.totalSuggestions ?? 3));
  const aiTarget = Math.max(0, Math.min(desiredCount, options?.aiTargetCount ?? desiredCount));
  const normalizeKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

  return Promise.all([
    requestGeminiGapSuggestions(gap, habits, todos, options).catch(() => [] as SmartCalendarSuggestion[]),
    Promise.resolve(buildHeuristicSuggestions(gap, habits, todos, options)),
  ]).then(([aiSuggestions, dbSuggestions]) => {
    const selected: SmartCalendarSuggestion[] = [];
    const used = new Set<string>();

    const pushUnique = (list: SmartCalendarSuggestion[], limit?: number) => {
      let added = 0;
      for (const item of list) {
        const key = normalizeKey(item.title);
        if (used.has(key)) continue;
        used.add(key);
        selected.push(item);
        added += 1;
        if (selected.length >= desiredCount) break;
        if (limit != null && added >= limit) break;
      }
    };

    pushUnique(aiSuggestions, aiTarget);
    pushUnique(dbSuggestions);
    pushUnique(aiSuggestions);

    return selected.slice(0, desiredCount);
  });
};
