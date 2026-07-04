import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SwipeDeck, SwipeDeckHandle } from '../components/SwipeDeck';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { isBusinessPremium } from '../services/user';
import { getUpcomingEvents } from '../services/calendar';
import { CalendarBlock, CalendarGap, DAY_END_HOUR, DAY_START_HOUR, SmartCalendarSuggestion, buildGapSuggestions, findCalendarGaps } from '../services/smartCalendar';
import { Commitment, DeckSuggestion, SmartTodoItem } from '../types';

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
const TIMELINE_HEIGHT = 520;
const GAP_CACHE_KEY = 'smart_calendar_gap_cache_v1';

type SmartSuggestionDeckEntry = {
  suggestion: SmartCalendarSuggestion;
  deck: DeckSuggestion;
};

type StoredGapCache = Record<string, Array<Omit<SmartCalendarSuggestion, 'id'> & { id?: string }>>;

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const parseDeadlineInput = (dateValue: string, timeValue: string): Date | null => {
  if (!dateValue.trim()) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (!dateMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  const time = timeValue.trim() || '18:00';
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
    || parsed.getHours() !== hour
    || parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
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

const normalizeDeckType = (category: SmartCalendarSuggestion['category']): DeckSuggestion['type'] => {
  if (category === 'Exercise') return 'GO_OUT';
  return 'AT_HOME';
};

const toTagColor = (category: SmartCalendarSuggestion['category']) => {
  if (category === 'Exercise') return { bg: '#DFF4EA', text: '#1D5A3A' };
  if (category === 'Productivity') return { bg: '#DCEBFF', text: '#1C477A' };
  return { bg: '#FDE8D7', text: '#7A3E1C' };
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

const segmentHeight = (durationMin: number, timelineRangeMin: number): number => {
  return Math.max(22, (durationMin / Math.max(1, timelineRangeMin)) * TIMELINE_HEIGHT);
};

const buildTimelineSegments = (column: DayColumn): DaySegment[] => {
  const segments: DaySegment[] = [
    ...column.blocks.map((block) => ({
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

export const SmartCalendarScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppState();

  const [columns, setColumns] = useState<DayColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGap, setSelectedGap] = useState<CalendarGap | null>(null);
  const [gapSuggestions, setGapSuggestions] = useState<SmartSuggestionDeckEntry[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [gapSuggestionCache, setGapSuggestionCache] = useState<Record<string, SmartCalendarSuggestion[]>>({});
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDate, setTodoDate] = useState('');
  const [todoTime, setTodoTime] = useState('');
  const suggestionDeckRef = useRef<SwipeDeckHandle>(null);

  const premiumEnabled = isBusinessPremium(state.userEmail);

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
    if (!premiumEnabled) return;
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

          const allDayBlocks: CalendarBlock[] = calendarEvents
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
            ...allDayBlocks,
            ...calendarEvents
              .filter((item) => !item.allDay)
              .map((item, idx) => ({
                id: `cal_${i}_${idx}`,
                title: item.title,
                startAt: item.startDate,
                endAt: item.endDate,
                source: 'calendar' as const,
              })),
            ...scheduled,
          ].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

          const timedBlocks = blocks.filter((block) => !block.allDay);
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
          setColumns(built);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => { active = false; };
  }, [premiumEnabled, state.enabledCalendars, state.prefs.wakeStartTime, state.prefs.wakeEndTime, state.scheduledActivities]);

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

  const fetchGapSuggestions = (gap: CalendarGap, forceRefresh = false) => {
    const cacheKey = gapCacheKey(gap);
    const cached = !forceRefresh ? gapSuggestionCache[cacheKey] : undefined;
    if (cached?.length) {
      setGapSuggestions(toDeckEntries(gap, cached));
      setSuggestionIndex(0);
      return;
    }

    setSuggestionsLoading(true);
    buildGapSuggestions(gap, state.habits, state.smartTodos, {
      defaultLocation: {
        lat: state.location.lat ?? undefined,
        lng: state.location.lng ?? undefined,
      },
      dayStartMin: parseHourMinute(state.prefs.wakeStartTime, DAY_START_HOUR),
      dayEndMin: parseHourMinute(state.prefs.wakeEndTime, DAY_END_HOUR),
    })
      .then((result) => {
        const nextSuggestions = result.slice(0, 3);
        setGapSuggestions(toDeckEntries(gap, nextSuggestions));
        setSuggestionIndex(0);
        setGapSuggestionCache((prev) => {
          const updated = { ...prev, [cacheKey]: nextSuggestions };
          persistGapCache(updated);
          return updated;
        });
      })
      .catch(() => {
        setGapSuggestions([]);
      })
      .finally(() => {
        setSuggestionsLoading(false);
      });
  };

  useEffect(() => {
    if (!selectedGap) {
      setGapSuggestions([]);
      setSuggestionIndex(0);
      return;
    }
    fetchGapSuggestions(selectedGap);
  }, [selectedGap, gapSuggestionCache, state.habits, state.location.lat, state.location.lng, state.prefs.wakeEndTime, state.prefs.wakeStartTime, state.smartTodos]);

  const setDeadlinePreset = (offsetDays: number, hour: number, minute: number) => {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    setTodoDate(`${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`);
    setTodoTime(`${pad2(hour)}:${pad2(minute)}`);
  };

  const addTodo = () => {
    const title = todoTitle.trim();
    if (!title) {
      Alert.alert('Missing title', 'Please enter a to-do title.');
      return;
    }

    const parsedDeadline = parseDeadlineInput(todoDate, todoTime);
    if (todoDate.trim() && !parsedDeadline) {
      Alert.alert('Invalid deadline', 'Use date format YYYY-MM-DD and time format HH:MM (24h).');
      return;
    }

    const todo: SmartTodoItem = {
      id: `todo_${Date.now()}`,
      title,
      notes: undefined,
      deadlineAt: parsedDeadline ? parsedDeadline.toISOString() : null,
      done: false,
      createdAt: new Date().toISOString(),
    };

    actions.addSmartTodo(todo);
    setTodoTitle('');
    setTodoDate('');
    setTodoTime('');
  };

  const scheduleSuggestion = (gap: CalendarGap, entry: SmartSuggestionDeckEntry) => {
    const suggestion = entry.suggestion;
    const deckSuggestion = entry.deck;

    if (!actions.spendSwipe()) {
      Alert.alert('No swipes left', 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }

    const startAt = gap.startAt;
    const endAt = new Date(startAt.getTime() + suggestion.durationMin * 60000);

    const commitment: Commitment = {
      suggestionId: deckSuggestion.id,
      type: deckSuggestion.type,
      title: deckSuggestion.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      calendarWriteFailed: true,
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
      calendarWriteFailed: true,
    });

    setSelectedGap(null);
    Alert.alert('Added to plan', 'The suggestion was added to your scheduled activities and will be used by Plan Ahead.');
  };

  const handleSuggestionSkip = () => {
    if (!gapSuggestions.length) return;
    if (suggestionIndex >= gapSuggestions.length - 1) {
      Alert.alert('Last card', 'Use Regenerate 3 to fetch a new set of suggestions.');
      return;
    }
    if (!actions.spendSwipe()) {
      Alert.alert('No swipes left', 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }
    setSuggestionIndex((prev) => Math.min(prev + 1, gapSuggestions.length - 1));
  };

  const regenerateSuggestions = () => {
    if (!selectedGap || regenerating) return;
    if (!actions.spendSwipe()) {
      Alert.alert('No swipes left', 'You have no swipes remaining. Complete activities or wait for recharge.');
      return;
    }
    setRegenerating(true);
    fetchGapSuggestions(selectedGap, true);
    setTimeout(() => setRegenerating(false), 250);
  };

  if (!premiumEnabled) {
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
        <View style={[styles.lockedWrap, { paddingTop: insets.top + theme.spacing.xl }]}>
          <Text style={styles.lockedEmoji}>📅</Text>
          <Text style={styles.lockedTitle}>Smart Calendar is Premium</Text>
          <Text style={styles.lockedText}>
            Add your email to EXPO_PUBLIC_BUSINESS_PREMIUM_EMAILS in .env.local to unlock this feature.
          </Text>
          <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Smart Calendar</Text>
        <Pressable onPress={() => setTodoModalOpen(true)}>
          <Text style={styles.todoButton}>To-do</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerWrap}>
          <Text style={styles.subtle}>Analyzing daily timeline...</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columnsWrap}>
          {columns.map((column) => (
            <View key={column.id} style={styles.dayCol}>
              <Text style={styles.dayTitle}>{column.label}</Text>
              <Text style={styles.dayRangeLabel}>{`${pad2(Math.floor(column.timelineStartMin / 60))}:${pad2(column.timelineStartMin % 60)} - ${pad2(Math.floor(column.timelineEndMin / 60))}:${pad2(column.timelineEndMin % 60)}`}</Text>

              {column.allDayBlocks.length > 0 && (
                <View style={styles.allDaySection}>
                  {column.allDayBlocks.map((block) => (
                    <View key={block.id} style={styles.allDayChip}>
                      <Text style={styles.allDayIcon}>📅</Text>
                      <Text style={styles.allDayText} numberOfLines={1} ellipsizeMode="tail">{block.title}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.timeline, { height: TIMELINE_HEIGHT }]}> 
                {buildTimelineSegments(column).map((segment) => {
                  const timelineRange = Math.max(60, column.timelineEndMin - column.timelineStartMin);
                  const segStartMin = Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.startAt)));
                  const segEndMin = Math.max(segStartMin + 1, Math.max(column.timelineStartMin, Math.min(column.timelineEndMin, minuteOfDay(segment.endAt))));
                  const top = ((segStartMin - column.timelineStartMin) / timelineRange) * TIMELINE_HEIGHT;
                  const cellHeight = segmentHeight(segEndMin - segStartMin, timelineRange);
                  const titleLines = cellHeight < 42 ? 1 : 2;
                  if (segment.kind === 'event' && segment.block) {
                    const canOpenPlan = segment.block.source === 'scheduled';
                    const openPlan = () => {
                      if (!canOpenPlan) return;
                      const scheduled = state.scheduledActivities.find((item) => item.id === segment.block!.id);
                      if (!scheduled) return;
                      navigation.navigate('Plan', {
                        commitment: scheduled.commitment,
                        suggestion: scheduled.suggestion,
                      });
                    };
                    return (
                      <Pressable
                        key={segment.id}
                        onPress={openPlan}
                        style={[styles.eventBlock, canOpenPlan && styles.eventBlockPressable, { top, height: cellHeight }]}
                      >
                        <Text style={styles.eventTitle} numberOfLines={titleLines} ellipsizeMode="tail">{segment.block.title}</Text>
                        <Text style={styles.eventTime}>{formatTime(segment.startAt)} - {formatTime(segment.endAt)}</Text>
                      </Pressable>
                    );
                  }

                  if (segment.kind === 'gap' && segment.gap) {
                    return (
                      <View
                        key={segment.id}
                        style={[styles.gapBlock, { top, height: cellHeight }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.gapTime}>{formatTime(segment.startAt)} - {formatTime(segment.endAt)}</Text>
                          <Text style={styles.gapMeta}>{segment.durationMin} min free</Text>
                        </View>
                        <Pressable style={styles.plusButton} onPress={() => setSelectedGap(segment.gap!)}>
                          <Text style={styles.plusText}>+</Text>
                        </Pressable>
                      </View>
                    );
                  }

                  return null;
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!selectedGap} transparent animationType="slide" onRequestClose={() => setSelectedGap(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Gap Suggestions</Text>
            <Text style={styles.modalMeta}>
              {selectedGap ? `${selectedGap.dayLabel} · ${formatTime(selectedGap.startAt)} - ${formatTime(selectedGap.endAt)}` : ''}
            </Text>

            <Text style={styles.subtle}>Finding best fitting activities for your schedule.</Text>

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
                  <Text style={styles.suggestionMetaSmall}>
                    {`Card ${Math.min(suggestionIndex + 1, gapSuggestions.length)} / ${gapSuggestions.length} · Bank ${state.swipeBank.current}`}
                  </Text>
                </View>

                <View style={styles.deckWrapModal}>
                  <SwipeDeck
                    ref={suggestionDeckRef}
                    current={gapSuggestions[suggestionIndex]?.deck ?? null}
                    next={gapSuggestions[suggestionIndex + 1]?.deck ?? null}
                    onSwipeLeft={handleSuggestionSkip}
                    onSwipeRight={() => selectedGap && gapSuggestions[suggestionIndex] && scheduleSuggestion(selectedGap, gapSuggestions[suggestionIndex])}
                    disabled={false}
                  />
                </View>

                <View style={styles.modalActionRow}>
                  <Pressable style={styles.modalTinyBtn} onPress={handleSuggestionSkip}>
                    <Text style={styles.modalTinyBtnText}>Skip</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalTinyBtn, regenerating && { opacity: 0.5 }]}
                    onPress={regenerateSuggestions}
                    disabled={regenerating}
                  >
                    <Text style={styles.modalTinyBtnText}>Regenerate 3</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.scheduleBtn, { flex: 1 }]}
                    onPress={() => selectedGap && gapSuggestions[suggestionIndex] && scheduleSuggestion(selectedGap, gapSuggestions[suggestionIndex])}
                  >
                    <Text style={styles.scheduleBtnText}>Add to plan</Text>
                  </Pressable>
                </View>
              </>
            )}

            <Pressable style={styles.closeBtn} onPress={() => setSelectedGap(null)}>
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
            <TextInput
              value={todoDate}
              onChangeText={setTodoDate}
              placeholder="Date (optional, YYYY-MM-DD)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <TextInput
              value={todoTime}
              onChangeText={setTodoTime}
              placeholder="Time (HH:MM, 24h)"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />

            <View style={styles.deadlinePresetRow}>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(0, 18, 0)}>
                <Text style={styles.deadlineChipText}>Today 18:00</Text>
              </Pressable>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(1, 9, 0)}>
                <Text style={styles.deadlineChipText}>Tomorrow 09:00</Text>
              </Pressable>
              <Pressable style={styles.deadlineChip} onPress={() => setDeadlinePreset(7, 18, 0)}>
                <Text style={styles.deadlineChipText}>+7 days</Text>
              </Pressable>
              <Pressable
                style={[styles.deadlineChip, styles.deadlineChipMuted]}
                onPress={() => {
                  setTodoDate('');
                  setTodoTime('');
                }}
              >
                <Text style={styles.deadlineChipText}>Clear</Text>
              </Pressable>
            </View>

            <Pressable style={styles.scheduleBtn} onPress={addTodo}>
              <Text style={styles.scheduleBtnText}>Add task</Text>
            </Pressable>

            <ScrollView style={styles.modalList}>
              {state.smartTodos.map((todo) => (
                <View key={todo.id} style={styles.todoRow}>
                  <Pressable onPress={() => actions.toggleSmartTodoDone(todo.id)}>
                    <Text style={styles.todoCheck}>{todo.done ? '☑' : '☐'}</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.todoTitle, todo.done && styles.todoDone]}>{todo.title}</Text>
                    {!!todo.deadlineAt && (
                      <Text style={styles.todoDeadline}>Due {new Date(todo.deadlineAt).toLocaleString()}</Text>
                    )}
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
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  dayCol: {
    width: 280,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
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
    backgroundColor: '#F6F4EE',
    overflow: 'hidden',
  },
  eventBlock: {
    position: 'absolute',
    left: 6,
    right: 6,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.accent,
    justifyContent: 'space-between',
  },
  eventBlockPressable: {
    opacity: 0.98,
  },
  eventTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentText,
    fontSize: 12,
  },
  eventTime: {
    fontFamily: theme.fonts.body,
    color: theme.colors.accentText,
    fontSize: 11,
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
  plusButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  plusText: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.accentText,
    fontSize: 22,
    lineHeight: 22,
  },
  subtle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
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
  suggestionMetaSmall: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  deckWrapModal: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
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
  todoDelete: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
  },
  lockedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: theme.spacing.sm,
  },
  lockedEmoji: {
    fontSize: 42,
  },
  lockedTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    color: theme.colors.text,
  },
  lockedText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  backButton: {
    marginTop: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  backButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
});
