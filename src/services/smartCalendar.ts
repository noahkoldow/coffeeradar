import { Habit, SmartTodoItem } from '../types';
import { chooseTravelMode, estimateEtaMinutes, haversineKm } from './travel';
import { formatTime } from '../utils/time';
import { getTodoDeadlineAt, getTodoDueDate, getTodoUrgencyScore, isTodoEligibleForWindow, isTodoOverdue } from '../utils/todos';
import { evaluateTodoWindowFit, estimateTodoDurationMin, isTodoAtomizable, parseTodoExplicitDurationMin } from '../utils/todoAtomization';

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
  timeZone?: string | null;
  language?: 'en' | 'de';
  generationSpeedFactor?: number;
  aiTargetCount?: number;
  totalSuggestions?: number;
};

const MIN_GAP_MINUTES = 20;
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 22;
const env = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env ?? {} : {};
const isDevBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const allowDirectModelCalls = isDevBuild
  || String(env.EXPO_PUBLIC_ALLOW_DIRECT_MODEL_CALLS ?? '').toLowerCase() === 'true';
const GEMINI_KEY = env.EXPO_PUBLIC_GEMINI_API_KEY as string | undefined;
const GEMINI_MODEL = (env.EXPO_PUBLIC_GEMINI_MODEL as string | undefined) || 'gemini-2.5-flash-lite';
const TRANSIT_RISK_MULTIPLIER = 1.2;
const TRANSIT_MIN_SAFETY_MIN = 4;
const ITEM_TRANSITION_BUFFER_MIN = 6;

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

  // Risk-averse estimate: reserve both travel legs plus a conservative safety pad.
  const totalTransitMin = toSuggestionEta + fromSuggestionEta;
  const safetyPadMin = Math.max(TRANSIT_MIN_SAFETY_MIN, Math.ceil(totalTransitMin * (TRANSIT_RISK_MULTIPLIER - 1)));
  return Math.max(TRANSIT_MIN_SAFETY_MIN, totalTransitMin + safetyPadMin);
};

export const findCalendarGaps = (
  date: Date,
  blocks: CalendarBlock[],
  options?: Pick<BuildGapOptions, 'dayStartMin' | 'dayEndMin'> & { minStartAt?: Date },
): CalendarGap[] => {
  const startMin = Math.max(0, Math.min(23 * 60 + 59, options?.dayStartMin ?? DAY_START_HOUR * 60));
  const endMin = Math.max(startMin + 1, Math.min(24 * 60, options?.dayEndMin ?? DAY_END_HOUR * 60));
  const rawDayStart = new Date(date);
  rawDayStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

  // When a gap for the current day is being computed, clamp its start to "now"
  // so a free slot happening right now is suggested from now → end, not from the
  // (already-passed) beginning of the slot.
  const dayStart = options?.minStartAt
    && options.minStartAt.getTime() > rawDayStart.getTime()
    && options.minStartAt.getTime() < dayEnd.getTime()
    ? options.minStartAt
    : rawDayStart;

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
  return getTodoUrgencyScore(todo, new Date());
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

const buildCommonModeConstraintLines = (): string[] => [
  'You are a practical, sharp friend helping a bored user decide what to do in free time.',
  'Do not return generic filler. Return specific, concrete actions that are realistic now.',
  'Every suggestion must fully fit the free window including transition/travel time.',
  'Use before and after events as hard context. Suggestions must match this in-between moment.',
  'Respect time-of-day and likely venue reality (avoid suggestions that are implausible for the hour).',
  'Prefer healthy, repeatable, habit-friendly actions unless urgency says otherwise.',
  'Prioritize deadline-sensitive to-dos and avoid duplicate/near-duplicate ideas.',
  'Keep variety: include productivity/progress and at least one mood-lifting or recovery option when space allows.',
  'Reasons must explain why this exact slot is good (before/after event fit, urgency, or weekly balance).',
];

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
  const languageInstruction = options?.language === 'de'
    ? 'Output language: German (de-DE) for all user-facing fields (title/reason).'
    : 'Output language: English (en-US) for all user-facing fields (title/reason).';
  const pendingTodos = todos
    .filter((todo) => !todo.done)
    .slice(0, 10)
    .map((todo) => {
      const explicitDuration = parseTodoExplicitDurationMin(todo);
      const estimatedDuration = explicitDuration ?? estimateTodoDurationMin(todo);
      const atomizable = isTodoAtomizable(todo, estimatedDuration);
      const durationLabel = explicitDuration
        ? `${explicitDuration} min explicit`
        : `~${estimatedDuration} min estimated`;
      const atomizableLabel = atomizable ? 'atomizable=yes' : 'atomizable=no';
      const deadlineAt = getTodoDeadlineAt(todo);
      const dueDate = getTodoDueDate(todo, options?.timeZone);
      const timingLabel = deadlineAt
        ? ` (deadline: ${new Date(deadlineAt).toLocaleString()})`
        : dueDate
          ? ` (due date: ${dueDate})`
          : '';
      return `- ${todo.title}${timingLabel} [${durationLabel}; ${atomizableLabel}]`;
    })
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
    languageInstruction,
    'Schema: {"suggestions":[{"title":string,"reason":string,"durationMin":number,"source":"todo"|"habit"|"smart"}]}',
    'Goal: propose activities and to-dos that are appropriate for this specific free-time gap.',
    ...buildCommonModeConstraintLines(),
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
  if (!allowDirectModelCalls) return [];
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
    if (!isTodoEligibleForWindow(todo, gap.startAt, gap.endAt, options?.timeZone)) continue;

    const fit = evaluateTodoWindowFit(todo, usableMin);
    if (!fit.fits) continue;

    const durationMin = fit.durationMin;
    const overdue = isTodoOverdue(todo, Date.now(), options?.timeZone);
    const deadlineAt = getTodoDeadlineAt(todo);
    const dueDate = getTodoDueDate(todo, options?.timeZone);
    const partialReason = fit.isPartial
      ? `This slot fits a ${fit.durationMin}-minute chunk of a larger task (~${fit.estimatedTotalMin} min total).`
      : undefined;
    suggestions.push({
      id: `todo_${todo.id}`,
      title,
      reason: overdue
        ? (deadlineAt
          ? 'Overdue — this task is past its deadline. Catch up on it here.'
          : 'Overdue — this task missed its due date. Catch up on it here.')
        : deadlineAt
          ? 'Deadline-aware task selected for this slot.'
          : dueDate
            ? `Due-date task eligible today (${dueDate}).`
          : partialReason ?? 'Pending task that matches this free slot.',
      durationMin,
      travelBufferMin,
      source: 'todo',
      score: 1.6 + todoDeadlineScore(todo) + (fit.isPartial ? 0.15 : 0.35),
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

// ---------------------------------------------------------------------------
// Whole-week "ultimate" planner
// ---------------------------------------------------------------------------

export type WeekPlanDayInput = {
  dayIndex: number;
  date: Date;
  label: string;
  gaps: CalendarGap[];
  busy: { title: string; startAt: Date; endAt: Date }[];
};

export type WeekPlanContext = {
  habits: Habit[];
  todos: SmartTodoItem[];
  challenges?: string[];
  defaultLocation?: LocationHint;
};

export type WeekPlanItem = {
  id: string;
  dayIndex: number;
  title: string;
  category: SmartCalendarSuggestion['category'];
  source: 'todo' | 'habit' | 'smart' | 'challenge' | 'event';
  startAt: Date;
  endAt: Date;
  durationMin: number;
  travelBufferMin: number;
  reason: string;
};

export type WeekPlanResult = {
  items: WeekPlanItem[];
  usedAi: boolean;
};

/** Rough token count: ~4 characters per token is a safe average for English + JSON. */
const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Worst-case Gemini token estimate for a single "plan my week" run. Returns the
 * combined input + output token ceiling so callers can budget cost.
 */
export const estimateWeekPlanTokenCost = (
  days: WeekPlanDayInput[],
  context: WeekPlanContext,
): { inputTokens: number; maxOutputTokens: number; totalTokens: number } => {
  const prompt = buildWeekPlanPrompt(days, context);
  const inputTokens = approxTokens(prompt);
  const totalGaps = days.reduce((sum, day) => sum + day.gaps.length, 0);
  // Each placed item costs ~60 output tokens (title + times + a reasoning sentence).
  const maxOutputTokens = Math.min(8192, Math.max(1024, totalGaps * 2 * 60));
  return { inputTokens, maxOutputTokens, totalTokens: inputTokens + maxOutputTokens };
};

const buildWeekPlanPrompt = (days: WeekPlanDayInput[], context: WeekPlanContext): string => {
  const habitLines = context.habits
    .slice(0, 16)
    .map((habit) => `- ${habit.name} (${habit.lengthMin} min, ${habit.type}, ${habit.timeOfDay}${habit.frequency ? `, ${habit.frequency}` : ''})`)
    .join('\n') || '- none';

  const todoLines = context.todos
    .filter((todo) => !todo.done)
    .slice(0, 40)
    .map((todo) => {
      const deadlineAt = getTodoDeadlineAt(todo);
      const dueDate = getTodoDueDate(todo);
      return `- ${todo.title}${deadlineAt ? ` (deadline: ${new Date(deadlineAt).toLocaleString()})` : dueDate ? ` (due date: ${dueDate})` : ''}`;
    })
    .join('\n') || '- none';

  const challengeLines = (context.challenges ?? []).slice(0, 12).map((c) => `- ${c}`).join('\n') || '- none';

  const dayLines = days.map((day) => {
    const busy = day.busy.length
      ? day.busy.map((b) => `    busy: ${b.title} ${formatTime(b.startAt)}-${formatTime(b.endAt)}`).join('\n')
      : '    busy: none';
    const gaps = day.gaps.length
      ? day.gaps.map((gap) => `    freeGap ${formatTime(gap.startAt)}-${formatTime(gap.endAt)} (${gap.durationMin} min, before: ${gap.before?.title ?? 'none'}, after: ${gap.after?.title ?? 'none'})`).join('\n')
      : '    freeGap: none';
    return `Day ${day.dayIndex} (${day.label}):\n${busy}\n${gaps}`;
  }).join('\n');

  return [
    'You are an elite personal productivity + wellbeing planner.',
    'Plan the user\'s whole week by placing to-dos, habits, challenges and smart self-care into their FREE gaps for maximum efficiency and synergy.',
    'Model each free gap as: "the user is bored in this in-between window and wants to do something meaningful now."',
    'Use the same judgement quality as instant recommendation modes (e.g. Do something now), but schedule across the week.',
    'Return ONLY valid JSON. Schema:',
    '{"items":[{"dayIndex":number,"startTime":"HH:MM","durationMin":number,"title":string,"source":"todo"|"habit"|"smart"|"challenge"|"event","reason":string}]}',
    ...buildCommonModeConstraintLines(),
    'Hard rules:',
    '- Only schedule inside the listed freeGap windows for that day; never overlap busy events.',
    '- Treat each freeGap as a flexible mini-session, not a fixed "one thing" slot: a gap can contain zero, one, or multiple items.',
    '- For EACH freeGap, apply the same realism constraints as instant modes (specific action, context fit, feasible timing, no generic filler).',
    '- Long gaps should often be split into a small sequence of complementary items (e.g., focus block + quick reset) when useful.',
    '- Act like an animator/host: if the user has open time, proactively choose attractive options so they do not have to decide.',
    '- Do NOT over-focus on todos/habits only. Add genuinely useful smart activities (and occasional events) that fit the person and timing.',
    '- If there are no urgent deadlines in a gap, default toward one concrete smart activity that prevents indecision and inactivity.',
    '- Across the whole plan, target meaningful variety: at least ~40% of placed items should be source="smart" or source="event" when feasible.',
    '- Leave realistic transit/transition buffers between items and around busy events.',
    '- Be risk-averse with transit: include a small safety margin beyond expected travel time.',
    '- Respect deadlines: place deadline-bound to-dos before their deadline.',
    '- Spread habits sensibly across the week (do not stack the same habit twice a day).',
    '- Group synergistic items (e.g. revise a lecture right before that lecture; exercise right after commuting home).',
    '- Every item MUST include a specific, motivating "reason" explaining WHY this exact time was chosen (reference the neighbouring events, deadlines or weekly balance).',
    '- Prefer filling as many gaps as is genuinely useful, but do not invent busywork.',
    '',
    'Habits:',
    habitLines,
    '',
    'Pending to-dos:',
    todoLines,
    '',
    'Active challenges:',
    challengeLines,
    '',
    `Default user coordinates: ${context.defaultLocation?.lat ?? 'unknown'}, ${context.defaultLocation?.lng ?? 'unknown'}`,
    '',
    'Week:',
    dayLines,
  ].join('\n');
};

type RawWeekPlanItem = {
  dayIndex?: number;
  startTime?: string;
  durationMin?: number;
  title?: string;
  source?: string;
  reason?: string;
};

type OccupiedSlot = { start: number; end: number };

const parseHHMM = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
};

const normalizeWeekPlanItems = (
  raw: RawWeekPlanItem[],
  days: WeekPlanDayInput[],
  context: WeekPlanContext,
): WeekPlanItem[] => {
  const byIndex = new Map(days.map((day) => [day.dayIndex, day]));
  // Track already-occupied windows per day so AI placements never collide.
  const occupied = new Map<number, { start: number; end: number }[]>();
  for (const day of days) {
    occupied.set(day.dayIndex, day.busy.map((b) => ({ start: minutesOfDay(b.startAt), end: minutesOfDay(b.endAt) })));
  }

  const items: WeekPlanItem[] = [];
  raw.forEach((entry, idx) => {
    const day = typeof entry.dayIndex === 'number' ? byIndex.get(entry.dayIndex) : undefined;
    const title = String(entry.title ?? '').trim();
    const reason = String(entry.reason ?? '').trim();
    const startMin = entry.startTime ? parseHHMM(String(entry.startTime)) : null;
    if (!day || !title || !reason || startMin == null) return;

    const duration = clampDuration(Number(entry.durationMin) || 30, 10, 240);
    const endMin = startMin + duration;

    // Must fit inside one of the day's free gaps.
    const fittingGap = day.gaps.find((gap) => {
      const gStart = minutesOfDay(gap.startAt);
      const gEnd = minutesOfDay(gap.endAt);
      return startMin >= gStart - 1 && endMin <= gEnd + 1;
    });
    if (!fittingGap) return;

    const beforeLocation: LocationHint = { title: fittingGap.before?.title, lat: fittingGap.before?.lat, lng: fittingGap.before?.lng };
    const afterLocation: LocationHint = { title: fittingGap.after?.title, lat: fittingGap.after?.lat, lng: fittingGap.after?.lng };
    const suggestionLocation: LocationHint = { title, lat: context.defaultLocation?.lat, lng: context.defaultLocation?.lng };
    const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);

    const gapStartMin = minutesOfDay(fittingGap.startAt);
    const gapEndMin = minutesOfDay(fittingGap.endAt);
    const edgeBufferMin = Math.max(ITEM_TRANSITION_BUFFER_MIN, Math.ceil(travelBufferMin / 2));
    if (startMin < gapStartMin + edgeBufferMin || endMin > gapEndMin - edgeBufferMin) return;

    const dayOccupied = occupied.get(day.dayIndex) ?? [];
    const collides = dayOccupied.some((slot) => {
      return startMin < slot.end + ITEM_TRANSITION_BUFFER_MIN
        && endMin > slot.start - ITEM_TRANSITION_BUFFER_MIN;
    });
    if (collides) return;
    dayOccupied.push({ start: startMin, end: endMin });
    occupied.set(day.dayIndex, dayOccupied);

    const startAt = new Date(day.date);
    startAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    const endAt = new Date(startAt.getTime() + duration * 60000);

    const source: WeekPlanItem['source'] = (['todo', 'habit', 'smart', 'challenge', 'event'] as const)
      .includes(entry.source as any)
      ? (entry.source as WeekPlanItem['source'])
      : 'smart';

    items.push({
      id: `weekplan_${day.dayIndex}_${idx}_${startMin}`,
      dayIndex: day.dayIndex,
      title,
      category: classifyCategory(title, source === 'todo' ? 'todo' : source === 'habit' ? 'habit' : 'smart'),
      source,
      startAt,
      endAt,
      durationMin: duration,
      travelBufferMin: computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation),
      reason,
    });
  });

  return items;
};

const minutesOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

const buildAnimatorSmartCandidate = (
  gap: CalendarGap,
): { title: string; category: SmartCalendarSuggestion['category']; baseDurationMin: number; reason: string } => {
  const startMin = minutesOfDay(gap.startAt);
  const beforeTitle = (gap.before?.title ?? '').toLowerCase();
  const afterTitle = (gap.after?.title ?? '').toLowerCase();
  const commuteLike = /(commute|travel|train|bus|drive|walk)/.test(beforeTitle) || /(commute|travel|train|bus|drive|walk)/.test(afterTitle);
  const workLike = /(work|office|meeting|lecture|class|study|deadline|project)/.test(beforeTitle) || /(work|office|meeting|lecture|class|study|deadline|project)/.test(afterTitle);

  if (startMin < 11 * 60) {
    return {
      title: commuteLike ? 'Activation walk and reset' : 'Morning activation reset',
      category: 'Exercise',
      baseDurationMin: 35,
      reason: 'Placed to create momentum early and prevent decision paralysis in this open window.',
    };
  }
  if (startMin < 16 * 60) {
    return {
      title: workLike ? 'Focused prep sprint' : 'Progress sprint with quick reset',
      category: 'Productivity',
      baseDurationMin: 40,
      reason: 'Chosen as a decisive, low-friction block to convert idle midday time into meaningful progress.',
    };
  }
  if (startMin < 20 * 60) {
    return {
      title: workLike ? 'Decompression ritual and recharge' : 'Intentional recovery block',
      category: 'Self-care',
      baseDurationMin: 35,
      reason: 'Scheduled to lower friction after daytime commitments and keep the evening from becoming unstructured.',
    };
  }
  return {
    title: 'Low-stimulation wind-down routine',
    category: 'Self-care',
    baseDurationMin: 30,
    reason: 'Picked to close the day with a concrete calming activity instead of drifting into unplanned inactivity.',
  };
};

const splitGapIntoFreeWindows = (gap: CalendarGap, occupied: OccupiedSlot[]): OccupiedSlot[] => {
  const gapStart = minutesOfDay(gap.startAt);
  const gapEnd = minutesOfDay(gap.endAt);
  if (gapEnd <= gapStart) return [];

  const relevant = occupied
    .filter((slot) => Math.max(slot.start, gapStart) < Math.min(slot.end, gapEnd))
    .sort((a, b) => a.start - b.start);

  const windows: OccupiedSlot[] = [];
  let cursor = gapStart;
  for (const slot of relevant) {
    if (slot.start > cursor) {
      windows.push({ start: cursor, end: Math.min(slot.start, gapEnd) });
    }
    cursor = Math.max(cursor, slot.end);
    if (cursor >= gapEnd) break;
  }
  if (cursor < gapEnd) {
    windows.push({ start: cursor, end: gapEnd });
  }

  return windows
    .map((window) => ({
      start: window.start + ITEM_TRANSITION_BUFFER_MIN,
      end: window.end - ITEM_TRANSITION_BUFFER_MIN,
    }))
    .filter((window) => window.end - window.start >= MIN_GAP_MINUTES);
};

const addAnimatorSmartTopUps = (
  days: WeekPlanDayInput[],
  context: WeekPlanContext,
  baseItems: WeekPlanItem[],
): WeekPlanItem[] => {
  const items = [...baseItems];
  const occupied = new Map<number, OccupiedSlot[]>();

  for (const day of days) {
    occupied.set(
      day.dayIndex,
      day.busy.map((b) => ({ start: minutesOfDay(b.startAt), end: minutesOfDay(b.endAt) })),
    );
  }

  for (const item of items) {
    const daySlots = occupied.get(item.dayIndex) ?? [];
    daySlots.push({ start: minutesOfDay(item.startAt), end: minutesOfDay(item.endAt) });
    occupied.set(item.dayIndex, daySlots);
  }

  const smartLikeCount = items.filter((item) => item.source === 'smart' || item.source === 'event').length;
  const longGapCount = days.reduce((sum, day) => sum + day.gaps.filter((gap) => gap.durationMin >= 45).length, 0);
  const targetSmartLike = Math.max(
    1,
    Math.max(Math.ceil(Math.max(3, items.length) * 0.4), Math.min(4, longGapCount)),
  );

  let toAdd = Math.max(0, targetSmartLike - smartLikeCount);
  if (toAdd <= 0) return items;

  for (const day of days) {
    if (toAdd <= 0) break;
    const daySlots = occupied.get(day.dayIndex) ?? [];

    for (const gap of day.gaps) {
      if (toAdd <= 0) break;
      const windows = splitGapIntoFreeWindows(gap, daySlots);
      if (!windows.length) continue;

      const animator = buildAnimatorSmartCandidate(gap);
      const suggestionLocation: LocationHint = {
        title: animator.title,
        lat: context.defaultLocation?.lat,
        lng: context.defaultLocation?.lng,
      };
      const beforeLocation: LocationHint = { title: gap.before?.title, lat: gap.before?.lat, lng: gap.before?.lng };
      const afterLocation: LocationHint = { title: gap.after?.title, lat: gap.after?.lat, lng: gap.after?.lng };
      const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);

      const pickedWindow = windows.find((window) => (window.end - window.start) - travelBufferMin >= 15);
      if (!pickedWindow) continue;

      const availableMin = pickedWindow.end - pickedWindow.start;
      const usableMin = availableMin - travelBufferMin;
      if (usableMin < 15) continue;

      const durationMin = clampDuration(animator.baseDurationMin, 15, usableMin);
      const startMin = pickedWindow.start + travelBufferMin;
      const endMin = startMin + durationMin;
      if (endMin > pickedWindow.end) continue;

      const startAt = new Date(day.date);
      startAt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      const endAt = new Date(day.date);
      endAt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

      const idSuffix = `${day.dayIndex}_${gap.id}_${startMin}`;
      items.push({
        id: `weekplan_animator_${idSuffix}`,
        dayIndex: day.dayIndex,
        title: animator.title,
        category: animator.category,
        source: 'smart',
        startAt,
        endAt,
        durationMin,
        travelBufferMin,
        reason: animator.reason,
      });

      daySlots.push({ start: startMin, end: endMin });
      toAdd -= 1;
      if (toAdd <= 0) break;
    }
  }

  return items.sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    return a.startAt.getTime() - b.startAt.getTime();
  });
};

/**
 * Heuristic fallback week plan used when Gemini is unavailable. Greedily packs
 * the most urgent to-dos and under-scheduled habits into the earliest gaps.
 */
const buildHeuristicWeekPlan = (days: WeekPlanDayInput[], context: WeekPlanContext): WeekPlanItem[] => {
  const items: WeekPlanItem[] = [];
  const pendingTodos = [...context.todos.filter((t) => !t.done)]
    .sort((a, b) => todoDeadlineScore(b) - todoDeadlineScore(a));
  let habitCursor = 0;
  const habitPool = context.habits.slice(0, 12);
  const usedTodoIds = new Set<string>();

  for (const day of days) {
    for (const gap of day.gaps) {
      if (gap.durationMin < MIN_GAP_MINUTES) continue;
      let remainingStartAt = new Date(gap.startAt);
      let remainingMin = gap.durationMin;
      let beforeLocation: LocationHint = { title: gap.before?.title, lat: gap.before?.lat, lng: gap.before?.lng };
      const afterLocation: LocationHint = { title: gap.after?.title, lat: gap.after?.lat, lng: gap.after?.lng };

      // A single gap may hold multiple useful items when time allows.
      for (let segmentIndex = 0; segmentIndex < 3; segmentIndex += 1) {
        if (remainingMin < MIN_GAP_MINUTES) break;

        let picked: { title: string; source: WeekPlanItem['source']; reason: string; durationMin: number } | null = null;
        const todo = pendingTodos.find((candidate) => (
          !usedTodoIds.has(candidate.id)
          && isTodoEligibleForWindow(
            candidate,
            remainingStartAt,
            new Date(remainingStartAt.getTime() + Math.min(remainingMin, 30) * 60000),
          )
        ));
        if (todo) {
          usedTodoIds.add(todo.id);
          const deadlineAt = getTodoDeadlineAt(todo);
          const dueDate = getTodoDueDate(todo);
          picked = {
            title: todo.title,
            source: 'todo',
            reason: deadlineAt
              ? `Slotted before its deadline (${new Date(deadlineAt).toLocaleString()}) while this gap is open.`
              : dueDate
                ? `Placed on its due date (${dueDate}) while this gap is open.`
                : 'Placed here to convert idle gap time into progress.',
            durationMin: 30,
          };
        } else if (habitPool.length) {
          const habit = habitPool[habitCursor % habitPool.length];
          habitCursor += 1;
          picked = {
            title: habit.name,
            source: 'habit',
            reason: `Keeps your "${habit.name}" habit on track while fitting this open window.`,
            durationMin: habit.lengthMin,
          };
        }
        if (!picked) break;

        const suggestionLocation: LocationHint = {
          title: picked.title,
          lat: context.defaultLocation?.lat,
          lng: context.defaultLocation?.lng,
        };
        const travelBufferMin = computeTravelBufferMin(beforeLocation, suggestionLocation, afterLocation);
        const usableMin = remainingMin - travelBufferMin;
        if (usableMin < 15) break;

        const duration = clampDuration(picked.durationMin, 15, usableMin);
        const startAt = new Date(remainingStartAt.getTime() + travelBufferMin * 60000);
        const endAt = new Date(startAt.getTime() + duration * 60000);

        items.push({
          id: `weekplan_heur_${day.dayIndex}_${gap.id}_${segmentIndex}`,
          dayIndex: day.dayIndex,
          title: picked.title,
          category: classifyCategory(picked.title, picked.source === 'todo' ? 'todo' : picked.source === 'habit' ? 'habit' : 'smart'),
          source: picked.source,
          startAt,
          endAt,
          durationMin: duration,
          travelBufferMin,
          reason: picked.reason,
        });

        remainingStartAt = endAt;
        remainingMin = Math.max(0, Math.round((gap.endAt.getTime() - endAt.getTime()) / 60000));
        beforeLocation = suggestionLocation;
      }
    }
  }

  return items;
};

export const planWeekWithGemini = async (
  days: WeekPlanDayInput[],
  context: WeekPlanContext,
): Promise<WeekPlanResult> => {
  if (!allowDirectModelCalls || !GEMINI_KEY) {
    const heuristicItems = buildHeuristicWeekPlan(days, context);
    return { items: addAnimatorSmartTopUps(days, context, heuristicItems), usedAi: false };
  }

  const prompt = buildWeekPlanPrompt(days, context);
  const { maxOutputTokens } = estimateWeekPlanTokenCost(days, context);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.9,
          topK: 40,
          maxOutputTokens,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!response.ok) {
      const heuristicItems = buildHeuristicWeekPlan(days, context);
      return { items: addAnimatorSmartTopUps(days, context, heuristicItems), usedAi: false };
    }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text ?? '')).join('') ?? '';
    const parsed = parseGeminiJson(text) as { items?: RawWeekPlanItem[] } | null;
    const rawItems = Array.isArray(parsed?.items) ? parsed!.items! : [];
    const items = normalizeWeekPlanItems(rawItems, days, context);
    if (!items.length) {
      const heuristicItems = buildHeuristicWeekPlan(days, context);
      return { items: addAnimatorSmartTopUps(days, context, heuristicItems), usedAi: false };
    }
    return { items: addAnimatorSmartTopUps(days, context, items), usedAi: true };
  } catch {
    const heuristicItems = buildHeuristicWeekPlan(days, context);
    return { items: addAnimatorSmartTopUps(days, context, heuristicItems), usedAi: false };
  } finally {
    clearTimeout(timeoutId);
  }
};
