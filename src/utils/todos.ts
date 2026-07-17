import { SmartTodoItem } from '../types';
import { getTimeZoneParts } from './time';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateKey = (year: number, month: number, day: number): string => {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const getLocalDateKey = (date: Date, timeZone?: string | null): string => {
  const parts = getTimeZoneParts(date, timeZone);
  return toDateKey(parts.year, parts.month, parts.day);
};

export const getTodoDueDate = (todo: SmartTodoItem, timeZone?: string | null): string | null => {
  const explicitDueDate = String(todo.dueDate ?? '').trim();
  if (DATE_KEY_RE.test(explicitDueDate)) return explicitDueDate;

  if (!todo.deadlineAt || todo.hasFixedSchedule) return null;
  const parsed = new Date(todo.deadlineAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return getLocalDateKey(parsed, timeZone);
};

export const getTodoDeadlineAt = (todo: SmartTodoItem): string | null => {
  if (!todo.deadlineAt) return null;
  if (!todo.hasFixedSchedule && getTodoDueDate(todo) != null) return null;
  const deadlineMs = new Date(todo.deadlineAt).getTime();
  if (Number.isNaN(deadlineMs)) return null;
  return todo.deadlineAt;
};

export const isTodoEligibleForWindow = (
  todo: SmartTodoItem,
  startAt: Date,
  endAt: Date,
  timeZone?: string | null,
): boolean => {
  if (todo.done) return false;

  const deadlineAt = getTodoDeadlineAt(todo);
  if (deadlineAt) {
    const deadlineMs = new Date(deadlineAt).getTime();
    if (!Number.isNaN(deadlineMs) && endAt.getTime() > deadlineMs) return false;
  }

  const dueDate = getTodoDueDate(todo, timeZone);
  if (!dueDate) return true;
  return getLocalDateKey(startAt, timeZone) >= dueDate;
};

export const getTodoUrgencyScore = (
  todo: SmartTodoItem,
  now: Date = new Date(),
  timeZone?: string | null,
): number => {
  const deadlineAt = getTodoDeadlineAt(todo);
  if (deadlineAt) {
    const deadlineMs = new Date(deadlineAt).getTime();
    if (Number.isNaN(deadlineMs)) return 0.2;
    const deltaHours = (deadlineMs - now.getTime()) / 3600000;
    if (deltaHours <= 0) return 2.2;
    if (deltaHours <= 24) return 1.8;
    if (deltaHours <= 72) return 1.2;
    return 0.6;
  }

  const dueDate = getTodoDueDate(todo, timeZone);
  if (!dueDate) return 0.2;

  const todayKey = getLocalDateKey(now, timeZone);
  if (todayKey > dueDate) return 2;
  if (todayKey === dueDate) return 1.1;
  return 0.2;
};

/**
 * A to-do is overdue when its true deadline timestamp has passed or its due-date day
 * is already behind the current local day. This intentionally ignores `scheduledAt`.
 */
export const isTodoOverdue = (
  todo: SmartTodoItem,
  now: number = Date.now(),
  timeZone?: string | null,
): boolean => {
  if (todo.done) return false;

  const deadlineAt = getTodoDeadlineAt(todo);
  if (deadlineAt) {
    const deadlineMs = new Date(deadlineAt).getTime();
    if (!Number.isNaN(deadlineMs)) return deadlineMs < now;
  }

  const dueDate = getTodoDueDate(todo, timeZone);
  if (!dueDate) return false;
  return getLocalDateKey(new Date(now), timeZone) > dueDate;
};
