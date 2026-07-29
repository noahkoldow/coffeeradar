import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SwipeDeck, SwipeDeckHandle } from '../components/SwipeDeck';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { createPlanEvent, deletePlanEvent, getUpcomingEvents } from '../services/calendar';
import { CalendarBlock, CalendarGap, DAY_END_HOUR, DAY_START_HOUR, SmartCalendarSuggestion, WeekPlanContext, WeekPlanDayInput, WeekPlanItem, buildGapSuggestions, computeTravelBufferMin, findCalendarGaps, planWeekWithGemini } from '../services/smartCalendar';
import { importTodosFromPhoto } from '../services/todoPhotoImport';
import { generateJsonWithFirebaseAiLogic } from '../services/firebaseAiLogic';
import { buildAdKeywords } from '../services/ads/adConfig';
import { consumeVideoAd, preloadVideoAd } from '../services/ads/videoAd';
import { isAdPlaceholderMode, isAdsAvailable } from '../services/ads/mobileAds';
import { useAdsCompliance } from '../services/ads/consent';
import { isAdminUser as resolveAdminAccess, isBusinessAdmin } from '../services/user';
import { VideoAdModal } from '../components/ads/VideoAdModal';
import { Commitment, DeckSuggestion, ScheduledActivity, SmartTodoItem } from '../types';
import { formatClockMinutes, formatTime } from '../utils/time';
import { getLocalDateKey, getTodoDeadlineAt, getTodoDueDate, isTodoEligibleForWindow, isTodoOverdue } from '../utils/todos';
import { applyTodoChunkCompletion, evaluateTodoWindowFit, estimateTodoDurationMin, getTodoAtomizedProgress, parseTodoExplicitDurationMin } from '../utils/todoAtomization';
import { useI18n } from '../i18n/I18nProvider';

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
// Cap how many title lines drive the timeline scale. Beyond this, titles are
// truncated with an ellipsis instead of forcing the whole timeline taller.
const MAX_EVENT_TITLE_LINES = 2;
const GAP_MIN_HEIGHT = 40;
const BASE_PX_PER_MINUTE = 0.45;
const EVENT_TINT_ALTERNATE_ALPHA = 0.72;
const HOUR_SEPARATOR_WIDTH = 8;
const HOUR_AXIS_LABEL_WIDTH = 28;
const HOUR_SEPARATOR_LABEL_OFFSET_MIN = 70;
const ALL_DAY_CHIP_ESTIMATED_HEIGHT = 24;
const ALL_DAY_CHIP_GAP = 4;
const GAP_CACHE_KEY = 'smart_calendar_gap_cache_v1';
const WEEK_PLAN_LAST_USED_KEY = 'smart_calendar_week_plan_last_used_v1';
const WEEK_PLAN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
type SmartSuggestionDeckEntry = {
  suggestion: SmartCalendarSuggestion;
  deck: DeckSuggestion;
};

type StoredGapCache = Record<string, Array<Omit<SmartCalendarSuggestion, 'id'> & { id?: string }>>;
const PREMIUM_GENERATION_SPEED_FACTOR = 0.9;
const SMART_CALENDAR_DECK_COLORS = { bg: '#B5EAD7', text: '#1A4A3A' };
const SMART_TODO_DEFAULT_DURATION_MIN = 30;
const SMART_TODO_MAX_CANDIDATE_SLOTS = 24;
const SMART_TODO_RANKING_MODEL = 'gemini-3.6-flash';

const normalizeTodoTitleKey = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const mergeTodoNotesWithDueText = (
  notes?: string,
  dueText?: string,
  deadlineAt?: string | null,
  dueDate?: string | null,
): string | undefined => {
  const trimmedNotes = String(notes ?? '').trim();
  const trimmedDueText = String(dueText ?? '').trim();
  if (!trimmedDueText || !!deadlineAt || !!dueDate) return trimmedNotes || undefined;

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
  transitBufferMin: number;
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

type TodoSchedulingContext = {
  isSocialCall: boolean;
  avoidBeforeMin: number;
  preferredStartMin: number;
  preferredEndMin: number;
  hoursToDeadline: number | null;
};

const SOCIAL_CALL_INTENT_RE = /\b(call|phone|facetime|video\s*call|ring|chat|catch\s*up|talk)\b/i;
const PERSONAL_RELATION_RE = /\b(mum|mom|mother|dad|father|parent|brother|sister|grandma|grandpa|friend|family)\b/i;
const REMOTE_TODO_RE = /\b(call|phone|facetime|video\s*call|zoom|meet|online|remote|email)\b/i;

const overlapMinutes = (aStart: number, aEnd: number, bStart: number, bEnd: number): number => {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
};

const resolveTodoSchedulingContext = (todo: SmartTodoItem): TodoSchedulingContext => {
  const text = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  const isSocialCall = SOCIAL_CALL_INTENT_RE.test(text) && PERSONAL_RELATION_RE.test(text);

  const deadlineAt = getTodoDeadlineAt(todo);
  const deadlineMs = deadlineAt ? new Date(deadlineAt).getTime() : Number.NaN;
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

type NowIndicatorProps = {
  minStartMin: number;
  maxEndMin: number;
  pxPerMinute: number;
  calendarMinimized: boolean;
  timeZone: string;
  styles: ReturnType<typeof createStyles>;
};

/**
 * Renders the moving "current time" line + label for today's column.
 *
 * It owns its own per-minute timer so that only this small component
 * re-renders on the minute tick, instead of forcing the whole calendar
 * screen to re-render (which previously caused a visible flicker and made
 * the timeline jump back to "now").
 */
const NowIndicator: React.FC<NowIndicatorProps> = React.memo(
  ({ minStartMin, maxEndMin, pxPerMinute, calendarMinimized, timeZone, styles }) => {
    const [nowMinute, setNowMinute] = useState(() => minuteOfDay(new Date()));
    const [labelWidth, setLabelWidth] = useState(44);

    useEffect(() => {
      const update = () => setNowMinute(minuteOfDay(new Date()));
      update();
      // Align the tick to the start of each minute so the line advances
      // exactly on the minute rather than drifting.
      const now = new Date();
      const msUntilNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
      let interval: ReturnType<typeof setInterval> | null = null;
      const timeout = setTimeout(() => {
        update();
        interval = setInterval(update, 60000);
      }, msUntilNextMinute);
      return () => {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
      };
    }, []);

    const clamped = Math.max(minStartMin, Math.min(maxEndMin, nowMinute));
    const top = TIMELINE_VERTICAL_INSET + (clamped - minStartMin) * pxPerMinute;

    return (
      <>
        {!calendarMinimized && (
          <View
            pointerEvents="none"
            style={[styles.currentTimeLabel, { top }]}
            onLayout={(event) => {
              const measuredWidth = Math.ceil(event.nativeEvent.layout.width);
              if (measuredWidth > 0 && measuredWidth !== labelWidth) {
                setLabelWidth(measuredWidth);
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
            { left: 8 + (calendarMinimized ? 0 : labelWidth), top },
          ]}
        />
      </>
    );
  },
);

const isSameDay = (a: Date, b: Date): boolean => (
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate()
);

const parseGapIdentity = (gap: CalendarGap): { dayId: string; idx: number } => {
  const match = /^gap_(\d{4}-\d{2}-\d{2})_(\d+)(?:_cont_\d+)?$/.exec(gap.id);
  return {
    dayId: match?.[1] ?? gap.startAt.toISOString().slice(0, 10),
    idx: Number(match?.[2] ?? 0),
  };
};

const normalizeSuggestionTitleKey = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const buildTodoLocationHint = (
  todo: SmartTodoItem,
  defaultLocation: { lat?: number; lng?: number },
): { title?: string; lat?: number; lng?: number } => {
  const merged = `${todo.title ?? ''} ${todo.notes ?? ''}`.toLowerCase();
  if (REMOTE_TODO_RE.test(merged)) {
    return {
      title: 'home',
      lat: defaultLocation.lat,
      lng: defaultLocation.lng,
    };
  }
  return {
    title: todo.title,
    lat: defaultLocation.lat,
    lng: defaultLocation.lng,
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
  const estimatedTitleLines = Math.min(
    MAX_EVENT_TITLE_LINES,
    Math.max(1, Math.ceil((title || '').trim().length / charsPerLine)),
  );
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
  const fit = evaluateTodoWindowFit(todo, availableDurationMin);
  if (fit.fits) return fit.durationMin;
  const hardMax = Math.max(15, availableDurationMin);
  return Math.max(15, Math.min(SMART_TODO_DEFAULT_DURATION_MIN, hardMax));
};

const buildTodoDeckSuggestion = (
  todo: SmartTodoItem,
  startAt: Date,
  endAt: Date,
  tag: string,
  timeZone?: string | null,
): DeckSuggestion => ({
  id: `todo_sched_${todo.id}_${startAt.getTime()}`,
  type: 'AT_HOME',
  source: 'todo',
  title: todo.title,
  hook: getTodoAtomizedProgress(todo).isAtomized ? 'Atomized to-do' : 'To-do',
  cta: getTodoAtomizedProgress(todo).isAtomized ? 'Complete this chunk' : 'Complete this task',
  description: todo.notes?.trim() || 'Scheduled to-do task',
  durationMin: Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)),
  confidence: 0.88,
  tags: ['todo', 'smart_calendar', tag],
  meta: {
    planStartAt: startAt.toISOString(),
    planEndAt: endAt.toISOString(),
    todoDeadlineAt: getTodoDeadlineAt(todo),
    todoDueDate: getTodoDueDate(todo, timeZone),
    ...(getTodoAtomizedProgress(todo).isAtomized
      ? {
          todoAtomizedProgressMin: getTodoAtomizedProgress(todo).progressMin,
          todoAtomizedTotalMin: getTodoAtomizedProgress(todo).totalMin ?? undefined,
          todoAtomizedRemainingMin: getTodoAtomizedProgress(todo).remainingMin,
        }
      : {}),
  },
});

const buildWeekPlanDeckSuggestion = (item: WeekPlanItem): DeckSuggestion => ({
  id: `weekplan_${item.id}`,
  type: 'AT_HOME',
  source: item.source === 'todo' ? 'todo' : item.source === 'habit' ? 'habit' : 'gemini',
  title: item.title,
  hook: item.category,
  cta: 'Open',
  description: item.reason,
  durationMin: item.durationMin,
  confidence: 0.9,
  tags: ['smart_calendar', 'week_plan', item.source],
  meta: {
    planStartAt: item.startAt.toISOString(),
    planEndAt: item.endAt.toISOString(),
  },
});

type EditableEventBlockProps = {
  title: string;
  timeLabel: string;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  backgroundColor: string;
  zIndex: number;
  editMode: boolean;
  movable: boolean;
  styles: any;
  /** Parent-owned translate value; only applied while THIS block is being dragged. */
  dragTranslateY: Animated.Value;
  isBeingDragged: boolean;
  hasOverlap: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDragGesture: (translationY: number, translationX: number, absoluteX: number, absoluteY: number) => void;
  onDragStateChange: (state: number, oldState: number, translationY: number, translationX: number, absoluteX: number, absoluteY: number) => void;
  onDelete?: () => void;
};

/**
 * Renders a single timeline event. In edit mode, movable (smart-scheduled)
 * events can be dragged vertically to a new time via a gesture-handler pan;
 * immovable external calendar events show a block sign and cannot be moved.
 *
 * Drag state (translate + auto-scroll compensation) is owned by the parent so
 * the block stays glued to the finger even while the timeline auto-scrolls.
 */
const EditableEventBlock: React.FC<EditableEventBlockProps> = ({
  title,
  timeLabel,
  top,
  height,
  leftPct,
  widthPct,
  backgroundColor,
  zIndex,
  editMode,
  movable,
  styles,
  dragTranslateY,
  isBeingDragged,
  hasOverlap,
  onPress,
  onLongPress,
  onDragGesture,
  onDragStateChange,
  onDelete,
}) => {
  const positionStyle = {
    top,
    height,
    left: `${leftPct}%` as any,
    width: `${widthPct}%` as any,
    backgroundColor,
    zIndex: isBeingDragged ? 999 : zIndex,
  };

  if (editMode && movable) {
    return (
      <PanGestureHandler
        maxPointers={1}
        activeOffsetY={[-6, 6]}
        activeOffsetX={[-8, 8]}
        onGestureEvent={(event) =>
          onDragGesture(
            event.nativeEvent.translationY,
            event.nativeEvent.translationX,
            event.nativeEvent.absoluteX,
            event.nativeEvent.absoluteY,
          )
        }
        onHandlerStateChange={(event) =>
          onDragStateChange(
            event.nativeEvent.state,
            event.nativeEvent.oldState,
            event.nativeEvent.translationY,
            event.nativeEvent.translationX,
            event.nativeEvent.absoluteX,
            event.nativeEvent.absoluteY,
          )
        }
      >
        <Animated.View
          style={[
            styles.eventBlock,
            styles.eventBlockEditing,
            hasOverlap && styles.eventBlockOverlap,
            positionStyle,
            isBeingDragged && styles.eventBlockDragging,
            { transform: [{ translateY: isBeingDragged ? dragTranslateY : 0 }] },
          ]}
        >
          {hasOverlap && (
            <View style={styles.overlapBadge}>
              <Text style={styles.overlapBadgeText}>Overlap!</Text>
            </View>
          )}
          {onDelete && (
            <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteEventBtn}>
              <Text style={styles.deleteEventBtnText}>✕</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={[{ flex: 1 }, onDelete ? styles.eventBlockContentWithDelete : undefined]}
          >
            <Text style={styles.eventTitle} numberOfLines={MAX_EVENT_TITLE_LINES} ellipsizeMode="tail">{title}</Text>
            <Text style={styles.eventTime}>{timeLabel}</Text>
          </Pressable>
          <View style={styles.dragHandleBadge}>
            <Text style={styles.dragHandleText}>⇅</Text>
          </View>
        </Animated.View>
      </PanGestureHandler>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[
        styles.eventBlock,
        hasOverlap && styles.eventBlockOverlap,
        editMode && !movable && styles.eventBlockImmovable,
        positionStyle,
      ]}
    >
      {hasOverlap && (
        <View style={styles.overlapBadge}>
          <Text style={styles.overlapBadgeText}>Overlap!</Text>
        </View>
      )}
      {editMode && !movable && (
        <View style={styles.immovableBadge}>
          <Text style={styles.immovableBadgeText}>🚫</Text>
        </View>
      )}
      <Text style={styles.eventTitle} numberOfLines={MAX_EVENT_TITLE_LINES} ellipsizeMode="tail">{title}</Text>
      <Text style={styles.eventTime}>{timeLabel}</Text>
      {editMode && !movable && <Text style={styles.immovableHint}>Locked</Text>}
    </Pressable>
  );
};

const buildTodoCandidateSlots = (
  columns: DayColumn[],
  todo: SmartTodoItem,
  now: Date,
  timeZone: string | null | undefined,
  minDurationMin: number,
  defaultLocation: { lat?: number; lng?: number },
): TodoCandidateSlot[] => {
  const slots: TodoCandidateSlot[] = [];
  const suggestionLocation = buildTodoLocationHint(todo, defaultLocation);
  for (const column of columns) {
    for (const gap of column.gaps) {
      if (gap.endAt.getTime() <= now.getTime()) continue;
      const transitBufferMin = computeTravelBufferMin(
        {
          title: gap.before?.title,
          lat: gap.before?.lat,
          lng: gap.before?.lng,
        },
        suggestionLocation,
        {
          title: gap.after?.title,
          lat: gap.after?.lat,
          lng: gap.after?.lng,
        },
      );
      const reserveBeforeMin = Math.ceil(transitBufferMin / 2);
      const reserveAfterMin = Math.floor(transitBufferMin / 2);
      const usableStartAt = new Date(gap.startAt.getTime() + reserveBeforeMin * 60000);
      const usableEndAt = new Date(gap.endAt.getTime() - reserveAfterMin * 60000);
      const usableDurationMin = Math.max(0, Math.round((usableEndAt.getTime() - usableStartAt.getTime()) / 60000));
      if (usableDurationMin < minDurationMin) continue;
      if (!isTodoEligibleForWindow(todo, gap.startAt, gap.endAt, timeZone)) continue;
      slots.push({
        id: gap.id,
        dayId: column.id,
        dayLabel: column.label,
        startAt: usableStartAt,
        endAt: usableEndAt,
        durationMin: usableDurationMin,
        beforeTitle: gap.before?.title,
        afterTitle: gap.after?.title,
        transitBufferMin,
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

const hasClearTodoDateTime = (value?: string | null): boolean => {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  // Date-only values are usually normalized to midnight. Treat those as
  // non-explicit times to avoid accidental auto-scheduling.
  return parsed.getHours() !== 0 || parsed.getMinutes() !== 0;
};

const computeManualStartInGap = (
  gap: CalendarGap,
  pressLocationY: number,
  renderedGapHeight: number,
  todoDurationMin: number,
): Date => {
  const safeHeight = Math.max(1, renderedGapHeight);
  const ratio = Math.max(0, Math.min(1, pressLocationY / safeHeight));
  const maxOffset = Math.max(0, gap.durationMin - todoDurationMin);
  const offsetMin = Math.max(0, Math.min(maxOffset, snapMinutesToGrid(ratio * maxOffset, 5)));
  return new Date(gap.startAt.getTime() + offsetMin * 60000);
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

const cloneScheduledActivities = (items: ScheduledActivity[]): ScheduledActivity[] => (
  JSON.parse(JSON.stringify(items)) as ScheduledActivity[]
);

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
  const { t, language } = useI18n();
  const isGerman = language === 'de';
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const { state, actions } = useAppState();
  const adsCompliance = useAdsCompliance();

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
  const [todoFormModalOpen, setTodoFormModalOpen] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDeadlineAt, setTodoDeadlineAt] = useState<Date | null>(null);
  const [todoHasExplicitTime, setTodoHasExplicitTime] = useState(false);
  const [todoDatePickerVisible, setTodoDatePickerVisible] = useState(false);
  const [todoTimePickerVisible, setTodoTimePickerVisible] = useState(false);
  const [todoPhotoImporting, setTodoPhotoImporting] = useState(false);
  const [showScheduledTodos, setShowScheduledTodos] = useState(false);
  const [showUnscheduledTodos, setShowUnscheduledTodos] = useState(true);
  const [showDoneTodos, setShowDoneTodos] = useState(false);
  const [todoSchedulingMode, setTodoSchedulingMode] = useState<TodoScheduleMode | null>(null);
  const [todoSchedulingTarget, setTodoSchedulingTarget] = useState<SmartTodoItem | null>(null);
  const [rankedTodoSlots, setRankedTodoSlots] = useState<RankedTodoSlot[]>([]);
  const [smartTodoSlotLoading, setSmartTodoSlotLoading] = useState(false);
  const [manualPreview, setManualPreview] = useState<ManualPreviewState | null>(null);
  const [selectedScheduledActivity, setSelectedScheduledActivity] = useState<ScheduledActivity | null>(null);
  const [eventEditTitle, setEventEditTitle] = useState('');
  const [eventEditDescription, setEventEditDescription] = useState('');
  const [eventEditStartAt, setEventEditStartAt] = useState<Date | null>(null);
  const [eventEditDatePickerVisible, setEventEditDatePickerVisible] = useState(false);
  const [eventEditTimePickerVisible, setEventEditTimePickerVisible] = useState(false);
  const [calendarMinimized, setCalendarMinimized] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editHasChanges, setEditHasChanges] = useState(false);
  const [planningWeek, setPlanningWeek] = useState(false);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [weekPlanLastUsedAt, setWeekPlanLastUsedAt] = useState<number | null>(null);
  const [videoAd, setVideoAd] = useState<any>(null);
  const videoAdResolveRef = useRef<(() => void) | null>(null);
  const [timelineTopOffsets, setTimelineTopOffsets] = useState<Record<string, number>>({});
  const [calendarViewportHeight, setCalendarViewportHeight] = useState(0);
  const suggestionDeckRef = useRef<SwipeDeckHandle>(null);
  const manualScheduleInFlightRef = useRef(false);
  const previousSuggestionIndexRef = useRef(0);
  const columnsScrollRef = useRef<ScrollView | null>(null);
  const calendarVerticalScrollRef = useRef<ScrollView | null>(null);
  const dayColumnXRef = useRef<Record<string, number>>({});
  const columnsContentWidthRef = useRef(0);
  const columnsViewportWidthRef = useRef(0);
  const columnsViewportLeftRef = useRef(0);
  const lastColumnsScrollXRef = useRef(0);
  const snapInFlightRef = useRef(false);
  const autoScrolledRef = useRef(false);
  const lastAutoFocusedRankedSlotRef = useRef<string | null>(null);
  // --- Drag-to-move (edit mode) auto-scroll plumbing ---
  const verticalScrollYRef = useRef(0);
  const verticalViewportRef = useRef({ top: 0, height: 0 });
  const dragStartScrollYRef = useRef(0);
  const autoScrollVectorRef = useRef({ vy: 0, hx: 0 });
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragTranslateY = useRef(new Animated.Value(0)).current;
  const dragBaseTranslationRef = useRef(0);
  const dragActivityRef = useRef<ScheduledActivity | null>(null);
  const editSnapshotRef = useRef<ScheduledActivity[] | null>(null);
  const dragStartColumnIndexRef = useRef<number | null>(null);
  const dragTargetColumnIndexRef = useRef<number | null>(null);
  const hasLoadedCalendarRef = useRef(false);
  const pendingViewportFocusRef = useRef<{ dayId: string; minute: number } | null>(null);

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
  const [isAdminUser, setIsAdminUser] = useState(() => isBusinessAdmin(state.userEmail));
  const hasSwipesRemaining = (state.swipeBank?.current ?? 0) > 0;
  // Non-premium users see a short video ad while the week planner works.
  const adsFreeUser = !premiumEnabled
    && ((isAdsAvailable && adsCompliance.initialized && adsCompliance.canRequestAds) || isAdPlaceholderMode);
  const adKeywords = useMemo(
    () => buildAdKeywords(state.prefs, state.location, 'all'),
    [state.prefs, state.location],
  );
  // The "plan my whole week" button can be used once per 7 days (bool, no stacking).
  useEffect(() => {
    let active = true;
    setIsAdminUser(isBusinessAdmin(state.userEmail));
    resolveAdminAccess()
      .then((value) => {
        if (active) setIsAdminUser(value);
      })
      .catch(() => {
        if (active) setIsAdminUser(isBusinessAdmin(state.userEmail));
      });

    return () => {
      active = false;
    };
  }, [state.userEmail, state.userId]);

  const weekPlanAvailable = isAdminUser
    || !weekPlanLastUsedAt
    || (Date.now() - weekPlanLastUsedAt >= WEEK_PLAN_COOLDOWN_MS);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(WEEK_PLAN_LAST_USED_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const ts = Number(raw);
        if (Number.isFinite(ts)) setWeekPlanLastUsedAt(ts);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (adsFreeUser) preloadVideoAd(adKeywords);
  }, [adsFreeUser, adKeywords]);

  const closeVideoAd = () => {
    setVideoAd(null);
    videoAdResolveRef.current?.();
    videoAdResolveRef.current = null;
  };

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const formatCalendarTime = (value: Date): string => formatTime(value, timeZone);
  const activeTodos = useMemo(() => {
    const now = Date.now();
    const pending = state.smartTodos.filter((todo) => !todo.done);
    // Surface overdue to-dos first (earliest deadline first), keeping the rest
    // in their original order.
    const overdue = pending.filter((todo) => isTodoOverdue(todo, now, timeZone));
    const rest = pending.filter((todo) => !isTodoOverdue(todo, now, timeZone));
    overdue.sort(
      (a, b) => {
        const aDeadlineAt = getTodoDeadlineAt(a);
        const bDeadlineAt = getTodoDeadlineAt(b);
        if (aDeadlineAt && bDeadlineAt) {
          return new Date(aDeadlineAt).getTime() - new Date(bDeadlineAt).getTime();
        }

        const aDueDate = getTodoDueDate(a, timeZone);
        const bDueDate = getTodoDueDate(b, timeZone);
        if (aDueDate && bDueDate) return aDueDate.localeCompare(bDueDate);
        if (aDeadlineAt || aDueDate) return -1;
        if (bDeadlineAt || bDueDate) return 1;
        return 0;
      },
    );
    return [...overdue, ...rest];
  }, [state.smartTodos, timeZone]);
  const scheduledTodos = useMemo(() => activeTodos.filter((todo) => !!todo.scheduledAt || !!todo.linkedScheduledActivityId), [activeTodos]);
  const unscheduledTodos = useMemo(() => activeTodos.filter((todo) => !todo.scheduledAt && !todo.linkedScheduledActivityId), [activeTodos]);
  const doneTodos = useMemo(() => state.smartTodos.filter((todo) => todo.done), [state.smartTodos]);
  const schedulingActive = !!todoSchedulingMode && !!todoSchedulingTarget;
  const scheduledActivityById = useMemo(
    () => new Map(state.scheduledActivities.map((item) => [item.id, item] as const)),
    [state.scheduledActivities],
  );

  useEffect(() => {
    if (!todoModalOpen) return;
    setShowScheduledTodos(false);
    setShowUnscheduledTodos(true);
    setShowDoneTodos(false);
  }, [todoModalOpen]);

  const laneLayoutByDay = useMemo(() => {
    const map: Record<string, Record<string, EventLaneMeta>> = {};
    for (const column of columns) {
      map[column.id] = resolveEventLanes(column);
    }
    return map;
  }, [columns]);

  const overlapBlockIdsByDay = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const column of columns) {
      const overlaps = new Set<string>();
      const timedBlocks = column.blocks.filter((block) => !block.allDay);
      for (let i = 0; i < timedBlocks.length; i += 1) {
        const a = timedBlocks[i];
        const aStart = a.startAt.getTime();
        const aEnd = a.endAt.getTime();
        for (let j = i + 1; j < timedBlocks.length; j += 1) {
          const b = timedBlocks[j];
          const bStart = b.startAt.getTime();
          const bEnd = b.endAt.getTime();
          if (Math.max(aStart, bStart) < Math.min(aEnd, bEnd)) {
            overlaps.add(a.id);
            overlaps.add(b.id);
          }
        }
      }
      map[column.id] = overlaps;
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

  const eventTintAlphaByDay = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};

    for (const column of columns) {
      const tintByBlockId: Record<string, number> = {};
      const timedBlocks = column.blocks
        .filter((block) => !block.allDay)
        .slice()
        .sort((a, b) => {
          const startDelta = a.startAt.getTime() - b.startAt.getTime();
          if (startDelta !== 0) return startDelta;
          const endDelta = a.endAt.getTime() - b.endAt.getTime();
          if (endDelta !== 0) return endDelta;
          return a.id.localeCompare(b.id);
        });

      let previousColorKey: 'smart' | 'external' | null = null;
      let useAlternateTint = false;

      for (const block of timedBlocks) {
        const colorKey: 'smart' | 'external' = block.source === 'scheduled' && smartCalendarScheduledIds.has(block.id)
          ? 'smart'
          : 'external';

        if (colorKey === previousColorKey) {
          useAlternateTint = !useAlternateTint;
        } else {
          useAlternateTint = false;
        }

        tintByBlockId[block.id] = useAlternateTint ? EVENT_TINT_ALTERNATE_ALPHA : 1;
        previousColorKey = colorKey;
      }

      map[column.id] = tintByBlockId;
    }

    return map;
  }, [columns, smartCalendarScheduledIds]);

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

  const timelineHeight = useMemo(() => {
    const expandedMaxHeight = viewportHeight > 0 ? viewportHeight * 2 : Number.POSITIVE_INFINITY;
    const minimizedViewportHeight = Math.max(0, calendarViewportHeight - sharedTimelineTopOffset - TIMELINE_VERTICAL_INSET * 2);
    const minimizedMaxHeight = minimizedViewportHeight > 0 ? minimizedViewportHeight * 0.75 : Number.POSITIVE_INFINITY;
    if (!calendarMinimized) return Math.min(globalTimelineHeight, expandedMaxHeight);
    return Math.min(globalTimelineHeight, minimizedMaxHeight);
  }, [calendarMinimized, calendarViewportHeight, globalTimelineHeight, sharedTimelineTopOffset, viewportHeight]);

  const pxPerMinute = useMemo(() => {
    if (!columns.length) return timelineHeight / 60;
    const globalRangeMin = Math.min(...columns.map((column) => column.timelineStartMin));
    const globalRangeMax = Math.max(...columns.map((column) => column.timelineEndMin));
    const globalRangeDuration = Math.max(60, globalRangeMax - globalRangeMin);
    return timelineHeight / Math.max(1, globalRangeDuration);
  }, [columns, timelineHeight]);

  const horizontalEdgePadding = useMemo(() => {
    return Math.max(theme.spacing.lg, (viewportWidth - DAY_COLUMN_WIDTH) / 2);
  }, [theme.spacing.lg, viewportWidth]);


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
    // Mark this scroll as programmatic so the resulting momentum-end event does
    // not re-trigger snapping and leave the ScrollView stuck in a scrolling
    // state (which blocks taps on child buttons).
    snapInFlightRef.current = true;
    columnsScrollRef.current?.scrollTo({ x: targetOffsetX, y: 0, animated });
  };

  const focusRankedTodoSlot = (slot: RankedTodoSlot, animated: boolean) => {
    const targetColumn = columns.find((column) => column.id === slot.slot.dayId);
    if (!targetColumn) return;

    const colX = dayColumnXRef.current[targetColumn.id];
    if (Number.isFinite(colX)) {
      columnsScrollRef.current?.scrollTo({ x: Math.max(0, colX - 10), y: 0, animated });
    }

    const targetMinute = Math.max(
      globalTimelineRange.minStartMin,
      Math.min(globalTimelineRange.maxEndMin, minuteOfDay(slot.suggestedStartAt)),
    );
    const top = TIMELINE_VERTICAL_INSET + (targetMinute - globalTimelineRange.minStartMin) * pxPerMinute;
    const offsetY = Math.max(0, top - DAY_TIMELINE_VIEWPORT_HEIGHT * 0.28);
    calendarVerticalScrollRef.current?.scrollTo({ y: offsetY, animated });
  };

  const focusCalendarViewport = (dayId: string, minute: number, animated = false) => {
    const targetColumn = columns.find((column) => column.id === dayId);
    if (!targetColumn) return;

    const colX = dayColumnXRef.current[targetColumn.id];
    const viewport = columnsViewportWidthRef.current > 0 ? columnsViewportWidthRef.current : viewportWidth;
    if (Number.isFinite(colX)) {
      const targetOffsetX = Math.max(0, colX + DAY_COLUMN_WIDTH / 2 - viewport / 2);
      columnsScrollRef.current?.scrollTo({ x: targetOffsetX, y: 0, animated });
      lastColumnsScrollXRef.current = targetOffsetX;
    }

    const clampedMinute = Math.max(
      globalTimelineRange.minStartMin,
      Math.min(globalTimelineRange.maxEndMin, minute),
    );
    const top = TIMELINE_VERTICAL_INSET + (clampedMinute - globalTimelineRange.minStartMin) * pxPerMinute;
    const targetOffsetY = Math.max(0, top - DAY_TIMELINE_VIEWPORT_HEIGHT * 0.32);
    calendarVerticalScrollRef.current?.scrollTo({ y: targetOffsetY, animated });
    verticalScrollYRef.current = targetOffsetY;
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

    // Compute "now" locally at run-time. This effect intentionally does NOT
    // depend on a per-minute state value, so it only scrolls to "now" once
    // per data load (guarded by autoScrolledRef) instead of jumping back to
    // the current time every minute.
    const nowMinuteLocal = minuteOfDay(new Date());
    const clampedNowMinute = Math.max(globalTimelineRange.minStartMin, Math.min(globalTimelineRange.maxEndMin, nowMinuteLocal));
    const nowTop = TIMELINE_VERTICAL_INSET + (clampedNowMinute - globalTimelineRange.minStartMin) * pxPerMinute;
    const targetOffset = Math.max(0, nowTop - DAY_TIMELINE_VIEWPORT_HEIGHT * 0.35);

    calendarVerticalScrollRef.current?.scrollTo({ y: targetOffset, animated: false });
    autoScrolledRef.current = true;
  }, [calendarMinimized, columns, loading, pxPerMinute, globalTimelineRange.maxEndMin, globalTimelineRange.minStartMin]);

  useEffect(() => {
    if (todoSchedulingMode !== 'smart') return;
    if (smartTodoSlotLoading) return;
    if (!rankedTodoSlots.length) return;

    const best = [...rankedTodoSlots].sort((a, b) => a.rank - b.rank)[0];
    const focusId = `${best.slot.dayId}_${best.rank}_${best.suggestedStartAt.getTime()}`;
    if (lastAutoFocusedRankedSlotRef.current === focusId) return;

    lastAutoFocusedRankedSlotRef.current = focusId;
    const timer = setTimeout(() => {
      focusRankedTodoSlot(best, true);
    }, 80);
    return () => clearTimeout(timer);
  }, [columns, rankedTodoSlots, smartTodoSlotLoading, todoSchedulingMode, pxPerMinute]);

  useEffect(() => {
    if (loading) return;
    const pending = pendingViewportFocusRef.current;
    if (!pending) return;

    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled) return;
      attempts += 1;
      const hasMeasuredX = Number.isFinite(dayColumnXRef.current[pending.dayId]);
      if (hasMeasuredX || attempts >= 8) {
        focusCalendarViewport(pending.dayId, pending.minute, false);
        pendingViewportFocusRef.current = null;
        return;
      }
      setTimeout(tryFocus, 30);
    };

    setTimeout(tryFocus, 10);
    return () => { cancelled = true; };
  }, [columns, loading, pxPerMinute, globalTimelineRange.maxEndMin, globalTimelineRange.minStartMin, viewportWidth]);

  const showPremiumInfo = () => {
    Alert.alert(
      isGerman ? 'Bits Premium erforderlich' : 'Bits Premium required',
      isGerman
        ? 'Du brauchst Bits Premium, um Smart Calendar Auto-Planung zu nutzen. Kaufe es jetzt, um Luckenvorschlage und Plan-Queueing freizuschalten.'
        : 'You need to be a Bits Premium user to use Smart Calendar auto-planning. Purchase it now to unlock gap suggestions and plan queueing.',
      [
        { text: isGerman ? 'Jetzt nicht' : 'Not now', style: 'cancel' },
        { text: isGerman ? 'Jetzt kaufen' : 'Purchase now', onPress: () => navigation.navigate('Premium') },
      ],
    );
  };

  const showTodoPhotoImportPremiumInfo = () => {
    Alert.alert(
      isGerman ? 'Premium-Fotoimport' : 'Premium photo import',
      isGerman
        ? 'Das ist eine Premium-Funktion. Dir fehlen:\n\n• Smarte Erkennung aus handschriftlichen/gedruckten To-do-Fotos\n• Ein-Klick-Import mehrerer Aufgaben\n• Automatische Fälligkeits-Erkennung, wenn sichtbar'
        : 'This is a Premium feature. You are missing:\n\n• Smart extraction from handwritten/printed to-do photos\n• One-tap import of multiple tasks\n• Automatic due-date detection when visible',
      [
        { text: isGerman ? 'Jetzt nicht' : 'Not now', style: 'cancel' },
        { text: isGerman ? 'Premium kaufen' : 'Buy Premium', onPress: () => navigation.navigate('Premium') },
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
      const shouldShowBlockingLoader = !hasLoadedCalendarRef.current;
      if (shouldShowBlockingLoader) setLoading(true);
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

          const calendarEvents = await getUpcomingEvents(dayStart, dayEnd, state.disabledCalendars).catch(() => []);
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
            gaps: findCalendarGaps(day, blocks, {
              dayStartMin: wakeStartMin,
              dayEndMin: wakeEndMin,
              // For today, a free slot that is already underway is suggested from
              // "now" until its end instead of from its (passed) beginning.
              minStartAt: isSameDay(day, new Date()) ? new Date() : undefined,
            }),
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
          hasLoadedCalendarRef.current = true;
        }
      } finally {
        if (active && !hasLoadedCalendarRef.current) {
          hasLoadedCalendarRef.current = true;
        }
        if (active && shouldShowBlockingLoader) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [state.disabledCalendars, state.prefs.wakeStartTime, state.prefs.wakeEndTime, state.scheduledActivities]);

  const toDeckEntries = (gap: CalendarGap, suggestions: SmartCalendarSuggestion[]): SmartSuggestionDeckEntry[] => {
    return suggestions.slice(0, 3).map((suggestion, idx) => {
      const startAt = gap.startAt;
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
    const cacheKey = gapBatchCacheKey(gap, batchIndex);
    const scheduledTitleKeys = new Set(
      state.scheduledActivities.map((item) => normalizeSuggestionTitleKey(item.title)),
    );
    const cached = !forceRefresh ? gapSuggestionCache[cacheKey] : undefined;
    if (cached?.length) {
      const filteredCached = cached.filter(
        (item) => !scheduledTitleKeys.has(normalizeSuggestionTitleKey(item.title)),
      );
      setGapSuggestions(toDeckEntries(gap, filteredCached));
      setSuggestionIndex(0);
      setDeckExhausted(false);
      return;
    }

    setSuggestionsLoading(true);
    const aiSuggestionCount = aiCountForBatch(batchIndex);
    buildGapSuggestions(gap, state.habits, state.smartTodos.filter((t) => !t.done && !t.linkedScheduledActivityId && !t.scheduledAt), {
      defaultLocation: {
        lat: state.location.lat ?? undefined,
        lng: state.location.lng ?? undefined,
      },
      dayStartMin: parseHourMinute(state.prefs.wakeStartTime, DAY_START_HOUR),
      dayEndMin: parseHourMinute(state.prefs.wakeEndTime, DAY_END_HOUR),
      timeZone,
      language,
      generationSpeedFactor: premiumEnabled ? PREMIUM_GENERATION_SPEED_FACTOR : 1,
      aiTargetCount: aiSuggestionCount,
      activityLog: state.activityLog,
    })
      .then((result) => {
        const nextSuggestions = result
          .filter((item) => !scheduledTitleKeys.has(normalizeSuggestionTitleKey(item.title)))
          .slice(0, 3);
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
  }, [selectedGap, premiumEnabled, gapBatchIndexByKey, gapSuggestionCache, state.habits, state.location.lat, state.location.lng, state.prefs.wakeEndTime, state.prefs.wakeStartTime, state.smartTodos, state.scheduledActivities]);

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
      isGerman ? 'To-do Nachverfolgung' : 'To-do follow-up',
      isGerman ? `Hast du "${pending.title}" erledigt?` : `Did you complete "${pending.title}"?`,
      [
        {
          text: isGerman ? 'Nein' : 'No',
          style: 'cancel',
          onPress: () => {
            actions.updateSmartTodo({
              ...pending,
              completionPromptedAt: new Date().toISOString(),
            });
          },
        },
        {
          text: isGerman ? 'Ja, erledigt' : 'Yes, done',
          onPress: () => {
            const linkedActivity = pending.linkedScheduledActivityId
              ? scheduledActivityById.get(pending.linkedScheduledActivityId)
              : undefined;
            const completion = applyTodoChunkCompletion(pending, linkedActivity?.durationMin);
            actions.updateSmartTodo({
              ...completion.todo,
              completionPromptedAt: new Date().toISOString(),
            });
            if (completion.usedAtomizedProgress && completion.totalMin != null) {
              const progressCopy = `${completion.progressMin}/${completion.totalMin} min`;
              Alert.alert(
                completion.becameDone ? (isGerman ? 'To-do erledigt' : 'To-do completed') : (isGerman ? 'Teil erledigt' : 'Chunk completed'),
                completion.becameDone
                  ? (isGerman ? `Stark. "${pending.title}" ist jetzt vollstandig erledigt (${progressCopy}).` : `Great work. "${pending.title}" is now fully complete (${progressCopy}).`)
                  : (isGerman ? `Fortschritt fur "${pending.title}" gespeichert: ${progressCopy}.` : `Progress saved for "${pending.title}": ${progressCopy}.`),
              );
            }
          },
        },
      ],
    );
  }, [actions, scheduledActivityById, state.smartTodos]);

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
      Alert.alert(isGerman ? 'Zuerst Datum auswahlen' : 'Pick a date first', isGerman ? 'Wahle ein Datum, bevor du eine Uhrzeit auswahlen kannst.' : 'Choose a date before selecting a time.');
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
    if (!value) return isGerman ? 'Kein Falligkeitsdatum oder keine Deadline gesetzt' : 'No due date or deadline set';
    const datePart = value.toLocaleDateString();
    if (!todoHasExplicitTime) return isGerman ? `Fallig am ${datePart}` : `Due date ${datePart}`;
    return isGerman ? `Deadline ${datePart} ${formatCalendarTime(value)}` : `Deadline ${datePart} ${formatCalendarTime(value)}`;
  };

  const resolveTodoFromSuggestion = (suggestion: SmartCalendarSuggestion): SmartTodoItem | null => {
    if (suggestion.source !== 'todo') return null;

    const idMatch = /^todo_(.+)$/.exec(String(suggestion.id ?? ''));
    const explicitTodoId = idMatch?.[1] ?? null;
    if (explicitTodoId) {
      const exact = state.smartTodos.find((todo) => todo.id === explicitTodoId);
      if (exact && !exact.done && !exact.linkedScheduledActivityId && !exact.scheduledAt) {
        return exact;
      }
    }

    const titleKey = normalizeTodoTitleKey(suggestion.title);
    if (!titleKey) return null;

    const titleMatched = state.smartTodos.find((todo) => (
      !todo.done
      && !todo.linkedScheduledActivityId
      && !todo.scheduledAt
      && normalizeTodoTitleKey(todo.title) === titleKey
    ));
    return titleMatched ?? null;
  };

  const addTodo = () => {
    const title = todoTitle.trim();
    if (!title) {
      Alert.alert(isGerman ? 'Titel fehlt' : 'Missing title', isGerman ? 'Bitte gib einen To-do-Titel ein.' : 'Please enter a to-do title.');
      return;
    }

    const todo: SmartTodoItem = {
      id: `todo_${Date.now()}`,
      title,
      notes: undefined,
      atomizedTotalMin: null,
      atomizedProgressMin: 0,
      deadlineAt: todoDeadlineAt && todoHasExplicitTime ? todoDeadlineAt.toISOString() : null,
      dueDate: todoDeadlineAt && !todoHasExplicitTime ? getLocalDateKey(todoDeadlineAt, timeZone) : null,
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
    if (todo.hasFixedSchedule && todo.deadlineAt && hasClearTodoDateTime(todo.deadlineAt)) {
      const fixedStart = new Date(todo.deadlineAt);
      if (!Number.isNaN(fixedStart.getTime())) {
        void scheduleTodoAt(todo, fixedStart, 'fixed', SMART_TODO_DEFAULT_DURATION_MIN);
      }
    }
    setTodoTitle('');
    setTodoDeadlineAt(null);
    setTodoHasExplicitTime(false);
    setTodoDatePickerVisible(false);
    setTodoTimePickerVisible(false);
    setTodoFormModalOpen(false);
  };

  const importTodosViaPhoto = async () => {
    if (!premiumEnabled) {
      showTodoPhotoImportPremiumInfo();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(isGerman ? 'Berechtigung erforderlich' : 'Permission required', isGerman ? 'Erlaube Fotozugriff, um deine To-do-Liste aus einem Bild zu importieren.' : 'Allow photo access to import your to-do list from an image.');
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
      Alert.alert(isGerman ? 'Import fehlgeschlagen' : 'Import failed', isGerman ? 'Das ausgewahlte Bild konnte nicht gelesen werden. Bitte versuche ein anderes Foto.' : 'Could not read the selected image. Please try another photo.');
      return;
    }

    setTodoPhotoImporting(true);
    try {
      const extracted = await importTodosFromPhoto(asset.base64, asset.mimeType ?? 'image/jpeg');
      if (!extracted.length) {
        Alert.alert(isGerman ? 'Keine Aufgaben gefunden' : 'No tasks found', isGerman ? 'In diesem Bild wurden keine klaren To-do-Aufgaben erkannt.' : 'No clear to-do items were detected in this image.');
        return;
      }

      const now = Date.now();
      const existingByTitle = new Map(
        state.smartTodos.map((todo) => [normalizeTodoTitleKey(todo.title), todo] as const),
      );
      const queuedAutoSchedules: SmartTodoItem[] = [];
      const seenInBatch = new Set<string>();
      let addedCount = 0;
      let mergedCount = 0;
      let skippedCount = 0;

      extracted.forEach((item, idx) => {
        const title = String(item.title ?? '').trim();
        const titleKey = normalizeTodoTitleKey(title);
        const importedNotes = mergeTodoNotesWithDueText(item.notes, item.dueText, item.deadlineAt ?? null, item.dueDate ?? null);
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
          const mergedDueDate = existing.dueDate ?? item.dueDate ?? null;
          const hasChange = mergedNotes !== existing.notes
            || mergedDeadline !== (existing.deadlineAt ?? null)
            || mergedDueDate !== (existing.dueDate ?? null);

          if (hasChange) {
            const updatedTodo: SmartTodoItem = {
              ...existing,
              notes: mergedNotes,
              deadlineAt: mergedDeadline,
              dueDate: mergedDueDate,
              hasFixedSchedule: existing.hasFixedSchedule || !!mergedDeadline,
            };
            actions.updateSmartTodo(updatedTodo);
            if (
              updatedTodo.hasFixedSchedule
              && updatedTodo.deadlineAt
              && hasClearTodoDateTime(updatedTodo.deadlineAt)
              && !updatedTodo.linkedScheduledActivityId
            ) {
              queuedAutoSchedules.push(updatedTodo);
            }
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
          atomizedTotalMin: null,
          atomizedProgressMin: 0,
          deadlineAt: item.deadlineAt ?? null,
          dueDate: item.dueDate ?? null,
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
        if (todo.hasFixedSchedule && todo.deadlineAt && hasClearTodoDateTime(todo.deadlineAt)) {
          queuedAutoSchedules.push(todo);
        }
        existingByTitle.set(titleKey, todo);
        addedCount += 1;
      });

      for (const fixedTodo of queuedAutoSchedules) {
        const fixedStart = fixedTodo.deadlineAt ? new Date(fixedTodo.deadlineAt) : null;
        if (!fixedStart || Number.isNaN(fixedStart.getTime())) continue;
        // Schedule fixed-time todos immediately; overlaps are allowed and shown in calendar UI.
        await scheduleTodoAt(fixedTodo, fixedStart, 'fixed', SMART_TODO_DEFAULT_DURATION_MIN);
      }

      if (!addedCount && !mergedCount) {
        Alert.alert(isGerman ? 'Keine neuen Aufgaben' : 'No new tasks', isGerman ? 'Alle erkannten Aufgaben existieren bereits in deiner To-do-Liste.' : 'All detected tasks already exist in your to-do list.');
        return;
      }

      const summaryParts = [];
      if (addedCount > 0) summaryParts.push(`${addedCount} added`);
      if (mergedCount > 0) summaryParts.push(`${mergedCount} updated`);
      if (skippedCount > 0) summaryParts.push(`${skippedCount} duplicate${skippedCount === 1 ? '' : 's'} skipped`);

      Alert.alert(isGerman ? 'Importiert' : 'Imported', summaryParts.join(' • '));
    } catch (error) {
      console.warn('[TodoPhotoImport] Failed to import todos', error);
      Alert.alert(isGerman ? 'Import fehlgeschlagen' : 'Import failed', isGerman ? 'Die KI-Extraktion wurde nicht abgeschlossen. Bitte versuche es mit einem klareren Foto erneut.' : 'The AI extraction did not complete. Please try again with a clearer photo.');
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
    const pickedStartAt = computeManualStartInGap(gap, pressLocationY, renderedGapHeight, todoDurationMin);
    const pickedEndAt = new Date(pickedStartAt.getTime() + todoDurationMin * 60000);
    const label = `${formatCalendarTime(pickedStartAt)} - ${formatCalendarTime(pickedEndAt)}`;
    const safeHeight = Math.max(1, renderedGapHeight);
    const topOffset = Math.max(4, Math.min(safeHeight - 28, pressLocationY - 14));
    setManualPreview({
      gapId: gap.id,
      label,
      topOffset,
      startAt: pickedStartAt,
      durationMin: todoDurationMin,
    });
  };

  const confirmManualTodoSchedule = (todo: SmartTodoItem, startAt: Date, durationMin: number) => {
    if (manualScheduleInFlightRef.current) return;
    manualScheduleInFlightRef.current = true;
    void scheduleTodoAt(todo, startAt, 'manual', durationMin)
      .then(() => {
        clearTodoSchedulingMode();
        Alert.alert(t('smart_scheduled_title'), isGerman ? `"${todo.title}" um ${formatCalendarTime(startAt)} geplant.` : `"${todo.title}" scheduled at ${formatCalendarTime(startAt)}.`);
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
      ...(() => {
        const progress = getTodoAtomizedProgress(todo);
        if (!progress.isAtomized || progress.totalMin == null) return {};
        return {
          atomizedTotalMin: progress.totalMin,
          atomizedProgressMin: progress.progressMin,
        };
      })(),
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
    if (!isTodoEligibleForWindow(todo, startAt, endAt, timeZone)) {
      const deadlineAt = getTodoDeadlineAt(todo);
      const dueDate = getTodoDueDate(todo, timeZone);
      Alert.alert(
        isGerman ? 'UnguItige Planungszeit' : 'Invalid scheduling time',
        deadlineAt
          ? (isGerman ? `Dieses To-do muss vor ${new Date(deadlineAt).toLocaleString()} fertig sein.` : `This to-do must finish before ${new Date(deadlineAt).toLocaleString()}.`)
          : dueDate
            ? (isGerman ? `Dieses To-do mit Falligkeitsdatum kann nur am oder nach dem ${dueDate} geplant werden.` : `This due-date to-do can only be scheduled on or after ${dueDate}.`)
            : (isGerman ? 'Dieses To-do kann in diesem Slot nicht geplant werden.' : 'This to-do cannot be scheduled in that slot.'),
      );
      return;
    }

    if (sourceMode === 'smart') {
      const dayId = startAt.toISOString().slice(0, 10);
      const column = columns.find((item) => item.id === dayId);
      const containingGap = column?.gaps.find((gap) => {
        const gapStart = gap.startAt.getTime();
        const gapEnd = gap.endAt.getTime();
        return startAt.getTime() >= gapStart && endAt.getTime() <= gapEnd;
      });
      if (!containingGap) {
        Alert.alert(isGerman ? 'Slot geandert' : 'Slot changed', isGerman ? 'Dieser Slot ist nicht mehr frei. Bitte wahlen einen anderen.' : 'This slot is no longer free. Please pick another one.');
        return;
      }

      const transitBufferMin = computeTravelBufferMin(
        {
          title: containingGap.before?.title,
          lat: containingGap.before?.lat,
          lng: containingGap.before?.lng,
        },
        buildTodoLocationHint(todo, {
          lat: state.location.lat ?? undefined,
          lng: state.location.lng ?? undefined,
        }),
        {
          title: containingGap.after?.title,
          lat: containingGap.after?.lat,
          lng: containingGap.after?.lng,
        },
      );
      if (durationMin + transitBufferMin > containingGap.durationMin) {
        Alert.alert(isGerman ? 'Zu wenig Wechselzeit' : 'Not enough transit room', isGerman ? 'Dieser Slot lasst nicht genug Zeit fur Wege/Ubergange. Wahlen einen anderen Smart-Slot.' : 'This slot does not leave enough time for travel/transition. Pick another smart slot.');
        return;
      }
    }

    const deckSuggestion = buildTodoDeckSuggestion(todo, startAt, endAt, `todo_${sourceMode}`, timeZone);
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
    const candidates = buildTodoCandidateSlots(
      columns,
      todo,
      now,
      timeZone,
      20,
      {
        lat: state.location.lat ?? undefined,
        lng: state.location.lng ?? undefined,
      },
    );
    if (!candidates.length) return [];
    const schedulingContext = resolveTodoSchedulingContext(todo);
    const prioritizedCandidates = prioritizeTodoCandidateSlots(candidates, schedulingContext, now)
      .slice(0, SMART_TODO_MAX_CANDIDATE_SLOTS);
    if (!prioritizedCandidates.length) return [];

    const explicitDurationMin = parseTodoExplicitDurationMin(todo);
    const estimatedDurationMin = explicitDurationMin ?? estimateTodoDurationMin(todo);
    const requiredDurationMin = Math.max(15, estimatedDurationMin);
    const candidateFits = prioritizedCandidates
      .map((slot) => ({ slot, durationMin: requiredDurationMin }))
      .filter((entry) => entry.slot.durationMin >= entry.durationMin)
      .slice(0, SMART_TODO_MAX_CANDIDATE_SLOTS);
    if (!candidateFits.length) return [];

    const plannedActivities = formatScheduleActivityLines(columns);
    const slotLines = candidateFits.map(({ slot, durationMin }, idx) => {
      const maxOffset = Math.max(0, slot.durationMin - durationMin);
      const before = slot.beforeTitle ? ` | before: ${slot.beforeTitle}` : '';
      const after = slot.afterTitle ? ` | after: ${slot.afterTitle}` : '';
      return `${idx}. ${slot.dayLabel} ${formatCalendarTime(slot.startAt)}-${formatCalendarTime(slot.endAt)} (${slot.durationMin} min usable) | transitReserve=${slot.transitBufferMin} | todoDuration=${durationMin} | fitMode=full_task | maxStartOffset=${maxOffset}${before}${after}`;
    }).join('\n');

    const fallback = candidateFits.slice(0, 3).map(({ slot, durationMin }, idx) => {
      const adjustedOffset = clampOffsetForTodoContext(slot, durationMin, 0, schedulingContext);
      const suggestedStartAt = new Date(slot.startAt.getTime() + adjustedOffset * 60000);
      const suggestedEndAt = new Date(suggestedStartAt.getTime() + durationMin * 60000);
      return {
      id: slot.id,
      rank: (idx + 1) as 1 | 2 | 3,
      reason: idx === 0 ? 'Earliest practical full-fit slot.' : 'Fallback full-fit slot.',
      slot,
      suggestedStartAt,
      suggestedEndAt,
      };
    });

    const prompt = [
      'You are an assistant that picks the best calendar slots for one todo.',
      'Return ONLY JSON with schema: {"estimatedDurationMin":number,"picks":[{"slotIndex":number,"startOffsetMin":number,"durationMin":number,"reason":string}]}',
      'Constraints:',
      '- Pick up to 3 different slotIndex values from the provided slot list.',
      '- For each pick, choose startOffsetMin within [0, maxStartOffset] for that slot.',
      '- Respect todoDuration shown for each slot (full-fit durations only).',
      '- durationMin in output must equal that todoDuration for chosen slot.',
      '- Prefer realistic, low-friction times around existing plans.',
      '- Respect urgency when deadline exists.',
      '- Date-only due dates may only be placed on or after their due date day.',
      '- Keep reasons concise (max 12 words).',
      '',
      `Todo: ${todo.title}`,
      `Todo notes: ${todo.notes ?? 'none'}`,
      `Todo deadline: ${getTodoDeadlineAt(todo) ? new Date(getTodoDeadlineAt(todo) as string).toISOString() : 'none'}`,
      `Todo due date: ${getTodoDueDate(todo, timeZone) ?? 'none'}`,
      `Todo explicit duration (minutes): ${explicitDurationMin ?? 'none'}`,
      `Todo estimated total duration (minutes): ${estimatedDurationMin}`,
      '',
      'Planned activities by day:',
      plannedActivities,
      '',
      'Candidate slots:',
      slotLines,
    ].join('\n');

    try {
      const text = await generateJsonWithFirebaseAiLogic({
        prompt,
        model: SMART_TODO_RANKING_MODEL,
        temperature: 0.2,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 900,
        timeoutMs: 12000,
        responseSchema: {
          type: 'object',
          properties: {
            estimatedDurationMin: { type: 'number' },
            picks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slotIndex: { type: 'number' },
                  startOffsetMin: { type: 'number' },
                  durationMin: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['slotIndex', 'startOffsetMin', 'durationMin', 'reason'],
              },
            },
          },
          required: ['picks'],
        },
      });
      const parsed = parseSmartSlotJson(text);
      const picks = (parsed?.picks ?? [])
        .map((pick) => ({
          slotIndex: Number(pick.slotIndex),
          startOffsetMin: Number(pick.startOffsetMin ?? 0),
          reason: String(pick.reason ?? '').trim() || 'Good fit with your existing schedule.',
        }))
        .filter((pick) => Number.isInteger(pick.slotIndex) && pick.slotIndex >= 0 && pick.slotIndex < candidateFits.length);

      const unique = Array.from(new Map(picks.map((pick) => [pick.slotIndex, pick])).values()).slice(0, 3);
      if (!unique.length) return fallback;

      return unique.map((pick, idx) => {
        const { slot, durationMin } = candidateFits[pick.slotIndex];
        const duration = durationMin;
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
        .then(() => Alert.alert(t('smart_scheduled_title'), 'Fixed-time to-do added to your calendar.'));
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

  const renderActiveTodoRow = (todo: SmartTodoItem) => {
    const dueHint = extractTodoDueHint(todo.notes);
    const overdue = isTodoOverdue(todo, Date.now(), timeZone);
    const deadlineAt = getTodoDeadlineAt(todo);
    const dueDate = getTodoDueDate(todo, timeZone);
    const linkedActivity = todo.linkedScheduledActivityId
      ? scheduledActivityById.get(todo.linkedScheduledActivityId)
      : undefined;
    const isScheduled = !!linkedActivity && !todo.done;
    const atomized = getTodoAtomizedProgress(todo);
    const atomizedProgressLabel = atomized.isAtomized && atomized.totalMin != null
      ? `${atomized.progressMin}/${atomized.totalMin} min done`
      : null;

    return (
      <View key={todo.id} style={[styles.todoRow, overdue && styles.todoRowOverdue]}>
        <Pressable
          onPress={() => {
            if (todo.done) {
              actions.updateSmartTodo({ ...todo, done: false });
              return;
            }
            const completion = applyTodoChunkCompletion(todo, linkedActivity?.durationMin);
            actions.updateSmartTodo({
              ...completion.todo,
              completionPromptedAt: new Date().toISOString(),
            });
            if (completion.usedAtomizedProgress && completion.totalMin != null) {
              const progressCopy = `${completion.progressMin}/${completion.totalMin} min`;
              Alert.alert(
                completion.becameDone ? 'To-do completed' : 'Chunk completed',
                completion.becameDone
                  ? `Great work. "${todo.title}" is now fully complete (${progressCopy}).`
                  : `Progress saved for "${todo.title}": ${progressCopy}.`,
              );
            }
          }}
        >
          <Text style={styles.todoCheck}>{todo.done ? '☑' : '☐'}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={styles.todoTitleRow}>
            <Text style={[styles.todoTitle, todo.done && styles.todoDone]}>{todo.title}</Text>
            {overdue && (
              <View style={styles.overdueBadge}>
                <Text style={styles.overdueBadgeText}>Overdue</Text>
              </View>
            )}
          </View>
          {!!deadlineAt && (
            <Text style={[styles.todoDeadline, overdue && styles.todoDeadlineOverdue]}>
              Deadline {new Date(deadlineAt).toLocaleDateString()} {formatCalendarTime(new Date(deadlineAt))}
            </Text>
          )}
          {!deadlineAt && !!dueDate && (
            <Text style={[styles.todoDeadline, overdue && styles.todoDeadlineOverdue]}>
              Due {new Date(`${dueDate}T00:00:00`).toLocaleDateString()}
            </Text>
          )}
          {!deadlineAt && !dueDate && !!dueHint && (
            <Text style={styles.todoDueHint}>{dueHint}</Text>
          )}
          {!!todo.scheduledAt && !todo.done && (
            <Text style={styles.todoScheduledMeta}>
              Scheduled {todo.scheduledMode ? `(${todo.scheduledMode})` : ''}: {new Date(todo.scheduledAt).toLocaleDateString()} {formatCalendarTime(new Date(todo.scheduledAt))}
            </Text>
          )}
          {todo.hasFixedSchedule && !!deadlineAt && (
            <Text style={styles.todoFixedMeta}>Fixed time/date to-do</Text>
          )}
          {!!atomizedProgressLabel && (
            <Text style={styles.todoAtomizedProgress}>{atomizedProgressLabel}</Text>
          )}
        </View>
        {isScheduled ? (
          <Pressable onPress={() => openTodoScheduledActivity(linkedActivity)}>
            <Text style={styles.todoScheduledAction}>Scheduled</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => startTodoScheduling(todo)}>
            <Text style={styles.todoSchedule}>Schedule</Text>
          </Pressable>
        )}
        <Pressable onPress={() => actions.removeSmartTodo(todo.id)}>
          <Text style={styles.todoDelete}>Delete</Text>
        </Pressable>
      </View>
    );
  };

  const renderDoneTodoRow = (todo: SmartTodoItem) => (
    <View key={todo.id} style={styles.todoRowDoneCollapsed}>
      <Pressable onPress={() => actions.updateSmartTodo({ ...todo, done: false })}>
        <Text style={styles.todoCheck}>☑</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.todoTitle, styles.todoDone]}>{todo.title}</Text>
        {(() => {
          const atomized = getTodoAtomizedProgress(todo);
          if (!atomized.isAtomized || atomized.totalMin == null) return null;
          return (
            <Text style={styles.todoAtomizedProgressDone}>
              {atomized.progressMin}/{atomized.totalMin} min done
            </Text>
          );
        })()}
      </View>
      <Pressable onPress={() => actions.removeSmartTodo(todo.id)}>
        <Text style={styles.todoDelete}>Delete</Text>
      </Pressable>
    </View>
  );

  const openTodoScheduledActivity = (activity: ScheduledActivity) => {
    const startAt = new Date(activity.startAt);
    const dayId = startAt.toISOString().slice(0, 10);
    const startMinute = minuteOfDay(startAt);
    pendingViewportFocusRef.current = {
      dayId,
      minute: startMinute,
    };
    setTodoModalOpen(false);
    clearTodoSchedulingMode();
    setTimeout(() => {
      focusCalendarViewport(dayId, startMinute, true);
      setSelectedScheduledActivity(activity);
    }, 90);
  };

  const scheduleSuggestion = async (gap: CalendarGap, entry: SmartSuggestionDeckEntry) => {
    if (!premiumEnabled) {
      showPremiumInfo();
      return;
    }
    const suggestion = entry.suggestion;
    const deckSuggestion = entry.deck;

    if (!actions.spendSwipe()) {
      Alert.alert(isGerman ? 'Keine Swipes mehr' : 'No swipes left', isGerman ? 'Du hast keine Swipes mehr. SchlieSSe Aktivitaten ab oder warte auf Aufladung.' : 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }

    const startAt = gap.startAt;
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

    const scheduledId = `sched_smart_${Date.now()}`;
    actions.addScheduledActivity({
      id: scheduledId,
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
      planReason: suggestion.reason,
      planSource: suggestion.source,
    });

    const linkedTodo = resolveTodoFromSuggestion(suggestion);
    if (linkedTodo) {
      updateTodoAfterSchedule(linkedTodo, scheduledId, startAt, endAt, 'smart');
    }

    const consumedSuggestionTitleKey = normalizeSuggestionTitleKey(entry.suggestion.title);
    setGapSuggestions((prev) => prev.filter(
      (item) => normalizeSuggestionTitleKey(item.suggestion.title) !== consumedSuggestionTitleKey,
    ));
    setSuggestionIndex(0);
    setDeckExhausted(false);

    const activeBatchIndex = gapBatchIndexByKey[gapCacheKey(gap)] ?? 0;
    const activeBatchCacheKey = gapBatchCacheKey(gap, activeBatchIndex);
    setGapSuggestionCache((prev) => {
      const existing = prev[activeBatchCacheKey] ?? [];
      const filtered = existing.filter(
        (item) => normalizeSuggestionTitleKey(item.title) !== consumedSuggestionTitleKey,
      );
      const next = { ...prev, [activeBatchCacheKey]: filtered };
      persistGapCache(next);
      return next;
    });

    // A free slot can hold MORE than one activity. If usable time remains after
    // this booking, keep the modal open on the leftover sub-slot so the user can
    // stack another activity; otherwise close.
    const remainingMin = Math.round((gap.endAt.getTime() - endAt.getTime()) / 60000);
    if (remainingMin >= 20) {
      const continuationGap: CalendarGap = {
        ...gap,
        id: `${gap.id}_cont_${endAt.getTime()}`,
        startAt: endAt,
        durationMin: remainingMin,
        before: {
          id: `just_scheduled_${endAt.getTime()}`,
          title: deckSuggestion.title,
          startAt,
          endAt,
          source: 'scheduled',
        },
      };
      setSelectedGap(continuationGap);
      Alert.alert(isGerman ? 'Hinzugefugt - fulle diesen Slot weiter' : 'Added — keep filling this slot', isGerman ? `${remainingMin} Min sind noch frei. Wahlen eine weitere Aktivitat oder tippe auf SchlieSen.` : `${remainingMin} min still free. Pick another activity or tap Close.`);
      return;
    }

    setSelectedGap(null);
    if (calendarWriteFailed && state.permissions.calendarGranted) {
      Alert.alert(isGerman ? 'Zum Plan hinzugefugt' : 'Added to plan', isGerman ? 'Der Vorschlag wurde hinzugefugt, aber die Synchronisierung mit deinem Kalender ist fehlgeschlagen.' : 'The suggestion was added, but syncing to your device calendar failed.');
      return;
    }
    Alert.alert(isGerman ? 'Zum Plan hinzugefugt' : 'Added to plan', isGerman ? 'Der Vorschlag wurde zu deinen geplanten Aktivitaten und deinem Kalender hinzugefugt.' : 'The suggestion was added to your scheduled activities and your device calendar.');
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
      Alert.alert(isGerman ? 'Keine Swipes mehr' : 'No swipes left', isGerman ? 'Du hast keine Swipes mehr. SchlieSSe Aktivitaten ab oder warte auf Aufladung.' : 'You have no swipes remaining. Complete activities or wait for recharge.');
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
    if (!hasSwipesRemaining) {
      Alert.alert(isGerman ? 'Keine Swipes mehr' : 'No swipes left', isGerman ? 'Du hast keine Swipes mehr. SchlieSSe Aktivitaten ab oder warte auf Aufladung.' : 'You have no swipes remaining. Complete activities or wait for recharge.');
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

  const openScheduledActivityModal = (activity: ScheduledActivity) => {
    setSelectedScheduledActivity(activity);
    setEventEditTitle(activity.title);
    setEventEditDescription(activity.description ?? '');
    setEventEditStartAt(new Date(activity.startAt));
    setEventEditDatePickerVisible(false);
    setEventEditTimePickerVisible(false);
  };

  const handleEventEditDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setEventEditDatePickerVisible(false);
    if (event.type === 'dismissed' || !selectedDate || !eventEditStartAt) return;

    const next = new Date(eventEditStartAt);
    next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    setEventEditStartAt(next);
  };

  const handleEventEditTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    setEventEditTimePickerVisible(false);
    if (event.type === 'dismissed' || !selectedTime || !eventEditStartAt) return;

    const next = new Date(eventEditStartAt);
    next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
    setEventEditStartAt(next);
  };

  const openEventEditDatePicker = () => {
    if (!eventEditStartAt) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: eventEditStartAt,
        mode: 'date',
        onChange: (event, selectedDate) => {
          if (event.type === 'dismissed' || !selectedDate || !eventEditStartAt) return;
          const next = new Date(eventEditStartAt);
          next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          setEventEditStartAt(next);
        },
      });
      return;
    }
    setEventEditDatePickerVisible(true);
  };

  const openEventEditTimePicker = () => {
    if (!eventEditStartAt) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: eventEditStartAt,
        mode: 'time',
        is24Hour: true,
        onChange: (event, selectedTime) => {
          if (event.type === 'dismissed' || !selectedTime || !eventEditStartAt) return;
          const next = new Date(eventEditStartAt);
          next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
          setEventEditStartAt(next);
        },
      });
      return;
    }
    setEventEditTimePickerVisible(true);
  };

  const saveScheduledActivityEdits = async () => {
    if (!selectedScheduledActivity || !eventEditStartAt) return;

    const title = eventEditTitle.trim() || selectedScheduledActivity.title;
    const description = eventEditDescription.trim();
    const durationMin = selectedScheduledActivity.durationMin
      || Math.max(15, Math.round((new Date(selectedScheduledActivity.endAt).getTime() - new Date(selectedScheduledActivity.startAt).getTime()) / 60000));
    const nextStart = new Date(eventEditStartAt);
    nextStart.setSeconds(0, 0);
    const nextEnd = new Date(nextStart.getTime() + durationMin * 60000);

    let calendarEventId = selectedScheduledActivity.calendarEventId;
    if (state.permissions.calendarGranted && calendarEventId) {
      try {
        await deletePlanEvent(calendarEventId);
        calendarEventId = await createPlanEvent({
          title,
          startDate: nextStart,
          endDate: nextEnd,
          notes: description,
        });
      } catch (error) {
        console.warn('[SmartCalendar] Failed to update calendar event during edit', error);
      }
    }

    const updated: ScheduledActivity = {
      ...selectedScheduledActivity,
      title,
      description,
      startAt: nextStart.toISOString(),
      endAt: nextEnd.toISOString(),
      calendarEventId,
      suggestion: {
        ...selectedScheduledActivity.suggestion,
        title,
        description,
        durationMin,
      },
      commitment: {
        ...selectedScheduledActivity.commitment,
        title,
        startAt: nextStart.toISOString(),
        endAt: nextEnd.toISOString(),
        calendarEventId,
      },
    };

    pendingViewportFocusRef.current = {
      dayId: nextStart.toISOString().slice(0, 10),
      minute: minuteOfDay(nextStart),
    };
    actions.updateScheduledActivity(updated.id, updated);
    if (editMode) setEditHasChanges(true);
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
        Alert.alert(isGerman ? 'Konnte nicht loschen' : 'Could not delete', isGerman ? 'Bitte versuche es in deiner Kalender-App erneut.' : 'Please try again from your calendar app.');
        return;
      }
    }

    actions.removeScheduledActivity(selectedScheduledActivity.id);
    setSelectedScheduledActivity(null);
  };

  const confirmDeleteActivityById = (activity: ScheduledActivity) => {
    Alert.alert(isGerman ? 'Aktivitat loschen?' : 'Delete activity?', isGerman ? `"${activity.title}" aus deinem Plan entfernen?` : `Remove "${activity.title}" from your schedule?`, [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          const linkedEventId = activity.calendarEventId ?? activity.commitment?.calendarEventId;
          if (linkedEventId) {
            try {
              await deletePlanEvent(linkedEventId);
            } catch (error) {
              console.warn('Failed to delete calendar event for activity', error);
            }
          }
          if (editMode) setEditHasChanges(true);
          actions.removeScheduledActivity(activity.id);
        },
      },
    ]);
  };

  const rescheduleActivityTime = async (activity: ScheduledActivity, newStartAt: Date): Promise<void> => {
    const durationMin = activity.durationMin
      || Math.max(15, Math.round((new Date(activity.endAt).getTime() - new Date(activity.startAt).getTime()) / 60000));
    const newEndAt = new Date(newStartAt.getTime() + durationMin * 60000);

    let calendarEventId = activity.calendarEventId;
    if (state.permissions.calendarGranted && calendarEventId) {
      try {
        await deletePlanEvent(calendarEventId);
        calendarEventId = await createPlanEvent({
          title: activity.title,
          startDate: newStartAt,
          endDate: newEndAt,
          notes: activity.description,
        });
      } catch (error) {
        console.warn('[SmartCalendar] Failed to move calendar event', error);
      }
    }

    actions.updateScheduledActivity(activity.id, {
      ...activity,
      startAt: newStartAt.toISOString(),
      endAt: newEndAt.toISOString(),
      calendarEventId,
      commitment: {
        ...activity.commitment,
        startAt: newStartAt.toISOString(),
        endAt: newEndAt.toISOString(),
        calendarEventId,
      },
    });

    if (editMode) setEditHasChanges(true);
  };

  const swapActivities = async (a: ScheduledActivity, b: ScheduledActivity): Promise<void> => {
    const aStart = new Date(a.startAt);
    const bStart = new Date(b.startAt);
    await rescheduleActivityTime(a, bStart);
    await rescheduleActivityTime(b, aStart);
  };

  const DRAG_DAY_SWITCH_THRESHOLD_PX = 44;

  const resolveAdjacentDayIdByDrag = (activity: ScheduledActivity, translationX: number): string | null => {
    if (Math.abs(translationX) < DRAG_DAY_SWITCH_THRESHOLD_PX) return null;
    const startAt = new Date(activity.startAt);
    const sourceIndex = columns.findIndex((col) => isSameDay(col.date, startAt));
    if (sourceIndex < 0) return null;

    // Horizontal timeline behavior: dragging left targets the next day, dragging
    // right targets the previous day.
    const targetIndex = translationX < 0 ? sourceIndex + 1 : sourceIndex - 1;
    if (targetIndex < 0 || targetIndex >= columns.length) return null;
    return columns[targetIndex].id;
  };

  const resolveDragTargetColumnIndex = (translationX: number) => {
    const startIndex = dragStartColumnIndexRef.current;
    if (startIndex == null || startIndex < 0) return;

    const resistancePx = 40;
    if (Math.abs(translationX) < resistancePx) {
      dragTargetColumnIndexRef.current = startIndex;
      return;
    }

    const step = translationX < 0 ? 1 : -1;
    const maxIndex = Math.max(0, columns.length - 1);
    dragTargetColumnIndexRef.current = Math.max(0, Math.min(maxIndex, startIndex + step));
  };

  const resolveDropTargetDayId = (absoluteX: number): string | null => {
    const viewportX = absoluteX - columnsViewportLeftRef.current;
    if (!Number.isFinite(viewportX)) return null;
    const contentX = lastColumnsScrollXRef.current + viewportX;

    let best: { id: string; dist: number } | null = null;
    for (const column of columns) {
      const colX = dayColumnXRef.current[column.id];
      if (!Number.isFinite(colX)) continue;
      const centerX = colX + DAY_COLUMN_WIDTH / 2;
      const dist = Math.abs(centerX - contentX);
      if (!best || dist < best.dist) best = { id: column.id, dist };
    }
    return best?.id ?? null;
  };

  const resolveDropStartAt = (
    activity: ScheduledActivity,
    absoluteY: number,
    targetColumn: DayColumn,
  ): Date => {
    const durationMin = activity.durationMin
      || Math.max(15, Math.round((new Date(activity.endAt).getTime() - new Date(activity.startAt).getTime()) / 60000));

    const viewportY = absoluteY - verticalViewportRef.current.top;
    const contentY = verticalScrollYRef.current + viewportY;
    const timelineTop = sharedTimelineTopOffset + TIMELINE_VERTICAL_INSET;
    const minuteAtPointer = globalTimelineRange.minStartMin + ((contentY - timelineTop) / Math.max(0.001, pxPerMinute));

    // Place block by its center at drop point for intuitive "drop where it is" behavior.
    const centeredStartMin = minuteAtPointer - durationMin / 2;
    const snappedStartMin = snapMinutesToGrid(centeredStartMin, 5);
    const clampedStartMin = Math.max(
      targetColumn.timelineStartMin,
      Math.min(targetColumn.timelineEndMin - durationMin, snappedStartMin),
    );

    const startAt = new Date(targetColumn.date);
    startAt.setHours(Math.floor(clampedStartMin / 60), clampedStartMin % 60, 0, 0);
    return startAt;
  };

  const commitEventDrag = (
    activity: ScheduledActivity,
    deltaMinutes: number,
    targetDayId?: string | null,
    forcedStartAt?: Date,
  ) => {
    const snappedDelta = Math.round(deltaMinutes / 5) * 5;

    const origStart = new Date(activity.startAt);
    const durationMin = activity.durationMin
      || Math.max(15, Math.round((new Date(activity.endAt).getTime() - origStart.getTime()) / 60000));

    const sourceColumn = columns.find((col) => isSameDay(col.date, origStart));
    const column = columns.find((col) => col.id === targetDayId) ?? sourceColumn;
    if (!column) return;

    const dayStartMin = column?.timelineStartMin ?? DAY_START_HOUR * 60;
    const dayEndMin = column?.timelineEndMin ?? DAY_END_HOUR * 60;
    let newStart: Date;
    if (forcedStartAt) {
      newStart = new Date(forcedStartAt);
      const min = minuteOfDay(newStart);
      const clamped = Math.max(dayStartMin, Math.min(dayEndMin - durationMin, min));
      newStart.setHours(Math.floor(clamped / 60), clamped % 60, 0, 0);
    } else {
      const desiredStartMin = minuteOfDay(origStart) + snappedDelta;
      const newStartMin = Math.max(dayStartMin, Math.min(dayEndMin - durationMin, desiredStartMin));
      newStart = new Date(column.date);
      newStart.setHours(Math.floor(newStartMin / 60), newStartMin % 60, 0, 0);
    }
    const newEnd = new Date(newStart.getTime() + durationMin * 60000);

    const movedAcrossDay = !isSameDay(origStart, newStart);
    if (snappedDelta === 0 && !movedAcrossDay) return;

    const others = (column?.blocks ?? []).filter((block) => block.id !== activity.id);
    const overlap = others.find((block) =>
      Math.max(block.startAt.getTime(), newStart.getTime()) < Math.min(block.endAt.getTime(), newEnd.getTime()),
    );

    if (overlap) {
      if (overlap.source === 'calendar') {
        Alert.alert('Locked slot', `"${overlap.title}" comes from your external calendar and can't be moved or overlapped.`);
        return;
      }
      const other = state.scheduledActivities.find((item) => item.id === overlap.id);
      if (other) {
        Alert.alert(
          'Swap activities?',
          `That slot already holds "${other.title}". Swap the two times?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Swap', onPress: () => { void swapActivities(activity, other); } },
          ],
        );
        return;
      }
    }

    pendingViewportFocusRef.current = {
      dayId: column.id,
      minute: minuteOfDay(newStart),
    };
    focusCalendarViewport(column.id, minuteOfDay(newStart), false);
    void rescheduleActivityTime(activity, newStart);
  };

  // While an activity is being dragged in edit mode the calendar itself no longer
  // scrolls from finger gestures; instead the dragged activity drives navigation:
  // when it nears an edge we auto-scroll the timeline (vertically) or the day
  // columns (horizontally) in that direction.
  const stopDragAutoScroll = () => {
    autoScrollVectorRef.current = { vy: 0, hx: 0 };
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  };

  // Keeps the dragged block glued to the finger: its visual offset is the finger
  // translation PLUS however far the timeline has auto-scrolled since the grab.
  const applyDragTranslate = () => {
    const scrollComp = verticalScrollYRef.current - dragStartScrollYRef.current;
    dragTranslateY.setValue(dragBaseTranslationRef.current + scrollComp);
  };

  const ensureDragAutoScroll = () => {
    if (autoScrollIntervalRef.current) return;
    autoScrollIntervalRef.current = setInterval(() => {
      const { vy, hx } = autoScrollVectorRef.current;
      if (vy === 0 && hx === 0) {
        stopDragAutoScroll();
        return;
      }
      if (vy !== 0) {
        const nextY = Math.max(0, verticalScrollYRef.current + vy);
        if (nextY !== verticalScrollYRef.current) {
          verticalScrollYRef.current = nextY;
          calendarVerticalScrollRef.current?.scrollTo({ y: nextY, animated: false });
        }
      }
      if (hx !== 0) {
        const maxX = Math.max(0, columnsContentWidthRef.current - columnsViewportWidthRef.current);
        const nextX = Math.max(0, Math.min(maxX, lastColumnsScrollXRef.current + hx));
        if (nextX !== lastColumnsScrollXRef.current) {
          lastColumnsScrollXRef.current = nextX;
          columnsScrollRef.current?.scrollTo({ x: nextX, y: 0, animated: false });
        }
      }
      applyDragTranslate();
    }, 16);
  };

  // Edge auto-scroll while dragging: vertical timeline + horizontal day strip.
  const handleDragEdge = (pageX: number, pageY: number, translationX: number) => {
    const viewport = verticalViewportRef.current;
    const vEdge = 90;
    const hEdge = 54;
    let vy = 0;
    let hx = 0;
    if (viewport.height > 0) {
      if (pageY < viewport.top + vEdge) vy = -12;
      else if (pageY > viewport.top + viewport.height - vEdge) vy = 12;
    }
    if (pageX <= hEdge && translationX > 34) hx = -10;
    else if (pageX >= viewportWidth - hEdge && translationX < -34) hx = 10;

    autoScrollVectorRef.current = { vy, hx };
    if (vy !== 0 || hx !== 0) ensureDragAutoScroll();
    else stopDragAutoScroll();
  };

  const handleDragGesture = (translationY: number, translationX: number, absX: number, absY: number) => {
    dragBaseTranslationRef.current = translationY;
    applyDragTranslate();
    resolveDragTargetColumnIndex(translationX);
    handleDragEdge(absX, absY, translationX);
  };

  const handleDragStateChange = (
    activity: ScheduledActivity,
    gestureState: number,
    oldState: number,
    translationY: number,
    translationX: number,
    absoluteX: number,
    absoluteY: number,
  ) => {
    if (gestureState === State.ACTIVE) {
      dragActivityRef.current = activity;
      dragStartScrollYRef.current = verticalScrollYRef.current;
      dragBaseTranslationRef.current = 0;
      dragTranslateY.setValue(0);
      const sourceIndex = columns.findIndex((col) => isSameDay(col.date, new Date(activity.startAt)));
      dragStartColumnIndexRef.current = sourceIndex >= 0 ? sourceIndex : null;
      dragTargetColumnIndexRef.current = sourceIndex >= 0 ? sourceIndex : null;
      setDraggingBlockId(activity.id);
      if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined);
      return;
    }
    // Gesture ended (END) or was cancelled/failed while it had been active.
    if (oldState === State.ACTIVE) {
      stopDragAutoScroll();
      const scrollComp = verticalScrollYRef.current - dragStartScrollYRef.current;
      const totalPx = translationY + scrollComp;
      const deltaMinutes = pxPerMinute > 0 ? totalPx / pxPerMinute : 0;
      const act = dragActivityRef.current;
      dragActivityRef.current = null;
      setDraggingBlockId(null);
      // Snap the visual block back to origin; the (possibly) new position comes
      // from re-deriving the timeline after commitEventDrag updates state.
      Animated.timing(dragTranslateY, { toValue: 0, duration: 140, useNativeDriver: false }).start();
      if (act) {
        const targetIndex = dragTargetColumnIndexRef.current;
        const fromLiveTarget = targetIndex != null && targetIndex >= 0 && targetIndex < columns.length
          ? columns[targetIndex].id
          : null;
        const fromDrop = resolveDropTargetDayId(absoluteX);
        const targetDayId = fromDrop ?? fromLiveTarget ?? resolveAdjacentDayIdByDrag(act, translationX);
        const targetColumn = columns.find((col) => col.id === targetDayId)
          ?? columns.find((col) => isSameDay(col.date, new Date(act.startAt)));
        const dropStartAt = targetColumn ? resolveDropStartAt(act, absoluteY, targetColumn) : undefined;
        commitEventDrag(act, deltaMinutes, targetDayId, dropStartAt);
      }
      dragStartColumnIndexRef.current = null;
      dragTargetColumnIndexRef.current = null;
    }
  };

  useEffect(() => () => stopDragAutoScroll(), []);

  const enterEditMode = () => {
    if (schedulingActive) clearTodoSchedulingMode();
    setSelectedScheduledActivity(null);
    setSelectedGap(null);
    editSnapshotRef.current = cloneScheduledActivities(state.scheduledActivities);
    setEditHasChanges(false);
    setEditMode(true);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  };

  const closeEditSession = () => {
    stopDragAutoScroll();
    dragActivityRef.current = null;
    setDraggingBlockId(null);
    dragTranslateY.setValue(0);
    setEditHasChanges(false);
    editSnapshotRef.current = null;
    setEditMode(false);
  };

  const saveEditModeChanges = () => {
    closeEditSession();
  };

  const discardEditModeChanges = () => {
    const snapshot = editSnapshotRef.current;
    if (snapshot) {
      const currentById = new Map(state.scheduledActivities.map((item) => [item.id, item]));
      const snapshotById = new Map(snapshot.map((item) => [item.id, item]));

      for (const item of state.scheduledActivities) {
        if (!snapshotById.has(item.id)) {
          actions.removeScheduledActivity(item.id);
        }
      }

      for (const baseline of snapshot) {
        if (currentById.has(baseline.id)) {
          actions.updateScheduledActivity(baseline.id, baseline);
        } else {
          actions.addScheduledActivity(baseline);
        }
      }
    }

    closeEditSession();
  };

  const handleEditCancelPress = () => {
    if (!editHasChanges) {
      closeEditSession();
      return;
    }

    Alert.alert(
      'Discard edits?',
      'You made changes in edit mode. Do you want to save instead?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save', onPress: saveEditModeChanges },
        { text: 'Discard', style: 'destructive', onPress: discardEditModeChanges },
      ],
    );
  };

  const applyWeekPlanItem = async (item: WeekPlanItem): Promise<void> => {
    const deckSuggestion = buildWeekPlanDeckSuggestion(item);
    const eventTitle = item.source === 'todo' ? `To-do: ${item.title}` : item.title;

    let calendarEventId: string | undefined;
    let calendarWriteFailed = !state.permissions.calendarGranted;
    if (state.permissions.calendarGranted) {
      try {
        calendarEventId = await createPlanEvent({
          title: eventTitle,
          startDate: item.startAt,
          endDate: item.endAt,
          notes: item.reason,
        });
        calendarWriteFailed = false;
      } catch (error) {
        console.warn('[SmartCalendar] Failed to create week-plan calendar event', error);
      }
    }

    actions.addScheduledActivity({
      id: `sched_weekplan_${item.id}_${Date.now()}`,
      suggestionId: deckSuggestion.id,
      title: item.title,
      description: deckSuggestion.description,
      durationMin: item.durationMin,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      type: deckSuggestion.type,
      tags: ['smart_calendar', 'week_plan', item.source],
      suggestion: deckSuggestion,
      commitment: {
        suggestionId: deckSuggestion.id,
        type: deckSuggestion.type,
        title: item.title,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        calendarEventId,
        calendarWriteFailed,
      },
      calendarEventId,
      calendarWriteFailed,
      planReason: item.reason,
      planSource: item.source,
    });
  };

  // Runs the model, shows a video ad to non-premium users while it works, then
  // applies the plan. Only consumes the weekly cooldown when items are placed.
  const executeWeekPlan = async (days: WeekPlanDayInput[], context: WeekPlanContext): Promise<void> => {
    setPlanningWeek(true);
    // Kick the model off immediately so it works in the background while the ad plays.
    const planPromise = planWeekWithGemini(days, context);

    if (adsFreeUser) {
      const ad = consumeVideoAd(adKeywords);
      if (ad) {
        await new Promise<void>((resolve) => {
          videoAdResolveRef.current = resolve;
          setVideoAd(ad);
        });
      } else {
        // Nothing ready — warm one up for next time and continue without blocking.
        preloadVideoAd(adKeywords);
      }
    }

    try {
      const { items, usedAi } = await planPromise;
      if (!items.length) {
        Alert.alert('Nothing to place', 'The planner could not find useful items for your open slots.');
        return;
      }
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await applyWeekPlanItem(item);
      }
      // Success — start the 7-day cooldown for non-admin users only.
      if (!isAdminUser) {
        const usedAt = Date.now();
        setWeekPlanLastUsedAt(usedAt);
        AsyncStorage.setItem(WEEK_PLAN_LAST_USED_KEY, String(usedAt)).catch(() => undefined);
      }
      Alert.alert(
        'Week planned',
        `${items.length} item${items.length === 1 ? '' : 's'} placed${usedAi ? ' by AI' : ''}. Tap any item to see why it's there, or long-press it to edit and shift things around.`,
      );
    } catch (error) {
      console.warn('[SmartCalendar] Week planning failed', error);
      Alert.alert('Planning failed', 'Something went wrong while planning your week. Please try again.');
    } finally {
      setPlanningWeek(false);
    }
  };

  const runUltimatePlan = () => {
    if (planningWeek) return;

    if (!weekPlanAvailable) {
      const daysLeft = weekPlanLastUsedAt
        ? Math.max(1, Math.ceil((WEEK_PLAN_COOLDOWN_MS - (Date.now() - weekPlanLastUsedAt)) / (24 * 60 * 60 * 1000)))
        : 1;
      Alert.alert('Already planned', `You can plan your whole week again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
      return;
    }

    if (!columns.length) {
      Alert.alert('Nothing to plan', 'Your week has no free time to fill yet.');
      return;
    }

    const days: WeekPlanDayInput[] = columns.map((col, idx) => ({
      dayIndex: idx,
      date: col.date,
      label: col.label,
      gaps: col.gaps,
      busy: col.blocks.map((block) => ({ title: block.title, startAt: block.startAt, endAt: block.endAt })),
    }));
    const context: WeekPlanContext = {
      habits: state.habits,
      todos: state.smartTodos,
      challenges: [],
      defaultLocation: { lat: state.location.lat ?? undefined, lng: state.location.lng ?? undefined },
    };

    const totalGaps = days.reduce((sum, day) => sum + day.gaps.length, 0);
    if (!totalGaps) {
      Alert.alert('No free gaps', 'There are no open slots in the next 7 days to plan into.');
      return;
    }

    Alert.alert(
      'Plan my whole week?',
      adsFreeUser
        ? `The planner fills your free gaps with to-dos, habits and smart picks — each with a reason you can tap to read. A short ad plays while it works.${isAdminUser ? ' Admin accounts can run this anytime.' : ' You can plan again in 7 days.'}`
        : `The planner fills your free gaps with to-dos, habits and smart picks — each with a reason you can tap to read. It never moves anything locked.${isAdminUser ? ' Admin accounts can run this anytime.' : ' You can plan again in 7 days.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Plan week', onPress: () => { void executeWeekPlan(days, context); } },
      ],
    );
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.sm }]}>
        <View style={styles.headerSideLeft}>
          {editMode ? (
            editHasChanges ? (
              <Pressable onPress={saveEditModeChanges} style={styles.editSaveBtn} hitSlop={8}>
                <Text style={styles.editSaveText}>Save</Text>
              </Pressable>
            ) : (
              <View style={styles.editSavePlaceholder} />
            )
          ) : (
            <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.planAheadTitleContainer}>
          <Text style={styles.planAheadTitle}>PLAN AHEAD</Text>
        </View>

        <View style={styles.headerSideRight}>
          {editMode ? (
            <Pressable onPress={handleEditCancelPress} style={styles.editCancelBtn} hitSlop={8}>
              <Text style={styles.editCancelText}>Cancel</Text>
            </Pressable>
          ) : (
            <>
              <Pressable onPress={enterEditMode} hitSlop={8} accessibilityLabel="Edit schedule">
                <Text style={styles.editPencilIcon}>✏️</Text>
              </Pressable>
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
            </>
          )}
        </View>
      </View>

      {editMode && (
        <View style={styles.editHintBar}>
          <Text style={styles.editHintText}>
            Edit mode — drag up/down to reschedule. Push into the left/right edge with a little resistance to move across days. 🚫 items are locked. Tap Cancel to finish.
          </Text>
        </View>
      )}

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
          scrollEnabled={!editMode || draggingBlockId === null}
          scrollEventThrottle={16}
          onScroll={(event) => {
            verticalScrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
          onLayout={(event) => {
            const { y, height } = event.nativeEvent.layout;
            verticalViewportRef.current = { top: y, height };
            setCalendarViewportHeight((prev) => (prev === height ? prev : height));
          }}
        >
          <ScrollView
            ref={columnsScrollRef}
            horizontal
            scrollEnabled={!editMode || draggingBlockId === null}
            showsHorizontalScrollIndicator={false}
            onLayout={(event) => {
              columnsViewportLeftRef.current = event.nativeEvent.layout.x;
              columnsViewportWidthRef.current = event.nativeEvent.layout.width;
            }}
            onContentSizeChange={(width) => {
              columnsContentWidthRef.current = width;
            }}
            contentContainerStyle={[
              styles.columnsWrap,
              { paddingLeft: horizontalEdgePadding, paddingRight: horizontalEdgePadding },
            ]}
            scrollEventThrottle={16}
            onScroll={(event) => {
              lastColumnsScrollXRef.current = event.nativeEvent.contentOffset.x;
            }}
            onScrollBeginDrag={() => {
              // A fresh user gesture always clears any stale programmatic-snap
              // flag so genuine swipes are never accidentally skipped.
              snapInFlightRef.current = false;
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
              // Skip snapping when this momentum-end was produced by our own
              // programmatic snap scroll, otherwise the animated scrollTo keeps
              // re-triggering itself and the ScrollView never settles.
              if (snapInFlightRef.current) {
                snapInFlightRef.current = false;
                return;
              }
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
                    <NowIndicator
                      minStartMin={globalTimelineRange.minStartMin}
                      maxEndMin={globalTimelineRange.maxEndMin}
                      pxPerMinute={pxPerMinute}
                      calendarMinimized={calendarMinimized}
                      timeZone={timeZone}
                      styles={styles}
                    />
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
                        openScheduledActivityModal(scheduled);
                      };

                      const laneCount = Math.max(1, laneMeta.laneCount);
                      const insetPct = (TIMELINE_HORIZONTAL_INSET / segmentTrackWidth) * 100;
                      const gapPct = laneCount > 1 ? (TIMELINE_LANE_GAP / segmentTrackWidth) * 100 : 0;
                      const laneWidthPct = (100 - insetPct * 2 - gapPct * (laneCount - 1)) / laneCount;
                      const leftPct = insetPct + laneMeta.laneIndex * (laneWidthPct + gapPct);
                      const isSmartCalendarBlock = segment.block.source === 'scheduled'
                        && smartCalendarScheduledIds.has(segment.block.id);
                      const baseAlpha = laneCount > 1 ? Math.max(0.4, 1 - laneMeta.laneIndex * 0.2) : 1;
                      const tintAlpha = eventTintAlphaByDay[column.id]?.[segment.block.id] ?? 1;
                      const alpha = Math.max(0.3, Math.min(1, baseAlpha * tintAlpha));
                      const overlapColor = isSmartCalendarBlock
                        ? `rgba(76,148,111,${alpha})`
                        : `rgba(37,99,235,${alpha})`;
                      const hasOverlap = overlapBlockIdsByDay[column.id]?.has(segment.block.id) ?? false;
                      const isMovable = segment.block.source === 'scheduled';

                      return (
                        <EditableEventBlock
                          key={segment.id}
                          title={segment.block.title}
                          timeLabel={`${formatCalendarTime(segment.startAt)} - ${formatCalendarTime(segment.endAt)}`}
                          top={top}
                          height={cellHeight}
                          leftPct={leftPct}
                          widthPct={laneWidthPct}
                          backgroundColor={overlapColor}
                          zIndex={20 + laneMeta.laneIndex}
                          editMode={editMode}
                          movable={isMovable}
                          styles={styles}
                          dragTranslateY={dragTranslateY}
                          isBeingDragged={draggingBlockId === segment.block.id}
                          hasOverlap={hasOverlap}
                          onPress={openPlan}
                          onLongPress={() => {
                            if (!editMode) enterEditMode();
                          }}
                          onDragGesture={handleDragGesture}
                          onDragStateChange={(gestureState, oldState, translationY, translationX, absoluteX, absoluteY) => {
                            const scheduled = state.scheduledActivities.find((item) => item.id === segment.block!.id);
                            if (scheduled) handleDragStateChange(
                              scheduled,
                              gestureState,
                              oldState,
                              translationY,
                              translationX,
                              absoluteX,
                              absoluteY,
                            );
                          }}
                          onDelete={editMode && isMovable ? () => {
                            const scheduled = state.scheduledActivities.find((item) => item.id === segment.block!.id);
                            if (scheduled) confirmDeleteActivityById(scheduled);
                          } : undefined}
                        />
                      );
                    }

                    if (segment.kind === 'gap' && segment.gap) {
                      const cellHeight = Math.max(durationMin * pxPerMinute, minSegmentHeight(segment));
                      return (
                        <Pressable
                          key={segment.id}
                          onPressIn={(event) => {
                            if (todoSchedulingMode !== 'manual' || !todoSchedulingTarget) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, segment.gap!.durationMin);
                            updateManualPreviewForGap(segment.gap!, event.nativeEvent.locationY, cellHeight, durationMinForTodo);
                          }}
                          onTouchMove={(event) => {
                            if (todoSchedulingMode !== 'manual' || !todoSchedulingTarget) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, segment.gap!.durationMin);
                            updateManualPreviewForGap(segment.gap!, event.nativeEvent.locationY, cellHeight, durationMinForTodo);
                          }}
                          onPressOut={() => {
                            if (todoSchedulingMode === 'manual') setManualPreview(null);
                          }}
                          onPress={(event) => {
                            if (todoSchedulingMode !== 'manual' || !todoSchedulingTarget) return;
                            const durationMinForTodo = computeTodoDurationMin(todoSchedulingTarget, segment.gap!.durationMin);
                            const pickedStartAt = computeManualStartInGap(
                              segment.gap!,
                              event.nativeEvent.locationY,
                              cellHeight,
                              durationMinForTodo,
                            );
                            confirmManualTodoSchedule(todoSchedulingTarget, pickedStartAt, durationMinForTodo);
                          }}
                          style={[styles.gapBlock, { top, height: cellHeight, zIndex: 5 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.gapTime}>{formatCalendarTime(segment.startAt)} - {formatCalendarTime(segment.endAt)}</Text>
                            <Text style={styles.gapMeta}>{t('smart_gap_free_min', { value: segment.durationMin })}</Text>
                            {todoSchedulingMode === 'manual' && !!todoSchedulingTarget && (
                              <Text style={styles.manualGapHint}>{t('smart_tap_todo_start')}</Text>
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
                              <Text style={styles.plusText}>{t('smart_plus')}</Text>
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
                                setSelectedGap(segment.gap!);
                              }}
                            >
                              <Text style={[styles.plusText, !premiumEnabled && styles.plusTextLocked]}>
                                {premiumEnabled ? t('smart_plus') : '👑'}
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
                      const height = Math.max(item.slot.durationMin * pxPerMinute, 56);
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
                                Alert.alert(t('smart_scheduled_title'), `"${todoSchedulingTarget.title}" scheduled at ${formatCalendarTime(item.suggestedStartAt)}.`);
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
                              {todoSchedulingTarget?.title ?? t('smart_todo_slot')}
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
            <Text style={styles.smartTodoOtherBtnText}>{t('smart_other')}</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.calendarMinimizeWrap, { bottom: insets.bottom + theme.spacing.md }]}> 
        <Pressable
          style={styles.calendarMinimizeButton}
          onPress={() => setCalendarMinimized((prev) => !prev)}
        >
          <Text style={styles.calendarMinimizeButtonText}>{calendarMinimized ? t('smart_expand') : t('smart_minimize')}</Text>
        </Pressable>
      </View>

      <Modal visible={!!selectedGap} transparent animationType="slide" onRequestClose={() => setSelectedGap(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { marginBottom: insets.bottom + theme.spacing.lg }]}>
            <Text style={styles.modalTitle}>{t('smart_gap_suggestions')}</Text>
            {suggestionsLoading ? (
              <View style={styles.centerWrap}>
                <ActivityIndicator size="large" color={theme.colors.accent} style={{ marginBottom: theme.spacing.md }} />
                <Text style={styles.subtle}>{t('smart_gathering')}</Text>
                <Text style={[styles.subtle, { fontSize: 12, marginTop: theme.spacing.xs, opacity: 0.6 }]}>{t('smart_finding_fit')}</Text>
              </View>
            ) : gapSuggestions.length === 0 ? (
              <Text style={styles.subtle}>{t('smart_no_option')}</Text>
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
                      <Image
                        source={require('../../assets/backarrow.png')}
                        style={[
                          styles.deckUndoIcon,
                          (!canUndoSuggestion || suggestionsLoading) && styles.deckUndoIconDisabled,
                        ]}
                      />
                    </Pressable>
                    <Text style={styles.deckCounterText}>{Math.min(suggestionIndex + 1, gapSuggestions.length)} / {gapSuggestions.length}</Text>
                  </View>
                </View>

                {!hasSwipesRemaining ? (
                  <View style={styles.emptyDeckWrap}>
                    <Text style={styles.emptyDeckTitle}>{t('smart_out_swipes_title')}</Text>
                    <Text style={styles.emptyDeckSubtitle}>
                      {t('smart_out_swipes_body')}
                    </Text>
                  </View>
                ) : deckExhausted ? (
                  <View style={styles.emptyDeckWrap}>
                    <Text style={styles.emptyDeckTitle}>{t('smart_nothing_clicked')}</Text>
                    <Text style={styles.emptyDeckSubtitle}>{t('smart_want_new_set')}</Text>
                    <Pressable style={styles.newSetBtn} onPress={queueNewSetForSelectedGap}>
                      <Text style={styles.newSetBtnText}>{t('smart_new_set')}</Text>
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
                        disabled={!hasSwipesRemaining}
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
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{selectedScheduledActivity?.title ?? 'Scheduled activity'}</Text>
              <Pressable
                accessibilityLabel="Close activity editor"
                hitSlop={8}
                onPress={() => setSelectedScheduledActivity(null)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.modalMeta}>
              {selectedScheduledActivity
                ? `${new Date(selectedScheduledActivity.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatCalendarTime(new Date(selectedScheduledActivity.startAt))} - ${formatCalendarTime(new Date(selectedScheduledActivity.endAt))}`
                : ''}
            </Text>
            {!editMode && !!selectedScheduledActivity?.description && (
              <Text style={styles.suggestionReason}>{selectedScheduledActivity.description}</Text>
            )}
            {editMode && !!selectedScheduledActivity && (
              <>
                <TextInput
                  value={eventEditTitle}
                  onChangeText={setEventEditTitle}
                  placeholder="Activity title"
                  placeholderTextColor={theme.colors.textMuted}
                  style={styles.input}
                />
                <TextInput
                  value={eventEditDescription}
                  onChangeText={setEventEditDescription}
                  placeholder="Description / notes"
                  placeholderTextColor={theme.colors.textMuted}
                  style={[styles.input, { minHeight: 84, textAlignVertical: 'top' }]}
                  multiline
                />
                <View style={styles.deadlinePickerRow}>
                  <Pressable style={styles.deadlinePickerButton} onPress={openEventEditDatePicker}>
                    <Text style={styles.deadlinePickerButtonText}>
                      {eventEditStartAt ? eventEditStartAt.toLocaleDateString() : 'Pick day'}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.deadlinePickerButton} onPress={openEventEditTimePicker}>
                    <Text style={styles.deadlinePickerButtonText}>
                      {eventEditStartAt ? formatCalendarTime(eventEditStartAt) : 'Pick time'}
                    </Text>
                  </Pressable>
                </View>
                {eventEditDatePickerVisible && (
                  <View style={styles.pickerContrastWrap}>
                    <DateTimePicker
                      value={eventEditStartAt ?? new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleEventEditDateChange}
                      {...(Platform.OS === 'ios'
                        ? {
                            textColor: theme.colors.text,
                            accentColor: theme.colors.accent,
                            themeVariant: theme.isDark ? 'dark' : 'light',
                          }
                        : {})}
                    />
                  </View>
                )}
                {eventEditTimePickerVisible && (
                  <View style={styles.pickerContrastWrap}>
                    <DateTimePicker
                      value={eventEditStartAt ?? new Date()}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleEventEditTimeChange}
                      {...(Platform.OS === 'ios'
                        ? {
                            textColor: theme.colors.text,
                            accentColor: theme.colors.accent,
                            themeVariant: theme.isDark ? 'dark' : 'light',
                          }
                        : {})}
                    />
                  </View>
                )}
              </>
            )}
            {!!selectedScheduledActivity?.planReason && (
              <View style={styles.planReasonCard}>
                <Text style={styles.planReasonLabel}>Why this time?</Text>
                <Text style={styles.planReasonText}>{selectedScheduledActivity.planReason}</Text>
              </View>
            )}

            <View style={styles.modalActionRow}>
              <Pressable style={styles.modalTinyBtn} onPress={removeScheduledActivity}>
                <Text style={styles.modalTinyBtnText}>Remove</Text>
              </Pressable>
              {editMode ? (
                <Pressable style={[styles.scheduleBtn, { flex: 1 }]} onPress={() => { void saveScheduledActivityEdits(); }}>
                  <Text style={styles.scheduleBtnText}>Save changes</Text>
                </Pressable>
              ) : (
                <Pressable style={[styles.scheduleBtn, { flex: 1 }]} onPress={openScheduledActivity}>
                  <Text style={styles.scheduleBtnText}>Start now</Text>
                </Pressable>
              )}
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
            <View style={styles.todoListActionRow}>
              <Pressable
                style={styles.addTodoBtn}
                hitSlop={8}
                onPress={() => {
                  setTodoTitle('');
                  setTodoDeadlineAt(null);
                  setTodoHasExplicitTime(false);
                  setTodoDatePickerVisible(false);
                  setTodoTimePickerVisible(false);
                  setTodoModalOpen(false);
                  setTimeout(() => setTodoFormModalOpen(true), 0);
                }}
              >
                <Text style={styles.addTodoBtnText}>Add to-do</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.photoImportBtn,
                  styles.photoImportBtnInline,
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
                      ? 'Import photo (AI)'
                      : 'Import photo (Premium)'}
                </Text>
              </Pressable>
            </View>

            <ScrollView style={styles.modalList}>
              <Pressable style={styles.todoSectionHeader} onPress={() => setShowUnscheduledTodos((prev) => !prev)}>
                <Text style={styles.todoSectionHeaderText}>
                  {showUnscheduledTodos ? '▾' : '▸'} Unscheduled to-dos ({unscheduledTodos.length})
                </Text>
              </Pressable>

              {showUnscheduledTodos && unscheduledTodos.map(renderActiveTodoRow)}

              <Pressable style={styles.todoSectionHeader} onPress={() => setShowScheduledTodos((prev) => !prev)}>
                <Text style={styles.todoSectionHeaderText}>
                  {showScheduledTodos ? '▾' : '▸'} Scheduled to-dos ({scheduledTodos.length})
                </Text>
              </Pressable>

              {showScheduledTodos && scheduledTodos.map(renderActiveTodoRow)}

              <Pressable style={styles.todoSectionHeader} onPress={() => setShowDoneTodos((prev) => !prev)}>
                <Text style={styles.todoSectionHeaderText}>
                  {showDoneTodos ? '▾' : '▸'} Done to-dos ({doneTodos.length})
                </Text>
              </Pressable>

              {showDoneTodos && doneTodos.map(renderDoneTodoRow)}
            </ScrollView>

            <Pressable style={styles.closeBtn} onPress={() => setTodoModalOpen(false)}>
              <Text style={styles.closeBtnText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={todoFormModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setTodoFormModalOpen(false);
          setTodoDatePickerVisible(false);
          setTodoTimePickerVisible(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.todoModalCard}>
            <Text style={styles.modalTitle}>Add To-do</Text>
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
              <View style={styles.pickerContrastWrap}>
                <DateTimePicker
                  value={todoDeadlineAt ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTodoDateChange}
                  {...(Platform.OS === 'ios'
                    ? {
                        textColor: theme.colors.text,
                        accentColor: theme.colors.accent,
                        themeVariant: theme.isDark ? 'dark' : 'light',
                      }
                    : {})}
                />
              </View>
            )}

            {todoTimePickerVisible && (
              <View style={styles.pickerContrastWrap}>
                <DateTimePicker
                  value={todoDeadlineAt ?? new Date()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleTodoTimeChange}
                  {...(Platform.OS === 'ios'
                    ? {
                        textColor: theme.colors.text,
                        accentColor: theme.colors.accent,
                        themeVariant: theme.isDark ? 'dark' : 'light',
                      }
                    : {})}
                />
              </View>
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

            <View style={styles.modalActionRow}>
              <Pressable
                style={styles.modalTinyBtn}
                onPress={() => {
                  setTodoFormModalOpen(false);
                  setTodoDatePickerVisible(false);
                  setTodoTimePickerVisible(false);
                }}
              >
                <Text style={styles.modalTinyBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.scheduleBtn, { flex: 1 }]} onPress={addTodo}>
                <Text style={styles.scheduleBtnText}>Add task</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <VideoAdModal ad={videoAd} onClose={closeVideoAd} deckColors={SMART_CALENDAR_DECK_COLORS} />
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
  headerRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  headerSideLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing.md,
  },
  headerSideRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing.md,
  },
  headerActionMuted: {
    opacity: 0.35,
  },
  starsIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  starsIconBusy: {
    opacity: 0.4,
  },
  editPencilIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  editCancelBtn: {
    minWidth: 88,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: '#111111',
    alignItems: 'center',
  },
  editCancelText: {
    fontFamily: theme.fonts.semibold,
    color: '#FFFFFF',
    fontSize: 13,
  },
  editSaveBtn: {
    minWidth: 88,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: '#F2FAF2',
    borderWidth: 1,
    borderColor: '#111111',
    alignItems: 'center',
  },
  editSaveText: {
    fontFamily: theme.fonts.semibold,
    color: '#111111',
    fontSize: 13,
  },
  editSavePlaceholder: {
    minWidth: 88,
    minHeight: 32,
  },
  editHintBar: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.isDark ? '#3A2E1E' : '#FCEFD6',
    borderWidth: 1,
    borderColor: theme.isDark ? '#5C4A2E' : '#F0D9A8',
  },
  editHintText: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.isDark ? '#F3E6CC' : '#7A5A1E',
  },
  ultimateBar: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  ultimateBtn: {
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  ultimateBtnBusy: {
    opacity: 0.7,
  },
  ultimateBtnText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.accentText,
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
  eventBlockEditing: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    borderStyle: 'dashed',
  },
  eventBlockOverlap: {
    borderWidth: 2,
    borderColor: '#DC2626',
  },
  eventBlockDragging: {
    opacity: 0.92,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  eventBlockImmovable: {
    opacity: 0.85,
  },
  deleteEventBtn: {
    position: 'absolute',
    left: 4,
    top: 0,
    bottom: 0,
    width: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  deleteEventBtnText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '700' as const,
  },
  eventBlockContentWithDelete: {
    marginLeft: 22,
  },
  dragHandleBadge: {
    position: 'absolute',
    top: 2,
    right: 4,
    zIndex: 2,
  },
  dragHandleText: {
    fontSize: 13,
    color: theme.colors.accentText,
  },
  immovableBadge: {
    position: 'absolute',
    top: 2,
    left: 4,
    zIndex: 2,
  },
  immovableBadgeText: {
    fontSize: 12,
  },
  immovableHint: {
    fontFamily: theme.fonts.body,
    fontSize: 9,
    color: theme.colors.accentText,
    opacity: 0.9,
  },
  overlapBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 4,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(220,38,38,0.92)',
  },
  overlapBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 9,
    color: '#FFFFFF',
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
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
    flex: 1,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalCloseBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 16,
    lineHeight: 18,
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
  deckUndoIcon: {
    width: 14,
    height: 14,
    resizeMode: 'contain',
    tintColor: theme.isDark ? theme.colors.text : undefined,
    opacity: 0.75,
  },
  deckUndoIconDisabled: {
    opacity: 0.3,
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
  planReasonCard: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.isDark ? '#22332C' : '#EAF7F0',
    borderWidth: 1,
    borderColor: theme.isDark ? '#33463D' : '#CDE9DC',
  },
  planReasonLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.isDark ? '#9FD8BF' : '#1A6B4A',
    marginBottom: 2,
  },
  planReasonText: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.text,
    lineHeight: 17,
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
  photoImportBtnInline: {
    marginTop: 0,
    flex: 1.2,
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
  todoListActionRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    position: 'relative',
    zIndex: 1,
  },
  addTodoBtn: {
    flex: 1,
    flexShrink: 0,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
    position: 'relative',
    zIndex: 2,
    elevation: 2,
  },
  addTodoBtnText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentText,
    fontSize: 13,
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
  pickerContrastWrap: {
    marginTop: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.isDark ? '#151D29' : '#F3F6FC',
    overflow: 'hidden',
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
  todoRowOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.danger,
    paddingLeft: theme.spacing.sm,
  },
  todoCheck: {
    fontSize: 20,
    color: theme.colors.text,
  },
  todoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  todoTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  overdueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: theme.colors.danger,
  },
  overdueBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#fff',
  },
  todoDeadlineOverdue: {
    color: theme.colors.danger,
    fontFamily: theme.fonts.semibold,
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
  todoAtomizedProgress: {
    fontFamily: theme.fonts.semibold,
    color: '#1D4ED8',
    fontSize: 11,
  },
  todoAtomizedProgressDone: {
    fontFamily: theme.fonts.body,
    color: '#475569',
    fontSize: 11,
    marginTop: 2,
  },
  todoSchedule: {
    fontFamily: theme.fonts.semibold,
    color: '#15803D',
  },
  todoScheduledAction: {
    fontFamily: theme.fonts.semibold,
    color: '#166534',
  },
  todoDelete: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
  },
  todoSectionHeader: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  todoSectionHeaderText: {
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
