import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Image, InteractionManager, Linking, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
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

  // ── Banner auto-swipe ──
  const bannerScrollRef = useRef<ScrollView>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerPageRef = useRef(0); // track page without re-renders
  const hasBadges = useRef(false); // updated from badgeProgress later

  const scheduleBannerSwipe = useCallback(() => {
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    const delay = 60_000 + Math.random() * 60_000; // 1–2 min
    bannerTimerRef.current = setTimeout(() => {
      if (!hasBadges.current) return; // only one page, nothing to swipe
      const nextPage = bannerPageRef.current === 0 ? 1 : 0;
      bannerScrollRef.current?.scrollTo({ x: nextPage * screenWidth, animated: true });
      bannerPageRef.current = nextPage;
      setBannerPageIndex(nextPage);
      scheduleBannerSwipe(); // schedule the next one
    }, delay);
  }, [screenWidth]);

  // ── Dashboard popup state ──
  const [popupVisible, setPopupVisible] = useState(false);
  const popupAnim = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // ── Badge popup state ──
  const [badgePopupVisible, setBadgePopupVisible] = useState(false);
  const badgePopupAnim = useRef(new Animated.Value(0)).current;
  const badgeBackdropAnim = useRef(new Animated.Value(0)).current;

  const openPopup = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPopupVisible(true);
    Animated.parallel([
      Animated.spring(popupAnim, { toValue: 1, tension: 65, friction: 10, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [popupAnim, backdropAnim]);

  const closePopup = useCallback(() => {
    Animated.parallel([
      Animated.spring(popupAnim, { toValue: 0, tension: 65, friction: 10, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setPopupVisible(false));
  }, [popupAnim, backdropAnim]);

  const openBadgePopup = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBadgePopupVisible(true);
    Animated.parallel([
      Animated.spring(badgePopupAnim, { toValue: 1, tension: 65, friction: 10, useNativeDriver: true }),
      Animated.timing(badgeBackdropAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [badgePopupAnim, badgeBackdropAnim]);

  const closeBadgePopup = useCallback(() => {
    Animated.parallel([
      Animated.spring(badgePopupAnim, { toValue: 0, tension: 65, friction: 10, useNativeDriver: true }),
      Animated.timing(badgeBackdropAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setBadgePopupVisible(false));
  }, [badgePopupAnim, badgeBackdropAnim]);

  // ── Scheduled activity popup ──
  const [schedulePrompt, setSchedulePrompt] = useState<ScheduledActivity | null>(null);

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
    { key: 'all', label: 'DO SOMETHING NOW', filter: undefined as string | undefined, bg: theme.colors.accent, text: '#FFFFFF' },
    { key: 'productive', label: 'BE PRODUCTIVE', filter: 'productive', bg: '#A8D8EA', text: '#1A3A4A' },
    { key: 'go_out', label: 'GO OUT NOW', filter: 'go_out', bg: '#B5EAD7', text: '#1A4A3A' },
    { key: 'at_home', label: 'DO SOME @ HOME', filter: 'at_home', bg: '#E2B6CF', text: '#3A1A2E' },
  ], [theme.colors.accent]);

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
    hexToRgba(theme.colors.background, 0.137),
    hexToRgba(theme.colors.background, 0.263),
    hexToRgba(theme.colors.background, 0.485),
    hexToRgba(theme.colors.background, 0.678),
    hexToRgba(theme.colors.background, 0.848),
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
      actionsRef.current.preloadDeck(fakeAvail);
    }
  }, [manualDuration, state.permissions.calendarGranted]);

  const refreshContext = useCallback(async () => {
    if (!state.permissions.calendarGranted && !state.permissions.locationGranted) return;
    setLoading(true);
    try {
      let latestAvailability = state.availability;
      let latestLocation = state.location;
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
          const w = await fetchWeather(latestLocation.lat, latestLocation.lng);
          setWeatherCondition(w.condition);
          saveWeatherCondition(w.condition);
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
        emojis: ['✨', '🎉', '⭐', '🔥'],
        tags: habit.tags ?? [],
        suggestionType: habit.type,
        habitId: habit.id,
        description: habit.description,
      });
      navigatingRef.current = false;
    });
  }, [actions, navigation]);

  const startDeck = (filter?: string) => {
    const params = {
      durationOverride: state.permissions.calendarGranted ? null : manualDuration,
      filter: filter ?? undefined,
    };
    if (Platform.OS === 'web') {
      navigation.dispatch(StackActions.push('Deck', params));
      setTimeout(() => {
        navigation.dispatch(StackActions.replace('Deck', params));
      }, 0);
    } else {
      navigation.navigate('Deck', params);
    }
    logEvent('tap_do_something_now', { filter: filter ?? 'all' });
  };

  const onDoSomethingNow = () => {
    const currentFilter = ACTION_MODES[actionIndex]?.filter;
    if (isBusyNow) {
      Alert.alert(
        'You are busy right now',
        `Current plan: ${currentEventTitle}. Start something else anyway?`,
        [
          { text: 'Keep plan', style: 'cancel' },
          { text: 'Proceed', onPress: () => startDeck(currentFilter) },
        ],
      );
      return;
    }
    startDeck(currentFilter);
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + 120 },
        ]}
      >
        <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
        <View style={styles.header}>
          {areaLabel ? (
            <View style={styles.locationRow}>
              <Text style={styles.pinIcon}>📍</Text>
              <Text style={styles.locationLabel} numberOfLines={1}>{areaLabel}</Text>
            </View>
          ) : (
            <View style={styles.locationRow} />
          )}
          <View style={styles.headerRight}>
            <Pressable onPress={() => navigation.navigate('Profile')}>
              <Text style={styles.settings}>Profile</Text>
            </Pressable>
            <Pressable onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.settings}>Settings</Text>
            </Pressable>
          </View>
        </View>
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
                  variant={isBusyNow ? 'muted' : 'default'}
                  bgColor={isBusyNow ? undefined : item.bg}
                  textColor={isBusyNow ? undefined : item.text}
                  onPress={onDoSomethingNow}
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.dotRow}>
            {ACTION_MODES.map((mode, i) => (
              <Pressable
                key={mode.key}
                onPress={() => setActionIndex(i)}
                hitSlop={8}
              >
                <View
                  style={[
                    styles.dot,
                    i === actionIndex && [styles.dotActive, { backgroundColor: mode.bg }],
                  ]}
                />
              </Pressable>
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
          <Text style={styles.subtext}>
            {state.permissions.calendarGranted
              ? beforeLabel ? `${availabilityLabel} ${beforeLabel}` : availabilityLabel
              : availabilityLabel}
          </Text>
          {/* ── Scheduled activities ── */}
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
                          {formatTime(new Date(item.startAt))} · {item.durationMin} min
                        </Text>
                      </View>
                      <Text style={styles.scheduledArrow}>›</Text>
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
          <Pressable onPress={openPopup} style={({ pressed }) => pressed ? { opacity: 0.92 } : undefined}>
          <View style={styles.dashboard}>
            <View style={styles.dashboardTitleRow}>
              <Text style={styles.dashboardTitle}>Your activity</Text>
              <Text style={styles.expandHint}>Tap to expand ↗</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.activityCount}</Text>
                <Text style={styles.statLabel}>Activities done</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.minutes}</Text>
                <Text style={styles.statLabel}>Minutes this week</Text>
              </View>
              {stats.habitTotal > 0 && (
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats.habitPercent ?? 0}%</Text>
                  <Text style={styles.statLabel}>Habits done</Text>
                </View>
              )}
            </View>

            <View style={styles.habitHeader}>
              <Text style={styles.sectionTitle}>Habits</Text>
              <Pressable onPress={() => navigation.navigate('Habits')}>
                <Text style={styles.addLink}>View all</Text>
              </Pressable>
            </View>
            {state.habits.length === 0 && (
              <Text style={styles.emptyText}>No habits yet. Add one to keep it in your deck.</Text>
            )}
            {state.habits.slice(0, 3).map((habit) => {
              const due = isHabitDue(habit);
              const dots = weeklyDots(habit);
              const streak = habit.currentStreak ?? 0;
              const urgency = getHabitUrgency(habit);
              return (
                <View key={habit.id} style={styles.habitCard}>
                  <Pressable onPress={() => navigation.navigate('Habits', { flippedHabitId: habit.id })}>
                    <View style={styles.habitCardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {(urgency === 'approaching' || urgency === 'overdue') && (
                            <Text style={{ fontSize: 13 }}>⏳</Text>
                          )}
                          <Text style={styles.habitName}>{habit.name}</Text>
                        </View>
                        <Text style={styles.habitMeta}>
                          {formatHabitFrequency(habit.frequency)} · {formatHabitTimeOfDay(habit.timeOfDay)} · {habit.lengthMin}m
                        </Text>
                      </View>
                      {streak > 0 && (
                        <View style={styles.streakBadge}>
                          <Text style={styles.streakText}>{streakEmoji(streak)} {streak}</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                  <View style={styles.habitDotsRow}>
                    {dots.map((done, i) => (
                      <View key={`d${i}`} style={[styles.habitDot, done ? styles.habitDotDone : styles.habitDotEmpty]} />
                    ))}
                    {due ? (
                      <Pressable
                        style={({ pressed }) => [styles.markDoneBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => markHabitDone(habit)}
                      >
                        <Text style={styles.markDoneText}>✓ Done</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={({ pressed }) => [styles.undoBtn, pressed && { opacity: 0.7 }]}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); actions.uncompleteHabit(habit.id); actions.removeLatestActivityForHabit(habit.id); }}
                      >
                        <Text style={styles.undoText}>↩ Undo</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}

            {suggestedHabits.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Suggested habits</Text>
                {suggestedHabits.map((habit) => (
                  <View key={habit.name} style={styles.habitRow}>
                    <View>
                      <Text style={styles.habitName}>{habit.name}</Text>
                      <Text style={styles.habitMeta}>
                      {formatHabitFrequency(habit.frequency)} - {formatHabitTimeOfDay(habit.timeOfDay)} - {habit.lengthMin}m
                      </Text>
                    </View>
                    <Pressable onPress={() => addSuggestedHabit(habit)}>
                      <Text style={styles.addLink}>Add</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}
          </View>
          </Pressable>
          {badgeProgress.length > 0 && (
            <View style={styles.badgeCard}>
              <Pressable onPress={openBadgePopup}>
                <View style={styles.dashboardTitleRow}>
                  <Text style={styles.dashboardTitle}>Badges</Text>
                  <Text style={styles.expandHint}>Tap to expand ↗</Text>
                </View>
              </Pressable>
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
        <Pressable
          style={({ pressed }) => [styles.habitsButton, pressed && styles.habitsButtonPressed]}
          onPress={() => navigation.navigate('Habits')}
        >
          <Text style={styles.habitsButtonText}>Habits</Text>
        </Pressable>
      </LinearGradient>

      {/* ── Dashboard Popup Modal ── */}
      <Modal visible={popupVisible} transparent animationType="none" onRequestClose={closePopup}>
        <View style={styles.popupOverlay}>
          <Animated.View style={[styles.popupBackdrop, { opacity: backdropAnim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closePopup} />
          </Animated.View>

          <Animated.View style={[
            styles.popupContainer,
            {
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              transform: [
                { translateY: popupAnim.interpolate({ inputRange: [0, 1], outputRange: [screenHeight, 0] }) },
              ],
            },
          ]}>
            <ScrollView style={styles.popupScroll} contentContainerStyle={styles.popupScrollContent} showsVerticalScrollIndicator={false}>
              {/* Header */}
              <View style={styles.popupHeader}>
                <Text style={styles.popupTitle}>📊 Dashboard</Text>
                <Pressable onPress={closePopup} hitSlop={12}>
                  <Text style={styles.popupClose}>✕</Text>
                </Pressable>
              </View>

              {/* Stats overview */}
              <View style={styles.popupSection}>
                <Text style={styles.popupSectionTitle}>This week</Text>
                <View style={styles.popupStatsRow}>
                  <View style={styles.popupStatCard}>
                    <Text style={styles.popupStatValue}>{stats.activityCount}</Text>
                    <Text style={styles.popupStatLabel}>Activities</Text>
                  </View>
                  <View style={styles.popupStatCard}>
                    <Text style={styles.popupStatValue}>{stats.minutes}m</Text>
                    <Text style={styles.popupStatLabel}>Total time</Text>
                  </View>
                  {stats.habitTotal > 0 && (
                    <View style={styles.popupStatCard}>
                      <Text style={styles.popupStatValue}>{stats.habitDone}/{stats.habitTotal}</Text>
                      <Text style={styles.popupStatLabel}>Habits done</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Habits section */}
              {state.habits.length > 0 && (
                <View style={styles.popupSection}>
                  <Pressable onPress={() => { closePopup(); setTimeout(() => navigation.navigate('Habits'), 300); }} style={styles.popupSectionHeader}>
                    <Text style={styles.popupSectionTitle}>Habits</Text>
                    <Text style={styles.popupLink}>View all →</Text>
                  </Pressable>
                  {state.habits.map((habit) => {
                    const due = isHabitDue(habit);
                    const dots = weeklyDots(habit);
                    const streak = habit.currentStreak ?? 0;
                    return (
                      <Pressable
                        key={habit.id}
                        style={({ pressed }) => [styles.popupHabitCard, pressed && { opacity: 0.85 }]}
                        onPress={() => { closePopup(); setTimeout(() => navigation.navigate('Habits'), 300); }}
                      >
                        <View style={styles.popupHabitTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.popupHabitName}>{habit.name}</Text>
                            <Text style={styles.popupHabitMeta}>
                              {formatHabitFrequency(habit.frequency)} · {formatHabitTimeOfDay(habit.timeOfDay)} · {habit.lengthMin}m
                            </Text>
                          </View>
                          {streak > 0 && (
                            <View style={styles.streakBadge}>
                              <Text style={styles.streakText}>{streakEmoji(streak)} {streak}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.popupDotsRow}>
                          {['M','T','W','T','F','S','S'].map((label, i) => (
                            <View key={`pd${i}`} style={styles.popupDotCol}>
                              <View style={[styles.popupDot, dots[i] ? styles.popupDotDone : styles.popupDotEmpty]} />
                              <Text style={styles.popupDotLabel}>{label}</Text>
                            </View>
                          ))}
                          <View style={{ marginLeft: 'auto' }}>
                            {due ? (
                              <Pressable
                                style={({ pressed }) => [styles.markDoneBtn, pressed && { opacity: 0.7 }]}
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  closePopup();
                                  setTimeout(() => markHabitDone(habit), 300);
                                }}
                              >
                                <Text style={styles.markDoneText}>✓ Done</Text>
                              </Pressable>
                            ) : (
                              <Pressable
                                style={({ pressed }) => [styles.undoBtn, pressed && { opacity: 0.7 }]}
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                  actions.uncompleteHabit(habit.id);
                                  actions.removeLatestActivityForHabit(habit.id);
                                }}
                              >
                                <Text style={styles.undoText}>✓ Undo</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Badges section */}
              {badgeProgress.length > 0 && (
                <View style={styles.popupSection}>
                  <Text style={styles.popupSectionTitle}>Badges</Text>
                  <View style={styles.popupBadgeGrid}>
                    {badgeProgress.map((badge) => {
                      const pLabel = badge.nextTarget
                        ? `${badge.count}/${badge.nextTarget}`
                        : `${badge.count} total`;
                      return (
                        <Pressable
                          key={badge.id}
                          style={({ pressed }) => [styles.popupBadgeItem, pressed && { transform: [{ scale: 0.95 }] }]}
                          onPress={() => { closePopup(); setTimeout(() => navigation.navigate('BadgeDetail', { badgeId: badge.id }), 300); }}
                        >
                          <View style={styles.popupBadgeIconStack}>
                            <BadgeRing size={40} strokeWidth={4} progress={badge.progress} level={badge.level} color={badge.color} />
                            <View style={styles.popupBadgeRingOverlay}>
                              <BadgeIcon badgeId={badge.id} size={Math.round(40 * 0.8)} color={badge.color} />
                            </View>
                          </View>
                          <Text style={styles.popupBadgeName}>{badge.title}</Text>
                          <Text style={styles.popupBadgeMeta}>{pLabel}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Recent activities */}
              {recentActivities.length > 0 && (
                <View style={styles.popupSection}>
                  <Text style={styles.popupSectionTitle}>Recent activities</Text>
                  {recentActivities.map((entry) => {
                    const d = new Date(entry.timestamp);
                    const dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                    return (
                      <View key={entry.id} style={styles.popupActivityRow}>
                        <View style={styles.popupActivityDot} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.popupActivityTitle}>{entry.title}</Text>
                          <Text style={styles.popupActivityMeta}>{dayLabel} · {entry.durationMin}m{entry.isHabit ? ' · 🔁 habit' : ''}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Badge Popup Modal ── */}
      <Modal visible={badgePopupVisible} transparent animationType="none" onRequestClose={closeBadgePopup}>
        <View style={styles.popupOverlay}>
          <Animated.View style={[styles.popupBackdrop, { opacity: badgeBackdropAnim }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeBadgePopup} />
          </Animated.View>

          <Animated.View style={[
            styles.popupContainer,
            { maxHeight: screenHeight * 0.85, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 },
            { transform: [{ translateY: badgePopupAnim.interpolate({ inputRange: [0, 1], outputRange: [screenHeight, 0] }) }] },
          ]}>
            <ScrollView style={styles.popupScroll} contentContainerStyle={styles.popupScrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.popupHeader}>
                <Text style={styles.popupTitle}>🏆 All Badges</Text>
                <Pressable onPress={closeBadgePopup} hitSlop={12}>
                  <Text style={styles.popupClose}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.badgePopupGrid}>
                {badgeProgress.map((badge) => {
                  const progressLabel = badge.nextTarget
                    ? `${badge.count}/${badge.nextTarget}`
                    : `${badge.count} total`;
                  return (
                    <Pressable
                      key={badge.id}
                      style={({ pressed }) => [
                        styles.badgePopupCell,
                        pressed && { opacity: 0.85 },
                      ]}
                      onPress={() => { closeBadgePopup(); setTimeout(() => navigation.navigate('BadgeDetail', { badgeId: badge.id }), 300); }}
                    >
                      <BadgeIcon badgeId={badge.id} size={28} color={badge.color} />
                      <BadgeRing size={44} strokeWidth={4} progress={badge.progress} level={badge.level} color={badge.color} showLevel />
                      <Text style={styles.popupBadgeName} numberOfLines={1}>{badge.title}</Text>
                      <Text style={styles.popupBadgeMeta}>{progressLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* ── Scheduled activity prompt ── */}
      <Modal visible={!!schedulePrompt} transparent animationType="fade" onRequestClose={() => setSchedulePrompt(null)}>
        <Pressable style={styles.scheduleModalOverlay} onPress={() => setSchedulePrompt(null)}>
          <Pressable style={styles.scheduleModalCard} onPress={() => {}}>
            <Text style={styles.scheduleModalTitle}>{schedulePrompt?.title}</Text>
            <Text style={styles.scheduleModalMeta}>
              Scheduled at {schedulePrompt ? formatTime(new Date(schedulePrompt.startAt)) : ''} · {schedulePrompt?.durationMin} min
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
  scroll: {
    padding: theme.spacing.xl,
    flexGrow: 1,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    minWidth: 40,
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
    marginTop: theme.spacing.xl,
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
    marginHorizontal: 16,
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
  subtext: {
    marginTop: theme.spacing.md,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 16,
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
    marginTop: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    gap: theme.spacing.md,
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
    color: '#fff',
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

  /* ── Inline badge trio grid ─── */
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
  /* ── Expanded badge popup grid ─── */
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

  /* ── Dashboard title row ─── */
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

  /* ── Popup ─────────────────────────────────── */
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

  /* ── Popup stats ─── */
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
  popupStatCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  popupStatValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 22,
    color: theme.colors.accent,
  },
  popupStatLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },

  /* ── Popup habits ─── */
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

  /* ── Popup badges ─── */
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

  /* ── Popup activities ─── */
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

  /* ── Banner swipe ─── */
  bannerSwipeContainer: {
    zIndex: 2,
  },
  bannerPage: {
    height: 94,
    overflow: 'hidden',
  },
  badgeBannerPage: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
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

  /* ── Badge horizontal scroll ─── */
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
