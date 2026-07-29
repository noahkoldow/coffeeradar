import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Image, InteractionManager, Linking, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { ChargeBar } from '../components/ChargeBar';
import { Chip } from '../components/Chip';
import { BadgeRing } from '../components/BadgeRing';
import { BadgeIcon } from '../components/BadgeIcon';
import { BrandCollabLockup } from '../components/BrandCollabLockup';
import { ActivityBanner, SkyBanner } from '../components/ActivityBanner';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { deletePlanEvent, getAvailability, getUpcomingEvents } from '../services/calendar';
import { getCurrentLocation } from '../services/location';
import { formatDuration, formatTime, getTimeWindowContext } from '../utils/time';
import { logEvent } from '../services/analytics';
import { isAdminUser, isBusinessAdmin, upsertUserData } from '../services/user';
import { fetchWeather, WeatherCondition } from '../services/weather';
import { prefetchGeminiSuggestions } from '../services/geminiSuggestions';
import { loadProfileAvatarUri, loadWeatherCondition, saveWeatherCondition } from '../utils/storage';
import { detectLocationProfile } from '../services/locationProfile';
import { getAvatarInitial } from '../utils/social';
import { recommendedHabits } from '../data/habits';
import { ActivityLog, Availability, Habit, ScheduledActivity } from '../types';
import { formatHabitFrequency, formatHabitTimeOfDay, isHabitDue, streakEmoji, weeklyDots, getHabitUrgency } from '../utils/habits';
import * as Haptics from 'expo-haptics';
import { buildBadgeProgress } from '../utils/badges';
import { buildPlanSessionKey } from '../utils/planSession';
import { getVisibleTags } from '../utils/visibleTags';
import { applyTodoChunkCompletion } from '../utils/todoAtomization';
import { applyIgnoredEventsToAvailability } from '../utils/availabilityIgnore';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'Home'>;

type ActionMode = {
  key: 'all' | 'productive' | 'tomorrow' | 'at_home' | 'challenge_me';
  label: string;
  filter?: string;
  planDate?: 'today' | 'tomorrow';
  bg: string;
  text: string;
};

type ActivityModeKey = ActionMode['key'];

const durationOptions = [30, 60, 120, 240];

const formatDurationLabel = (minutes: number): string => {
  if (minutes === 240) return 'Tonight';
  return formatDuration(minutes);
};

const BANNER_PAGE_HEIGHT = 94;
const DASHBOARD_STACK_SEGMENT_OVERLAP_PX = 16;
// Activity graph window: keep plenty of past days scrollable, no future days.
const DASHBOARD_HISTORY_DAYS = 30;
const DASHBOARD_FUTURE_DAYS = 0;
// How many day columns should fit within the visible viewport (matches the pre-scroll layout).
// Slightly below 7 so bars are a touch wider and the week stays horizontally scrollable.
const DASHBOARD_VISIBLE_DAYS = 6.4;
const DASHBOARD_DEFAULT_COL_WIDTH = 30;

// Logo: 1:3 aspect ratio, half the button height (~30px tall, 90px wide)
const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
};

type DashboardTagTone = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

const getDashboardTagTone = (tag: string): DashboardTagTone => {
  const t = tag.trim().toLowerCase();

  if (/(challenge|quest|mission|sprint|hard|intense|push)/.test(t)) {
    return { backgroundColor: '#F2EDFA', borderColor: '#D8CBEF', textColor: '#6A2B8E' };
  }

  if (/(nature|outdoor|park|walk|hike|garden|forest|tree|green|trail|fresh air|sunset|view)/.test(t)) {
    return { backgroundColor: '#EAF6EE', borderColor: '#B8DDC5', textColor: '#3C7D50' };
  }
  if (/(fitness|workout|exercise|run|jog|bike|cycle|sport|movement|active)/.test(t)) {
    return { backgroundColor: '#E8F7EF', borderColor: '#B2DFC7', textColor: '#2E8055' };
  }
  if (/(social|friends|date|meet|party|group|community|hangout)/.test(t)) {
    return { backgroundColor: '#FAEDF3', borderColor: '#E5C2D3', textColor: '#9B4D72' };
  }
  if (/(coffee|cafe|food|cook|eat|drink|restaurant|market|snack|brunch|lunch|dinner)/.test(t)) {
    return { backgroundColor: '#FBF3E6', borderColor: '#E8D0A3', textColor: '#9A6A12' };
  }
  if (/(learn|read|study|focus|work|project|planning|organize|library|cowork|brain|research)/.test(t)) {
    return { backgroundColor: '#EBF0FC', borderColor: '#C3D0F4', textColor: '#3559B8' };
  }
  if (/(creative|art|music|draw|paint|write|craft|design|photo|film)/.test(t)) {
    return { backgroundColor: '#FBEFE8', borderColor: '#E9C7B0', textColor: '#A05A2D' };
  }
  if (/(relax|calm|rest|self care|sleep|stretch|yoga|meditat|breathe|mindful)/.test(t)) {
    return { backgroundColor: '#F1ECFA', borderColor: '#D3C8EC', textColor: '#6A56A8' };
  }
  if (/(clean|tidy|declutter|laundry|home|repair|prep|routine|organise|organize)/.test(t)) {
    return { backgroundColor: '#EDF3F6', borderColor: '#C7D5DE', textColor: '#4F6472' };
  }
  if (/(shopping|market|store|browse|gift|fashion|style)/.test(t)) {
    return { backgroundColor: '#F7EDF5', borderColor: '#DEC6DA', textColor: '#955A8D' };
  }
  if (/(explore|adventure|trip|travel|discover|wander|city|museum|gallery|daytrip)/.test(t)) {
    return { backgroundColor: '#EAF5F4', borderColor: '#C2DEDB', textColor: '#3D7880' };
  }

  return { backgroundColor: '#EEF1F6', borderColor: '#D2D9E5', textColor: '#5C6775' };
};

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useI18n();
  const { state, actions } = useAppState();
  const [loading, setLoading] = useState(false);
  const [manualDuration, setManualDuration] = useState(60);
  const [weatherCondition, setWeatherCondition] = useState<WeatherCondition>('unknown');
  const [wakeWindowNow, setWakeWindowNow] = useState<number>(Date.now());
  const [bannerKey, setBannerKey] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [bannerPageIndex, setBannerPageIndex] = useState(0);
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const actionIndexRef = useRef(actionIndex);
  useEffect(() => {
    actionIndexRef.current = actionIndex;
  }, [actionIndex]);
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  const deckQueueRef = useRef({
    hasQueuedDeck: state.preloadedDeck != null,
    deckLoading: state.deckLoading,
    prefs: state.prefs,
  });
  useEffect(() => {
    deckQueueRef.current = {
      hasQueuedDeck: state.preloadedDeck != null,
      deckLoading: state.deckLoading,
      prefs: state.prefs,
    };
  }, [state.preloadedDeck, state.deckLoading, state.prefs]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadProfileAvatarUri(state.userId)
        .then((uri) => {
          if (active) setProfileAvatarUri(uri);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [state.userId])
  );
  const isInitialMount = useRef(true);
  const hasHandledHomeFocusRef = useRef(false);
  const lastSettingsSignatureRef = useRef<string | null>(null);
  const lastConsumptionMarkersRef = useRef<Record<ActivityModeKey, string | null>>({
    all: null,
    tomorrow: null,
    productive: null,
    challenge_me: null,
    at_home: null,
  });
  const [isAdmin, setIsAdmin] = useState(() => isBusinessAdmin(state.userEmail));
  const premiumEnabled = state.isPremium;

  useEffect(() => {
    let active = true;
    setIsAdmin(isBusinessAdmin(state.userEmail));
    isAdminUser()
      .then((value) => {
        if (active) setIsAdmin(value);
      })
      .catch(() => {
        if (active) setIsAdmin(isBusinessAdmin(state.userEmail));
      });

    return () => {
      active = false;
    };
  }, [state.userEmail, state.userId]);

  const screenWidth = Dimensions.get('window').width - theme.spacing.xl * 2;
  const homeScrollRef = useRef<ScrollView>(null);
  const actionScrollRef = useRef<ScrollView>(null);

  // ������ Banner auto-swipe ������
  const bannerScrollRef = useRef<ScrollView>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerPageRef = useRef(0); // track page without re-renders
  const hasBadges = useRef(false); // updated from badgeProgress later

  const scheduleBannerSwipe = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    const delay = 60_000 + Math.random() * 60_000; // 1���2 min
    bannerTimerRef.current = setTimeout(() => {
      if (!hasBadges.current) return; // only one page, nothing to swipe
      const nextPage = bannerPageRef.current === 0 ? 1 : 0;
      bannerScrollRef.current?.scrollTo({ x: nextPage * screenWidth, animated: true });
      bannerPageRef.current = nextPage;
      setBannerPageIndex(nextPage);
      scheduleBannerSwipe(); // schedule the next one
    }, delay);
  }, [screenWidth]);

  // ������ Scheduled activity popup ������
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [isScheduledCollapsed, setIsScheduledCollapsed] = useState(false);
  const graphScrollRef = useRef<ScrollView>(null);
  const pendingGraphScrollRef = useRef(true);
  const [graphViewportWidth, setGraphViewportWidth] = useState(0);
  const [showTodayButton, setShowTodayButton] = useState(false);

  const graphColumnWidth = useMemo(() => {
    if (!graphViewportWidth) return DASHBOARD_DEFAULT_COL_WIDTH;
    const horizontalPadding = theme.spacing.xs * 2;
    const gaps = theme.spacing.xs * (DASHBOARD_VISIBLE_DAYS - 1);
    return Math.max(24, (graphViewportWidth - horizontalPadding - gaps) / DASHBOARD_VISIBLE_DAYS);
  }, [graphViewportWidth, theme.spacing.xs]);

  const scrollGraphToToday = useCallback((animated: boolean) => {
    if (!graphViewportWidth) {
      pendingGraphScrollRef.current = true;
      return;
    }
    // Skip to the end so the current whole week (today + surrounding days) is shown.
    graphScrollRef.current?.scrollToEnd({ animated });
    pendingGraphScrollRef.current = false;
    setShowTodayButton(false);
  }, [graphViewportWidth]);

  const handleGraphScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!graphViewportWidth) return;
    const scrollX = e.nativeEvent.contentOffset.x;
    const idx = DASHBOARD_HISTORY_DAYS; // today's column index within weekGraph
    const colLeft = theme.spacing.xs + idx * (graphColumnWidth + theme.spacing.xs);
    const colRight = colLeft + graphColumnWidth;
    const todayFullyVisible = colLeft >= scrollX - 1 && colRight <= scrollX + graphViewportWidth + 1;
    setShowTodayButton(!todayFullyVisible);
  }, [graphColumnWidth, graphViewportWidth, theme.spacing.xs]);

  useEffect(() => {
    if (graphViewportWidth && pendingGraphScrollRef.current) {
      scrollGraphToToday(false);
    }
  }, [graphViewportWidth, scrollGraphToToday]);

  const recentActivities = useMemo(() => {
    return state.activityLog.slice(0, 10);
  }, [state.activityLog]);

  const { height: screenHeight } = Dimensions.get('window');
  const todayKey = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toDateString();
  }, []);

  // Restore cached weather so the banner doesn't visually jump on first render
  useEffect(() => {
    loadWeatherCondition().then((cached) => {
      if (cached && (cached === 'clear' || cached === 'cloudy' || cached === 'rain' || cached === 'snow')) {
        setWeatherCondition(cached as WeatherCondition);
      }
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setWakeWindowNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const avatarInitial = useMemo(() => getAvatarInitial(state.userEmail), [state.userEmail]);

  const isOutsideWakeWindow = useMemo(() => {
    const ctx = getTimeWindowContext(
      new Date(wakeWindowNow),
      state.location.timeZone,
      state.prefs.wakeStartTime,
      state.prefs.wakeEndTime,
    );
    return !ctx.isWithinWakeWindow;
  }, [wakeWindowNow, state.location.timeZone, state.prefs.wakeEndTime, state.prefs.wakeStartTime]);

  const ACTION_MODES = useMemo(() => {
    const baseModes: ActionMode[] = [
      { key: 'all', label: t('home_action_now'), filter: undefined as string | undefined, bg: theme.colors.accent, text: theme.colors.accentText },
      {
        key: 'productive',
        label: t('home_action_productive'),
        filter: 'productive',
        bg: theme.isDark ? '#2A4A5E' : '#A8D8EA',
        text: theme.isDark ? '#D8F0FF' : '#1A3A4A',
      },
      {
        key: 'challenge_me',
        label: t('home_action_challenge'),
        filter: 'challenge_me',
        bg: theme.isDark ? '#4D2E66' : '#D7B9F1',
        text: theme.isDark ? '#F0E3FF' : '#3E2257',
      },
      {
        key: 'at_home',
        label: t('home_action_homebody'),
        filter: 'at_home',
        bg: theme.isDark ? '#54374A' : '#E2B6CF',
        text: theme.isDark ? '#F5DDED' : '#3A1A2E',
      },
    ];

    if (!premiumEnabled) return baseModes;

    return [
      baseModes[0],
      {
        key: 'tomorrow',
        label: t('home_action_plan_ahead'),
        filter: undefined as string | undefined,
        planDate: 'tomorrow' as const,
        bg: theme.isDark ? '#2E4F45' : '#B5EAD7',
        text: theme.isDark ? '#D9F6EA' : '#1A4A3A',
      } as ActionMode,
      baseModes[1],
      baseModes[2],
      baseModes[3],
    ];
  }, [premiumEnabled, t, theme.colors.accent, theme.colors.accentText, theme.isDark]);

  const swipesRemaining = state.swipeBank?.current ?? 0;
  const hasSwipes = swipesRemaining > 0;
  const isModeAvailable = useCallback((mode: ActionMode) => hasSwipes || mode.key === 'tomorrow', [hasSwipes]);

  useEffect(() => {
    if (!(premiumEnabled && !hasSwipes)) return;
    const tomorrowIndex = ACTION_MODES.findIndex((mode) => mode.key === 'tomorrow');
    if (tomorrowIndex < 0) return;

    if (actionIndex !== tomorrowIndex) {
      setActionIndex(tomorrowIndex);
    }
    actionScrollRef.current?.scrollTo({ x: tomorrowIndex * screenWidth, animated: true });
  }, [ACTION_MODES, actionIndex, hasSwipes, premiumEnabled, screenWidth]);

  const activityModeColors = useMemo<Record<ActivityModeKey, string>>(() => ({
    all: theme.colors.accent,
    tomorrow: theme.isDark ? '#2E4F45' : '#B5EAD7',
    productive: theme.isDark ? '#2A4A5E' : '#A8D8EA',
    challenge_me: theme.isDark ? '#4D2E66' : '#D7B9F1',
    at_home: theme.isDark ? '#54374A' : '#E2B6CF',
  }), [theme.colors.accent, theme.isDark]);

  const resolveActivityMode = useCallback((entry: ActivityLog): ActivityModeKey => {
    if (entry.activityMode) return entry.activityMode;
    if (entry.tags?.some((tag) => /challenge|quest|mission|sprint|hard|intense|push/.test(tag.toLowerCase()))) {
      return 'challenge_me';
    }
    if (entry.suggestionType === 'AT_HOME') return 'at_home';
    const productiveTags = new Set(['productivity', 'learning', 'creative', 'focus', 'planning', 'work', 'study', 'reading']);
    if (entry.tags?.some((tag) => productiveTags.has(tag))) return 'productive';
    return 'all';
  }, []);

  const activityModeOrder: ActivityModeKey[] = ['all', 'tomorrow', 'productive', 'challenge_me', 'at_home'];

  const settingsSignature = useMemo(() => JSON.stringify({
    prefs: state.prefs,
    sessionActivityIntent: state.sessionActivityIntent ?? '',
    disabledCalendars: [...state.disabledCalendars].sort(),
    permissions: {
      calendarGranted: state.permissions.calendarGranted,
      locationGranted: state.permissions.locationGranted,
    },
  }), [
    state.prefs,
    state.sessionActivityIntent,
    state.disabledCalendars,
    state.permissions.calendarGranted,
    state.permissions.locationGranted,
  ]);
  const settingsSignatureRef = useRef(settingsSignature);
  useEffect(() => {
    settingsSignatureRef.current = settingsSignature;
  }, [settingsSignature]);

  const latestConsumptionMarkers = useMemo<Record<ActivityModeKey, string | null>>(() => {
    const latest: Record<ActivityModeKey, { ts: number; marker: string } | null> = {
      all: null,
      tomorrow: null,
      productive: null,
      challenge_me: null,
      at_home: null,
    };

    for (const entry of state.activityLog) {
      const mode = resolveActivityMode(entry);
      const ts = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const marker = `${entry.id}:${entry.timestamp}`;
      const prev = latest[mode];
      if (!prev || ts > prev.ts) {
        latest[mode] = { ts, marker };
      }
    }

    return {
      all: latest.all?.marker ?? null,
      tomorrow: latest.tomorrow?.marker ?? null,
      productive: latest.productive?.marker ?? null,
      challenge_me: latest.challenge_me?.marker ?? null,
      at_home: latest.at_home?.marker ?? null,
    };
  }, [state.activityLog, resolveActivityMode]);
  const latestConsumptionMarkersRef = useRef(latestConsumptionMarkers);
  useEffect(() => {
    latestConsumptionMarkersRef.current = latestConsumptionMarkers;
  }, [latestConsumptionMarkers]);

  const weekGraph = useMemo(() => {
    const anchorDate = new Date();
    anchorDate.setHours(0, 0, 0, 0);
    const totalDays = DASHBOARD_HISTORY_DAYS + 1 + DASHBOARD_FUTURE_DAYS;
    const days = Array.from({ length: totalDays }, (_, offset) => {
      const date = new Date(anchorDate);
      date.setDate(anchorDate.getDate() - DASHBOARD_HISTORY_DAYS + offset);
      const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
      const key = date.toDateString();
      const activities = state.activityLog
        .filter((entry) => new Date(entry.timestamp).toDateString() === key)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const scheduled = state.scheduledActivities
        .filter((item) => key === todayKey && new Date(item.startAt).toDateString() === key)
        .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      const minutesByMode: Record<ActivityModeKey, number> = {
        all: 0,
        tomorrow: 0,
        productive: 0,
        challenge_me: 0,
        at_home: 0,
      };
      for (const entry of activities) {
        const mode = resolveActivityMode(entry);
        minutesByMode[mode] += entry.durationMin;
      }
      const minutes = activities.reduce((sum, entry) => sum + entry.durationMin, 0);
      return { date, dayLabel, key, minutes, minutesByMode, activities, scheduled };
    });
    const maxMinutes = Math.max(1, ...days.map((day) => day.minutes));
    return days.map((day) => ({
      ...day,
      modeSegments: activityModeOrder
        .filter((mode) => day.minutesByMode[mode] > 0)
        .map((mode) => ({
          mode,
          minutes: day.minutesByMode[mode],
        })),
      hasActivity: day.minutes > 0 || day.scheduled.length > 0,
      height: day.minutes > 0
        ? Math.max(8, (day.minutes / maxMinutes) * 100)
        : day.scheduled.length > 0
          ? 18
          : 0,
    }));
  }, [activityModeOrder, resolveActivityMode, state.activityLog, state.scheduledActivities, todayKey]);

  useEffect(() => {
    if (selectedDayKey && weekGraph.some((day) => day.key === selectedDayKey)) return;
    const defaultDay = [...weekGraph].reverse().find((day) => day.minutes > 0) ?? weekGraph[weekGraph.length - 1];
    setSelectedDayKey(defaultDay?.key ?? null);
  }, [selectedDayKey, weekGraph]);

  const selectedDay = useMemo(
    () => weekGraph.find((day) => day.key === selectedDayKey) ?? weekGraph[weekGraph.length - 1] ?? null,
    [selectedDayKey, weekGraph],
  );
  const selectedDayActivities = selectedDay?.activities ?? [];
  const isSelectedDayToday = useMemo(() => {
    if (!selectedDay) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selectedDay.date.toDateString() === today.toDateString();
  }, [selectedDay]);
  const nextUpcomingToday = useMemo(() => {
    const nextTitle = state.availability?.nextEventTitle?.trim();
    const nextStartAt = state.availability?.nextEventStartAt;
    if (!isSelectedDayToday || !nextTitle || !nextStartAt) return null;

    const nextStart = new Date(nextStartAt);
    const now = new Date();
    if (Number.isNaN(nextStart.getTime()) || nextStart <= now) return null;
    if (nextStart.toDateString() !== now.toDateString()) return null;

    return {
      title: nextTitle,
      startLabel: formatTime(nextStart),
    };
  }, [isSelectedDayToday, state.availability?.nextEventStartAt, state.availability?.nextEventTitle]);
  const selectedDayScheduledActivities = useMemo(() => {
    if (!selectedDay || selectedDay.key !== todayKey) return [];
    return state.scheduledActivities
      .filter((item) => {
        const scheduledDate = new Date(item.startAt);
        return scheduledDate.toDateString() === todayKey;
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }, [selectedDay, state.scheduledActivities, todayKey]);

  const linkedTodoByScheduledActivityId = useMemo(
    () => new Map(
      state.smartTodos
        .filter((todo) => !!todo.linkedScheduledActivityId)
        .map((todo) => [todo.linkedScheduledActivityId as string, todo] as const),
    ),
    [state.smartTodos],
  );

  const overdueScheduledActivityIds = useMemo(() => {
    const now = Date.now();

    return new Set(
      state.scheduledActivities
        .filter((item) => {
          const endAt = new Date(item.endAt).getTime();
          if (Number.isNaN(endAt) || endAt > now) return false;

          const linkedTodo = linkedTodoByScheduledActivityId.get(item.id);
          if (!linkedTodo) return true;
          return !linkedTodo.done;
        })
        .map((item) => item.id),
    );
  }, [linkedTodoByScheduledActivityId, state.scheduledActivities]);

  const dashboardScheduledActivities = useMemo(() => {
    return state.scheduledActivities
      .filter((item) => {
        const startDate = new Date(item.startAt);
        return startDate.toDateString() === todayKey;
      })
      .sort((a, b) => {
        const aOverdue = overdueScheduledActivityIds.has(a.id);
        const bOverdue = overdueScheduledActivityIds.has(b.id);
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
        return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      });
  }, [overdueScheduledActivityIds, state.scheduledActivities, todayKey]);

  const activePlanSession = useMemo(() => {
    const session = state.inProgressPlanSession;
    if (!session?.manualStartAt) return null;
    const startedAt = new Date(session.manualStartAt);
    if (Number.isNaN(startedAt.getTime())) return null;
    return session;
  }, [state.inProgressPlanSession]);

  const openPlanSession = useCallback((item?: ScheduledActivity) => {
    if (item && activePlanSession) {
      const itemKey = buildPlanSessionKey(item.commitment, item.suggestion);
      if (itemKey === activePlanSession.key) {
        navigation.navigate('Plan', {
          commitment: activePlanSession.commitment,
          suggestion: activePlanSession.suggestion,
        });
        return true;
      }
    }

    if (activePlanSession) {
      if (!activePlanSession.manualStartAt) return false;
      const now = Date.now();
      const started = new Date(activePlanSession.manualStartAt).getTime();
      const ends = new Date(activePlanSession.commitment.endAt).getTime();
      const isRunningWindow = Number.isFinite(started) && Number.isFinite(ends) && now >= started && now <= ends + 2 * 60 * 60 * 1000;
      if (isRunningWindow) {
        navigation.navigate('Plan', {
          commitment: activePlanSession.commitment,
          suggestion: activePlanSession.suggestion,
        });
        return true;
      }
    }

    return false;
  }, [activePlanSession, navigation]);

  const onActionScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / screenWidth);
    const clamped = Math.max(0, Math.min(idx, ACTION_MODES.length - 1));
    if (clamped !== actionIndexRef.current) {
      setActionIndex(clamped);
    }
  }, [screenWidth, ACTION_MODES.length]);

  const onBannerScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / screenWidth);
    const clamped = Math.max(0, Math.min(idx, 1));
    setBannerPageIndex(clamped);
    bannerPageRef.current = clamped;
    scheduleBannerSwipe(); // reset timer on manual swipe
  }, [screenWidth, scheduleBannerSwipe]);

  const footerGradientColors = useMemo(() => [
    hexToRgba(theme.colors.background, 0),
    hexToRgba(theme.colors.background, 0.1),
    hexToRgba(theme.colors.background, 0.22),
    hexToRgba(theme.colors.background, 0.42),
    hexToRgba(theme.colors.background, 0.66),
    hexToRgba(theme.colors.background, 0.86),
    hexToRgba(theme.colors.background, 1),
  ] as [string, string, ...string[]], [theme.colors.background]);

  // Preload deck when manual duration changes (for users without calendar)
  useEffect(() => {
    if (!state.permissions.calendarGranted) {
      if (state.preloadedDeck || state.deckLoading) return;
      const fakeAvail: Availability = {
        start: new Date().toISOString(),
        end: new Date(Date.now() + manualDuration * 60000).toISOString(),
        durationMin: manualDuration,
        nextEventTitle: null,
      };
      const prefetchAvail = applyIgnoredEventsToAvailability(fakeAvail, state.ignoredExternalEventKeys);
      prefetchGeminiSuggestions(state.location, deckQueueRef.current.prefs, prefetchAvail, null, { sessionActivityIntent: state.sessionActivityIntent }, state.userId).catch(() => undefined);
      actionsRef.current.preloadDeck(fakeAvail);
    }
  }, [manualDuration, state.permissions.calendarGranted, state.preloadedDeck, state.deckLoading, state.location, state.sessionActivityIntent, state.userId, state.ignoredExternalEventKeys]);

  const refreshContext = useCallback(async () => {
    if (!state.permissions.calendarGranted && !state.permissions.locationGranted) return;
    setLoading(true);
    try {
      let latestAvailability = state.availability;
      let latestLocation = state.location;
      let latestWeather: Awaited<ReturnType<typeof fetchWeather>> | null = null;
      if (state.permissions.calendarGranted) {
        const availability = await getAvailability(state.disabledCalendars);
        actionsRef.current.setAvailability(availability);
        latestAvailability = availability;
      }
      if (state.permissions.locationGranted) {
        const location = await getCurrentLocation();
        actionsRef.current.setLocation(location);
        latestLocation = location;
      }
      // Fetch weather for banner animation
      if (latestLocation.lat != null && latestLocation.lng != null) {
        try {
          latestWeather = await fetchWeather(latestLocation.lat, latestLocation.lng);
          setWeatherCondition(latestWeather.condition);
          saveWeatherCondition(latestWeather.condition);
        } catch { /* keep previous */ }
        // Detect location profile (coastal/urban/suburban) for better scoring
        detectLocationProfile(latestLocation.lat, latestLocation.lng, state.userId)
          .then((profile) => actionsRef.current.setLocationProfile(profile))
          .catch(() => { /* non-critical */ });
      }

      await upsertUserData({
        availability: latestAvailability ?? null,
        areaLabel: latestLocation.areaLabel ?? null,
      });
      // Preload the deck in the background so DeckScreen opens instantly
      if (latestAvailability) {
        const queueState = deckQueueRef.current;
        if (queueState.hasQueuedDeck || queueState.deckLoading) {
          return;
        }
        // Use at least 15 min so preload builds a viable deck even when "busy"
        const preloadAvail = latestAvailability.durationMin < 15
          ? { ...latestAvailability, durationMin: 15 }
          : latestAvailability;
        const prefetchAvail = applyIgnoredEventsToAvailability(preloadAvail, state.ignoredExternalEventKeys);
        prefetchGeminiSuggestions(latestLocation, queueState.prefs, prefetchAvail, latestWeather, { sessionActivityIntent: state.sessionActivityIntent }, state.userId).catch(() => undefined);
        actionsRef.current.preloadDeck(preloadAvail);
      }
    } catch (error) {
      console.warn('Refresh error', error);
    } finally {
      setLoading(false);
    }
  }, [
    state.permissions.calendarGranted,
    state.permissions.locationGranted,
    state.disabledCalendars,
    state.sessionActivityIntent,
    state.userId,
    state.ignoredExternalEventKeys,
  ]);

  useFocusEffect(
    useCallback(() => {
      homeScrollRef.current?.scrollTo({ y: 0, animated: true });
      bannerScrollRef.current?.scrollTo({ x: 0, animated: false });
      bannerPageRef.current = 0;
      setBannerPageIndex(0);
      if (isInitialMount.current) {
        isInitialMount.current = false;
      } else {
        setBannerKey((k) => k + 1);
      }
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      if (hasBadges.current) scheduleBannerSwipe();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedDayKey(today.toDateString());
      pendingGraphScrollRef.current = true;
      scrollGraphToToday(false);
      navigatingRef.current = false;          // reset guard on focus

      const currentModes = ACTION_MODES;
      const selectedMode = currentModes[
        Math.max(0, Math.min(actionIndexRef.current, currentModes.length - 1))
      ]?.key ?? 'all';

      const isFirstHomeFocus = !hasHandledHomeFocusRef.current;
      const settingsChanged = !!(
        hasHandledHomeFocusRef.current
        && lastSettingsSignatureRef.current
        && lastSettingsSignatureRef.current !== settingsSignatureRef.current
      );
      const consumedInSelectedMode = !!(
        hasHandledHomeFocusRef.current
        && lastConsumptionMarkersRef.current[selectedMode] !== latestConsumptionMarkersRef.current[selectedMode]
      );

      if (isFirstHomeFocus || settingsChanged || consumedInSelectedMode) {
        refreshContext();
      }

      hasHandledHomeFocusRef.current = true;
      lastSettingsSignatureRef.current = settingsSignatureRef.current;
      lastConsumptionMarkersRef.current = latestConsumptionMarkersRef.current;

      return () => {
        if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      };
    }, [ACTION_MODES, refreshContext, scheduleBannerSwipe, scrollGraphToToday]),
  );

  useEffect(() => {
    if (state.availability?.durationMin && state.availability.durationMin < 20) {
      Alert.alert(t('home_tight_window_title'), t('home_tight_window_body'));
    }
  }, [state.availability?.durationMin, t]);

  const isBusyNow = !!(state.permissions.calendarGranted && state.availability && state.availability.durationMin === 0);
  const currentEventTitle = state.availability?.nextEventTitle || t('home_current_event');
  const currentEventIgnoreKey = useMemo(() => {
    const currentEventId = state.availability?.currentEventId?.trim();
    if (currentEventId) return `id:${currentEventId}`;
    const normalizedTitle = state.availability?.nextEventTitle?.trim().toLowerCase();
    if (normalizedTitle) return `title:${normalizedTitle}`;
    return null;
  }, [state.availability?.currentEventId, state.availability?.nextEventTitle]);

  const isCurrentExternalEventIgnored = !!(
    isBusyNow
    && currentEventIgnoreKey
    && state.ignoredExternalEventKeys.includes(currentEventIgnoreKey)
  );
  const isBusyNowEffective = isBusyNow && !isCurrentExternalEventIgnored;

  const handleDeleteCurrentEvent = useCallback(() => {
    const eventId = state.availability?.currentEventId;
    if (!eventId) return;

    const linkedScheduled = state.scheduledActivities.filter(
      (item) => item.calendarEventId === eventId || item.commitment.calendarEventId === eventId,
    );

    if (!linkedScheduled.length) {
      Alert.alert(
        t('home_ignore_external_title'),
        t('home_ignore_external_body'),
        [
          { text: t('common_cancel'), style: 'cancel' },
          {
            text: t('home_ignore'),
            onPress: () => {
              const fallbackTitleKey = state.availability?.nextEventTitle?.trim().toLowerCase();
              const eventKey = `id:${eventId}` || (fallbackTitleKey ? `title:${fallbackTitleKey}` : null);
              if (!eventKey) return;
              actions.addIgnoredExternalEventKey(eventKey);
            },
          },
        ],
      );
      return;
    }

    Alert.alert(t('home_delete_activity_title'), t('home_delete_activity_body'), [
      { text: t('home_keep'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlanEvent(eventId);
            linkedScheduled.forEach((item) => {
              actions.removeScheduledActivity(item.id);
            });
            await refreshContext();
          } catch (error) {
            console.warn('Failed to delete current event', error);
            Alert.alert(t('home_could_not_delete_title'), t('home_could_not_delete_body'));
          }
        },
      },
    ]);
  }, [actions, refreshContext, state.availability?.currentEventId, state.availability?.nextEventTitle, state.scheduledActivities, t]);
  const availabilityLabel = state.availability
    ? isBusyNowEffective
      ? t('home_busy_now')
      : state.availability.durationMin >= 240
        ? t('home_busy_next_hours')
        : state.availability.durationMin === 0
          ? t('home_free_now')
          : t('home_free_for', { value: formatDuration(state.availability.durationMin) })
    : t('home_pick_now');

  const availabilityEmoji = state.availability
    ? isBusyNowEffective
      ? '⏳'
      : state.availability.durationMin >= 240
        ? '🏖️'
        : '⏰'
    : '';

  const nextEventStartDate = useMemo(() => {
    const raw = state.availability?.nextEventStartAt;
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [state.availability?.nextEventStartAt]);

  const nextEventTitle = state.availability?.nextEventTitle?.trim() ?? '';

  const linkedUpcomingScheduledActivity = useMemo(() => {
    const byStart = nextEventStartDate?.getTime();
    const hasStart = Number.isFinite(byStart);
    const normalizedNextTitle = nextEventTitle.toLowerCase();
    const now = Date.now();

    const candidates = state.scheduledActivities
      .filter((item) => {
        const start = new Date(item.startAt).getTime();
        if (!Number.isFinite(start) || start < now - 15 * 60 * 1000) return false;
        if (hasStart && Math.abs(start - (byStart as number)) <= 2 * 60 * 1000) return true;

        if (!normalizedNextTitle) return false;
        const normalizedTitle = item.title.trim().toLowerCase();
        if (!normalizedTitle) return false;
        return normalizedTitle === normalizedNextTitle;
      })
      .sort((a, b) => {
        const aStart = new Date(a.startAt).getTime();
        const bStart = new Date(b.startAt).getTime();
        if (!hasStart) return aStart - bStart;
        return Math.abs(aStart - (byStart as number)) - Math.abs(bStart - (byStart as number));
      });

    return candidates[0] ?? null;
  }, [nextEventStartDate, nextEventTitle, state.scheduledActivities]);

  const currentScheduledActivity = useMemo(() => {
    const eventId = state.availability?.currentEventId;
    if (eventId) {
      const byCalendarId = state.scheduledActivities.find(
        (item) => item.calendarEventId === eventId || item.commitment.calendarEventId === eventId,
      );
      if (byCalendarId) return byCalendarId;
    }

    const normalizedCurrentTitle = currentEventTitle.trim().toLowerCase();
    const now = Date.now();

    return state.scheduledActivities.find((item) => {
      const start = new Date(item.startAt).getTime();
      const end = new Date(item.endAt).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (!(start <= now && now <= end + 15 * 60 * 1000)) return false;
      return item.title.trim().toLowerCase() === normalizedCurrentTitle;
    }) ?? null;
  }, [currentEventTitle, state.availability?.currentEventId, state.scheduledActivities]);

  const beforeLabel = nextEventTitle ? `before ${nextEventTitle}` : '';
  const untilLabel = nextEventStartDate ? formatTime(nextEventStartDate) : '';
  const showTappableUntil = !isBusyNowEffective && !!untilLabel && !!linkedUpcomingScheduledActivity;
  const canPressAvailabilitySubtext = !isBusyNowEffective
    && state.permissions.calendarGranted
    && (!!linkedUpcomingScheduledActivity || !!nextEventTitle || !!nextEventStartDate);

  const availabilitySubtextPrefix = isBusyNowEffective
    ? ''
    : (state.permissions.calendarGranted
      ? `${availabilityEmoji} ${availabilityLabel}`
      : `${availabilityEmoji} ${availabilityLabel}`);

  const availabilitySubtextSuffix = isBusyNowEffective
    ? ''
    : (state.permissions.calendarGranted
      ? (untilLabel ? ' until ' : (beforeLabel ? ` ${beforeLabel}` : ''))
      : '');

  const availabilitySubtext = isBusyNowEffective
    ? ''
    : `${availabilitySubtextPrefix}${state.permissions.calendarGranted && !untilLabel && beforeLabel ? ` ${beforeLabel}` : ''}`;

  const areaLabel = state.location.areaLabel ?? null;
  const locationStatusLabel = areaLabel
    ?? (state.permissions.locationGranted ? 'Finding location...' : 'Location off');

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = state.activityLog.filter((entry) => new Date(entry.timestamp) >= weekAgo);
    const minutes = recent.reduce((sum, entry) => sum + entry.durationMin, 0);
    const habitTotal = state.habits.length;
    const habitDone = state.habits.filter((habit) => !isHabitDue(habit, now, state.location.timeZone)).length;
    const habitPercent = habitTotal ? Math.round((habitDone / habitTotal) * 100) : null;
    return {
      activityCount: recent.length,
      minutes,
      habitTotal,
      habitDone,
      habitPercent,
      totalDone: state.activityLog.length,
    };
  }, [state.activityLog, state.habits, state.location.timeZone]);

  const badgeProgress = useMemo(() => {
    const progress = buildBadgeProgress(state.activityLog, state.habits);
    return [...progress].sort((a, b) => b.level - a.level || b.count - a.count);
  }, [state.activityLog, state.habits]);

  // Keep hasBadges ref in sync and manage auto-swipe lifecycle
  useEffect(() => {
    hasBadges.current = badgeProgress.length > 0;
    if (hasBadges.current) {
      scheduleBannerSwipe();
    } else if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current);
    }
    return () => { if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current); };
  }, [badgeProgress.length, scheduleBannerSwipe]);

  const suggestedHabits = useMemo(() => {
    const existing = new Set(state.habits.map((habit) => habit.name.toLowerCase()));
    return recommendedHabits.filter((habit) => {
      if (existing.has(habit.name.toLowerCase())) return false;
      if (!state.prefs.allowSerendipity && state.prefs.interestTags.length) {
        return habit.tags.some((tag) => state.prefs.interestTags.includes(tag));
      }
      return true;
    }).slice(0, 3);
  }, [state.habits, state.prefs]);

  const existingHabitNames = useMemo(
    () => new Set(state.habits.map((habit) => habit.name.trim().toLowerCase())),
    [state.habits],
  );

  const activityStatsByKey = useMemo(() => {
    const stats = new Map<string, { count: number; minutes: number }>();
    state.activityLog.forEach((entry) => {
      const key = entry.suggestionId || entry.title.trim().toLowerCase();
      const current = stats.get(key);
      if (current) {
        current.count += 1;
        current.minutes += entry.durationMin;
      } else {
        stats.set(key, { count: 1, minutes: entry.durationMin });
      }
    });
    return stats;
  }, [state.activityLog]);

  const addSuggestedHabit = (template: typeof recommendedHabits[number]) => {
    const habit: Habit = {
      id: `habit_${Date.now()}`,
      name: template.name,
      type: template.type,
      lengthMin: template.lengthMin,
      description: template.description,
      frequency: template.frequency,
      timeOfDay: template.timeOfDay,
      tags: template.tags,
      createdAt: new Date().toISOString(),
      lastCompletedAt: null,
      currentStreak: 0,
      longestStreak: 0,
      completionHistory: [],
    };
    actions.addHabit(habit);
  };

  const navigatingRef = useRef(false);
  const markHabitDone = useCallback((habit: Habit) => {
    if (navigatingRef.current) return;          // guard against double-fire
    navigatingRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    actions.recordActivity({
      id: `act_${Date.now()}`,
      suggestionId: habit.id,
      title: habit.name,
      durationMin: habit.lengthMin,
      timestamp: new Date().toISOString(),
      source: 'habit',
      isHabit: true,
      habitId: habit.id,
      tags: habit.tags ?? [],
      suggestionType: habit.type,
    });
    actions.completeHabit(habit.id);
    // Defer navigation so React settles all state updates before pushing
    InteractionManager.runAfterInteractions(() => {
      navigation.navigate('Completion', {
        title: habit.name,
        durationMin: habit.lengthMin,
        emojis: ['ԣ�', '����', 'ԡ�', '����'],
        tags: habit.tags ?? [],
        suggestionType: habit.type,
        habitId: habit.id,
        description: habit.description,
      });
      navigatingRef.current = false;
    });
  }, [actions, navigation]);

  const addCompletedActivityToHabits = useCallback((entry: ActivityLog) => {
    if (entry.isHabit) return;
    const normalizedTitle = entry.title.trim().toLowerCase();
    if (!normalizedTitle) return;
    if (existingHabitNames.has(normalizedTitle)) {
      Alert.alert(t('home_already_in_habits_title'), t('home_already_in_habits_body'));
      return;
    }

    const nowIso = new Date().toISOString();
    const newHabit: Habit = {
      id: `habit_${Date.now()}`,
      name: entry.title,
      type: entry.suggestionType === 'AT_HOME' ? 'AT_HOME' : 'GO_OUT',
      lengthMin: entry.durationMin,
      description: '',
      frequency: 'daily',
      timeOfDay: 'any',
      tags: entry.tags ?? [],
      createdAt: nowIso,
      lastCompletedAt: nowIso,
      currentStreak: 1,
      longestStreak: 1,
      completionHistory: [nowIso.slice(0, 10)],
    };

    actions.addHabit(newHabit);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logEvent('habit_added_from_dashboard_activity', {
      title: entry.title,
      suggestion_id: entry.suggestionId ?? null,
    });
  }, [actions, existingHabitNames]);

  const startDeck = (filter?: string, planDate?: 'today' | 'tomorrow') => {
    if (planDate === 'tomorrow') {
      navigation.navigate('SmartCalendar');
      logEvent('tap_plan_tomorrow', { filter: filter ?? 'all', planDate: 'tomorrow' });
      return;
    }

    const params = {
      durationOverride: state.permissions.calendarGranted ? null : manualDuration,
      filter: filter ?? undefined,
      planDate,
    };
    if (Platform.OS === 'web') {
      navigation.dispatch(StackActions.push('Deck', params));
      setTimeout(() => {
        navigation.dispatch(StackActions.replace('Deck', params));
      }, 0);
    } else {
      navigation.navigate('Deck', params);
    }
    logEvent('tap_do_something_now', { filter: filter ?? 'all', planDate: planDate ?? 'today' });
  };

  const onDoSomethingNow = () => {
    const currentMode = ACTION_MODES[actionIndex];
    if (!isModeAvailable(currentMode)) {
      return;
    }
    if (isBusyNowEffective) {
      Alert.alert(
        t('home_busy_prompt_title'),
        t('home_busy_prompt_body', { title: currentEventTitle }),
        [
          { text: t('home_keep_plan'), style: 'cancel' },
          { text: t('home_proceed'), onPress: () => startDeck(currentMode.filter, currentMode.planDate) },
        ],
      );
      return;
    }
    startDeck(currentMode.filter, currentMode.planDate);
  };

  const openScheduledActivity = useCallback((item: ScheduledActivity) => {
    if (openPlanSession(item)) return;
    navigation.navigate('Plan', {
      commitment: item.commitment,
      suggestion: item.suggestion,
      activityMode: item.activityMode,
    });
  }, [navigation, openPlanSession]);

  const onPressAvailabilityUntil = useCallback(() => {
    const openExternalCalendar = (eventId?: string | null) => {
      if (Platform.OS === 'ios') {
        Linking.openURL('calshow:').catch(() => {});
        return;
      }

      const fallbackTimeUrl = nextEventStartDate
        ? `content://com.android.calendar/time/${nextEventStartDate.getTime()}`
        : 'content://com.android.calendar/time/';

      if (eventId) {
        Linking.openURL(`content://com.android.calendar/events/${eventId}`).catch(() => {
          Linking.openURL(fallbackTimeUrl).catch(() =>
            Linking.openURL('content://com.android.calendar/time/').catch(() => {}),
          );
        });
        return;
      }

      Linking.openURL(fallbackTimeUrl).catch(() =>
        Linking.openURL('content://com.android.calendar/time/').catch(() => {}),
      );
    };

    if (linkedUpcomingScheduledActivity) {
      openScheduledActivity(linkedUpcomingScheduledActivity);
      return;
    }

    if (!state.permissions.calendarGranted) return;

    const resolveAndOpenExternal = async () => {
      if (!nextEventStartDate) {
        openExternalCalendar(null);
        return;
      }

      try {
        const searchStart = new Date(nextEventStartDate.getTime() - 10 * 60 * 1000);
        const searchEnd = new Date(nextEventStartDate.getTime() + 10 * 60 * 1000);
        const normalizedNextTitle = nextEventTitle.trim().toLowerCase();
        const nearbyEvents = await getUpcomingEvents(searchStart, searchEnd, state.disabledCalendars);

        const exactMatch = nearbyEvents.find((event) => {
          if (event.allDay) return false;
          if (Math.abs(event.startDate.getTime() - nextEventStartDate.getTime()) > 2 * 60 * 1000) return false;
          if (!normalizedNextTitle) return true;
          return event.title.trim().toLowerCase() === normalizedNextTitle;
        });

        openExternalCalendar(exactMatch?.id ?? nearbyEvents.find((event) => !event.allDay)?.id ?? null);
      } catch (error) {
        console.warn('Failed to resolve upcoming external event', error);
        openExternalCalendar(null);
      }
    };

    resolveAndOpenExternal().catch(() => openExternalCalendar(null));
  }, [
    linkedUpcomingScheduledActivity,
    nextEventStartDate,
    nextEventTitle,
    openScheduledActivity,
    state.disabledCalendars,
    state.permissions.calendarGranted,
  ]);

  const removeScheduledActivity = useCallback((item: ScheduledActivity) => {
    Alert.alert(t('home_delete_activity_title'), t('home_delete_scheduled_body'), [
      { text: t('home_keep'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          const linkedEventId = item.calendarEventId ?? item.commitment.calendarEventId;
          if (linkedEventId) {
            try {
              await deletePlanEvent(linkedEventId);
            } catch (error) {
              console.warn('Failed to delete scheduled activity from calendar', error);
              Alert.alert(t('home_could_not_delete_title'), t('home_could_not_delete_body'));
              return;
            }
          }

          actions.removeScheduledActivity(item.id);
          await refreshContext();
        },
      },
    ]);
  }, [actions, refreshContext, t]);

  const completeScheduledActivity = useCallback((item: ScheduledActivity) => {
    const scheduledStart = new Date(item.startAt);
    const completedAt = Number.isNaN(scheduledStart.getTime()) ? new Date() : scheduledStart;
    const linkedTodo = linkedTodoByScheduledActivityId.get(item.id);

    actions.recordActivity({
      id: `act_${Date.now()}`,
      suggestionId: item.suggestionId,
      title: item.title,
      durationMin: item.durationMin,
      timestamp: completedAt.toISOString(),
      activityMode: item.activityMode,
      source: item.suggestion.source === 'ad' ? undefined : item.suggestion.source,
      isHabit: !!item.suggestion.habitId,
      habitId: item.suggestion.habitId,
      tags: item.tags ?? item.suggestion.tags ?? [],
      suggestionType: item.type,
    });

    if (item.suggestion.habitId) {
      actions.completeHabit(item.suggestion.habitId, completedAt);
    }

    if (linkedTodo && !linkedTodo.done) {
      const completion = applyTodoChunkCompletion(linkedTodo, item.durationMin);
      actions.updateSmartTodo({
        ...completion.todo,
        completionPromptedAt: new Date().toISOString(),
      });
    }

    actions.removeScheduledActivity(item.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [actions, linkedTodoByScheduledActivityId]);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={styles.container}>
      <View style={[styles.pinnedHeader, { paddingTop: insets.top + theme.spacing.sm }]}> 
        <View style={styles.topBar}>
          <View style={styles.logoContainer}>
            <View style={styles.logoRow}>
              <Pressable onPress={() => navigation.navigate('Profile')}>
                {profileAvatarUri ? (
                  <Image source={{ uri: profileAvatarUri }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarFallback}>
                    <Text style={styles.headerAvatarFallbackText}>{avatarInitial}</Text>
                  </View>
                )}
              </Pressable>
              <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
            </View>
            <View style={styles.locationRow}>
              <Text style={styles.pinIcon}>{'\u{1F4CD}'}</Text>
              <Text style={styles.locationLabel} numberOfLines={1}>{locationStatusLabel}</Text>
            </View>
          </View>
          <View style={styles.headerRightColumn}>
            <View style={styles.bankActionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.premiumButton,
                  premiumEnabled ? styles.premiumButtonActive : styles.premiumButtonInactive,
                  pressed && styles.premiumButtonPressed,
                ]}
                onPress={() => navigation.navigate('Premium')}
              >
                <Text style={[styles.premiumButtonIcon, premiumEnabled ? styles.premiumIconActive : styles.premiumIconInactive]}>{'\u{1F451}'}</Text>
              </Pressable>
              <ChargeBar
                current={state.swipeBank?.current ?? 0}
                max={state.swipeBank?.max ?? 20}
                onPress={() => navigation.navigate('Bank')}
                style={styles.homeBankCounter}
              />
            </View>
            <View style={styles.headerRight}>
              <Pressable onPress={() => navigation.navigate('Profile')}>
                <Text style={styles.settings}>{t('home_profile')}</Text>
              </Pressable>
              <Pressable onPress={() => navigation.navigate('Settings')}>
                <Text style={styles.settings}>{t('home_settings')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
        <LinearGradient
          pointerEvents="none"
          colors={[
            hexToRgba(theme.colors.background, 1),
            hexToRgba(theme.colors.background, 0.94),
            hexToRgba(theme.colors.background, 0.82),
            hexToRgba(theme.colors.background, 0.6),
            hexToRgba(theme.colors.background, 0.3),
            hexToRgba(theme.colors.background, 0),
          ]}
          locations={[0, 0.45, 0.65, 0.8, 0.92, 1]}
          style={styles.headerFade}
        />
      </View>
      <ScrollView
        ref={homeScrollRef}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: theme.spacing.sm, paddingBottom: insets.bottom + 120 },
        ]}
      >
        <View style={styles.content}>
        <View style={styles.bannerSwipeContainer}>
          <ScrollView
            ref={bannerScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onBannerScroll}
            style={{ height: BANNER_PAGE_HEIGHT }}
          >
            <View style={[styles.bannerPage, { width: screenWidth }]}>
              <View style={styles.skyWrapper}>
                <SkyBanner key={`sky-${bannerKey}`} weather={weatherCondition} />
              </View>
              <ActivityBanner key={`activity-${bannerKey}`} weather={weatherCondition} restartKey={bannerKey} sleepMode={isOutsideWakeWindow} />
            </View>
            {badgeProgress.length > 0 && (
              <View style={[styles.bannerPage, styles.badgeBannerPage, { width: screenWidth }]}>
                {badgeProgress.slice(0, 3).map((badge) => (
                  <Pressable key={badge.id} style={styles.bannerBadgeItem} onPress={() => navigation.navigate('BadgeDetail', { badgeId: badge.id })}>
                    <Text style={styles.badgeLevelLabel}>{t('home_level', { value: badge.level })}</Text>
                    <View style={styles.bannerBadgeIconWrap}>
                      <BadgeRing size={41} strokeWidth={4} progress={badge.progress} level={badge.level} color={badge.color} />
                      <View style={styles.bannerBadgeOverlay}>
                        <BadgeIcon badgeId={badge.id} size={32} color={badge.color} />
                      </View>
                    </View>
                    <Text style={styles.bannerBadgeName} numberOfLines={1}>{badge.title}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
        <View style={styles.hero}>
          <ScrollView
            ref={actionScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onActionScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onActionScroll}
            snapToInterval={screenWidth}
            decelerationRate="fast"
            style={styles.actionScroll}
            contentContainerStyle={styles.actionScrollContent}
          >
            {ACTION_MODES.map((item) => (
              <View key={item.key} style={{ width: screenWidth, paddingHorizontal: 16 }}>
                {(() => {
                  const modeAvailable = isModeAvailable(item);
                  const modeMuted = !modeAvailable || (isBusyNowEffective && item.key !== 'tomorrow');
                  return (
                <PrimaryButton
                  label={loading ? t('home_working') : item.label}
                  glow={!isBusyNowEffective && modeAvailable}
                  variant={modeMuted ? 'muted' : 'default'}
                  bgColor={modeMuted ? undefined : item.bg}
                  textColor={modeMuted ? undefined : item.text}
                  disabled={loading || !modeAvailable}
                  onPress={onDoSomethingNow}
                />
                  );
                })()}
              </View>
            ))}
          </ScrollView>
          <View style={styles.dotRow}>
            {ACTION_MODES.map((mode, i) => (
              <View
                key={mode.key}
                style={[
                  styles.dot,
                  i === actionIndex && [styles.dotActive, { backgroundColor: mode.bg }],
                ]}
              />
            ))}
          </View>
          {isBusyNowEffective && (
            <Pressable
              style={({ pressed }) => [styles.busyCard, pressed && { opacity: 0.85 }]}
              onPress={() => {
                if (openPlanSession()) return;
                if (currentScheduledActivity) {
                  openScheduledActivity(currentScheduledActivity);
                  return;
                }
                const eventId = state.availability?.currentEventId;
                if (!eventId) return;
                if (Platform.OS === 'ios') {
                  Linking.openURL('calshow:').catch(() => {});
                } else {
                  Linking.openURL(`content://com.android.calendar/events/${eventId}`).catch(() =>
                    Linking.openURL('content://com.android.calendar/time/').catch(() => {}),
                  );
                }
              }}
            >
              <Text style={styles.busyLabel}>{t('home_happening_now')}</Text>
              <Text style={styles.busyTitle}>{activePlanSession?.suggestion?.title ?? currentEventTitle}</Text>
              <Text style={styles.busyHint}>{activePlanSession || currentScheduledActivity ? t('home_tap_resume') : t('home_tap_calendar')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete current activity from calendar"
                hitSlop={8}
                onPress={(event) => {
                  event.stopPropagation();
                  handleDeleteCurrentEvent();
                }}
                style={({ pressed }) => [
                  styles.busyDeleteButton,
                  pressed && styles.busyDeleteButtonPressed,
                ]}
              >
                <Text style={styles.busyDeleteLabel}>X</Text>
              </Pressable>
            </Pressable>
          )}
          {!!availabilitySubtext && (
            <View style={styles.deckMetaRow}>
              {canPressAvailabilitySubtext ? (
                <Pressable accessibilityRole="button" onPress={onPressAvailabilityUntil} style={styles.deckMetaPressable}>
                  <Text style={styles.subtext}>
                    {availabilitySubtextPrefix}
                    {!!availabilitySubtextSuffix && availabilitySubtextSuffix}
                    {showTappableUntil ? (
                      <Text style={styles.subtextLink}>
                        {untilLabel}
                      </Text>
                    ) : (
                      !!untilLabel && <Text>{untilLabel}</Text>
                    )}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.subtext}>
                  {availabilitySubtextPrefix}
                  {!!availabilitySubtextSuffix && availabilitySubtextSuffix}
                  {showTappableUntil ? (
                    <Text style={styles.subtextLink}>
                      {untilLabel}
                    </Text>
                  ) : (
                    !!untilLabel && <Text>{untilLabel}</Text>
                  )}
                </Text>
              )}
            </View>
          )}
          {/* ������ Scheduled activities ������ */}
          {dashboardScheduledActivities.length > 0 && (
            <View style={styles.scheduledSection}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isScheduledCollapsed ? 'Expand scheduled activities' : 'Collapse scheduled activities'}
                onPress={() => setIsScheduledCollapsed((prev) => !prev)}
                style={({ pressed }) => [styles.scheduledSectionHeader, pressed && styles.scheduledSectionHeaderPressed]}
              >
                <View style={styles.scheduledSectionTitleRow}>
                  <Text style={styles.scheduledSectionTitle}>
                    {isScheduledCollapsed
                      ? t('home_scheduled_today_count', { count: dashboardScheduledActivities.length })
                      : t('home_scheduled')}
                  </Text>
                  {isScheduledCollapsed && <Text style={styles.scheduledSectionTriangle}>▸</Text>}
                </View>
              </Pressable>
              {!isScheduledCollapsed && dashboardScheduledActivities
                .slice(0, 5)
                .map((item) => {
                  const isOverdue = overdueScheduledActivityIds.has(item.id);
                  return (
                  <Pressable
                    key={item.id}
                    onPress={() => openScheduledActivity(item)}
                    style={({ pressed }) => [
                      styles.scheduledCard,
                      isOverdue && styles.scheduledCardOverdue,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.scheduledCardRow}>
                      {isOverdue && (
                        <View style={styles.scheduledOverdueMarker}>
                          <Text style={styles.scheduledOverdueMarkerText}>{t('home_overdue')}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scheduledTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={[styles.scheduledMeta, isOverdue && styles.scheduledMetaOverdue]}>
                          {isOverdue ? t('home_overdue_prefix') : ''}
                          {new Date(item.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} | {formatTime(new Date(item.startAt))} | {item.durationMin} min
                        </Text>
                      </View>
                      <View style={[
                        styles.scheduledActionColumn,
                        isOverdue && styles.scheduledActionColumnOverdue,
                      ]}>
                        {isOverdue && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Mark scheduled activity ${item.title} as done`}
                            hitSlop={8}
                            onPress={(event) => {
                              event.stopPropagation();
                              completeScheduledActivity(item);
                            }}
                            style={({ pressed }) => [
                              styles.scheduledCheckButton,
                              pressed && styles.scheduledCheckButtonPressed,
                            ]}
                          >
                            <Text style={styles.scheduledCheckLabel}>✓</Text>
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove scheduled activity ${item.title}`}
                          hitSlop={8}
                          onPress={(event) => {
                            event.stopPropagation();
                            removeScheduledActivity(item);
                          }}
                          style={({ pressed }) => [
                            styles.scheduledDeleteButton,
                            pressed && styles.scheduledDeleteButtonPressed,
                          ]}
                        >
                          <Text style={styles.scheduledDeleteLabel}>X</Text>
                        </Pressable>
                      </View>
                    </View>
                  </Pressable>
                  );
                })}
            </View>
          )}
          {!state.permissions.calendarGranted && (
            <View style={styles.chipRow}>
              {durationOptions.map((minutes) => (
                <Chip
                  key={minutes}
                  label={formatDurationLabel(minutes)}
                  selected={manualDuration === minutes}
                  onPress={() => setManualDuration(minutes)}
                />
              ))}
            </View>
          )}
        </View>
          {!isAdmin && stats.totalDone < 3 ? (
            <View style={styles.dashboard}>
              <Text style={styles.dashboardTitle}>Unlock your dashboard</Text>
              <Text style={styles.emptyText}>
                Do {3 - stats.totalDone} more {3 - stats.totalDone === 1 ? 'activity' : 'activities'} to see your stats.
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(stats.totalDone, 3) / 3 * 100}%` }]} />
              </View>
              <Text style={styles.progressLabel}>{Math.min(stats.totalDone, 3)}/3 done</Text>
              <Text style={styles.encourageText}>Tap "DO SOMETHING NOW" to get your first wins.</Text>
            </View>
          ) : (
            <>
              <View style={styles.dashboard}>
                <View style={styles.dashboardTitleRow}>
                  <Text style={styles.dashboardTitle}>Your activity</Text>
                  {showTodayButton && (
                    <Pressable
                      onPress={() => scrollGraphToToday(true)}
                      style={({ pressed }) => [styles.todayButton, pressed && styles.todayButtonPressed]}
                    >
                      <Text style={styles.todayButtonText}>Today</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.dashboardGraphWrap}>
                  <ScrollView
                    ref={graphScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.dashboardGraph}
                    scrollEventThrottle={16}
                    onScroll={handleGraphScroll}
                    onLayout={(e) => setGraphViewportWidth(e.nativeEvent.layout.width)}
                    onContentSizeChange={() => {
                      if (pendingGraphScrollRef.current) scrollGraphToToday(false);
                    }}
                  >
                    {weekGraph.map((day) => (
                      <Pressable
                        key={day.key}
                        onPress={() => setSelectedDayKey(day.key)}
                        style={({ pressed }) => [
                          styles.dashboardGraphCol,
                          { width: graphColumnWidth },
                          day.key === selectedDayKey && styles.dashboardGraphColActive,
                          pressed && styles.dashboardGraphColPressed,
                        ]}
                      >
                      <View
                        style={[
                          styles.dashboardGraphTrackWrap,
                          day.key === selectedDayKey && styles.dashboardGraphTrackWrapActive,
                        ]}
                      >
                        <View style={styles.dashboardGraphTrack}>
                          {day.hasActivity ? (
                            <View style={[styles.dashboardGraphStack, { height: `${day.height}%` }]}>
                              {day.modeSegments.map((segment, idx) => (
                                <View
                                  key={`${day.key}_${segment.mode}`}
                                  style={[
                                    styles.dashboardGraphSegment,
                                    { flex: segment.minutes, backgroundColor: activityModeColors[segment.mode] },
                                    idx > 0 && styles.dashboardGraphSegmentStart,
                                    idx < day.modeSegments.length - 1 && styles.dashboardGraphSegmentOverlap,
                                    idx === 0 && styles.dashboardGraphSegmentTop,
                                  ]}
                                />
                              ))}
                            </View>
                          ) : (
                            <Text style={styles.dashboardGraphEmptyMark}>×</Text>
                          )}
                        </View>
                      </View>
                      <View style={[styles.dashboardGraphLabelWrap, day.key === todayKey && styles.dashboardGraphLabelWrapToday]}>
                        <Text numberOfLines={1} style={[styles.dashboardGraphLabel, day.key === todayKey && styles.dashboardGraphLabelToday]}>{day.dayLabel}</Text>
                      </View>
                      {day.minutes > 0 && <Text style={styles.dashboardGraphValue}>{day.minutes}m</Text>}
                    </Pressable>
                  ))}
                </ScrollView>
                </View>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.activityCount}</Text>
                    <Text style={styles.statLabel}>Activities</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statValue}>{stats.minutes}m</Text>
                    <Text style={styles.statLabel}>This week</Text>
                  </View>
                  {stats.habitTotal > 0 && (
                    <Pressable
                      onPress={() => navigation.navigate('Habits')}
                      style={({ pressed }) => [styles.statCard, styles.statCardPressable, pressed && styles.statCardPressed]}
                    >
                      <Text style={styles.statValue}>{stats.habitPercent ?? 0}%</Text>
                      <Text style={styles.statLabel}>Habit rate</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.dayDetailsCard}>
                  <View style={styles.dayDetailsHeader}>
                    <Text style={styles.dashboardTitle}>{selectedDay?.dayLabel ?? 'Today'}</Text>
                    <Text style={styles.dayDetailsMeta}>
                      {selectedDay && selectedDay.minutes > 0
                        ? `${selectedDay.minutes} min done`
                        : nextUpcomingToday
                          ? `Next today: ${nextUpcomingToday.title} at ${nextUpcomingToday.startLabel}`
                        : selectedDayScheduledActivities.length > 0
                          ? `${selectedDayScheduledActivities.length} scheduled`
                          : 'No activity'}
                    </Text>
                  </View>
                  {selectedDayActivities.length > 0 || selectedDayScheduledActivities.length > 0 ? (
                    <View style={styles.dayActivityList}>
                      {selectedDayActivities.map((entry) => {
                        const activityKey = entry.suggestionId || entry.title.trim().toLowerCase();
                        const aggregateStats = activityStatsByKey.get(activityKey);
                        const alreadyInHabits = entry.isHabit || existingHabitNames.has(entry.title.trim().toLowerCase());
                        const activityMode = resolveActivityMode(entry);
                        const displayTags = getVisibleTags(entry.tags, 2);
                        return (
                        <View key={entry.id} style={styles.dayActivityRow}>
                          <View
                            style={[
                              styles.dayActivitySourceDot,
                              { backgroundColor: activityModeColors[activityMode] },
                            ]}
                          />
                          <View style={styles.dayActivityTypeBlock}>
                            <View style={[styles.dayActivityTypePill, entry.isHabit ? styles.dayActivityHabitPill : styles.dayActivityOneOffPill]}>
                              <Text style={[styles.dayActivityTypeText, entry.isHabit ? styles.dayActivityHabitText : styles.dayActivityOneOffText]}>
                                {entry.isHabit ? 'Habit' : 'One-time'}
                              </Text>
                            </View>
                            {displayTags.length > 0 && (
                              <View style={styles.dayActivityTagsRow}>
                                {displayTags.map((tag, index) => (
                                  <View
                                    key={`${entry.id}_${tag}_${index}`}
                                    style={[
                                      styles.dayActivityTag,
                                      {
                                        backgroundColor: getDashboardTagTone(tag).backgroundColor,
                                        borderColor: getDashboardTagTone(tag).borderColor,
                                      },
                                    ]}
                                  >
                                    <Text style={[styles.dayActivityTagText, { color: getDashboardTagTone(tag).textColor }]} numberOfLines={1}>{tag}</Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.dayActivityTitle}>{entry.title}</Text>
                            <Text style={styles.dayActivityMeta}>{formatTime(new Date(entry.timestamp))} · {entry.durationMin}m</Text>
                            <View style={styles.dayActivityBottomRow}>
                              <Text style={styles.dayActivityStatText} numberOfLines={1}>
                                {aggregateStats
                                  ? `${aggregateStats.count}x done · ${aggregateStats.minutes}m total`
                                  : `${entry.durationMin}m done`}
                              </Text>
                              {!entry.isHabit && (
                                <Pressable
                                  hitSlop={6}
                                  disabled={alreadyInHabits}
                                  onPress={() => addCompletedActivityToHabits(entry)}
                                  style={({ pressed }) => [
                                    styles.dayActivityHabitAction,
                                    alreadyInHabits && styles.dayActivityHabitActionDisabled,
                                    pressed && !alreadyInHabits && styles.dayActivityHabitActionPressed,
                                  ]}
                                >
                                  <Text style={styles.dayActivityHabitActionText}>{alreadyInHabits ? 'In habits' : 'Add to habits'}</Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        </View>
                        );
                      })}
                      {selectedDayScheduledActivities.map((item) => (
                        <Pressable
                          key={item.id}
                          onPress={() => openScheduledActivity(item)}
                          style={({ pressed }) => [styles.dayActivityRow, pressed && styles.dayActivityRowPressed]}
                        >
                          <View style={[styles.dayActivityTypePill, styles.dayActivityScheduledPill]}>
                            <Text style={[styles.dayActivityTypeText, styles.dayActivityScheduledText]}>Scheduled</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.dayActivityTitle}>{item.title}</Text>
                            <Text style={styles.dayActivityMeta}>{formatTime(new Date(item.startAt))} · {item.durationMin}m</Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.dayDetailsEmpty}>
                      {nextUpcomingToday
                        ? `Coming up today: ${nextUpcomingToday.title} at ${nextUpcomingToday.startLabel}.`
                        : 'No activities for this day yet.'}
                    </Text>
                  )}
                </View>
                {badgeProgress.length > 0 && (
                  <View style={styles.dashboardBottomBadgeSection}>
                    <View style={styles.dashboardTitleRow}>
                      <Text style={styles.dashboardTitle}>Badges</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeScrollContent}>
                      {badgeProgress.map((badge) => (
                        <Pressable key={badge.id} style={styles.badgeScrollCell} onPress={() => navigation.navigate('BadgeDetail', { badgeId: badge.id })}>
                          <Text style={styles.badgeLevelLabelSmall}>Lv {badge.level}</Text>
                          <View style={styles.badgeScrollIconWrap}>
                            <BadgeRing size={36} strokeWidth={3} progress={badge.progress} level={badge.level} color={badge.color} />
                            <View style={styles.bannerBadgeOverlay}>
                              <BadgeIcon badgeId={badge.id} size={28} color={badge.color} />
                            </View>
                          </View>
                          <Text style={styles.badgeScrollName} numberOfLines={1}>{badge.title}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>
            </>
          )}
      </View>
      </ScrollView>
      <LinearGradient
        colors={footerGradientColors}
        locations={[0, 0.1, 0.2, 0.4, 0.6, 0.8, 1]}
        style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.lg }]}
        pointerEvents="box-none"
      >
        <View style={styles.footerRow}>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.habitsButtonWide, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('Habits')}
          >
            <Text style={styles.habitsButtonText}>Habits</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.libraryButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('Library')}
          >
            <Text style={styles.libraryButtonIcon}>{'\u{1F4DA}'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.smartCalendarButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('SmartCalendar')}
          >
            <Text style={styles.libraryButtonIcon}>{'\u{1F4C5}'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.addIdeaButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('CommunityIdeaForm')}
          >
            <Text style={styles.addIdeaButtonIcon}>+</Text>
          </Pressable>
        </View>
      </LinearGradient>

    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  pinnedHeader: {
    paddingHorizontal: theme.spacing.xl,
    zIndex: 10,
    elevation: 10,
    backgroundColor: theme.colors.background,
    paddingBottom: theme.spacing.xs,
  },
  headerFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -10,
    height: 10,
  },
  scroll: {
    paddingHorizontal: theme.spacing.xl,
    flexGrow: 1,
  },
  logo: {
    alignSelf: 'flex-start',
  },
  logoContainer: {
    alignItems: 'flex-start',
    gap: 2,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  headerAvatar: {
    width: LOGO_HEIGHT + 4,
    height: LOGO_HEIGHT + 4,
    borderRadius: (LOGO_HEIGHT + 4) / 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  headerAvatarFallback: {
    width: LOGO_HEIGHT + 4,
    height: LOGO_HEIGHT + 4,
    borderRadius: (LOGO_HEIGHT + 4) / 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    backgroundColor: '#D6DADF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarFallbackText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: '#5E6670',
    lineHeight: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  headerRightColumn: {
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
    paddingTop: 0,
    flexShrink: 0,
  },
  bankActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  homeBankCounter: {
    alignSelf: 'flex-end',
  },
  premiumButton: {
    width: 40,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumButtonActive: {
    backgroundColor: '#F7E8A6',
  },
  premiumButtonInactive: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  premiumButtonPressed: {
    transform: [{ scale: 0.97 }],
  },
  premiumButtonIcon: {
    fontSize: 17,
    lineHeight: 18,
  },
  premiumIconActive: {
    color: '#6A4A00',
  },
  premiumIconInactive: {
    color: '#9AA0A8',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  headerRight: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: 0,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 40,
    marginTop: 2,
  },
  pinIcon: {
    fontSize: 14,
  },
  locationLabel: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 13,
    flexShrink: 1,
  },
  settings: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  deckMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  deckMetaPressable: {
    flex: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xxl,
  },
  skyWrapper: {
    zIndex: 0,
    marginBottom: -18,
  },
  hero: {
    gap: theme.spacing.md,
  },
  actionScroll: {
    overflow: 'visible' as const,
    backgroundColor: 'transparent',
  },
  actionScrollContent: {
    backgroundColor: 'transparent',
  },
  busyCard: {
    position: 'relative',
    padding: theme.spacing.md,
    paddingRight: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  busyLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: theme.colors.textMuted,
  },
  busyTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  busyHint: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  busyDeleteButton: {
    position: 'absolute',
    right: theme.spacing.md,
    top: '50%',
    transform: [{ translateY: -10 }],
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyDeleteButtonPressed: {
    backgroundColor: theme.colors.border,
  },
  busyDeleteLabel: {
    fontFamily: theme.fonts.semibold,
    color: '#B8B8B8',
    fontSize: 13,
    lineHeight: 13,
  },
  dotRow: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: theme.colors.border,
  },
  dotActive: {
    backgroundColor: theme.colors.accent,
    width: 18,
  },
  habitsButton: {
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  habitsButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  habitsButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 15,
  },
  footerRow: {
    marginHorizontal: 16,
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  habitsButtonWide: {
    flex: 3,
  },
  libraryButton: {
    flex: 1,
    justifyContent: 'center',
  },
  smartCalendarButton: {
    flex: 1,
    justifyContent: 'center',
  },
  libraryButtonIcon: {
    fontSize: 18,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  addIdeaButton: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  addIdeaButtonIcon: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.accentText,
    fontSize: 20,
    lineHeight: 20,
  },
  subtext: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 16,
    flex: 1,
  },
  subtextLink: {
    textDecorationLine: 'underline',
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  subtextMuted: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  chipRow: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dashboard: {
    marginTop: theme.spacing.lg,
    marginBottom: -(theme.spacing.sm + theme.spacing.xs),
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.isDark ? theme.colors.card : '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  dashboardGraphWrap: {
    position: 'relative',
  },
  dashboardGraph: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
  },
  todayButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  todayButtonPressed: {
    opacity: 0.8,
  },
  todayButtonText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.accentText,
  },
  dashboardGraphCol: {
    width: DASHBOARD_DEFAULT_COL_WIDTH,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  dashboardGraphColActive: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  dashboardGraphTrackWrap: {
    width: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    padding: 1,
  },
  dashboardGraphTrackWrapActive: {
    borderColor: theme.colors.accent,
  },
  dashboardGraphColPressed: {
    opacity: 0.78,
  },
  dashboardGraphTrack: {
    width: '100%',
    height: 88,
    justifyContent: 'flex-end',
    borderRadius: 999,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  dashboardGraphEmptyMark: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.textMuted,
    opacity: 0.6,
  },
  dashboardGraphStack: {
    width: '100%',
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    overflow: 'hidden',
  },
  dashboardGraphSegment: {
    width: '100%',
  },
  dashboardGraphSegmentStart: {
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  dashboardGraphSegmentOverlap: {
    marginBottom: -DASHBOARD_STACK_SEGMENT_OVERLAP_PX,
  },
  dashboardGraphSegmentTop: {
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  dashboardGraphLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  dashboardGraphLabelWrap: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  dashboardGraphLabelWrapToday: {
    backgroundColor: theme.colors.accent,
  },
  dashboardGraphLabelToday: {
    color: theme.colors.accentText,
  },
  dashboardGraphValue: {
    fontFamily: theme.fonts.body,
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  badgeCard: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    gap: theme.spacing.md,
  },
  dashboardBottomBadgeSection: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  dashboardTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 120,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
  },
  statCardPressable: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statCardPressed: {
    opacity: 0.85,
    transform: [{ translateY: 1 }],
  },
  statValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
    color: theme.colors.text,
  },
  statLabel: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  habitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  addLink: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  emptyText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  encourageText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  dayDetailsCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    gap: theme.spacing.sm,
  },
  dayDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  dayDetailsMeta: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  dayDetailsEmpty: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  dayActivityList: {
    gap: theme.spacing.sm,
  },
  dayActivityRow: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    paddingRight: theme.spacing.lg + 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dayActivitySourceDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dayActivityRowPressed: {
    opacity: 0.82,
  },
  dayActivityTypePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  dayActivityTypeBlock: {
    alignItems: 'flex-start',
    gap: 4,
    maxWidth: 110,
  },
  dayActivityTagsRow: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  dayActivityTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 92,
  },
  dayActivityTagText: {
    fontFamily: theme.fonts.body,
    fontSize: 10,
  },
  dayActivityHabitPill: {
    backgroundColor: theme.colors.background,
  },
  dayActivityOneOffPill: {
    backgroundColor: theme.colors.background,
  },
  dayActivityScheduledPill: {
    backgroundColor: theme.colors.accentSoft,
  },
  dayActivityTypeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
  },
  dayActivityHabitText: {
    color: theme.colors.success,
  },
  dayActivityOneOffText: {
    color: theme.colors.textMuted,
  },
  dayActivityScheduledText: {
    color: theme.colors.accentDark,
  },
  dayActivityTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  dayActivityMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  dayActivityBottomRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  dayActivityStatText: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 11,
  },
  dayActivityHabitAction: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.accentSoft,
    flexShrink: 0,
    marginLeft: 'auto',
    marginRight: -(theme.spacing.lg + 2),
  },
  dayActivityHabitActionPressed: {
    opacity: 0.84,
  },
  dayActivityHabitActionDisabled: {
    backgroundColor: theme.colors.background,
  },
  dayActivityHabitActionText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.accentDark,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.backgroundAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.colors.accent,
  },
  progressLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  habitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  habitCard: {
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    gap: 6,
  },
  habitCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  habitName: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 14,
  },
  habitMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  streakBadge: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  streakText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.accentDark,
  },
  habitDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  habitDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  habitDotDone: {
    backgroundColor: theme.colors.accent,
  },
  habitDotEmpty: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  markDoneBtn: {
    marginLeft: 'auto',
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  markDoneText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.accentText,
  },
  doneTag: {
    marginLeft: 'auto',
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.accent,
  },
  undoBtn: {
    marginLeft: 'auto',
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  undoText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.accent,
  },
  habitStatus: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
  habitDue: {
    color: theme.colors.danger,
  },
  habitOk: {
    color: theme.colors.accentDark,
  },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  badgeItem: {
    width: 92,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
  },
  badgeItemPressed: {
    transform: [{ scale: 0.97 }],
  },
  badgeTitle: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.text,
    textAlign: 'center',
  },
  badgeMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },

  /* ������ Inline badge trio grid ��������� */
  badgeTrioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  badgeTrioCell: {
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    gap: 4,
  },
  badgeTrioName: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.textMuted,
    textAlign: 'center',
    maxWidth: '100%',
  },
  /* ������ Expanded badge popup grid ��������� */
  badgePopupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'center',
  },
  badgePopupCell: {
    flexBasis: '30%',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  badgePopupVisual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgePopupVisualLeft: {
    flexDirection: 'row',
  },
  badgePopupVisualRight: {
    flexDirection: 'row',
  },
  badgePopupLogoWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePopupRingWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupBadgeIconStack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupBadgeRingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ������ Dashboard title row ��������� */
  dashboardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expandHint: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },

  /* ������ Popup ��������������������������������������������������������������������������������������������������������� */
  popupOverlay: {
    flex: 1,
  },
  popupBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  popupContainer: {
    flex: 1,
    marginTop: 24,
    marginHorizontal: 10,
    marginBottom: 48,
    borderRadius: 28,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 10,
  },
  popupScroll: {
    flex: 1,
  },
  popupScrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  popupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  popupTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    color: theme.colors.text,
  },
  popupClose: {
    fontSize: 22,
    color: theme.colors.textMuted,
    padding: 4,
  },

  /* ������ Popup stats ��������� */
  popupSection: {
    gap: theme.spacing.sm,
  },
  popupSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  popupSectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  popupLink: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.accent,
  },
  popupStatsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  popupStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  popupStatCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  popupStatCardLarge: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: theme.spacing.lg,
    justifyContent: 'center',
  },
  popupStatValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    marginTop: theme.spacing.xs,
  },
  popupStatLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
  },

  /* ������ Popup habits ��������� */
  popupHabitCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  popupHabitTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  popupHabitName: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
    color: theme.colors.text,
  },
  popupHabitMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  popupDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  popupDotCol: {
    alignItems: 'center',
    gap: 2,
  },
  popupDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  popupDotDone: {
    backgroundColor: theme.colors.accent,
  },
  popupDotEmpty: {
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  popupDotLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 9,
    color: theme.colors.textMuted,
  },

  /* ������ Popup badges ��������� */
  popupBadgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  popupBadgeItem: {
    width: 80,
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  popupBadgeName: {
    marginTop: 4,
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
    textAlign: 'center',
  },
  popupBadgeMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 10,
    color: theme.colors.textMuted,
  },

  /* ������ Popup activities ��������� */
  popupActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  popupActivityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
  },
  popupActivityTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.text,
  },
  popupActivityMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },

  /* ������ Banner swipe ��������� */
  bannerSwipeContainer: {
    zIndex: 2,
  },
  bannerPage: {
    height: 94,
    overflow: 'hidden',
  },
  badgeBannerPage: {
    backgroundColor: theme.isDark ? theme.colors.card : '#FFFFFF',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: theme.spacing.md,
  },
  bannerBadgeItem: {
    alignItems: 'center',
    gap: 2,
  },
  badgeLevelLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 9,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badgeLevelLabelSmall: {
    fontFamily: theme.fonts.semibold,
    fontSize: 8,
    color: theme.colors.textMuted,
    letterSpacing: 0.3,
  },
  bannerBadgeIconWrap: {
    width: 41,
    height: 41,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBadgeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerBadgeName: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
    textAlign: 'center',
    maxWidth: 80,
  },
  bannerDotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
  },
  bannerDotActive: {
    backgroundColor: theme.colors.accent,
    width: 14,
  },

  /* ������ Badge horizontal scroll ��������� */
  badgeScrollContent: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
    alignItems: 'center',
  },
  badgeScrollCell: {
    alignItems: 'center',
    gap: 4,
    width: 60,
  },
  badgeScrollIconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeScrollName: {
    fontFamily: theme.fonts.semibold,
    fontSize: 9,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  scheduledSection: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  scheduledSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  scheduledSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduledSectionHeaderPressed: {
    opacity: 0.75,
  },
  scheduledSectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  scheduledSectionTriangle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 2,
    marginLeft: 6,
  },
  scheduledCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  scheduledCardOverdue: {
    borderColor: theme.colors.danger,
  },
  scheduledCardRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  scheduledOverdueMarker: {
    backgroundColor: theme.colors.danger,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
    marginRight: theme.spacing.sm,
  },
  scheduledOverdueMarkerText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  scheduledTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
    color: theme.colors.text,
  },
  scheduledMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  scheduledMetaOverdue: {
    color: theme.colors.danger,
  },
  scheduledActionColumn: {
    marginLeft: theme.spacing.sm,
    justifyContent: 'center' as const,
    gap: 4,
  },
  scheduledActionColumnOverdue: {
    alignSelf: 'flex-start' as const,
  },
  scheduledCheckButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduledCheckButtonPressed: {
    backgroundColor: hexToRgba(theme.colors.success, 0.16),
  },
  scheduledCheckLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.success,
    lineHeight: 16,
  },
  scheduledDeleteButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 0,
  },
  scheduledDeleteButtonPressed: {
    backgroundColor: theme.colors.border,
  },
  scheduledDeleteLabel: {
    fontFamily: theme.fonts.semibold,
    color: '#B8B8B8',
    fontSize: 13,
    lineHeight: 13,
  },
});
