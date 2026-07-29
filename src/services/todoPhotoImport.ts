import { generateJsonWithFirebaseAiLogic } from './firebaseAiLogic';

export type TodoPhotoImportItem = {
  title: string;
  notes?: string;
  deadlineAt?: string | null;
  dueDate?: string | null;
  dueText?: string;
};

type GeminiTodoItem = {
  title?: string;
  notes?: string;
  dueAt?: string | null;
  dueText?: string | null;
};

type GeminiTodoPayload = {
  todos?: GeminiTodoItem[];
};

const isDevBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const allowDirectModelCalls = isDevBuild
  || String((globalThis as any).process?.env?.EXPO_PUBLIC_ALLOW_DIRECT_MODEL_CALLS ?? '').toLowerCase() === 'true';
const GEMINI_MODELS = ['gemini-3.6-flash'];
const MAX_IMPORTED_TODOS = 20;

const toDateKey = (value?: string | null): string | null => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};

const normalizeTodoTitleKey = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const to24Hour = (hourRaw: number, meridiem?: string): number => {
  const boundedHour = Math.max(0, Math.min(23, hourRaw));
  if (!meridiem) return boundedHour;

  const normalized = meridiem.toLowerCase();
  if (normalized === 'am') {
    return hourRaw === 12 ? 0 : boundedHour;
  }
  if (normalized === 'pm') {
    return hourRaw === 12 ? 12 : Math.max(0, Math.min(23, hourRaw + 12));
  }
  return boundedHour;
};

const hasExplicitYear = (value?: string | null): boolean => {
  const input = String(value ?? '').trim();
  if (!input) return false;
  return /(19|20)\d{2}|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(input);
};

const isIsoLikeDateString = (value?: string | null): boolean => {
  const input = String(value ?? '').trim();
  if (!input) return false;
  return /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}(?:[T\s].*)?$/.test(input);
};

const normalizeImplicitYear = (
  isoValue: string | null,
  evidenceText?: string | null,
): string | null => {
  if (!isoValue) return null;
  if (hasExplicitYear(evidenceText)) return isoValue;

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return null;

  const now = new Date();
  let year = now.getFullYear();
  const rebuilt = new Date(
    year,
    parsed.getMonth(),
    parsed.getDate(),
    parsed.getHours(),
    parsed.getMinutes(),
    parsed.getSeconds(),
    parsed.getMilliseconds(),
  );

  if (Number.isNaN(rebuilt.getTime())) return isoValue;

  if (rebuilt.getTime() < Date.now() - (24 * 60 * 60 * 1000)) {
    year += 1;
    rebuilt.setFullYear(year);
  }

  return rebuilt.toISOString();
};

const parseDueTextFallback = (value?: string | null): string | null => {
  const input = String(value ?? '').trim();
  if (!input) return null;

  const hasExplicitTime = /(?:\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?|\d{1,2}\s*[AaPp][Mm]|\d{1,2}\s*[Hh](?:\s|$))/.test(input);
  if (!hasExplicitTime) return null;

  const isoLike = /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[\s,T]+(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/;
  const euroLike = /(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:[\s,T]+(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/;
  const timeOnlyLike = /(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/;

  const fromParts = (
    year: number,
    month: number,
    day: number,
    hour?: number,
    minute?: number,
  ): string | null => {
    const parsed = new Date(
      year,
      month - 1,
      day,
      Number.isFinite(hour) ? Number(hour) : 0,
      Number.isFinite(minute) ? Number(minute) : 0,
      0,
      0,
    );
    if (
      Number.isNaN(parsed.getTime())
      || parsed.getFullYear() !== year
      || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day
    ) {
      return null;
    }
    return parsed.toISOString();
  };

  const isoMatch = isoLike.exec(input);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const hour = isoMatch[4] ? to24Hour(Number(isoMatch[4]), isoMatch[6]) : undefined;
    const minute = isoMatch[5] ? Number(isoMatch[5]) : undefined;
    return fromParts(year, month, day, hour, minute);
  }

  const euroMatch = euroLike.exec(input);
  if (euroMatch) {
    const day = Number(euroMatch[1]);
    const month = Number(euroMatch[2]);
    const now = new Date();
    const yearRaw = euroMatch[3] ? Number(euroMatch[3]) : now.getFullYear();
    let year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const hour = euroMatch[4] ? to24Hour(Number(euroMatch[4]), euroMatch[6]) : undefined;
    const minute = euroMatch[5] ? Number(euroMatch[5]) : undefined;
    let parsed = fromParts(year, month, day, hour, minute);
    if (!euroMatch[3] && parsed) {
      const parsedMs = new Date(parsed).getTime();
      const yesterdayMs = Date.now() - (24 * 60 * 60 * 1000);
      if (parsedMs < yesterdayMs) {
        year += 1;
        parsed = fromParts(year, month, day, hour, minute);
      }
    }
    if (parsed) return parsed;
  }

  const timeOnlyMatch = timeOnlyLike.exec(input);
  if (timeOnlyMatch) {
    const now = new Date();
    const hour = to24Hour(Number(timeOnlyMatch[1]), timeOnlyMatch[3]);
    const minute = timeOnlyMatch[2] ? Number(timeOnlyMatch[2]) : 0;
    const parsed = fromParts(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
      hour,
      minute,
    );
    if (parsed) return parsed;
  }

  const normalizedInput = input.replace(/(\d{1,2})\s*[Hh]\b/g, '$1:00');
  const parsed = new Date(normalizedInput);
  if (!Number.isNaN(parsed.getTime())) return normalizeImplicitYear(parsed.toISOString(), input);
  return null;
};

const normalizeDeadline = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const hasExplicitTime = /(?:T\d{2}:\d{2}|\s\d{1,2}:\d{2}|\d{1,2}\s*[AaPp][Mm]|\d{1,2}\s*[Hh](?:\s|$))/.test(trimmed);
  return hasExplicitTime ? parsed.toISOString() : null;
};

const parseJsonPayload = (text: string): GeminiTodoPayload | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const attempts = [
    withoutFence,
    (withoutFence.match(/\{[\s\S]*\}/m) || [])[0],
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as GeminiTodoPayload;
    } catch {
      // Try next candidate
    }
  }

  return null;
};

const normalizeTodos = (payload: GeminiTodoPayload | null): TodoPhotoImportItem[] => {
  const seenTitles = new Set<string>();

  return (payload?.todos ?? [])
    .map((todo) => {
      const title = String(todo.title ?? '').trim();
      const notes = String(todo.notes ?? '').trim();
      const dueText = String(todo.dueText ?? '').trim();
      const dueAtRaw = String(todo.dueAt ?? '').trim();
      const implicitYearEvidence = [
        dueText,
        title,
        notes,
        isIsoLikeDateString(dueAtRaw) ? '' : dueAtRaw,
      ]
        .filter((part) => part.trim().length > 0)
        .join(' ');
      const dueAt = normalizeImplicitYear(normalizeDeadline(dueAtRaw || null), implicitYearEvidence);
      const dueFromDueAtText = dueAt ? null : normalizeImplicitYear(parseDueTextFallback(dueAtRaw || null), implicitYearEvidence);
      const combinedDueText = [dueText, title, notes]
        .filter((part) => part.trim().length > 0)
        .join(' ');
      const dueFromCombinedText = (dueAt || dueFromDueAtText)
        ? null
        : normalizeImplicitYear(parseDueTextFallback(combinedDueText), combinedDueText);
      return {
        title,
        notes: notes || undefined,
        deadlineAt: dueAt,
        dueDate: dueAt ? null : toDateKey(dueFromDueAtText ?? dueFromCombinedText),
        dueText: dueText || undefined,
      };
    })
    .filter((todo) => {
      if (!todo.title) return false;
      const key = normalizeTodoTitleKey(todo.title);
      if (!key) return false;
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0, MAX_IMPORTED_TODOS);
};

const buildPrompt = (): string => [
  'Extract every TODO item from this photo.',
  'Return only JSON with this exact schema:',
  '{"todos":[{"title":"string","notes":"string|null","dueAt":"ISO datetime|null","dueText":"string|null"}]}',
  'Rules:',
  '- Do not include markdown or explanations.',
  '- Keep titles short and actionable.',
  '- If exact date and time are visible, set dueAt using full ISO datetime.',
  '- If only date is visible without a time, keep dueAt null and put the raw text in dueText.',
  '- If only time is visible and date is unknown, keep dueAt null and fill dueText.',
  '- If no due date is visible, set both dueAt and dueText to null.',
  '- Never invent midnight when a time is missing.',
  '- Ignore non-task decorative text.',
].join('\n');

const callGeminiTodoVision = async (imageBase64: string, mimeType: string): Promise<TodoPhotoImportItem[]> => {
  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      const text = await generateJsonWithFirebaseAiLogic({
        prompt: buildPrompt(),
        model,
        temperature: 0.1,
        maxOutputTokens: 1600,
        timeoutMs: 25000,
        image: {
          mimeType,
          data: imageBase64,
        },
      });
      const parsed = parseJsonPayload(text);
      const todos = normalizeTodos(parsed);
      if (todos.length > 0) return todos;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Failed to extract todos from photo.');
    }
  }

  if (lastError) throw lastError;
  return [];
};

export const importTodosFromPhoto = async (
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<TodoPhotoImportItem[]> => {
  if (!allowDirectModelCalls) {
    throw new Error('Direct model calls are disabled. Use secured backend inference for photo import.');
  }
  if (!imageBase64?.trim()) {
    return [];
  }

  return callGeminiTodoVision(imageBase64, mimeType);
};
