import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackActions, useFocusEffect } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { Chip } from '../components/Chip';
import { BadgeRing } from '../components/BadgeRing';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { getAvailability } from '../services/calendar';
import { getCurrentLocation } from '../services/location';
import { formatDuration } from '../utils/time';
import { logEvent } from '../services/analytics';
import { upsertUserData } from '../services/user';
import { recommendedHabits } from '../data/habits';
import { Habit } from '../types';
import { formatHabitFrequency, formatHabitTimeOfDay, isHabitDue } from '../utils/habits';
import { buildBadgeProgress } from '../utils/badges';

type Props = StackScreenProps<RootStackParamList, 'Home'>;

const durationOptions = [30, 60, 120, 240];

const formatDurationLabel = (minutes: number): string => {
  if (minutes === 240) return 'Tonight';
  return formatDuration(minutes);
};

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const [loading, setLoading] = useState(false);
  const [manualDuration, setManualDuration] = useState(60);
  const insets = useSafeAreaInsets();

  const refreshContext = useCallback(async () => {
    if (!state.permissions.calendarGranted && !state.permissions.locationGranted) return;
    setLoading(true);
    try {
      let latestAvailability = state.availability;
      let latestLocation = state.location;
      if (state.permissions.calendarGranted) {
        const availability = await getAvailability(state.enabledCalendars);
        actions.setAvailability(availability);
        latestAvailability = availability;
      }
      if (state.permissions.locationGranted) {
        const location = await getCurrentLocation();
        actions.setLocation(location);
        latestLocation = location;
      }
      await upsertUserData({
        availability: latestAvailability ?? null,
        areaLabel: latestLocation.areaLabel ?? null,
      });
    } catch (error) {
      console.warn('Refresh error', error);
    } finally {
      setLoading(false);
    }
  }, [state.permissions, state.enabledCalendars, actions]);

  useFocusEffect(
    useCallback(() => {
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
      : `You are free for ${formatDuration(state.availability.durationMin)}`
    : 'Pick something you can do right now';

  const beforeLabel = state.availability?.nextEventTitle
    ? `before ${state.availability.nextEventTitle}`
    : 'before your next event';

  const areaLabel = state.location.areaLabel ? `near ${state.location.areaLabel}` : null;

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

  const badgeProgress = useMemo(() => buildBadgeProgress(state.activityLog), [state.activityLog]);

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
    };
    actions.addHabit(habit);
  };

  const startDeck = () => {
    const params = {
      durationOverride: state.permissions.calendarGranted ? null : manualDuration,
    };
    if (Platform.OS === 'web') {
      navigation.dispatch(StackActions.push('Deck', params));
      setTimeout(() => {
        navigation.dispatch(StackActions.replace('Deck', params));
      }, 0);
    } else {
      navigation.navigate('Deck', params);
    }
    logEvent('tap_do_something_now');
  };

  const onDoSomethingNow = () => {
    if (isBusyNow) {
      Alert.alert(
        'You are busy right now',
        `Current plan: ${currentEventTitle}. Start something else anyway?`,
        [
          { text: 'Keep plan', style: 'cancel' },
          { text: 'Proceed', onPress: startDeck },
        ],
      );
      return;
    }
    startDeck();
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.xxl },
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.navigate('Profile')}>
            <Text style={styles.settings}>Profile</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.settings}>Settings</Text>
          </Pressable>
        </View>
        <View style={styles.content}>
        <View style={styles.hero}>
          <PrimaryButton
            label={loading ? 'Working...' : 'DO SOMETHING NOW'}
            glow={!isBusyNow}
            variant={isBusyNow ? 'muted' : 'default'}
            onPress={onDoSomethingNow}
          />
          {isBusyNow && (
            <View style={styles.busyCard}>
              <Text style={styles.busyLabel}>Happening now</Text>
              <Text style={styles.busyTitle}>{currentEventTitle}</Text>
              <Text style={styles.busyHint}>Finish this first or proceed anyway.</Text>
            </View>
          )}
          <Text style={styles.subtext}>
            {state.permissions.calendarGranted ? `${availabilityLabel} ${beforeLabel}` : availabilityLabel}
          </Text>
          {areaLabel && (
            <Text style={styles.subtextMuted}>{areaLabel}</Text>
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
            <Text style={styles.dashboardTitle}>Your activity</Text>
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
              return (
                <View key={habit.id} style={styles.habitRow}>
                  <View>
                    <Text style={styles.habitName}>{habit.name}</Text>
                    <Text style={styles.habitMeta}>
                      {formatHabitFrequency(habit.frequency)} - {formatHabitTimeOfDay(habit.timeOfDay)} - {habit.lengthMin}m
                    </Text>
                  </View>
                  <Text style={[styles.habitStatus, due ? styles.habitDue : styles.habitOk]}>
                    {due ? 'Due' : 'Done'}
                  </Text>
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
          {badgeProgress.length > 0 && (
            <View style={styles.badgeCard}>
              <Text style={styles.dashboardTitle}>Badges</Text>
              <View style={styles.badgeGrid}>
                {badgeProgress.map((badge) => {
                  const progressLabel = badge.nextTarget
                    ? `${badge.count}/${badge.nextTarget}`
                    : `${badge.count} total`;
                  return (
                    <Pressable
                      key={badge.id}
                      style={({ pressed }) => [styles.badgeItem, pressed && styles.badgeItemPressed]}
                      onPress={() => navigation.navigate('BadgeDetail', { badgeId: badge.id })}
                    >
                      <BadgeRing
                        size={56}
                        strokeWidth={6}
                        progress={badge.progress}
                        level={badge.level}
                        color={badge.color}
                      />
                      <Text style={styles.badgeTitle}>{badge.title}</Text>
                      <Text style={styles.badgeMeta}>{progressLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          </>
        )}
      </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <Pressable
          style={({ pressed }) => [styles.habitsButton, pressed && styles.habitsButtonPressed]}
          onPress={() => navigation.navigate('Habits')}
        >
          <Text style={styles.habitsButtonText}>Habits</Text>
        </Pressable>
      </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing.md,
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
  },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.md,
  },
  hero: {
    marginTop: theme.spacing.xxl + theme.spacing.xl + theme.spacing.xl,
    gap: theme.spacing.md,
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
  habitName: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  habitMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
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
});
