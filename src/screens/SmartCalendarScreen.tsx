import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SwipeDeck, SwipeDeckHandle } from '../components/SwipeDeck';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { createPlanEvent, deletePlanEvent, getUpcomingEvents } from '../services/calendar';
import { CalendarBlock, CalendarGap, DAY_END_HOUR, DAY_START_HOUR, SmartCalendarSuggestion, buildGapSuggestions, findCalendarGaps } from '../services/smartCalendar';
import { importTodosFromPhoto } from '../services/todoPhotoImport';
import { Commitment, DeckSuggestion, ScheduledActivity, SmartTodoItem } from '../types';
import { formatClockMinutes, formatTime } from '../utils/time';

type Props = StackScreenProps<RootStackParamList, 'SmartCalendar'>;

type DayColumn = {
  id: string;
  date: Date;
  label: string;
  allDayBlocks: CalendarBlock[];
  blocks: CalendarBlock[];
  gaps: CalendarGap[];
  timelineStartMin: number;
  timelineEndMin: number;
};

const DAYS_TO_SHOW = 7;
const DAY_TIMELINE_VIEWPORT_HEIGHT = 260;
const DAY_COLUMN_WIDTH = 280;
const DAY_COLUMN_GAP = 0;
const DAY_COLUMN_PADDING_HORIZONTAL = 12;
const TIMELINE_HORIZONTAL_INSET = 6;
const TIMELINE_VERTICAL_INSET = TIMELINE_HORIZONTAL_INSET;
const TIMELINE_LANE_GAP = 4;
const EVENT_TITLE_LINE_HEIGHT = 14;
const EVENT_TIME_LINE_HEIGHT = 13;
const EVENT_VERTICAL_PADDING = 8;
const GAP_MIN_HEIGHT = 40;
const BASE_PX_PER_MINUTE = 0.45;
const HOUR_SEPARATOR_WIDTH = 8;
const HOUR_AXIS_LABEL_WIDTH = 28;
const HOUR_SEPARATOR_LABEL_OFFSET_MIN = 70;
const ALL_DAY_CHIP_ESTIMATED_HEIGHT = 24;
const ALL_DAY_CHIP_GAP = 4;
const GAP_CACHE_KEY = 'smart_calendar_gap_cache_v1';

type SmartSuggestionDeckEntry = {
  suggestion: SmartCalendarSuggestion;
  deck: DeckSuggestion;
};

type StoredGapCache = Record<string, Array<Omit<SmartCalendarSuggestion, 'id'> & { id?: string }>>;
const PREMIUM_GENERATION_SPEED_FACTOR = 0.9;
const SMART_CALENDAR_DECK_COLORS = { bg: '#B5EAD7', text: '#1A4A3A' };
const SMART_TODO_DEFAULT_DURATION_MIN = 30;
const SMART_TODO_MAX_CANDIDATE_SLOTS = 24;
const SMART_TODO_GEMINI_MODEL = 'gemini-2.5-flash-lite';
const SMART_TODO_GEMINI_KEY = (globalThis as any).process?.env?.EXPO_PUBLIC_GEMINI_API_KEY as string | undefined;

const normalizeTodoTitleKey = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const mergeTodoNotesWithDueText = (
  notes?: string,
  dueText?: string,
  deadlineAt?: string | null,
): string | undefined => {
  const trimmedNotes = String(notes ?? '').trim();
  const trimmedDueText = String(dueText ?? '').trim();
  if (!trimmedDueText || !!deadlineAt) return trimmedNotes || undefined;

  if (!trimmedNotes) return `Due: ${trimmedDueText}`;
  if (trimmedNotes.toLowerCase().includes(trimmedDueText.toLowerCase())) return trimmedNotes;
  return `${trimmedNotes}\nDue: ${trimmedDueText}`;
};

const extractTodoDueHint = (notes?: string): string | null => {
  if (!notes) return null;
  const line = notes
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith('due:'));
  return line || null;
};

type TodoScheduleMode = 'manual' | 'smart';

type TodoCandidateSlot = {
  id: string;
  dayId: string;
  dayLabel: string;
  startAt: Date;
  endAt: Date;
  durationMin: number;
  beforeTitle?: string;
  afterTitle?: string;
};

type RankedTodoSlot = {
  id: string;
  rank: 1 | 2 | 3;
  reason: string;
  slot: TodoCandidateSlot;
  suggestedStartAt: Date;
  suggestedEndAt: Date;
};

type ManualPreviewState = {
  gapId: string;
  label: string;
  topOffset: number;
  startAt: Date;
  durationMin: number;
};

type FutureGapWindow = {
  startAt: Date;
  endAt: Date;
  durationMin: number;
};

type TodoSchedulingContext = {
  isSocialCall: boolean;
  avoidBeforeMin: number;
  preferredStartMin: number;
  preferredEndMin: number;
  hoursToDeadline: number | null;
};

const SOCIAL_CALL_INTENT_RE = /\b(call|phone|facetime|video\s*call|ring|chat|catch\s*up|talk)\b/i;
const PERSONAL_RELATION_RE = /\b(mum|mom|mother|dad|father|parent|brother|sister|grandma|grandpa|friend|family)\b/i;

const overlapMinutes = (aStart: number, aEnd: number, bStart: number, bEnd: number): number => {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
};

const resolveTodoSchedulingContext = (todo: SmartTodoItem): TodoSchedulingContext => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  const isSocialCall = SOCIAL_CALL_INTENT_RE.test(text) && PERSONAL_RELATION_RE.test(text);

  const deadlineMs = todo.deadlineAt ? new Date(todo.deadlineAt).getTime() : Number.NaN;
  const hasDeadline = Number.isFinite(deadlineMs);
  const hoursToDeadline = hasDeadline ? (deadlineMs - Date.now()) / 3600000 : null;

  let avoidBeforeMin = isSocialCall ? 9 * 60 : 8 * 60;
  let preferredStartMin = isSocialCall ? 10 * 60 : 9 * 60;
  let preferredEndMin = isSocialCall ? 21 * 60 : 20 * 60;

  // When deadlines are near, keep flexibility and reduce time-of-day penalties.
  if (hoursToDeadline != null && hoursToDeadline <= 8) {
    avoidBeforeMin = 7 * 60;
    preferredStartMin = 8 * 60;
    preferredEndMin = 22 * 60;
  }

  return {
    isSocialCall,
    avoidBeforeMin,
    preferredStartMin,
    preferredEndMin,
    hoursToDeadline,
  };
};

const computeTodoCandidateScore = (
  slot: TodoCandidateSlot,
  context: TodoSchedulingContext,
  now: Date,
): number => {
  const startMin = minuteOfDay(slot.startAt);
  const endMin = minuteOfDay(slot.endAt);
  const hoursFromNow = Math.max(0, (slot.startAt.getTime() - now.getTime()) / 3600000);

  let score = 0;
  score -= hoursFromNow * 0.04;

  const preferredOverlapMin = overlapMinutes(
    startMin,
    endMin,
    context.preferredStartMin,
    context.preferredEndMin,
  );
  score += (preferredOverlapMin / 60) * 1.25;

  if (startMin < context.avoidBeforeMin) {
    score -= context.isSocialCall ? 2.2 : 0.8;
  }

  if (context.hoursToDeadline != null) {
    if (context.hoursToDeadline <= 6) {
      score += Math.max(0, 1.8 - hoursFromNow * 0.2);
    } else if (context.hoursToDeadline <= 24) {
      score += Math.max(0, 1.2 - hoursFromNow * 0.08);
    }
  }

  return score;
};

const prioritizeTodoCandidateSlots = (
  slots: TodoCandidateSlot[],
  context: TodoSchedulingContext,
  now: Date,
): TodoCandidateSlot[] => {
  return slots
    .map((slot, idx) => ({ slot, idx, score: computeTodoCandidateScore(slot, context, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    })
    .map((entry) => entry.slot);
};

const clampOffsetForTodoContext = (
  slot: TodoCandidateSlot,
  durationMin: number,
  requestedOffsetMin: number,
  context: TodoSchedulingContext,
): number => {
  if (context.hoursToDeadline != null && context.hoursToDeadline <= 8) {
    return requestedOffsetMin;
  }

  const slotStartMin = minuteOfDay(slot.startAt);
  const slotEndMin = slotStartMin + slot.durationMin;
  const maxOffset = Math.max(0, slot.durationMin - durationMin);

  if (slotStartMin >= context.avoidBeforeMin || slotEndMin <= context.avoidBeforeMin) {
    return Math.max(0, Math.min(maxOffset, requestedOffsetMin));
  }

  const minOffsetToAvoidEarly = Math.max(0, context.avoidBeforeMin - slotStartMin);
  const normalizedRequested = Math.max(0, Math.min(maxOffset, requestedOffsetMin));
  return Math.max(normalizedRequested, Math.min(maxOffset, snapMinutesToGrid(minOffsetToAvoidEarly, 5)));
};

const formatMinuteLabel = (minute: number, timeZone?: string | null): string => {
  const safeMinute = Math.max(0, Math.min(24 * 60 - 1, minute));
  return formatClockMinutes(safeMinute, timeZone);
};

const parseHourMinute = (value: string | undefined, fallbackHour: number): number => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return fallbackHour * 60;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallbackHour * 60;
  return Math.max(0, Math.min(24 * 60, hour * 60 + minute));
};

const minuteOfDay = (date: Date): number => date.getHours() * 60 + date.getMinutes();

const isSameDay = (a: Date, b: Date): boolean => (
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate()
);

const parseGapIdentity = (gap: CalendarGap): { dayId: string; idx: number } => {
  const match = /^gap_(\d{4}-\d{2}-\d{2})_(\d+)$/.exec(gap.id);
  return {
    dayId: match?.[1] ?? gap.startAt.toISOString().slice(0, 10),
    idx: Number(match?.[2] ?? 0),
  };
};

const gapCacheKey = (gap: CalendarGap): string => {
  const identity = parseGapIdentity(gap);
  return `${identity.dayId}_${identity.idx}`;
};

const gapBatchCacheKey = (gap: CalendarGap, batchIndex: number): string => {
  return `${gapCacheKey(gap)}::${batchIndex}`;
};

const aiCountForBatch = (batchIndex: number): number => {
  if (batchIndex <= 0) return 3;
  if (batchIndex === 1) return 2;
  if (batchIndex === 2) return 1;
  return 0;
};

const normalizeDeckType = (category: SmartCalendarSuggestion['category']): DeckSuggestion['type'] => {
  if (category === 'Exercise') return 'GO_OUT';
  return 'AT_HOME';
};

const toTagColor = (category: SmartCalendarSuggestion['category']) => {
  if (category === 'Exercise') return { bg: '#DFF4EA', text: '#1D5A3A' };
  if (category === 'Productivity') return { bg: '#CFECDD', text: '#1E5A3E' };
  return { bg: '#EAF6EF', text: '#2A6B4A' };
};

type DaySegment = {
  id: string;
  kind: 'event' | 'gap';
  startAt: Date;
  endAt: Date;
  durationMin: number;
  block?: CalendarBlock;
  gap?: CalendarGap;
};

type EventLaneMeta = {
  laneIndex: number;
  laneCount: number;
};

const segmentTrackWidth =
  DAY_COLUMN_WIDTH - (DAY_COLUMN_PADDING_HORIZONTAL * 2) - (TIMELINE_HORIZONTAL_INSET * 2);

const estimateEventMinHeight = (title: string, laneCount: number): number => {
  const safeLaneCount = Math.max(1, laneCount);
  const laneWidth = (segmentTrackWidth - TIMELINE_LANE_GAP * (safeLaneCount - 1)) / safeLaneCount;
  const textWidth = Math.max(36, laneWidth - 16);
  const charsPerLine = Math.max(8, Math.floor(textWidth / 6.6));
  const estimatedTitleLines = Math.max(1, Math.ceil((title || '').trim().length / charsPerLine));
  return EVENT_VERTICAL_PADDING * 2 + estimatedTitleLines * EVENT_TITLE_LINE_HEIGHT + EVENT_TIME_LINE_HEIGHT + 4;
};

const minSegmentHeight = (segment: DaySegment, laneMeta?: EventLaneMeta): number => {
  if (segment.kind === 'event' && segment.block) {
    return estimateEventMinHeight(segment.block.title, laneMeta?.laneCount ?? 1);
  }
  return GAP_MIN_HEIGHT;
};

const resolveEventLanes = (column: DayColumn): Record<string, EventLaneMeta> => {
  const events = column.blocks
    .filter((block) => !block.allDay)
    .map((block) => ({
      id: `event_${block.id}`,
      startMin: minuteOfDay(block.startAt),
      endMin: Math.max(minuteOfDay(block.startAt) + 1, minuteOfDay(block.endAt)),
    }))
    .sort((a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      return a.endMin - b.endMin;
    });

  const laneMap: Record<string, { laneIndex: number; clusterId: number }> = {};
  const clusterMaxLanes: Record<number, number> = {};
  const active: Array<{ id: string; endMin: number; laneIndex: number }> = [];
  let clusterSeq = 0;
  let currentClusterId = 0;

  for (const event of events) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].endMin <= event.startMin) {
        active.splice(i, 1);
      }
    }

    if (active.length === 0) {
      clusterSeq += 1;
      currentClusterId = clusterSeq;
      clusterMaxLanes[currentClusterId] = 0;
    }

    const usedLanes = new Set(active.map((item) => item.laneIndex));
    let laneIndex = 0;
    while (usedLanes.has(laneIndex)) laneIndex += 1;

    active.push({ id: event.id, endMin: event.endMin, laneIndex });
    laneMap[event.id] = { laneIndex, clusterId: currentClusterId };
    clusterMaxLanes[currentClusterId] = Math.max(clusterMaxLanes[currentClusterId], active.length);
  }

  const resolved: Record<string, EventLaneMeta> = {};
  for (const [eventId, lane] of Object.entries(laneMap)) {
    resolved[eventId] = {
      laneIndex: lane.laneIndex,
      laneCount: clusterMaxLanes[lane.clusterId] ?? 1,
    };
  }

  return resolved;
};

const buildTimelineSegments = (column: DayColumn): DaySegment[] => {
  const segments: DaySegment[] = [
    ...column.blocks.filter((block) => !block.allDay).map((block) => ({
      id: `event_${block.id}`,
      kind: 'event' as const,
      startAt: block.startAt,
      endAt: block.endAt,
      durationMin: Math.max(1, Math.round((block.endAt.getTime() - block.startAt.getTime()) / 60000)),
      block,
    })),
    ...column.gaps.map((gap) => ({
      id: `gap_${gap.id}`,
      kind: 'gap' as const,
      startAt: gap.startAt,
      endAt: gap.endAt,
      durationMin: gap.durationMin,
      gap,
    })),
  ];

  return segments.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
};

const computeTodoDurationMin = (todo: SmartTodoItem, availableDurationMin: number): number => {
  const desired = SMART_TODO_DEFAULT_DURATION_MIN;
  const hardMax = Math.max(15, availableDurationMin);
  return Math.max(15, Math.min(desired, hardMax));
};

const normalizeTodoDurationMin = (value: number, fallback = SMART_TODO_DEFAULT_DURATION_MIN): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(15, Math.min(240, Math.round(value / 5) * 5));
};

const clampTodoDurationToSlot = (durationMin: number, availableDurationMin: number): number => {
  const normalized = normalizeTodoDurationMin(durationMin);
  return Math.max(15, Math.min(normalized, Math.max(15, availableDurationMin)));
};

const extractExplicitTodoDurationMin = (todo: SmartTodoItem): number | null => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  if (!text.trim()) return null;

  const hourMinuteMatch = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d{1,2})?\s*(?:m|min|mins|minute|minutes)?/.exec(text);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const mins = Number(hourMinuteMatch[2] ?? 0);
    if (Number.isFinite(hours) && Number.isFinite(mins)) {
      return normalizeTodoDurationMin(hours * 60 + mins);
    }
  }

  const minuteMatch = /(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/.exec(text);
  if (minuteMatch) {
    const mins = Number(minuteMatch[1]);
    if (Number.isFinite(mins)) return normalizeTodoDurationMin(mins);
  }

  return null;
};

const estimateTodoDurationMinFallback = (todo: SmartTodoItem): number => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  if (/quick|brief|tiny|short|email|reply|call|confirm|book/.test(text)) return 20;
  if (/deep|project|report|presentation|refactor|research|analy/.test(text)) return 90;
  if (/clean|organize|study|prepare|write|review|exercise|workout/.test(text)) return 60;
  return 40;
};

const buildTodoDeckSuggestion = (todo: SmartTodoItem, startAt: Date, endAt: Date, tag: string): DeckSuggestion => ({
  id: `todo_sched_${todo.id}_${startAt.getTime()}`,
  type: 'AT_HOME',
  source: 'todo',
  title: todo.title,
  hook: 'To-do',
  cta: 'Complete this task',
  description: todo.notes?.trim() || 'Scheduled to-do task',
  durationMin: Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
  confidence: 0.88,
  tags: ['todo', 'smart_calendar', tag],
  meta: {
    planStartAt: startAt.toISOString(),
    planEndAt: endAt.toISOString(),
  },
});

const buildTodoCandidateSlots = (
  columns: DayColumn[],
  now: Date,
  minDurationMin: number,
): TodoCandidateSlot[] => {
  const slots: TodoCandidateSlot[] = [];
  for (const column of columns) {
    for (const gap of column.gaps) {
      const futureWindow = resolveFutureGapWindow(gap, now);
      if (!futureWindow) continue;
      if (futureWindow.durationMin < minDurationMin) continue;
      slots.push({
        id: gap.id,
        dayId: column.id,
        dayLabel: column.label,
        startAt: futureWindow.startAt,
        endAt: futureWindow.endAt,
        durationMin: futureWindow.durationMin,
        beforeTitle: gap.before?.title,
        afterTitle: gap.after?.title,
      });
      if (slots.length >= SMART_TODO_MAX_CANDIDATE_SLOTS) return slots;
    }
  }
  return slots;
};

const snapMinutesToGrid = (value: number, step = 5): number => {
  if (step <= 1) return Math.round(value);
  return Math.round(value / step) * step;
};

const resolveFutureGapWindow = (gap: CalendarGap, now = new Date()): FutureGapWindow | null => {
  const startMs = Math.max(gap.startAt.getTime(), now.getTime());
  const endMs = gap.endAt.getTime();
  if (endMs <= startMs) return null;

  const startAt = new Date(startMs);
  const endAt = new Date(endMs);
  const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));
  return { startAt, endAt, durationMin };
};

const computeManualStartInGap = (
  gapWindow: FutureGapWindow,
  pressLocationY: number,
  renderedGapHeight: number,
  todoDurationMin: number,
): Date => {
  const safeHeight = Math.max(1, renderedGapHeight);
  const ratio = Math.max(0, Math.min(1, pressLocationY / safeHeight));
  const maxOffset = Math.max(0, gapWindow.durationMin - todoDurationMin);
  const offsetMin = Math.max(0, Math.min(maxOffset, snapMinutesToGrid(ratio * maxOffset, 5)));
  return new Date(gapWindow.startAt.getTime() + offsetMin * 60000);
};

const parseSmartSlotJson = (text: string): {
  estimatedDurationMin?: number;
  picks?: Array<{ slotIndex?: number; startOffsetMin?: number; reason?: string; durationMin?: number }>;
} | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const direct = [trimmed, (trimmed.match(/\{[\s\S]*\}/m) || [])[0]].filter(Boolean) as string[];
  for (const candidate of direct) {
    try {
      return JSON.parse(candidate) as {
        estimatedDurationMin?: number;
        picks?: Array<{ slotIndex?: number; startOffsetMin?: number; reason?: string; durationMin?: number }>;
      };
    } catch {
      // Continue
    }
  }
  return null;
};

const formatScheduleActivityLines = (columns: DayColumn[]): string => {
  const lines: string[] = [];
  for (const column of columns) {
    lines.push(`${column.label}:`);
    const timed = column.blocks
      .filter((block) => !block.allDay)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    if (!timed.length) {
      lines.push('- no planned activities');
      continue;
    }
    for (const block of timed) {
      lines.push(`- ${formatTime(block.startAt)}-${formatTime(block.endAt)} ${block.title}`);
    }
  }
  return lines.join('\n');
};

export const SmartCalendarScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const { state, actions } = useAppState();

  const [columns, setColumns] = useState<DayColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGap, setSelectedGap] = useState<CalendarGap | null>(null);
  const [gapSuggestions, setGapSuggestions] = useState<SmartSuggestionDeckEntry[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [gapSuggestionCache, setGapSuggestionCache] = useState<Record<string, SmartCalendarSuggestion[]>>({});
  const [gapBatchIndexByKey, setGapBatchIndexByKey] = useState<Record<string, number>>({});
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [lastSuggestionIndex, setLastSuggestionIndex] = useState<number | null>(null);
  const [canUndoSuggestion, setCanUndoSuggestion] = useState(false);
  const [deckExhausted, setDeckExhausted] = useState(false);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDeadlineAt, setTodoDeadlineAt] = useState<Date | null>(null);
  const [todoHasExplicitTime, setTodoHasExplicitTime] = useState(false);
  const [todoDatePickerVisible, setTodoDatePickerVisible] = useState(false);
  const [todoTimePickerVisible, setTodoTimePickerVisible] = useState(false);
  const [todoPhotoImporting, setTodoPhotoImporting] = useState(false);
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [todoSchedulingMode, setTodoSchedulingMode] = useState<TodoScheduleMode | null>(null);
  const [todoSchedulingTarget, setTodoSchedulingTarget] = useState<SmartTodoItem | null>(null);
  const [rankedTodoSlots, setRankedTodoSlots] = useState<RankedTodoSlot[]>([]);
  const [smartTodoSlotLoading, setSmartTodoSlotLoading] = useState(false);
  const [manualPreview, setManualPreview] = useState<ManualPreviewState | null>(null);
  const [selectedScheduledActivity, setSelectedScheduledActivity] = useState<ScheduledActivity | null>(null);
  const [calendarMinimized, setCalendarMinimized] = useState(false);
  const [nowMinute, setNowMinute] = useState(minuteOfDay(new Date()));
  const [currentTimeLabelWidth, setCurrentTimeLabelWidth] = useState(44);
  const [timelineTopOffsets, setTimelineTopOffsets] = useState<Record<string, number>>({});
  const suggestionDeckRef = useRef<SwipeDeckHandle>(null);
  const manualScheduleInFlightRef = useRef(false);
  const previousSuggestionIndexRef = useRef(0);
  const columnsScrollRef = useRef<ScrollView | null>(null);
  const calendarVerticalScrollRef = useRef<ScrollView | null>(null);
  const dayColumnXRef = useRef<Record<string, number>>({});
  const lastColumnsScrollXRef = useRef(0);
  const autoScrolledRef = useRef(false);
  const lastAutoFocusedRankedSlotRef = useRef<string | null>(null);

  useEffect(() => {
    const prevIndex = previousSuggestionIndexRef.current;
    if (suggestionIndex > prevIndex) {
      setLastSuggestionIndex(prevIndex);
      setCanUndoSuggestion(true);
    }
    previousSuggestionIndexRef.current = suggestionIndex;
  }, [suggestionIndex]);

  useEffect(() => {
    setLastSuggestionIndex(null);
    setCanUndoSuggestion(false);
    previousSuggestionIndexRef.current = 0;
  }, [gapSuggestions, selectedGap]);

  const premiumEnabled = state.isPremium;
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const formatCalendarTime = (value: Date): string => formatTime(value, timeZone);
  const activeTodos = useMemo(() => state.smartTodos.filter((todo) => !todo.done), [state.smartTodos]);
  const doneTodos = useMemo(() => state.smartTodos.filter((todo) => todo.done), [state.smartTodos]);
  const schedulingActive = !!todoSchedulingMode && !!todoSchedulingTarget;

  const laneLayoutByDay = useMemo(() => {
    const map: Record<string, Record<string, EventLaneMeta>> = {};
    for (const column of columns) {
      map[column.id] = resolveEventLanes(column);
    }
    return map;
  }, [columns]);

  const smartCalendarScheduledIds = useMemo(
    () => new Set(
      state.scheduledActivities
        .filter((item) => (item.tags ?? []).includes('smart_calendar'))
        .map((item) => item.id),
    ),
    [state.scheduledActivities],
  );

  const globalTimelineHeight = useMemo(() => {
    if (!columns.length) return Math.ceil(BASE_PX_PER_MINUTE * 480);

    const globalRangeMin = Math.min(...columns.map((column) => column.timelineStartMin));
    const globalRangeMax = Math.max(...columns.map((column) => column.timelineEndMin));
    const globalRangeDuration = Math.max(60, globalRangeMax - globalRangeMin);

    let requiredPxPerMinute = BASE_PX_PER_MINUTE;
    for (const column of columns) {
      const laneLayout = laneLayoutByDay[column.id] ?? {};

      for (const segment of buildTimelineSegments(column)) {
        const segStartMin = Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.startAt)));
        const segEndMin = Math.max(segStartMin + 1, Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.endAt))));
        const durationMin = Math.max(1, segEndMin - segStartMin);
        const laneMeta = segment.kind === 'event' ? laneLayout[segment.id] : undefined;
        const minHeight = minSegmentHeight(segment, laneMeta);
        requiredPxPerMinute = Math.max(requiredPxPerMinute, minHeight / durationMin);
      }
    }

    return Math.ceil(requiredPxPerMinute * globalRangeDuration);
  }, [columns, laneLayoutByDay]);

  const globalTimelineRange = useMemo(() => {
    if (!columns.length) return { minStartMin: DAY_START_HOUR * 60, maxEndMin: DAY_END_HOUR * 60 };
    return {
      minStartMin: Math.min(...columns.map((c) => c.timelineStartMin)),
      maxEndMin: Math.max(...columns.map((c) => c.timelineEndMin)),
    };
  }, [columns]);

  const timelineHeight = useMemo(() => {
    if (!calendarMinimized) return globalTimelineHeight;
    const minutesInView = Math.max(60, globalTimelineRange.maxEndMin - globalTimelineRange.minStartMin);
    const compactPxPerMinute = 0.26;
    return Math.max(220, Math.ceil(minutesInView * compactPxPerMinute));
  }, [calendarMinimized, globalTimelineHeight, globalTimelineRange.maxEndMin, globalTimelineRange.minStartMin]);

  const pxPerMinute = useMemo(() => {
    if (!columns.length) return timelineHeight / 60;
    const globalRangeMin = Math.min(...columns.map((column) => column.timelineStartMin));
    const globalRangeMax = Math.max(...columns.map((column) => column.timelineEndMin));
    const globalRangeDuration = Math.max(60, globalRangeMax - globalRangeMin);
    return timelineHeight / Math.max(1, globalRangeDuration);
  }, [columns, timelineHeight]);

  const syncedAllDaySectionHeight = useMemo(() => {
    const maxAllDayCount = columns.length
      ? Math.max(0, ...columns.map((column) => column.allDayBlocks.length))
      : 0;
    if (!maxAllDayCount) return 0;

    const sectionBottomInset = theme.spacing.xs + 1 + theme.spacing.xs;
    const chipsHeight = maxAllDayCount * ALL_DAY_CHIP_ESTIMATED_HEIGHT;
    const gapsHeight = Math.max(0, maxAllDayCount - 1) * ALL_DAY_CHIP_GAP;
    return sectionBottomInset + chipsHeight + gapsHeight;
  }, [columns, theme.spacing.xs]);

  const sharedTimelineTopOffset = useMemo(() => {
    const offsets = Object.values(timelineTopOffsets);
    return offsets.length ? Math.max(...offsets) : 0;
  }, [timelineTopOffsets]);

  const horizontalEdgePadding = useMemo(() => {
    return Math.max(theme.spacing.lg, (viewportWidth - DAY_COLUMN_WIDTH) / 2);
  }, [theme.spacing.lg, viewportWidth]);

  useEffect(() => {
    const updateNowMinute = () => setNowMinute(minuteOfDay(new Date()));
    updateNowMinute();
    const interval = setInterval(updateNowMinute, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    autoScrolledRef.current = false;
  }, [columns]);

  useEffect(() => {
    setTimelineTopOffsets({});
  }, [columns]);

  const snapDaysToNearestCenter = (offsetX: number, animated = true) => {
    if (!columns.length || viewportWidth <= 0) return;

    const viewportCenterX = offsetX + viewportWidth / 2;
    let nearest: { centerX: number } | null = null;

    for (const column of columns) {
      const x = dayColumnXRef.current[column.id];
      if (!Number.isFinite(x)) continue;
      const centerX = x + DAY_COLUMN_WIDTH / 2;
      if (!nearest || Math.abs(centerX - viewportCenterX) < Math.abs(nearest.centerX - viewportCenterX)) {
        nearest = { centerX };
      }
    }

    if (!nearest) return;

    const targetOffsetX = Math.max(0, nearest.centerX - viewportWidth / 2);
    if (Math.abs(targetOffsetX - offsetX) < 1) return;

    lastColumnsScrollXRef.current = targetOffsetX;
    columnsScrollRef.current?.scrollTo({ x: targetOffsetX, y: 0, animated });
  };

  const focusRankedTodoSlot = (slot: RankedTodoSlot, animated: boolean): boolean => {
    const targetColumn = columns.find((column) => column.id === slot.slot.dayId);
    if (!targetColumn) return false;

    const colX = dayColumnXRef.current[targetColumn.id];
    if (!Number.isFinite(colX)) return false;

    columnsScrollRef.current?.scrollTo({ x: Math.max(0, colX - 10), y: 0, animated });

    const targetMinute = Math.max(
      globalTimelineRange.minStartMin,
      Math.min(globalTimelineRange.maxEndMin, minuteOfDay(slot.suggestedStartAt)),
    );
    const top = TIMELINE_VERTICAL_INSET + (targetMinute - globalTimelineRange.minStartMin) * pxPerMinute;
    const offsetY = Math.max(0, top - DAY_TIMELINE_VIEWPORT_HEIGHT * 0.28);
    calendarVerticalScrollRef.current?.scrollTo({ y: offsetY, animated });
    return true;
  };

  useEffect(() => {
    if (!columns.length || loading) return;

    if (calendarMinimized) {
      calendarVerticalScrollRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }

    const todayColumn = columns.find((column) => isSameDay(column.date, new Date()));
    if (!todayColumn) return;
    if (autoScrolledRef.current) return;

    const clampedNowMinute = Math.max(globalTimelineRange.minStartMin, Math.min(globalTimelineRange.maxEndMin, nowMinute));
    const nowTop = TIMELINE_VERTICAL_INSET + (clampedNowMinute - globalTimelineRange.minStartMin) * pxPerMinute;
    const targetOffset = Math.max(0, nowTop - DAY_TIMELINE_VIEWPORT_HEIGHT * 0.35);

    calendarVerticalScrollRef.current?.scrollTo({ y: targetOffset, animated: false });
    autoScrolledRef.current = true;
  }, [calendarMinimized, columns, loading, nowMinute, pxPerMinute, globalTimelineRange.maxEndMin, globalTimelineRange.minStartMin]);

  useEffect(() => {
    if (todoSchedulingMode !== 'smart') return;
    if (smartTodoSlotLoading) return;
    if (!rankedTodoSlots.length) return;

    const best = [...rankedTodoSlots].sort((a, b) => a.rank - b.rank)[0];
    const focusId = `${best.slot.dayId}_${best.rank}_${best.suggestedStartAt.getTime()}`;
    if (lastAutoFocusedRankedSlotRef.current === focusId) return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 6;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryFocus = () => {
      if (cancelled) return;
      const focused = focusRankedTodoSlot(best, true);
      if (focused) {
        lastAutoFocusedRankedSlotRef.current = focusId;
        return;
      }
      if (retryCount >= maxRetries) return;
      retryCount += 1;
      retryTimer = setTimeout(tryFocus, 120);
    };

    const timer = setTimeout(tryFocus, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [columns, rankedTodoSlots, smartTodoSlotLoading, todoSchedulingMode, pxPerMinute]);

  const showPremiumInfo = () => {
    Alert.alert(
      'Bits Premium required',
      'You need to be a Bits Premium user to use Smart Calendar auto-planning. Purchase it now to unlock gap suggestions and plan queueing.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Purchase now', onPress: () => navigation.navigate('Premium') },
      ],
    );
  };

  const showTodoPhotoImportPremiumInfo = () => {
    Alert.alert(
      'Premium photo import',
      'This is a Premium feature. You are missing:\n\n• Smart extraction from handwritten/printed to-do photos\n• One-tap import of multiple tasks\n• Automatic due-date detection when visible',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Buy Premium', onPress: () => navigation.navigate('Premium') },
      ],
    );
  };

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(GAP_CACHE_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = JSON.parse(raw) as StoredGapCache;
        const hydrated: Record<string, SmartCalendarSuggestion[]> = {};
        for (const [key, list] of Object.entries(parsed)) {
          hydrated[key] = (list || []).map((item, idx) => ({
            id: item.id ?? `cached_${key}_${idx}`,
            title: item.title,
            reason: item.reason,
            durationMin: item.durationMin,
            travelBufferMin: item.travelBufferMin,
            score: item.score,
            source: item.source,
            category: item.category,
          }));
        }
        setGapSuggestionCache(hydrated);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const base = new Date();
        base.setHours(0, 0, 0, 0);
        const wakeStartMin = parseHourMinute(state.prefs.wakeStartTime, DAY_START_HOUR);
        const wakeEndMin = Math.max(wakeStartMin + 30, parseHourMinute(state.prefs.wakeEndTime, DAY_END_HOUR));

        const built: DayColumn[] = [];
        for (let i = 0; i < DAYS_TO_SHOW; i += 1) {
          const day = new Date(base);
          day.setDate(base.getDate() + i);

          const dayStart = new Date(day);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(day);
          dayEnd.setHours(23, 59, 59, 999);

          const calendarEvents = await getUpcomingEvents(dayStart, dayEnd, state.enabledCalendars).catch(() => []);
          const scheduled = state.scheduledActivities
            .filter((item) => {
              const at = new Date(item.startAt);
              return at.getFullYear() === day.getFullYear()
                && at.getMonth() === day.getMonth()
                && at.getDate() === day.getDate();
            })
            .map((item) => ({
              id: item.id,
              title: item.title,
              startAt: new Date(item.startAt),
              endAt: new Date(item.endAt),
              source: 'scheduled' as const,
              lat: item.suggestion.place?.lat,
              lng: item.suggestion.place?.lng,
            }));

          const linkedCalendarEventIds = new Set(
            state.scheduledActivities
              .map((item) => item.calendarEventId)
              .filter((value): value is string => !!value),
          );
          const visibleCalendarEvents = calendarEvents.filter(
            (item) => !(item.id && linkedCalendarEventIds.has(item.id)),
          );

          const allDayBlocks: CalendarBlock[] = visibleCalendarEvents
            .filter((item) => item.allDay)
            .map((item, idx) => ({
              id: `cal_allday_${i}_${idx}`,
              title: item.title,
              startAt: (() => {
                const start = new Date(day);
                start.setHours(Math.floor(wakeStartMin / 60), wakeStartMin % 60, 0, 0);
                return start;
              })(),
              endAt: (() => {
                const end = new Date(day);
                end.setHours(Math.floor(wakeEndMin / 60), wakeEndMin % 60, 0, 0);
                return end;
              })(),
              source: 'calendar' as const,
              allDay: true,
            }));

          const blocks: CalendarBlock[] = [
            ...visibleCalendarEvents
              .filter((item) => !item.allDay)
              .map((item, idx) => ({
                id: item.id ? `cal_${item.id}` : `cal_${i}_${idx}`,
                title: item.title,
                startAt: item.startDate,
                endAt: item.endDate,
                source: 'calendar' as const,
              })),
            ...scheduled,
          ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

          const timedBlocks = blocks;
          const earliestEventMin = timedBlocks.length
            ? Math.min(...timedBlocks.map((block) => minuteOfDay(block.startAt)))
            : wakeStartMin;
          const latestEventMin = timedBlocks.length
            ? Math.max(...timedBlocks.map((block) => minuteOfDay(block.endAt)))
            : wakeEndMin;
          const timelineStartMin = Math.max(0, Math.min(wakeStartMin, earliestEventMin));
          const timelineEndMin = Math.min(24 * 60, Math.max(wakeEndMin, latestEventMin));

          built.push({
            id: day.toISOString().slice(0, 10),
            date: day,
            label: day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            allDayBlocks,
            blocks,
            gaps: findCalendarGaps(day, blocks, { dayStartMin: wakeStartMin, dayEndMin: wakeEndMin }),
            timelineStartMin,
            timelineEndMin,
          });
        }

        if (active) {
          const sharedTimelineStartMin = built.length
            ? Math.min(...built.map((column) => column.timelineStartMin))
            : DAY_START_HOUR * 60;
          const sharedTimelineEndMin = built.length
            ? Math.max(...built.map((column) => column.timelineEndMin))
            : DAY_END_HOUR * 60;

          setColumns(
            built.map((column) => ({
              ...column,
              timelineStartMin: sharedTimelineStartMin,
              timelineEndMin: sharedTimelineEndMin,
            })),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [state.enabledCalendars, state.prefs.wakeStartTime, state.prefs.wakeEndTime, state.scheduledActivities]);

  const toDeckEntries = (gap: CalendarGap, suggestions: SmartCalendarSuggestion[]): SmartSuggestionDeckEntry[] => {
    const futureWindow = resolveFutureGapWindow(gap, new Date());
    if (!futureWindow) return [];

    return suggestions.slice(0, 3).map((suggestion, idx) => {
      const startAt = futureWindow.startAt;
      const endAt = new Date(startAt.getTime() + suggestion.durationMin * 60000);
      const deck: DeckSuggestion = {
        id: `smart_gap_${gap.id}_${idx}_${suggestion.source}`,
        type: normalizeDeckType(suggestion.category),
        source: 'gemini',
        title: suggestion.title,
        hook: `${suggestion.category} fit`,
        cta: suggestion.category === 'Productivity' ? 'Get this done now' : suggestion.category === 'Exercise' ? 'Move your body now' : 'Reset and recharge',
        description: suggestion.reason,
        durationMin: suggestion.durationMin,
        confidence: Math.max(0.5, Math.min(0.99, 0.55 + suggestion.score / 5)),
        tags: ['plan_ahead', 'smart_calendar', suggestion.category.toLowerCase().replace(/[^a-z]+/g, '_')],
        meta: {
          planStartAt: startAt.toISOString(),
          planEndAt: endAt.toISOString(),
          planBeforeTitle: gap.before?.title,
          planAfterTitle: gap.after?.title,
        },
      };
      return { suggestion, deck };
    });
  };

  const persistGapCache = (nextCache: Record<string, SmartCalendarSuggestion[]>) => {
    const serializable: StoredGapCache = {};
    for (const [key, list] of Object.entries(nextCache)) {
      serializable[key] = list.slice(0, 3).map((item) => ({
        title: item.title,
        reason: item.reason,
        durationMin: item.durationMin,
        travelBufferMin: item.travelBufferMin,
        score: item.score,
        source: item.source,
        category: item.category,
      }));
    }
    AsyncStorage.setItem(GAP_CACHE_KEY, JSON.stringify(serializable)).catch(() => undefined);
  };

  const fetchGapSuggestions = (gap: CalendarGap, batchIndex: number, forceRefresh = false) => {
    if (!premiumEnabled) {
      showPremiumInfo();
      return;
    }

    const now = new Date();
    const futureWindow = resolveFutureGapWindow(gap, now);
    if (!futureWindow) {
      setGapSuggestions([]);
      setSuggestionIndex(0);
      setDeckExhausted(false);
      Alert.alert('Gap expired', 'This free slot is already in the past. Please choose an upcoming gap.');
      return;
    }

    const gapForSuggestions: CalendarGap = {
      ...gap,
      startAt: futureWindow.startAt,
      endAt: futureWindow.endAt,
      durationMin: futureWindow.durationMin,
    };

    const cacheKey = gapBatchCacheKey(gap, batchIndex);
    const cached = !forceRefresh ? gapSuggestionCache[cacheKey] : undefined;
    if (cached?.length) {
      setGapSuggestions(toDeckEntries(gap, cached));
      setSuggestionIndex(0);
      setDeckExhausted(false);
      return;
    }

    setSuggestionsLoading(true);
    const aiSuggestionCount = aiCountForBatch(batchIndex);
    buildGapSuggestions(gapForSuggestions, state.habits, state.smartTodos, {
      defaultLocation: {
        lat: state.location.lat ?? undefined,
        lng: state.location.lng ?? undefined,
      },
      dayStartMin: parseHourMinute(state.prefs.wakeStartTime, DAY_START_HOUR),
      dayEndMin: parseHourMinute(state.prefs.wakeEndTime, DAY_END_HOUR),
      generationSpeedFactor: premiumEnabled ? PREMIUM_GENERATION_SPEED_FACTOR : 1,
      aiTargetCount: aiSuggestionCount,
    })
      .then((result) => {
        const nextSuggestions = result.slice(0, 3);
        setGapSuggestions(toDeckEntries(gap, nextSuggestions));
        setSuggestionIndex(0);
        setDeckExhausted(false);
        setGapSuggestionCache((prev) => {
          const updated = { ...prev, [cacheKey]: nextSuggestions };
          persistGapCache(updated);
          return updated;
        });
      })
      .catch(() => {
        setGapSuggestions([]);
        setDeckExhausted(false);
      })
      .finally(() => {
        setSuggestionsLoading(false);
      });
  };

  useEffect(() => {
    if (!selectedGap) {
      setGapSuggestions([]);
      setSuggestionIndex(0);
      setDeckExhausted(false);
      return;
    }
    if (!premiumEnabled) {
      setSelectedGap(null);
      return;
    }
    const key = gapCacheKey(selectedGap);
    const batchIndex = gapBatchIndexByKey[key] ?? 0;
    fetchGapSuggestions(selectedGap, batchIndex);
  }, [selectedGap, premiumEnabled, gapBatchIndexByKey, gapSuggestionCache, state.habits, state.location.lat, state.location.lng, state.prefs.wakeEndTime, state.prefs.wakeStartTime, state.smartTodos]);

  useEffect(() => {
    const now = Date.now();
    const pending = state.smartTodos.find((todo) => {
      if (todo.done) return false;
      if (!todo.scheduledEndAt) return false;
      const endAt = new Date(todo.scheduledEndAt).getTime();
      if (Number.isNaN(endAt) || endAt > now) return false;
      return !todo.completionPromptedAt;
    });

    if (!pending) return;

    Alert.alert(
      'To-do follow-up',
      `Did you complete "${pending.title}"?`,
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {
            actions.updateSmartTodo({
              ...pending,
              completionPromptedAt: new Date().toISOString(),
            });
          },
        },
        {
          text: 'Yes, done',
          onPress: () => {
            actions.updateSmartTodo({
              ...pending,
              done: true,
              completionPromptedAt: new Date().toISOString(),
            });
          },
        },
      ],
    );
  }, [actions, state.smartTodos]);

  const setDeadlinePreset = (offsetDays: number, hour: number, minute: number) => {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    value.setHours(hour, minute, 0, 0);
    setTodoDeadlineAt(value);
    setTodoHasExplicitTime(true);
  };

  const handleTodoDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setTodoDatePickerVisible(false);
    if (event.type === 'dismissed' || !selectedDate) return;

    const base = todoDeadlineAt ?? new Date();
    const next = new Date(base);
    next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    setTodoDeadlineAt(next);
  };

  const handleTodoTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    setTodoTimePickerVisible(false);
    if (event.type === 'dismissed' || !selectedTime) return;

    const base = todoDeadlineAt ?? new Date();
    const next = new Date(base);
    next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    setTodoDeadlineAt(next);
    setTodoHasExplicitTime(true);
  };

  const openTodoDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: todoDeadlineAt ?? new Date(),
        mode: 'date',
        onChange: (event, selectedDate) => {
          if (event.type === 'dismissed' || !selectedDate) return;
          const base = todoDeadlineAt ?? new Date();
          const next = new Date(base);
          next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          setTodoDeadlineAt(next);
        },
      });
      return;
    }

    setTodoDatePickerVisible(true);
  };

  const openTodoTimePicker = () => {
    if (!todoDeadlineAt) {
      Alert.alert('Pick a date first', 'Choose a date before selecting a time.');
      return;
    }

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: todoDeadlineAt,
        mode: 'time',
        is24Hour: true,
        onChange: (event, selectedTime) => {
          if (event.type === 'dismissed' || !selectedTime) return;
          const next = new Date(todoDeadlineAt);
          next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
          setTodoDeadlineAt(next);
          setTodoHasExplicitTime(true);
        },
      });
      return;
    }

    setTodoTimePickerVisible(true);
  };

  const formatTodoDeadlineSummary = (value: Date | null): string => {
    if (!value) return 'No deadline set';
    const datePart = value.toLocaleDateString();
    if (!todoHasExplicitTime) return `Due ${datePart}`;
    return `Due ${datePart} ${formatCalendarTime(value)}`;
  };

  const addTodo = () => {
    const title = todoTitle.trim();
    if (!title) {
      Alert.alert('Missing title', 'Please enter a to-do title.');
      return;
    }

    const todo: SmartTodoItem = {
      id: `todo_${Date.now()}`,
      title,
      notes: undefined,
      deadlineAt: todoDeadlineAt ? todoDeadlineAt.toISOString() : null,
      hasFixedSchedule: !!todoDeadlineAt && todoHasExplicitTime,
      scheduledAt: null,
      scheduledEndAt: null,
      scheduledMode: null,
      linkedScheduledActivityId: null,
      completionPromptedAt: null,
      done: false,
      createdAt: new Date().toISOString(),
    };

    actions.addSmartTodo(todo);
    setTodoTitle('');
    setTodoDeadlineAt(null);
    setTodoHasExplicitTime(false);
  };

  const importTodosViaPhoto = async () => {
    if (!premiumEnabled) {
      showTodoPhotoImportPremiumInfo();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow photo access to import your to-do list from an image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
      base64: true,
      selectionLimit: 1,
    });

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.base64) {
      Alert.alert('Import failed', 'Could not read the selected image. Please try another photo.');
      return;
    }

    setTodoPhotoImporting(true);
    try {
      const extracted = await importTodosFromPhoto(asset.base64, asset.mimeType ?? 'image/jpeg');
      if (!extracted.length) {
        Alert.alert('No tasks found', 'No clear to-do items were detected in this image.');
        return;
      }

      const now = Date.now();
      const existingByTitle = new Map(
        state.smartTodos.map((todo) => [normalizeTodoTitleKey(todo.title), todo] as const),
      );
      const seenInBatch = new Set<string>();
      let addedCount = 0;
      let mergedCount = 0;
      let skippedCount = 0;

      extracted.forEach((item, idx) => {
        const title = String(item.title ?? '').trim();
        const titleKey = normalizeTodoTitleKey(title);
        const importedNotes = mergeTodoNotesWithDueText(item.notes, item.dueText, item.deadlineAt ?? null);
        if (!title || !titleKey) {
          skippedCount += 1;
          return;
        }
        if (seenInBatch.has(titleKey)) {
          skippedCount += 1;
          return;
        }
        seenInBatch.add(titleKey);

        const existing = existingByTitle.get(titleKey);
        if (existing) {
          const mergedNotes = existing.notes || importedNotes || undefined;
          const mergedDeadline = existing.deadlineAt ?? item.deadlineAt ?? null;
          const hasChange = mergedNotes !== existing.notes || mergedDeadline !== (existing.deadlineAt ?? null);

          if (hasChange) {
            actions.updateSmartTodo({
              ...existing,
              notes: mergedNotes,
              deadlineAt: mergedDeadline,
              hasFixedSchedule: existing.hasFixedSchedule || !!mergedDeadline,
            });
            mergedCount += 1;
          } else {
            skippedCount += 1;
          }
          return;
        }

        const todo: SmartTodoItem = {
          id: `todo_photo_${now}_${idx}`,
          title,
          notes: importedNotes,
          deadlineAt: item.deadlineAt ?? null,
          hasFixedSchedule: !!item.deadlineAt,
          scheduledAt: null,
          scheduledEndAt: null,
          scheduledMode: null,
          linkedScheduledActivityId: null,
          completionPromptedAt: null,
          done: false,
          createdAt: new Date().toISOString(),
        };
        actions.addSmartTodo(todo);
        existingByTitle.set(titleKey, todo);
        addedCount += 1;
      });

      if (!addedCount && !mergedCount) {
        Alert.alert('No new tasks', 'All detected tasks already exist in your to-do list.');
        return;
      }

      const summaryParts = [];
      if (addedCount > 0) summaryParts.push(`${addedCount} added`);
      if (mergedCount > 0) summaryParts.push(`${mergedCount} updated`);
      if (skippedCount > 0) summaryParts.push(`${skippedCount} duplicate${skippedCount === 1 ? '' : 's'} skipped`);

      Alert.alert('Imported', summaryParts.join(' • '));
    } catch (error) {
      console.warn('[TodoPhotoImport] Failed to import todos', error);
      Alert.alert('Import failed', 'The AI extraction did not complete. Please try again with a clearer photo.');
    } finally {
      setTodoPhotoImporting(false);
    }
  };

  const clearTodoSchedulingMode = () => {
    setTodoSchedulingMode(null);
    setTodoSchedulingTarget(null);
    setRankedTodoSlots([]);
    setSmartTodoSlotLoading(false);
    setManualPreview(null);
    lastAutoFocusedRankedSlotRef.current = null;
  };

  const updateManualPreviewForGap = (
    gap: CalendarGap,
    pressLocationY: number,
    renderedGapHeight: number,
    todoDurationMin: number,
  ) => {
    const futureWindow = resolveFutureGapWindow(gap, new Date());
    if (!futureWindow) {
      setManualPreview(null);
      return;
    }
    const safeDurationMin = Math.max(15, Math.min(todoDurationMin, futureWindow.durationMin));
    const pickedStartAt = computeManualStartInGap(futureWindow, pressLocationY, renderedGapHeight, safeDurationMin);
    const pickedEndAt = new Date(pickedStartAt.getTime() + safeDurationMin * 60000);
    const label = `${formatCalendarTime(pickedStartAt)} - ${formatCalendarTime(pickedEndAt)}`;
    const safeHeight = Math.max(1, renderedGapHeight);
    const topOffset = Math.max(4, Math.min(safeHeight - 28, pressLocationY - 14));
    setManualPreview({
      gapId: gap.id,
      label,
      topOffset,
      startAt: pickedStartAt,
      durationMin: safeDurationMin,
    });
  };

  const confirmManualTodoSchedule = (todo: SmartTodoItem, startAt: Date, durationMin: number) => {
    if (manualScheduleInFlightRef.current) return;
    manualScheduleInFlightRef.current = true;
    void scheduleTodoAt(todo, startAt, 'manual', durationMin)
      .then(() => {
        clearTodoSchedulingMode();
        Alert.alert('Scheduled', `"${todo.title}" scheduled at ${formatCalendarTime(startAt)}.`);
      })
      .finally(() => {
        manualScheduleInFlightRef.current = false;
      });
  };

  const updateTodoAfterSchedule = (
    todo: SmartTodoItem,
    activityId: string,
    startAt: Date,
    endAt: Date,
    scheduledMode: 'manual' | 'smart' | 'fixed',
  ) => {
    actions.updateSmartTodo({
      ...todo,
      done: false,
      scheduledAt: startAt.toISOString(),
      scheduledEndAt: endAt.toISOString(),
      scheduledMode,
      linkedScheduledActivityId: activityId,
      completionPromptedAt: null,
    });
  };

  const scheduleTodoAt = async (
    todo: SmartTodoItem,
    startAt: Date,
    sourceMode: 'manual' | 'smart' | 'fixed',
    availableDurationMin?: number,
  ) => {
    const durationMin = computeTodoDurationMin(todo, availableDurationMin ?? SMART_TODO_DEFAULT_DURATION_MIN);
    const endAt = new Date(startAt.getTime() + durationMin * 60000);
    const deckSuggestion = buildTodoDeckSuggestion(todo, startAt, endAt, `todo_${sourceMode}`);
    const commitment: Commitment = {
      suggestionId: deckSuggestion.id,
      type: deckSuggestion.type,
      title: todo.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    };

    let calendarEventId: string | undefined;
    let calendarWriteFailed = !state.permissions.calendarGranted;

    if (state.permissions.calendarGranted) {
      try {
        calendarEventId = await createPlanEvent({
          title: `To-do: ${todo.title}`,
          startDate: startAt,
          endDate: endAt,
          notes: todo.notes,
        });
        calendarWriteFailed = false;
      } catch (error) {
        console.warn('[SmartCalendar] Failed to create calendar event for to-do', error);
      }
    }

    const scheduledId = `sched_todo_${todo.id}_${Date.now()}`;
    actions.addScheduledActivity({
      id: scheduledId,
      suggestionId: deckSuggestion.id,
      title: todo.title,
      description: todo.notes?.trim() || 'Scheduled from to-do list',
      durationMin,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      type: deckSuggestion.type,
      tags: ['smart_calendar', 'todo', `todo_${sourceMode}`],
      suggestion: deckSuggestion,
      commitment: {
        ...commitment,
        calendarEventId,
        calendarWriteFailed,
      },
      calendarEventId,
      calendarWriteFailed,
    });

    updateTodoAfterSchedule(todo, scheduledId, startAt, endAt, sourceMode);
  };

  const buildSmartRankedTodoSlots = async (todo: SmartTodoItem): Promise<RankedTodoSlot[]> => {
    const now = new Date();
    const candidates = buildTodoCandidateSlots(columns, now, 20);
    if (!candidates.length) return [];
    const schedulingContext = resolveTodoSchedulingContext(todo);
    const prioritizedCandidates = prioritizeTodoCandidateSlots(candidates, schedulingContext, now)
      .slice(0, SMART_TODO_MAX_CANDIDATE_SLOTS);
    if (!prioritizedCandidates.length) return [];

    const explicitDurationMin = extractExplicitTodoDurationMin(todo);
    const fallbackEstimatedDurationMin = explicitDurationMin ?? estimateTodoDurationMinFallback(todo);

    const plannedActivities = formatScheduleActivityLines(columns);
    const slotLines = prioritizedCandidates.map((slot, idx) => {
      const slotDuration = clampTodoDurationToSlot(fallbackEstimatedDurationMin, slot.durationMin);
      const maxOffset = Math.max(0, slot.durationMin - slotDuration);
      const before = slot.beforeTitle ? ` | before: ${slot.beforeTitle}` : '';
      const after = slot.afterTitle ? ` | after: ${slot.afterTitle}` : '';
      return `${idx}. ${slot.dayLabel} ${formatCalendarTime(slot.startAt)}-${formatCalendarTime(slot.endAt)} (${slot.durationMin} min) | todoDuration=${slotDuration} | maxStartOffset=${maxOffset}${before}${after}`;
    }).join('\n');

    const fallback = prioritizedCandidates.slice(0, 3).map((slot, idx) => {
      const duration = clampTodoDurationToSlot(fallbackEstimatedDurationMin, slot.durationMin);
      const adjustedOffset = clampOffsetForTodoContext(slot, duration, 0, schedulingContext);
      const suggestedStartAt = new Date(slot.startAt.getTime() + adjustedOffset * 60000);
      const suggestedEndAt = new Date(suggestedStartAt.getTime() + duration * 60000);
      return {
      id: slot.id,
      rank: (idx + 1) as 1 | 2 | 3,
      reason: idx === 0 ? 'Earliest practical slot.' : 'Fallback slot.',
      slot,
      suggestedStartAt,
      suggestedEndAt,
      };
    });

    if (!SMART_TODO_GEMINI_KEY) return fallback;

    const prompt = [
      'You are an assistant that picks the best calendar slots for one todo.',
      'Return ONLY JSON with schema: {"estimatedDurationMin":number,"picks":[{"slotIndex":number,"startOffsetMin":number,"durationMin":number,"reason":string}]}',
      'Constraints:',
      '- Pick exactly 3 different slotIndex values from the provided slot list.',
      '- For each pick, choose startOffsetMin within [0, maxStartOffset] for that slot.',
      '- If todo has explicit duration, use that duration for all picks.',
      '- If no explicit duration is given, estimate realistic durationMin for this todo.',
      '- durationMin must be in [15, 240], and cannot exceed slot duration.',
      '- Prefer realistic, low-friction times around existing plans.',
      '- Respect urgency when deadline exists.',
      '- Keep reasons concise (max 12 words).',
      '',
      `Todo: ${todo.title}`,
      `Todo notes: ${todo.notes ?? 'none'}`,
      `Todo deadline: ${todo.deadlineAt ? new Date(todo.deadlineAt).toISOString() : 'none'}`,
      `Todo explicit duration (minutes): ${explicitDurationMin ?? 'none'}`,
      '',
      'Planned activities by day:',
      plannedActivities,
      '',
      'Candidate slots:',
      slotLines,
    ].join('\n');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(SMART_TODO_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(SMART_TODO_GEMINI_KEY)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            maxOutputTokens: 500,
          },
        }),
      });
      if (!response.ok) return fallback;
      const payload = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part?.text ?? '')
        .join('') ?? '';
      const parsed = parseSmartSlotJson(text);
      const picks = (parsed?.picks ?? [])
        .map((pick) => ({
          slotIndex: Number(pick.slotIndex),
          startOffsetMin: Number(pick.startOffsetMin ?? 0),
          durationMin: Number(pick.durationMin ?? Number.NaN),
          reason: String(pick.reason ?? '').trim() || 'Good fit with your existing schedule.',
        }))
        .filter((pick) => Number.isInteger(pick.slotIndex) && pick.slotIndex >= 0 && pick.slotIndex < prioritizedCandidates.length);

      const unique = Array.from(new Map(picks.map((pick) => [pick.slotIndex, pick])).values()).slice(0, 3);
      if (!unique.length) return fallback;

      const parsedEstimatedDurationMin = Number(parsed?.estimatedDurationMin ?? Number.NaN);
      const baseEstimatedDurationMin = explicitDurationMin
        ?? (Number.isFinite(parsedEstimatedDurationMin)
          ? normalizeTodoDurationMin(parsedEstimatedDurationMin, fallbackEstimatedDurationMin)
          : fallbackEstimatedDurationMin);

      return unique.map((pick, idx) => {
        const slot = prioritizedCandidates[pick.slotIndex];
        const candidateDuration = Number.isFinite(pick.durationMin) ? pick.durationMin : baseEstimatedDurationMin;
        const duration = clampTodoDurationToSlot(candidateDuration, slot.durationMin);
        const maxOffset = Math.max(0, slot.durationMin - duration);
        const normalizedOffset = Math.max(0, Math.min(maxOffset, snapMinutesToGrid(pick.startOffsetMin, 5)));
        const contextAdjustedOffset = clampOffsetForTodoContext(
          slot,
          duration,
          normalizedOffset,
          schedulingContext,
        );
        const suggestedStartAt = new Date(slot.startAt.getTime() + contextAdjustedOffset * 60000);
        const suggestedEndAt = new Date(suggestedStartAt.getTime() + duration * 60000);
        return {
          id: slot.id,
          rank: (idx + 1) as 1 | 2 | 3,
          reason: pick.reason,
          slot,
          suggestedStartAt,
          suggestedEndAt,
        };
      });
    } catch {
      return fallback;
    }
  };

  const beginManualTodoScheduling = (todo: SmartTodoItem) => {
    setTodoModalOpen(false);
    setSelectedGap(null);
    setTodoSchedulingTarget(todo);
    setTodoSchedulingMode('manual');
    setRankedTodoSlots([]);
  };

  const beginSmartTodoScheduling = async (todo: SmartTodoItem) => {
    setTodoModalOpen(false);
    setSelectedGap(null);
    setTodoSchedulingTarget(todo);
    setTodoSchedulingMode('smart');
    setSmartTodoSlotLoading(true);
    const ranked = await buildSmartRankedTodoSlots(todo);
    setRankedTodoSlots(ranked);
    setSmartTodoSlotLoading(false);
    if (!ranked.length) {
      setTodoSchedulingMode('manual');
      Alert.alert('No smart slots', 'No good AI slots were found. Switched to manual scheduling mode.');
    }
  };

  const startTodoScheduling = (todo: SmartTodoItem) => {
    if (todo.hasFixedSchedule && todo.deadlineAt) {
      const fixedStart = new Date(todo.deadlineAt);
      if (Number.isNaN(fixedStart.getTime())) {
        Alert.alert('Invalid date', 'This to-do has an invalid fixed date/time.');
        return;
      }
      setTodoModalOpen(false);
      void scheduleTodoAt(todo, fixedStart, 'fixed', SMART_TODO_DEFAULT_DURATION_MIN)
        .then(() => Alert.alert('Scheduled', 'Fixed-time to-do added to your calendar.'));
      return;
    }

    if (!premiumEnabled) {
      beginManualTodoScheduling(todo);
      return;
    }

    Alert.alert(
      'Schedule to-do',
      'Do you want Smart scheduling (AI top 3) or manual scheduling?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Manual', onPress: () => beginManualTodoScheduling(todo) },
        { text: 'Smart schedule', onPress: () => { void beginSmartTodoScheduling(todo); } },
      ],
    );
  };

  const scheduleSuggestion = async (gap: CalendarGap, entry: SmartSuggestionDeckEntry) => {
    if (!premiumEnabled) {
      showPremiumInfo();
      return;
    }
    const suggestion = entry.suggestion;
    const deckSuggestion = entry.deck;

    if (!actions.spendSwipe()) {
      Alert.alert('No swipes left', 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }

    const futureWindow = resolveFutureGapWindow(gap, new Date());
    if (!futureWindow) {
      Alert.alert('Gap expired', 'This free slot is already in the past. Please choose an upcoming gap.');
      setSelectedGap(null);
      return;
    }

    const startAt = futureWindow.startAt;
    const endAt = new Date(startAt.getTime() + suggestion.durationMin * 60000);
    let title = deckSuggestion.title;

    if (deckSuggestion.type === 'AT_HOME') {
      title = `Plan: ${deckSuggestion.title}`;
    }

    if (deckSuggestion.type === 'GO_OUT') {
      title = `Plan: ${deckSuggestion.place?.name ?? deckSuggestion.title}`;
    }

    if (deckSuggestion.type === 'EVENT') {
      title = `Event: ${deckSuggestion.title}`;
    }

    let calendarEventId: string | undefined;
    let calendarWriteFailed = !state.permissions.calendarGranted;

    if (state.permissions.calendarGranted) {
      try {
        calendarEventId = await createPlanEvent({
          title,
          startDate: startAt,
          endDate: endAt,
          notes: deckSuggestion.description,
        });
        calendarWriteFailed = false;
      } catch (error) {
        console.warn('[SmartCalendar] Failed to create calendar event', error);
        calendarWriteFailed = true;
      }
    }

    const commitment: Commitment = {
      suggestionId: deckSuggestion.id,
      type: deckSuggestion.type,
      title: deckSuggestion.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      calendarEventId,
      calendarWriteFailed,
    };

    actions.addScheduledActivity({
      id: `sched_smart_${Date.now()}`,
      suggestionId: deckSuggestion.id,
      title: deckSuggestion.title,
      description: deckSuggestion.description,
      durationMin: deckSuggestion.durationMin,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      type: deckSuggestion.type,
      tags: deckSuggestion.tags,
      suggestion: deckSuggestion,
      commitment,
      calendarEventId,
      calendarWriteFailed,
    });

    setSelectedGap(null);
    if (calendarWriteFailed && state.permissions.calendarGranted) {
      Alert.alert('Added to plan', 'The suggestion was added, but syncing to your device calendar failed.');
      return;
    }
    Alert.alert('Added to plan', 'The suggestion was added to your scheduled activities and your device calendar.');
  };

  const handleSuggestionSkip = () => {
    if (!premiumEnabled) {
      showPremiumInfo();
      return;
    }
    if (!gapSuggestions.length) return;
    if (suggestionIndex >= gapSuggestions.length - 1) {
      setDeckExhausted(true);
      return;
    }
    if (!actions.spendSwipe()) {
      Alert.alert('No swipes left', 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }
    setSuggestionIndex((prev) => Math.min(prev + 1, gapSuggestions.length - 1));
  };

  const handleSuggestionBack = () => {
    if (!canUndoSuggestion || lastSuggestionIndex === null || !gapSuggestions.length) return;
    const maxIndex = Math.max(gapSuggestions.length - 1, 0);
    const targetIndex = Math.max(0, Math.min(lastSuggestionIndex, maxIndex));
    setSuggestionIndex(targetIndex);
    setCanUndoSuggestion(false);
    setLastSuggestionIndex(null);
    setDeckExhausted(false);
  };

  const queueNewSetForSelectedGap = () => {
    if (!premiumEnabled) {
      showPremiumInfo();
      return;
    }
    if (!selectedGap) return;
    const key = gapCacheKey(selectedGap);
    const nextBatch = (gapBatchIndexByKey[key] ?? 0) + 1;
    setGapBatchIndexByKey((prev) => ({
      ...prev,
      [key]: nextBatch,
    }));
    fetchGapSuggestions(selectedGap, nextBatch);
  };

  const openScheduledActivity = () => {
    if (!selectedScheduledActivity) return;
    navigation.navigate('Plan', {
      commitment: selectedScheduledActivity.commitment,
      suggestion: selectedScheduledActivity.suggestion,
    });
    setSelectedScheduledActivity(null);
  };

  const removeScheduledActivity = async () => {
    if (!selectedScheduledActivity) return;
    const linkedEventId = selectedScheduledActivity.calendarEventId ?? selectedScheduledActivity.commitment.calendarEventId;
    if (linkedEventId) {
      try {
        await deletePlanEvent(linkedEventId);
      } catch (error) {
        console.warn('Failed to delete scheduled activity from calendar', error);
        Alert.alert('Could not delete', 'Please try again from your calendar app.');
        return;
      }
    }

    actions.removeScheduledActivity(selectedScheduledActivity.id);
    setSelectedScheduledActivity(null);
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.planAheadTitleContainer}>
          <Text style={styles.planAheadTitle}>PLAN AHEAD</Text>
        </View>
        <Pressable
          onPress={() => {
            if (schedulingActive) {
              clearTodoSchedulingMode();
              return;
            }
            setTodoModalOpen(true);
          }}
        >
          <Text style={styles.todoButton}>{schedulingActive ? 'Cancel' : 'To-do'}</Text>
        </Pressable>
      </View>

      {schedulingActive && (
        <View style={styles.todoScheduleHintWrap}>
          <Text style={styles.todoScheduleHintText}>
            {todoSchedulingMode === 'smart'
              ? smartTodoSlotLoading
                ? 'Finding top 3 slots with AI...'
                : `Smart schedule "${todoSchedulingTarget?.title}" by tapping a highlighted slot or choose Other.`
              : `Manual schedule "${todoSchedulingTarget?.title}" by tapping a + slot.`}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centerWrap}>
          <Text style={styles.subtle}>Analyzing daily timeline...</Text>
        </View>
      ) : (
        <ScrollView
          ref={calendarVerticalScrollRef}
          style={styles.calendarVerticalScroll}
          showsVerticalScrollIndicator={false}
        >
          <ScrollView
            ref={columnsScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.columnsWrap,
              { paddingLeft: horizontalEdgePadding, paddingRight: horizontalEdgePadding },
            ]}
            scrollEventThrottle={16}
            onScroll={(event) => {
              lastColumnsScrollXRef.current = event.nativeEvent.contentOffset.x;
            }}
            onScrollEndDrag={(event) => {
              const { x } = event.nativeEvent.contentOffset;
              lastColumnsScrollXRef.current = x;
              const velocityX = Math.abs(event.nativeEvent.velocity?.x ?? 0);
              if (velocityX < 0.05) {
                snapDaysToNearestCenter(x, true);
              }
            }}
            onMomentumScrollEnd={(event) => {
              const { x } = event.nativeEvent.contentOffset;
              lastColumnsScrollXRef.current = x;
              snapDaysToNearestCenter(x, true);
            }}
          >
          {columns.map((column, colIndex) => (
            <React.Fragment key={column.id}>
              {!calendarMinimized && colIndex % 2 === 1 && (() => {
                const { minStartMin, maxEndMin } = globalTimelineRange;
                const firstHour = Math.ceil(minStartMin / 60);
                const lastHour = Math.floor(maxEndMin / 60);
                const hourLabels: React.ReactNode[] = [];
                for (let h = firstHour; h <= lastHour; h += 1) {
                  const topPx = sharedTimelineTopOffset
                    + TIMELINE_VERTICAL_INSET
                    + (h * 60 - minStartMin + HOUR_SEPARATOR_LABEL_OFFSET_MIN) * pxPerMinute;
                  hourLabels.push(
                    <Text key={h} style={[styles.hourAxisLabel, { top: topPx }]}>
                      {formatClockMinutes(h * 60, timeZone)}
                    </Text>,
                  );
                }
                return (
                  <View
                    style={[
                      styles.hourSeparator,
                      {
                        width: HOUR_SEPARATOR_WIDTH,
                        height: sharedTimelineTopOffset + timelineHeight + TIMELINE_VERTICAL_INSET * 2,
                      },
                    ]}
                    pointerEvents="none"
                  >
                    {hourLabels}
                  </View>
                );
              })()}
              <View
                style={styles.dayCol}
                onLayout={(event) => {
                  dayColumnXRef.current[column.id] = event.nativeEvent.layout.x;
                }}
              >
              <Text style={styles.dayTitle}>{column.label}</Text>
              {!calendarMinimized && (
                <Text style={styles.dayRangeLabel}>{`${formatClockMinutes(column.timelineStartMin, timeZone)} - ${formatClockMinutes(column.timelineEndMin, timeZone)}`}</Text>
              )}

              <View>
                {syncedAllDaySectionHeight > 0 && (
                  <View
                    style={[
                      styles.allDaySection,
                      { height: syncedAllDaySectionHeight },
                    ]}
                  >
                    {column.allDayBlocks.map((block) => (
                      <View key={block.id} style={styles.allDayChip}>
                        <Text style={styles.allDayIcon}>📅</Text>
                        <Text style={styles.allDayText}>{block.title}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <View
                  style={[styles.timeline, { height: timelineHeight + TIMELINE_VERTICAL_INSET * 2 }]}
                  onLayout={(event) => {
                    const measured = Math.ceil(event.nativeEvent.layout.y);
                    setTimelineTopOffsets((prev) => {
                      if (prev[column.id] === measured) return prev;
                      return { ...prev, [column.id]: measured };
                    });
                  }}
                >
                  {isSameDay(column.date, new Date()) && (
                    <>
                      {!calendarMinimized && (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.currentTimeLabel,
                            {
                              top: TIMELINE_VERTICAL_INSET
                                + (Math.max(globalTimelineRange.minStartMin, Math.min(globalTimelineRange.maxEndMin, nowMinute)) - globalTimelineRange.minStartMin) * pxPerMinute,
                            },
                          ]}
                          onLayout={(event) => {
                            const measuredWidth = Math.ceil(event.nativeEvent.layout.width);
                            if (measuredWidth > 0 && measuredWidth !== currentTimeLabelWidth) {
                              setCurrentTimeLabelWidth(measuredWidth);
                            }
                          }}
                        >
                          <Text style={styles.currentTimeLabelText}>{formatMinuteLabel(nowMinute, timeZone)}</Text>
                        </View>
                      )}
                      <View
                        pointerEvents="none"
                        style={[
                          styles.currentTimeBar,
                          {
                            left: 8 + (calendarMinimized ? 0 : currentTimeLabelWidth),
                            top: TIMELINE_VERTICAL_INSET
                              + (Math.max(globalTimelineRange.minStartMin, Math.min(globalTimelineRange.maxEndMin, nowMinute)) - globalTimelineRange.minStartMin) * pxPerMinute,
                          },
                        ]}
                      />
                    </>
                  )}

                  {buildTimelineSegments(column).map((segment) => {
                    const laneLayout = laneLayoutByDay[column.id] ?? {};
                    const segStartMin = Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.startAt)));
                    const segEndMin = Math.max(segStartMin + 1, Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.endAt))));
                    const durationMin = Math.max(1, segEndMin - segStartMin);
                    const top = TIMELINE_VERTICAL_INSET + (segStartMin - globalTimelineRange.minStartMin) * pxPerMinute;

                    if (segment.kind === 'event' && segment.block) {
                      const laneMeta = laneLayout[segment.id] ?? { laneIndex: 0, laneCount: 1 };
                      const cellHeight = Math.max(durationMin * pxPerMinute, minSegmentHeight(segment, laneMeta));
                      const canOpenPlan = segment.block.source === 'scheduled';
                      const openPlan = () => {
                        if (!canOpenPlan) return;
                        const scheduled = state.scheduledActivities.find((item) => item.id === segment.block!.id);
                        if (!scheduled) return;
                        setSelectedScheduledActivity(scheduled);
                      };

                      const laneCount = Math.max(1, laneMeta.laneCount);
                      const insetPct = (TIMELINE_HORIZONTAL_INSET / segmentTrackWidth) * 100;
                      const gapPct = laneCount > 1 ? (TIMELINE_LANE_GAP / segmentTrackWidth) * 100 : 0;
                      const laneWidthPct = (100 - insetPct * 2 - gapPct * (laneCount - 1)) / laneCount;
                      const leftPct = insetPct + laneMeta.laneIndex * (laneWidthPct + gapPct);
                      const alpha = laneCount > 1 ? Math.max(0.4, 1 - laneMeta.laneIndex * 0.2) : 1;
                      const isSmartCalendarBlock = segment.block.source === 'scheduled'
                        && smartCalendarScheduledIds.has(segment.block.id);
                      const overlapColor = isSmartCalendarBlock
                        ? `rgba(76,148,111,${alpha})`
                        : `rgba(37,99,235,${alpha})`;

                      return (
                        <Pressable
                          key={segment.id}
                          onPress={openPlan}
                          style={[
                            styles.eventBlock,
                            canOpenPlan && styles.eventBlockPressable,
                            {
                              top,
                              height: cellHeight,
                              left: `${leftPct}%`,
                              width: `${laneWidthPct}%`,
                              backgroundColor: overlapColor,
                              zIndex: 20 + laneMeta.laneIndex,
                            },
                          ]}
                        >
                          <Text style={styles.eventTitle}>{segment.block.title}</Text>
                          <Text style={styles.eventTime}>{formatCalendarTime(segment.startAt)} - {formatCalendarTime(segment.endAt)}</Text>
                        </Pressable>
                      );
                    }

                    if (segment.kind === 'gap' && segment.gap) {
                      const cellHeight = Math.max(durationMin * pxPerMinute, minSegmentHeight(segment));
                      const manualTouchEnabled = todoSchedulingMode === 'manual' && !!todoSchedulingTarget;
                      return (
                        <Pressable
                          key={segment.id}
                          onPressIn={manualTouchEnabled ? (event) => {
                            if (!todoSchedulingTarget) return;
                            const futureWindow = resolveFutureGapWindow(segment.gap!, new Date());
                            if (!futureWindow) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, futureWindow.durationMin);
                            updateManualPreviewForGap(segment.gap!, event.nativeEvent.locationY, cellHeight, durationMinForTodo);
                          } : undefined}
                          onTouchMove={manualTouchEnabled ? (event) => {
                            if (!todoSchedulingTarget) return;
                            const futureWindow = resolveFutureGapWindow(segment.gap!, new Date());
                            if (!futureWindow) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, futureWindow.durationMin);
                            updateManualPreviewForGap(segment.gap!, event.nativeEvent.locationY, cellHeight, durationMinForTodo);
                          } : undefined}
                          onPress={manualTouchEnabled ? (event) => {
                            if (!todoSchedulingTarget) return;
                            const futureWindow = resolveFutureGapWindow(segment.gap!, new Date());
                            if (!futureWindow) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, futureWindow.durationMin);
                            updateManualPreviewForGap(segment.gap!, event.nativeEvent.locationY, cellHeight, durationMinForTodo);
                          } : undefined}
                          style={[styles.gapBlock, { top, height: cellHeight, zIndex: 5 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.gapTime}>{formatCalendarTime(segment.startAt)} - {formatCalendarTime(segment.endAt)}</Text>
                            <Text style={styles.gapMeta}>{segment.durationMin} min free</Text>
                            {todoSchedulingMode === 'manual' && !!todoSchedulingTarget && (
                              <Text style={styles.manualGapHint}>Tap where this to-do should start</Text>
                            )}
                          </View>
                          {todoSchedulingMode === 'manual' && manualPreview?.gapId === segment.gap!.id && (
                            <Pressable
                              onPress={() => {
                                if (todoSchedulingMode !== 'manual' || !todoSchedulingTarget) return;
                                confirmManualTodoSchedule(todoSchedulingTarget, manualPreview.startAt, manualPreview.durationMin);
                              }}
                              style={[styles.manualPreviewChip, { top: manualPreview.topOffset }]}
                            >
                              <View style={styles.manualPreviewCheckCircle}>
                                <Text style={styles.manualPreviewCheckText}>✓</Text>
                              </View>
                              <Text style={styles.manualPreviewText}>{manualPreview.label}</Text>
                            </Pressable>
                          )}
                          {schedulingActive ? (
                            <View
                              style={[
                                styles.plusButton,
                                styles.plusButtonScheduleMode,
                              ]}
                            >
                              <Text style={styles.plusText}>+</Text>
                            </View>
                          ) : (
                            <Pressable
                              style={[
                                styles.plusButton,
                                !premiumEnabled && styles.plusButtonLocked,
                              ]}
                              onPress={() => {
                                if (!premiumEnabled) {
                                  showPremiumInfo();
                                  return;
                                }
                                if (!resolveFutureGapWindow(segment.gap!, new Date())) {
                                  Alert.alert('Gap expired', 'This free slot is already in the past. Please choose an upcoming gap.');
                                  return;
                                }
                                setSelectedGap(segment.gap!);
                              }}
                            >
                              <Text style={[styles.plusText, !premiumEnabled && styles.plusTextLocked]}>
                                {premiumEnabled ? '+' : '👑'}
                              </Text>
                            </Pressable>
                          )}
                        </Pressable>
                      );
                    }

                    return null;
                  })}

                  {todoSchedulingMode === 'smart' && rankedTodoSlots
                    .filter((item) => item.slot.dayId === column.id)
                    .map((item) => {
                      const top = TIMELINE_VERTICAL_INSET
                        + (minuteOfDay(item.suggestedStartAt) - globalTimelineRange.minStartMin) * pxPerMinute;
                      const segmentDurationMin = Math.max(1, Math.round((item.suggestedEndAt.getTime() - item.suggestedStartAt.getTime()) / 60000));
                      const gapDurationMin = column.gaps.find((gap) => gap.id === item.slot.id)?.durationMin ?? segmentDurationMin;
                      const height = Math.max(gapDurationMin * pxPerMinute, 56);
                      const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : '🥉';
                      return (
                        <Pressable
                          key={`smart_todo_${item.id}_${item.rank}`}
                          style={[styles.smartTodoSlot, { top, height }]}
                          onPress={() => {
                            if (!todoSchedulingTarget) return;
                            void scheduleTodoAt(todoSchedulingTarget, item.suggestedStartAt, 'smart', segmentDurationMin)
                              .then(() => {
                                clearTodoSchedulingMode();
                                Alert.alert('Scheduled', `"${todoSchedulingTarget.title}" scheduled at ${formatCalendarTime(item.suggestedStartAt)}.`);
                              });
                          }}
                        >
                          <View style={styles.smartTodoSlotLeft}>
                            <Text style={styles.smartTodoMedal}>{medal}</Text>
                            <View style={styles.smartTodoPlusCircle}>
                              <Text style={styles.smartTodoPlusText}>+</Text>
                            </View>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.smartTodoGhostTitle} numberOfLines={1}>
                              {todoSchedulingTarget?.title ?? 'To-do slot'}
                            </Text>
                            <Text style={styles.smartTodoGhostTime}>
                              {formatCalendarTime(item.suggestedStartAt)} - {formatCalendarTime(item.suggestedEndAt)}
                            </Text>
                            <Text style={styles.smartTodoReason} numberOfLines={1}>{item.reason}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                </View>
              </View>
            </View>
            </React.Fragment>
          ))}
          </ScrollView>
        </ScrollView>
      )}

      {todoSchedulingMode === 'smart' && !!todoSchedulingTarget && (
        <View style={styles.smartTodoBottomBar}>
          <Pressable
            style={styles.smartTodoOtherBtn}
            onPress={() => {
              setTodoSchedulingMode('manual');
              setRankedTodoSlots([]);
            }}
          >
            <Text style={styles.smartTodoOtherBtnText}>Other</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.calendarMinimizeWrap, { bottom: insets.bottom + theme.spacing.md }]}> 
        <Pressable
          style={styles.calendarMinimizeButton}
          onPress={() => setCalendarMinimized((prev) => !prev)}
        >
          <Text style={styles.calendarMinimizeButtonText}>{calendarMinimized ? 'Expand' : 'Minimize'}</Text>
        </Pressable>
      </View>

      <Modal visible={!!selectedGap} transparent animationType="slide" onRequestClose={() => setSelectedGap(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Gap Suggestions</Text>
            {suggestionsLoading ? (
              <View style={styles.centerWrap}>
                <Text style={styles.subtle}>Building 3 fitting cards...</Text>
              </View>
            ) : gapSuggestions.length === 0 ? (
              <Text style={styles.subtle}>No fitting option found for this gap.</Text>
            ) : (
              <>
                <View style={styles.deckTagRow}>
                  <View style={[
                    styles.deckTag,
                    {
                      backgroundColor: toTagColor(gapSuggestions[suggestionIndex]?.suggestion.category ?? 'Self-care').bg,
                      borderColor: toTagColor(gapSuggestions[suggestionIndex]?.suggestion.category ?? 'Self-care').text,
                    },
                  ]}>
                    <Text style={[
                      styles.deckTagText,
                      { color: toTagColor(gapSuggestions[suggestionIndex]?.suggestion.category ?? 'Self-care').text },
                    ]}>
                      {gapSuggestions[suggestionIndex]?.suggestion.category ?? 'Self-care'}
                    </Text>
                  </View>
                  <View style={styles.deckCounterStack}>
                    <Pressable
                      onPress={handleSuggestionBack}
                      disabled={!canUndoSuggestion || suggestionsLoading}
                      style={({ pressed }) => [
                        styles.deckUndoButton,
                        (!canUndoSuggestion || suggestionsLoading) && styles.deckUndoButtonDisabled,
                        pressed && canUndoSuggestion && !suggestionsLoading && styles.deckUndoButtonPressed,
                      ]}
                      hitSlop={8}
                    >
                      <Text style={[styles.deckUndoText, (!canUndoSuggestion || suggestionsLoading) && styles.deckUndoTextDisabled]}>↶</Text>
                    </Pressable>
                    <Text style={styles.deckCounterText}>{Math.min(suggestionIndex + 1, gapSuggestions.length)} / {gapSuggestions.length}</Text>
                  </View>
                </View>

                {deckExhausted ? (
                  <View style={styles.emptyDeckWrap}>
                    <Text style={styles.emptyDeckTitle}>Nothing clicked.</Text>
                    <Text style={styles.emptyDeckSubtitle}>Want a new set?</Text>
                    <Pressable style={styles.newSetBtn} onPress={queueNewSetForSelectedGap}>
                      <Text style={styles.newSetBtnText}>New set</Text>
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <View style={styles.deckWrapModal}>
                      <SwipeDeck
                        ref={suggestionDeckRef}
                        current={gapSuggestions[suggestionIndex]?.deck ?? null}
                        next={gapSuggestions[suggestionIndex + 1]?.deck ?? null}
                        onSwipeLeft={handleSuggestionSkip}
                        onSwipeRight={() => {
                          if (!selectedGap || !gapSuggestions[suggestionIndex]) return;
                          void scheduleSuggestion(selectedGap, gapSuggestions[suggestionIndex]);
                        }}
                        disabled={false}
                        deckColors={SMART_CALENDAR_DECK_COLORS}
                      />
                    </View>

                    <View style={styles.modalActionRow}>
                      <Pressable style={styles.modalTinyBtn} onPress={handleSuggestionSkip}>
                        <Text style={styles.modalTinyBtnText}>Skip</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.scheduleBtn, { flex: 1 }]}
                        onPress={() => {
                          if (!selectedGap || !gapSuggestions[suggestionIndex]) return;
                          void scheduleSuggestion(selectedGap, gapSuggestions[suggestionIndex]);
                        }}
                      >
                        <Text style={styles.scheduleBtnText}>Add to plan</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}

            <Pressable style={styles.closeBtn} onPress={() => setSelectedGap(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!selectedScheduledActivity} transparent animationType="fade" onRequestClose={() => setSelectedScheduledActivity(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{selectedScheduledActivity?.title ?? 'Scheduled activity'}</Text>
            <Text style={styles.modalMeta}>
              {selectedScheduledActivity
                ? `${new Date(selectedScheduledActivity.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatCalendarTime(new Date(selectedScheduledActivity.startAt))} - ${formatCalendarTime(new Date(selectedScheduledActivity.endAt))}`
                : ''}
            </Text>
            {!!selectedScheduledActivity?.description && (
              <Text style={styles.suggestionReason}>{selectedScheduledActivity.description}</Text>
            )}

            <View style={styles.modalActionRow}>
              <Pressable style={styles.modalTinyBtn} onPress={removeScheduledActivity}>
                <Text style={styles.modalTinyBtnText}>Remove</Text>
              </Pressable>
              <Pressable style={[styles.scheduleBtn, { flex: 1 }]} onPress={openScheduledActivity}>
                <Text style={styles.scheduleBtnText}>Start now</Text>
              </Pressable>
            </View>

            <Pressable style={styles.closeBtn} onPress={() => setSelectedScheduledActivity(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={todoModalOpen} transparent animationType="fade" onRequestClose={() => setTodoModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.todoModalCard}>
            <Text style={styles.modalTitle}>To-do List</Text>
            <TextInput
              value={todoTitle}
              onChangeText={setTodoTitle}
              placeholder="Task title"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />

            <View style={styles.deadlinePickerRow}>
              <Pressable style={styles.deadlinePickerButton} onPress={openTodoDatePicker}>
                <Text style={styles.deadlinePickerButtonText}>
                  {todoDeadlineAt ? todoDeadlineAt.toLocaleDateString() : 'Pick date'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.deadlinePickerButton}
                onPress={openTodoTimePicker}
              >
                <Text style={styles.deadlinePickerButtonText}>
                  {todoDeadlineAt && todoHasExplicitTime ? formatCalendarTime(todoDeadlineAt) : 'Pick time'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.deadlineSummaryText}>{formatTodoDeadlineSummary(todoDeadlineAt)}</Text>

            {todoDatePickerVisible && (
              <DateTimePicker
                value={todoDeadlineAt ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTodoDateChange}
              />
            )}

            {todoTimePickerVisible && (
              <DateTimePicker
                value={todoDeadlineAt ?? new Date()}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTodoTimeChange}
              />
            )}

            <View style={styles.deadlinePresetRow}>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(0, 18, 0)}>
                <Text style={styles.deadlineChipText}>Today {formatClockMinutes(18 * 60, timeZone)}</Text>
              </Pressable>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(1, 9, 0)}>
                <Text style={styles.deadlineChipText}>Tomorrow {formatClockMinutes(9 * 60, timeZone)}</Text>
              </Pressable>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(7, 18, 0)}>
                <Text style={styles.deadlineChipText}>+7 days</Text>
              </Pressable>
              <Pressable
                style={[styles.deadlineChip, styles.deadlineChipMuted]}
                onPress={() => {
                  setTodoDeadlineAt(null);
                  setTodoHasExplicitTime(false);
                }}
              >
                <Text style={styles.deadlineChipText}>Clear</Text>
              </Pressable>
            </View>

            <Pressable style={styles.scheduleBtn} onPress={addTodo}>
              <Text style={styles.scheduleBtnText}>Add task</Text>
            </Pressable>

            <Pressable
              style={[
                styles.photoImportBtn,
                (!premiumEnabled || todoPhotoImporting) && styles.photoImportBtnDisabled,
              ]}
              onPress={() => {
                void importTodosViaPhoto();
              }}
              disabled={todoPhotoImporting}
            >
              <Text style={styles.photoImportBtnText}>
                {todoPhotoImporting
                  ? 'Reading photo...'
                  : premiumEnabled
                    ? 'Import from photo (AI)'
                    : 'Import from photo (Premium)'}
              </Text>
            </Pressable>

            <ScrollView style={styles.modalList}>
              {activeTodos.map((todo) => {
                const dueHint = extractTodoDueHint(todo.notes);
                return (
                  <View key={todo.id} style={styles.todoRow}>
                    <Pressable onPress={() => actions.toggleSmartTodoDone(todo.id)}>
                      <Text style={styles.todoCheck}>{todo.done ? '☑' : '☐'}</Text>
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.todoTitle, todo.done && styles.todoDone]}>{todo.title}</Text>
                      {!!todo.deadlineAt && (
                        <Text style={styles.todoDeadline}>
                          Due {new Date(todo.deadlineAt).toLocaleDateString()} {formatCalendarTime(new Date(todo.deadlineAt))}
                        </Text>
                      )}
                      {!todo.deadlineAt && !!dueHint && (
                        <Text style={styles.todoDueHint}>{dueHint}</Text>
                      )}
                      {!!todo.scheduledAt && !todo.done && (
                        <Text style={styles.todoScheduledMeta}>
                          Scheduled {todo.scheduledMode ? `(${todo.scheduledMode})` : ''}: {new Date(todo.scheduledAt).toLocaleDateString()} {formatCalendarTime(new Date(todo.scheduledAt))}
                        </Text>
                      )}
                      {todo.hasFixedSchedule && !!todo.deadlineAt && (
                        <Text style={styles.todoFixedMeta}>Fixed time/date to-do</Text>
                      )}
                    </View>
                    <Pressable onPress={() => startTodoScheduling(todo)}>
                      <Text style={styles.todoSchedule}>Schedule</Text>
                    </Pressable>
                    <Pressable onPress={() => actions.removeSmartTodo(todo.id)}>
                      <Text style={styles.todoDelete}>Delete</Text>
                    </Pressable>
                  </View>
                );
              })}

              <Pressable style={styles.doneTodosHeader} onPress={() => setShowDoneTodos((prev) => !prev)}>
                <Text style={styles.doneTodosHeaderText}>
                  {showDoneTodos ? '▾' : '▸'} Done to-dos ({doneTodos.length})
                </Text>
              </Pressable>

              {showDoneTodos && doneTodos.map((todo) => (
                <View key={todo.id} style={styles.todoRowDoneCollapsed}>
                  <Pressable onPress={() => actions.toggleSmartTodoDone(todo.id)}>
                    <Text style={styles.todoCheck}>☑</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.todoTitle, styles.todoDone]}>{todo.title}</Text>
                  </View>
                  <Pressable onPress={() => actions.removeSmartTodo(todo.id)}>
                    <Text style={styles.todoDelete}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <Pressable style={styles.closeBtn} onPress={() => setTodoModalOpen(false)}>
              <Text style={styles.closeBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  planAheadTitleContainer: {
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.isDark ? '#2E4F45' : '#B5EAD7',
  },
  planAheadTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.isDark ? '#D9F6EA' : '#1A4A3A',
  },
  backText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 22,
    color: theme.colors.text,
  },
  todoButton: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accent,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnsWrap: {
    paddingBottom: theme.spacing.xl,
    gap: DAY_COLUMN_GAP,
  },
  dayCol: {
    width: 280,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    backgroundColor: 'transparent',
    borderWidth: 0,
    gap: theme.spacing.sm,
  },
  calendarVerticalScroll: {
    flex: 1,
  },
  dayTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
    color: theme.colors.text,
  },
  dayRangeLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  allDaySection: {
    gap: 4,
    paddingBottom: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  allDayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  allDayIcon: {
    fontSize: 11,
  },
  allDayText: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    flex: 1,
  },
  blockList: {
    gap: theme.spacing.xs,
  },
  timeline: {
    position: 'relative',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  currentTimeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    marginTop: -3,
    backgroundColor: 'rgba(252, 165, 165, 0.5)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    zIndex: 40,
  },
  currentTimeLabel: {
    position: 'absolute',
    left: 6,
    marginTop: -12,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(252, 165, 165, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    zIndex: 41,
  },
  currentTimeLabelText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#7F1D1D',
  },
  eventBlock: {
    position: 'absolute',
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    justifyContent: 'flex-start',
    minHeight: 32,
  },
  eventBlockPressable: {
    opacity: 0.98,
  },
  eventTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentText,
    fontSize: 12,
    lineHeight: EVENT_TITLE_LINE_HEIGHT,
  },
  eventTime: {
    fontFamily: theme.fonts.body,
    color: theme.colors.accentText,
    fontSize: 11,
    lineHeight: EVENT_TIME_LINE_HEIGHT,
    opacity: 0.95,
  },
  blockCard: {
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundAlt,
  },
  blockTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 13,
  },
  blockTime: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  gapTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  gapList: {
    gap: theme.spacing.sm,
  },
  gapCard: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  gapBlock: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.background,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  gapTime: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  gapMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  manualGapHint: {
    marginTop: 2,
    fontFamily: theme.fonts.semibold,
    color: '#166534',
    fontSize: 10,
  },
  manualPreviewChip: {
    position: 'absolute',
    left: 8,
    right: 8,
    minHeight: 34,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#4ADE80',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualPreviewCheckCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  manualPreviewCheckText: {
    fontFamily: theme.fonts.semibold,
    color: '#F0FDF4',
    fontSize: 12,
    lineHeight: 12,
  },
  manualPreviewText: {
    fontFamily: theme.fonts.semibold,
    color: '#14532D',
    fontSize: 12,
    flexShrink: 1,
  },
  plusButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  plusButtonLocked: {
    backgroundColor: '#FACC15',
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  plusButtonScheduleMode: {
    backgroundColor: '#22C55E',
  },
  plusText: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.accentText,
    fontSize: 22,
    lineHeight: 22,
  },
  plusTextLocked: {
    color: '#7C2D12',
    fontSize: 16,
    lineHeight: 18,
  },
  subtle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  todoScheduleHintWrap: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: '#86EFAC',
    backgroundColor: 'rgba(187,247,208,0.55)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  todoScheduleHintText: {
    fontFamily: theme.fonts.semibold,
    color: '#14532D',
    fontSize: 12,
  },
  smartTodoSlot: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: '#22C55E',
    backgroundColor: 'rgba(220,252,231,0.5)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    zIndex: 30,
  },
  smartTodoSlotLeft: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    gap: 2,
  },
  smartTodoMedal: {
    fontSize: 14,
  },
  smartTodoPlusCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smartTodoPlusText: {
    fontFamily: theme.fonts.semibold,
    color: '#FFFFFF',
    lineHeight: 14,
    fontSize: 12,
  },
  smartTodoGhostTitle: {
    fontFamily: theme.fonts.semibold,
    color: '#166534',
    opacity: 0.78,
    fontSize: 12,
  },
  smartTodoGhostTime: {
    fontFamily: theme.fonts.body,
    color: '#166534',
    opacity: 0.7,
    fontSize: 11,
  },
  smartTodoReason: {
    fontFamily: theme.fonts.body,
    color: '#14532D',
    fontSize: 10,
  },
  hourSeparator: {
    position: 'relative',
    marginHorizontal: 0,
    alignSelf: 'stretch',
    overflow: 'visible',
  },
  hourAxisLabel: {
    position: 'absolute',
    left: (HOUR_SEPARATOR_WIDTH - HOUR_AXIS_LABEL_WIDTH) / 2,
    width: HOUR_AXIS_LABEL_WIDTH,
    textAlign: 'center',
    fontFamily: theme.fonts.body,
    fontSize: 9,
    color: 'rgba(150,150,150,0.6)',
  },
  smartTodoBottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 16,
    alignItems: 'center',
  },
  calendarMinimizeWrap: {
    position: 'absolute',
    right: 16,
    alignItems: 'flex-end',
  },
  calendarMinimizeButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.4)',
  },
  calendarMinimizeButtonText: {
    fontFamily: theme.fonts.semibold,
    color: '#F8FAFC',
    fontSize: 12,
  },
  smartTodoOtherBtn: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#4ADE80',
    backgroundColor: '#DCFCE7',
  },
  smartTodoOtherBtnText: {
    fontFamily: theme.fonts.semibold,
    color: '#14532D',
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '82%',
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  todoModalCard: {
    maxHeight: '88%',
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalTitle: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    fontSize: 20,
  },
  modalMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  modalList: {
    marginTop: theme.spacing.sm,
  },
  deckTagRow: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deckCounterStack: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  deckUndoButton: {
    minHeight: 24,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  deckUndoButtonDisabled: {
    opacity: 0.35,
  },
  deckUndoButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
  deckUndoText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.textMuted,
    lineHeight: 20,
  },
  deckUndoTextDisabled: {
    color: theme.colors.border,
  },
  deckCounterText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  deckTag: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deckTagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
  },
  deckWrapModal: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  emptyDeckWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  emptyDeckTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 22,
    color: theme.colors.text,
  },
  emptyDeckSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  newSetBtn: {
    marginTop: theme.spacing.xs,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 18,
    backgroundColor: '#B5EAD7',
    borderWidth: 1,
    borderColor: '#8CC9B3',
  },
  newSetBtnText: {
    fontFamily: theme.fonts.semibold,
    color: '#1A4A3A',
    fontSize: 13,
  },
  modalActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  modalTinyBtn: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.card,
  },
  modalTinyBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 12,
  },
  suggestionCard: {
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginBottom: theme.spacing.sm,
    gap: 4,
  },
  suggestionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  suggestionMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  suggestionReason: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 12,
  },
  scheduleBtn: {
    marginTop: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: theme.colors.accent,
  },
  scheduleBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentText,
  },
  photoImportBtn: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.card,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImportBtnDisabled: {
    opacity: 0.6,
  },
  photoImportBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accent,
    fontSize: 14,
  },
  closeBtn: {
    marginTop: theme.spacing.sm,
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
  },
  deadlinePresetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  deadlinePickerRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  deadlinePickerButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: theme.colors.card,
  },
  deadlinePickerButtonText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 13,
  },
  deadlineSummaryText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  deadlineChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.colors.card,
  },
  deadlineChipMuted: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  deadlineChipText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  todoCheck: {
    fontSize: 20,
    color: theme.colors.text,
  },
  todoTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  todoDone: {
    textDecorationLine: 'line-through',
    color: theme.colors.textMuted,
  },
  todoDeadline: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  todoDueHint: {
    fontFamily: theme.fonts.body,
    color: '#7C3AED',
    fontSize: 11,
  },
  todoScheduledMeta: {
    fontFamily: theme.fonts.body,
    color: '#15803D',
    fontSize: 11,
  },
  todoFixedMeta: {
    fontFamily: theme.fonts.body,
    color: '#0F766E',
    fontSize: 11,
  },
  todoSchedule: {
    fontFamily: theme.fonts.semibold,
    color: '#15803D',
  },
  todoDelete: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
  },
  doneTodosHeader: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  doneTodosHeaderText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  todoRowDoneCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    paddingBottom: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    opacity: 0.88,
  },
});
