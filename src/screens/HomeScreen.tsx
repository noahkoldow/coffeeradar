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
import { ActivityBanner, SkyBanner } from '../components/ActivityBanner';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { getAvailability } from '../services/calendar';
import { getCurrentLocation } from '../services/location';
import { formatDuration, formatTime } from '../utils/time';
import { logEvent } from '../services/analytics';
import { upsertUserData } from '../services/user';
import { fetchWeather, WeatherCondition } from '../services/weather';
import { prefetchGeminiSuggestions } from '../services/geminiSuggestions';
import { loadWeatherCondition, saveWeatherCondition } from '../utils/storage';
import { detectLocationProfile } from '../services/locationProfile';
import { recommendedHabits } from '../data/habits';
import { Availability, Habit, ScheduledActivity } from '../types';
import { formatHabitFrequency, formatHabitTimeOfDay, isHabitDue, streakEmoji, weeklyDots, getHabitUrgency } from '../utils/habits';
import * as Haptics from 'expo-haptics';
import { buildBadgeProgress } from '../utils/badges';

type Props = StackScreenProps<RootStackParamList, 'Home'>;

const durationOptions = [30, 60, 120, 240];

const formatDurationLabel = (minutes: number): string => {
  if (minutes === 240) return 'Tonight';
  return formatDuration(minutes);
};

const BANNER_PAGE_HEIGHT = 94;

// Logo: 1:3 aspect ratio, half the button height (~30px tall, 90px wide)
const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const bitsLogo = require('../../assets/logo.png');
const lastUpdatedLabel = new Date().toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
};

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const [loading, setLoading] = useState(false);
  const [manualDuration, setManualDuration] = useState(60);
  const [weatherCondition, setWeatherCondition] = useState<WeatherCondition>('unknown');
  const [bannerKey, setBannerKey] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [bannerPageIndex, setBannerPageIndex] = useState(0);
  const insets = useSafeAreaInsets();
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  const isInitialMount = useRef(true);

  const screenWidth = Dimensions.get('window').width - theme.spacing.xl * 2;

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
  const [schedulePrompt, setSchedulePrompt] = useState<ScheduledActivity | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const recentActivities = useMemo(() => {
    return state.activityLog.slice(0, 10);
  }, [state.activityLog]);

  const { height: screenHeight } = Dimensions.get('window');

  // Restore cached weather so the banner doesn't visually jump on first render
  useEffect(() => {
    loadWeatherCondition().then((cached) => {
      if (cached && (cached === 'clear' || cached === 'cloudy' || cached === 'rain' || cached === 'snow')) {
        setWeatherCondition(cached as WeatherCondition);
      }
    });
  }, []);

  const ACTION_MODES = useMemo(() => [
    { key: 'all', label: 'DO SOMETHING NOW', filter: undefined as string | undefined, bg: theme.colors.accent, text: theme.colors.accentText },
    {
      key: 'productive',
      label: 'BE PRODUCTIVE',
      filter: 'productive',
      bg: theme.isDark ? '#2A4A5E' : '#A8D8EA',
      text: theme.isDark ? '#D8F0FF' : '#1A3A4A',
    },
    {
      key: 'tomorrow',
      label: 'PLAN AHEAD',
      filter: undefined as string | undefined,
      planDate: 'tomorrow' as const,
      bg: theme.isDark ? '#2E4F45' : '#B5EAD7',
      text: theme.isDark ? '#D9F6EA' : '#1A4A3A',
    },
    {
      key: 'at_home',
      label: 'HOMEBODY IT',
      filter: 'at_home',
      bg: theme.isDark ? '#54374A' : '#E2B6CF',
      text: theme.isDark ? '#F5DDED' : '#3A1A2E',
    },
  ], [theme.colors.accent, theme.colors.accentText, theme.isDark]);

  const weekGraph = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - offset));
      const dayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
      const key = date.toDateString();
      const activities = state.activityLog
        .filter((entry) => new Date(entry.timestamp).toDateString() === key)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const minutes = activities.reduce((sum, entry) => sum + entry.durationMin, 0);
      return { date, dayLabel, key, minutes, activities };
    });
    const maxMinutes = Math.max(1, ...days.map((day) => day.minutes));
    return days.map((day) => ({
      ...day,
      hasActivity: day.minutes > 0,
      height: day.minutes > 0 ? Math.max(8, (day.minutes / maxMinutes) * 100) : 0,
    }));
  }, [state.activityLog]);

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

  const onActionScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const idx = Math.round(offsetX / screenWidth);
    setActionIndex(Math.max(0, Math.min(idx, ACTION_MODES.length - 1)));
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
      const fakeAvail: Availability = {
        start: new Date().toISOString(),
        end: new Date(Date.now() + manualDuration * 60000).toISOString(),
        durationMin: manualDuration,
        nextEventTitle: null,
      };
      prefetchGeminiSuggestions(state.location, state.prefs, fakeAvail, null).catch(() => undefined);
      actionsRef.current.preloadDeck(fakeAvail);
    }
  }, [manualDuration, state.permissions.calendarGranted]);

  const refreshContext = useCallback(async () => {
    if (!state.permissions.calendarGranted && !state.permissions.locationGranted) return;
    setLoading(true);
    try {
      let latestAvailability = state.availability;
      let latestLocation = state.location;
      let latestWeather: Awaited<ReturnType<typeof fetchWeather>> | null = null;
      if (state.permissions.calendarGranted) {
        const availability = await getAvailability(state.enabledCalendars);
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
        // Use at least 15 min so preload builds a viable deck even when "busy"
        const preloadAvail = latestAvailability.durationMin < 15
          ? { ...latestAvailability, durationMin: 15 }
          : latestAvailability;
        prefetchGeminiSuggestions(latestLocation, state.prefs, preloadAvail, latestWeather).catch(() => undefined);
        actionsRef.current.preloadDeck(preloadAvail);
      }
    } catch (error) {
      console.warn('Refresh error', error);
    } finally {
      setLoading(false);
    }
  }, [state.permissions, state.enabledCalendars]);

  useFocusEffect(
    useCallback(() => {
      if (isInitialMount.current) {
        isInitialMount.current = false;
      } else {
        setBannerKey((k) => k + 1);
      }
      navigatingRef.current = false;          // reset guard on focus
      refreshContext();
    }, [refreshContext]),
  );

  useEffect(() => {
    if (state.availability?.durationMin && state.availability.durationMin < 20) {
      Alert.alert('Tight window', 'Your next event starts soon. You can still pick a quick action.');
    }
  }, [state.availability?.durationMin]);

  const isBusyNow = !!(state.permissions.calendarGranted && state.availability && state.availability.durationMin === 0);
  const currentEventTitle = state.availability?.nextEventTitle || 'Current event';
  const availabilityLabel = state.availability
    ? isBusyNow
      ? 'You are busy right now'
      : state.availability.durationMin >= 240
        ? 'You are free for the next few hours'
        : `You are free for ${formatDuration(state.availability.durationMin)}`
    : 'Pick something you can do right now';

  const beforeLabel = state.availability?.nextEventTitle
    ? `before ${state.availability.nextEventTitle}`
    : '';

  const areaLabel = state.location.areaLabel ?? null;
  const locationStatusLabel = areaLabel
    ?? (state.permissions.locationGranted ? 'Finding location...' : 'Location off');

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = state.activityLog.filter((entry) => new Date(entry.timestamp) >= weekAgo);
    const minutes = recent.reduce((sum, entry) => sum + entry.durationMin, 0);
    const habitTotal = state.habits.length;
    const habitDone = state.habits.filter((habit) => !isHabitDue(habit, now)).length;
    const habitPercent = habitTotal ? Math.round((habitDone / habitTotal) * 100) : null;
    return {
      activityCount: recent.length,
      minutes,
      habitTotal,
      habitDone,
      habitPercent,
      totalDone: state.activityLog.length,
    };
  }, [state.activityLog, state.habits]);

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

  const startDeck = (filter?: string, planDate?: 'today' | 'tomorrow') => {
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
    logEvent(planDate === 'tomorrow' ? 'tap_plan_tomorrow' : 'tap_do_something_now', { filter: filter ?? 'all', planDate: planDate ?? 'today' });
  };

  const onDoSomethingNow = () => {
    const currentMode = ACTION_MODES[actionIndex];
    if (isBusyNow) {
      Alert.alert(
        'You are busy right now',
        `Current plan: ${currentEventTitle}. Start something else anyway?`,
        [
          { text: 'Keep plan', style: 'cancel' },
          { text: 'Proceed', onPress: () => startDeck(currentMode.filter, currentMode.planDate) },
        ],
      );
      return;
    }
    startDeck(currentMode.filter, currentMode.planDate);
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={styles.container}>
      <View style={[styles.pinnedHeader, { paddingTop: insets.top + theme.spacing.sm }]}> 
        <View style={styles.topBar}>
          <View style={styles.logoContainer}>
            <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.lastUpdated}>Last updated: {lastUpdatedLabel}</Text>
            <View style={styles.locationRow}>
              <Text style={styles.pinIcon}>{'\u{1F4CD}'}</Text>
              <Text style={styles.locationLabel} numberOfLines={1}>{locationStatusLabel}</Text>
            </View>
          </View>
          <View style={styles.headerRightColumn}>
            <ChargeBar
              current={state.swipeBank?.current ?? 0}
              max={state.swipeBank?.max ?? 20}
              onPress={() => navigation.navigate('Bank')}
              style={styles.homeBankCounter}
            />
            <View style={styles.headerRight}>
              <Pressable onPress={() => navigation.navigate('Profile')}>
                <Text style={styles.settings}>Profile</Text>
              </Pressable>
              <Pressable onPress={() => navigation.navigate('Settings')}>
                <Text style={styles.settings}>Settings</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
      <ScrollView
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
                <SkyBanner weather={weatherCondition} />
              </View>
              <ActivityBanner weather={weatherCondition} restartKey={bannerKey} />
            </View>
            {badgeProgress.length > 0 && (
              <View style={[styles.bannerPage, styles.badgeBannerPage, { width: screenWidth }]}>
                {badgeProgress.slice(0, 3).map((badge) => (
                  <Pressable key={badge.id} style={styles.bannerBadgeItem} onPress={() => navigation.navigate('BadgeDetail', { badgeId: badge.id })}>
                    <Text style={styles.badgeLevelLabel}>Level {badge.level}</Text>
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
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onActionScroll}
            snapToInterval={screenWidth}
            decelerationRate="fast"
            style={styles.actionScroll}
            contentContainerStyle={styles.actionScrollContent}
          >
            {ACTION_MODES.map((item) => (
              <View key={item.key} style={{ width: screenWidth, paddingHorizontal: 16 }}>
                <PrimaryButton
                  label={loading ? 'Working...' : item.label}
                  glow={!isBusyNow}
                  variant={isBusyNow && item.key !== 'tomorrow' ? 'muted' : 'default'}
                  bgColor={isBusyNow && item.key !== 'tomorrow' ? undefined : item.bg}
                  textColor={isBusyNow && item.key !== 'tomorrow' ? undefined : item.text}
                  onPress={onDoSomethingNow}
                />
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
          {isBusyNow && (
            <Pressable
              style={({ pressed }) => [styles.busyCard, pressed && { opacity: 0.85 }]}
              onPress={() => {
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
              <Text style={styles.busyLabel}>Happening now</Text>
              <Text style={styles.busyTitle}>{currentEventTitle}</Text>
              <Text style={styles.busyHint}>Tap to open in calendar</Text>
            </Pressable>
          )}
          <View style={styles.deckMetaRow}>
            <Text style={styles.subtext}>
              {state.permissions.calendarGranted
                ? beforeLabel ? `${availabilityLabel} ${beforeLabel}` : availabilityLabel
                : availabilityLabel}
            </Text>
          </View>
          {/* ������ Scheduled activities ������ */}
          {state.scheduledActivities.filter((s) => new Date(s.startAt) > new Date()).length > 0 && (
            <View style={styles.scheduledSection}>
              <Text style={styles.scheduledSectionTitle}>Scheduled</Text>
              {state.scheduledActivities
                .filter((s) => new Date(s.startAt) > new Date())
                .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
                .slice(0, 5)
                .map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setSchedulePrompt(item)}
                    style={({ pressed }) => [
                      styles.scheduledCard,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <View style={styles.scheduledCardRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scheduledTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.scheduledMeta}>
                          {new Date(item.startAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} -� {formatTime(new Date(item.startAt))} -� {item.durationMin} min
                        </Text>
                      </View>
                      <Text style={styles.scheduledArrow}>�Ǧ</Text>
                    </View>
                  </Pressable>
                ))}
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
          {stats.totalDone < 3 ? (
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
                </View>
                <View style={styles.dashboardGraph}>
                  {weekGraph.map((day) => (
                    <Pressable
                      key={day.key}
                      onPress={() => setSelectedDayKey(day.key)}
                      style={({ pressed }) => [
                        styles.dashboardGraphCol,
                        day.key === selectedDayKey && styles.dashboardGraphColActive,
                        pressed && styles.dashboardGraphColPressed,
                      ]}
                    >
                      <View style={styles.dashboardGraphTrack}>
                        {day.hasActivity ? (
                          <View style={[styles.dashboardGraphFill, { height: `${day.height}%` }]} />
                        ) : (
                          <Text style={styles.dashboardGraphEmptyMark}>×</Text>
                        )}
                      </View>
                      <Text style={styles.dashboardGraphLabel}>{day.dayLabel}</Text>
                      {day.minutes > 0 && <Text style={styles.dashboardGraphValue}>{day.minutes}m</Text>}
                    </Pressable>
                  ))}
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
                    <Text style={styles.dayDetailsMeta}>{selectedDay && selectedDay.minutes > 0 ? `${selectedDay.minutes} min` : 'No activity'}</Text>
                  </View>
                  {selectedDayActivities.length > 0 ? (
                    <View style={styles.dayActivityList}>
                      {selectedDayActivities.map((entry) => (
                        <View key={entry.id} style={styles.dayActivityRow}>
                          <View style={[styles.dayActivityTypePill, entry.isHabit ? styles.dayActivityHabitPill : styles.dayActivityOneOffPill]}>
                            <Text style={[styles.dayActivityTypeText, entry.isHabit ? styles.dayActivityHabitText : styles.dayActivityOneOffText]}>
                              {entry.isHabit ? 'Habit' : 'One-time'}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.dayActivityTitle}>{entry.title}</Text>
                            <Text style={styles.dayActivityMeta}>{formatTime(new Date(entry.timestamp))} · {entry.durationMin}m</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.dayDetailsEmpty}>No activities for this day yet.</Text>
                  )}
                </View>
              </View>
              {badgeProgress.length > 0 && (
                <View style={styles.badgeCard}>
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
            style={({ pressed }) => [styles.habitsButton, styles.smartCalendarButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('SmartCalendar')}
          >
            <Text style={styles.libraryButtonIcon}>{'\u{1F4C5}'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.libraryButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('Library')}
          >
            <Text style={styles.libraryButtonIcon}>{'\u{1F4DA}'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.habitsButton, styles.addIdeaButton, pressed && styles.habitsButtonPressed]}
            onPress={() => navigation.navigate('CommunityIdeaForm')}
          >
            <Text style={styles.addIdeaButtonIcon}>+</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {/* ������ Scheduled activity prompt ������ */}
      <Modal visible={!!schedulePrompt} transparent animationType="fade" onRequestClose={() => setSchedulePrompt(null)}>
        <Pressable style={styles.scheduleModalOverlay} onPress={() => setSchedulePrompt(null)}>
          <Pressable style={styles.scheduleModalCard} onPress={() => {}}>
            <Text style={styles.scheduleModalTitle}>{schedulePrompt?.title}</Text>
            <Text style={styles.scheduleModalMeta}>
              Scheduled at {schedulePrompt ? formatTime(new Date(schedulePrompt.startAt)) : ''} -� {schedulePrompt?.durationMin} min
            </Text>
            <Text style={[styles.scheduleModalMeta, { marginTop: -4 }]}>Do you want to start this activity now?</Text>
            <View style={styles.scheduleModalActions}>
              <Pressable
                style={[styles.scheduleModalBtn, { backgroundColor: theme.colors.backgroundAlt }]}
                onPress={() => {
                  if (schedulePrompt) {
                    actions.removeScheduledActivity(schedulePrompt.id);
                  }
                  setSchedulePrompt(null);
                }}
              >
                <Text style={[styles.scheduleModalBtnText, { color: theme.colors.textMuted }]}>Dismiss</Text>
              </Pressable>
              <Pressable
                style={[styles.scheduleModalBtn, { backgroundColor: theme.colors.accent }]}
                onPress={() => {
                  if (schedulePrompt) {
                    actions.removeScheduledActivity(schedulePrompt.id);
                    navigation.navigate('Plan', {
                      commitment: schedulePrompt.commitment,
                      suggestion: schedulePrompt.suggestion,
                    });
                  }
                  setSchedulePrompt(null);
                }}
              >
                <Text style={[styles.scheduleModalBtnText, { color: theme.colors.accentText }]}>Start now</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  pinnedHeader: {
    paddingHorizontal: theme.spacing.xl,
  },
  scroll: {
    paddingHorizontal: theme.spacing.xl,
    flexGrow: 1,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    alignSelf: 'flex-start',
  },
  logoContainer: {
    alignItems: 'flex-start',
    gap: 2,
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
  },
  homeBankCounter: {
    alignSelf: 'flex-end',
  },
  lastUpdated: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
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
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xxl,
  },
  skyWrapper: {
    zIndex: 2,
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
    padding: theme.spacing.md,
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
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.isDark ? theme.colors.card : '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  dashboardGraph: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
  },
  dashboardGraphCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  dashboardGraphColActive: {
    backgroundColor: theme.colors.backgroundAlt,
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
  dashboardGraphFill: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  dashboardGraphLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.textMuted,
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dayActivityTypePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  dayActivityHabitPill: {
    backgroundColor: theme.colors.background,
  },
  dayActivityOneOffPill: {
    backgroundColor: theme.colors.background,
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
  dayActivityTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  dayActivityMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
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
  scheduledSectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  scheduledCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  scheduledCardRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
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
  scheduledArrow: {
    fontSize: 22,
    color: theme.colors.textMuted,
    marginLeft: theme.spacing.sm,
  },
  scheduleModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: theme.spacing.lg,
  },
  scheduleModalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    width: '100%' as unknown as number,
    maxWidth: 340,
    gap: theme.spacing.md,
  },
  scheduleModalTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 18,
    color: theme.colors.text,
    textAlign: 'center' as const,
  },
  scheduleModalMeta: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: 'center' as const,
  },
  scheduleModalActions: {
    flexDirection: 'row' as const,
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  scheduleModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
  },
  scheduleModalBtnText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
  },
});
