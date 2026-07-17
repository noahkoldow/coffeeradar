import { SmartTodoItem } from '../types';

const TODO_MIN_CHUNK_MIN = 15;
const TODO_PREFERRED_CHUNK_MAX_MIN = 45;

const NON_ATOMIZABLE_RE = /\b(meeting|appointment|doctor|dentist|therapy|interview|exam|flight|train|bus|wedding|birthday|date night|webinar|class at|pickup|drop.?off|reservation|attend)\b/i;
const ATOMIZABLE_RE = /\b(write|draft|study|learn|research|review|revise|read|organize|clean|declutter|code|refactor|plan|prepare|outline|practice|exercise|workout|edit|email|inbox|documentation|project|report|analysis)\b/i;

const clampRounded = (value: number, min: number, max: number, step = 5): number => {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value / step) * step;
  return Math.max(min, Math.min(max, rounded));
};

export const parseTodoExplicitDurationMin = (todo: SmartTodoItem): number | null => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  if (!text.trim()) return null;

  const hourMinuteMatch = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d{1,2})?\s*(?:m|min|mins|minute|minutes)?/.exec(text);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const mins = Number(hourMinuteMatch[2] ?? 0);
    if (Number.isFinite(hours) && Number.isFinite(mins)) {
      return clampRounded(hours * 60 + mins, TODO_MIN_CHUNK_MIN, 8 * 60);
    }
  }

  const minuteMatch = /(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/.exec(text);
  if (minuteMatch) {
    const mins = Number(minuteMatch[1]);
    if (Number.isFinite(mins)) {
      return clampRounded(mins, TODO_MIN_CHUNK_MIN, 8 * 60);
    }
  }

  return null;
};

export const estimateTodoDurationMin = (todo: SmartTodoItem): number => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  if (/quick|brief|tiny|short|email|reply|call|confirm|book/.test(text)) return 20;
  if (/deep|project|report|presentation|refactor|research|analy/.test(text)) return 90;
  if (/clean|organize|study|prepare|write|review|exercise|workout/.test(text)) return 60;
  return 40;
};

export const isTodoAtomizable = (todo: SmartTodoItem, estimatedDurationMin?: number): boolean => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.trim();
  if (!text) return false;
  if (NON_ATOMIZABLE_RE.test(text)) return false;
  if (ATOMIZABLE_RE.test(text)) return true;

  const explicitDurationMin = parseTodoExplicitDurationMin(todo);
  const totalMin = explicitDurationMin ?? estimatedDurationMin ?? estimateTodoDurationMin(todo);
  return totalMin >= 60;
};

export type TodoWindowFit = {
  fits: boolean;
  isPartial: boolean;
  durationMin: number;
  estimatedTotalMin: number;
  explicitDurationMin: number | null;
  atomizable: boolean;
  minChunkMin: number;
};

export const evaluateTodoWindowFit = (todo: SmartTodoItem, windowDurationMin: number): TodoWindowFit => {
  const explicitDurationMin = parseTodoExplicitDurationMin(todo);
  const estimatedTotalMin = explicitDurationMin ?? estimateTodoDurationMin(todo);
  const atomizable = isTodoAtomizable(todo, estimatedTotalMin);
  const safeWindowMin = Math.max(0, Math.round(windowDurationMin));

  if (safeWindowMin < TODO_MIN_CHUNK_MIN) {
    return {
      fits: false,
      isPartial: false,
      durationMin: 0,
      estimatedTotalMin,
      explicitDurationMin,
      atomizable,
      minChunkMin: TODO_MIN_CHUNK_MIN,
    };
  }

  if (estimatedTotalMin <= safeWindowMin) {
    return {
      fits: true,
      isPartial: false,
      durationMin: clampRounded(estimatedTotalMin, TODO_MIN_CHUNK_MIN, safeWindowMin),
      estimatedTotalMin,
      explicitDurationMin,
      atomizable,
      minChunkMin: TODO_MIN_CHUNK_MIN,
    };
  }

  if (!atomizable) {
    return {
      fits: false,
      isPartial: false,
      durationMin: 0,
      estimatedTotalMin,
      explicitDurationMin,
      atomizable,
      minChunkMin: TODO_MIN_CHUNK_MIN,
    };
  }

  const preferredChunkMin = clampRounded(
    Math.min(TODO_PREFERRED_CHUNK_MAX_MIN, Math.max(TODO_MIN_CHUNK_MIN, estimatedTotalMin * 0.5)),
    TODO_MIN_CHUNK_MIN,
    safeWindowMin,
  );

  return {
    fits: true,
    isPartial: true,
    durationMin: preferredChunkMin,
    estimatedTotalMin,
    explicitDurationMin,
    atomizable,
    minChunkMin: TODO_MIN_CHUNK_MIN,
  };
};

const resolveAtomizedTotalMin = (todo: SmartTodoItem): number | null => {
  const stored = Number(todo.atomizedTotalMin);
  if (Number.isFinite(stored) && stored > 0) {
    return clampRounded(stored, TODO_MIN_CHUNK_MIN, 8 * 60);
  }

  const explicit = parseTodoExplicitDurationMin(todo);
  const estimated = explicit ?? estimateTodoDurationMin(todo);
  if (!isTodoAtomizable(todo, estimated)) return null;
  return clampRounded(estimated, TODO_MIN_CHUNK_MIN, 8 * 60);
};

export type TodoAtomizedProgress = {
  isAtomized: boolean;
  totalMin: number | null;
  progressMin: number;
  remainingMin: number;
};

export const getTodoAtomizedProgress = (todo: SmartTodoItem): TodoAtomizedProgress => {
  const totalMin = resolveAtomizedTotalMin(todo);
  if (totalMin == null) {
    return {
      isAtomized: false,
      totalMin: null,
      progressMin: 0,
      remainingMin: 0,
    };
  }

  const storedProgress = Number(todo.atomizedProgressMin ?? 0);
  const progressMin = Number.isFinite(storedProgress)
    ? Math.max(0, Math.min(totalMin, Math.round(storedProgress)))
    : 0;

  return {
    isAtomized: true,
    totalMin,
    progressMin,
    remainingMin: Math.max(0, totalMin - progressMin),
  };
};

export type TodoChunkCompletionResult = {
  todo: SmartTodoItem;
  usedAtomizedProgress: boolean;
  completedChunkMin: number;
  progressMin: number;
  totalMin: number | null;
  remainingMin: number;
  becameDone: boolean;
};

export const applyTodoChunkCompletion = (todo: SmartTodoItem, chunkDurationMin?: number): TodoChunkCompletionResult => {
  const progress = getTodoAtomizedProgress(todo);
  if (!progress.isAtomized || progress.totalMin == null) {
    return {
      todo: {
        ...todo,
        done: true,
      },
      usedAtomizedProgress: false,
      completedChunkMin: 0,
      progressMin: 0,
      totalMin: null,
      remainingMin: 0,
      becameDone: true,
    };
  }

  const totalMin = progress.totalMin;
  const remainingBefore = Math.max(0, totalMin - progress.progressMin);
  if (remainingBefore <= 0) {
    return {
      todo: {
        ...todo,
        atomizedTotalMin: totalMin,
        atomizedProgressMin: totalMin,
        done: true,
      },
      usedAtomizedProgress: true,
      completedChunkMin: 0,
      progressMin: totalMin,
      totalMin,
      remainingMin: 0,
      becameDone: true,
    };
  }

  const requestedChunk = Number(chunkDurationMin);
  const fallbackChunk = Math.min(
    TODO_PREFERRED_CHUNK_MAX_MIN,
    Math.max(TODO_MIN_CHUNK_MIN, Math.round(totalMin * 0.35)),
  );
  const unclampedChunk = Number.isFinite(requestedChunk) && requestedChunk > 0
    ? Math.round(requestedChunk)
    : fallbackChunk;
  const completedChunkMin = remainingBefore <= TODO_MIN_CHUNK_MIN
    ? remainingBefore
    : clampRounded(unclampedChunk, TODO_MIN_CHUNK_MIN, remainingBefore);

  const nextProgress = Math.max(0, Math.min(totalMin, progress.progressMin + completedChunkMin));
  const remainingMin = Math.max(0, totalMin - nextProgress);
  const becameDone = remainingMin === 0;

  return {
    todo: {
      ...todo,
      atomizedTotalMin: totalMin,
      atomizedProgressMin: nextProgress,
      done: becameDone,
    },
    usedAtomizedProgress: true,
    completedChunkMin,
    progressMin: nextProgress,
    totalMin,
    remainingMin,
    becameDone,
  };
};