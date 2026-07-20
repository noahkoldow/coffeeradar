import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { EmojiConfetti } from '../components/EmojiConfetti';
import { PrimaryButton } from '../components/PrimaryButton';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { Habit } from '../types';
import { formatDuration } from '../utils/time';
import { buildBadgeProgress, BadgeProgress } from '../utils/badges';
import { streakEmoji } from '../utils/habits';
import { logEvent } from '../services/analytics';

type Props = StackScreenProps<RootStackParamList, 'Completion'>;

const CELEBRATION_TITLES = [
  'You did it! 🎉',
  'Crushed it! 💪',
  'Amazing work! ⭐',
  'Well done! 🙌',
  'That was great! ✨',
  'Nicely done! 🔥',
  'Way to go! 🚀',
];

const MOTIVATIONAL_LINES = [
  'Small actions build big momentum.',
  'Every session counts — you showed up.',
  'You chose action over scrolling. That matters.',
  'One more thing checked off. Keep going.',
  'Progress is progress, no matter how small.',
  'Your future self just high-fived you.',
  'Consistency beats intensity. You are on track.',
  'You just proved you can make time for what matters.',
];

const pickRandom = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export const CompletionScreen: React.FC<Props> = ({ navigation, route }) => {
  const { title, durationMin, emojis, tags, suggestionType, suggestionId, habitId, description, movementKm } = route.params;
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppState();
  const sessionActivityIntent = state.sessionActivityIntent?.trim() ?? '';

  const [showConfetti, setShowConfetti] = useState(false);
  const [celebrationTitle] = useState(() => pickRandom(CELEBRATION_TITLES));
  const [motivationalLine] = useState(() => pickRandom(MOTIVATIONAL_LINES));
  const [addedAsHabit, setAddedAsHabit] = useState(false);
  const [rememberedSessionIntent, setRememberedSessionIntent] = useState(false);

  // Find habit data for streak display
  const habit = useMemo(() => {
    if (!habitId) return null;
    return state.habits.find((h) => h.id === habitId) ?? null;
  }, [habitId, state.habits]);

  // Animations
  const titleScale = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const buttonSlide = useRef(new Animated.Value(40)).current;
  const checkScale = useRef(new Animated.Value(0)).current;
  const checkRotate = useRef(new Animated.Value(0)).current;

  // Detect badge level-ups by comparing before/after
  const badgeLevelUp = useMemo((): BadgeProgress | null => {
    if (!tags?.length) return null;
    const progress = buildBadgeProgress(state.activityLog, state.habits);
    // Find a badge whose current activity pushed total minutes across a level threshold.
    for (const badge of progress) {
      if (!badge.tags.some((t) => tags.includes(t))) continue;
      const previousMinutes = Math.max(0, badge.count - durationMin);
      if (badge.level > 0 && previousMinutes < badge.currentTarget && badge.count >= badge.currentTarget) {
        return badge;
      }
    }
    return null;
  }, [durationMin, state.activityLog, state.habits, tags]);

  const weekStats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = state.activityLog.filter((e) => new Date(e.timestamp) >= weekAgo);
    return {
      count: recent.length,
      minutes: recent.reduce((sum, e) => sum + e.durationMin, 0),
    };
  }, [state.activityLog]);

  useEffect(() => {
    logEvent('completion_screen_shown', { title, durationMin, type: suggestionType });

    // Haptic burst
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Staggered entrance animation
    const seq = Animated.sequence([
      // Big checkmark pop
      Animated.parallel([
        Animated.spring(checkScale, {
          toValue: 1,
          tension: 80,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(checkRotate, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: true,
        }),
      ]),
      // Title scale
      Animated.spring(titleScale, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
      // Content fade in
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(buttonSlide, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]);

    // Show confetti slightly after entrance
    const confettiTimer = setTimeout(() => setShowConfetti(true), 300);

    seq.start();

    return () => clearTimeout(confettiTimer);
  }, []);

  // Award swipe bonus for completing the activity
  useEffect(() => {
    if (!actions || !durationMin) return;
    const bonus = Math.floor(durationMin * (1 / 30)); // 1 swipe per 30 minutes
    if (bonus > 0) {
      actions.addSwipes(bonus);
      logEvent('swipe_bonus_awarded', { title, durationMin, bonus });
    }
    logEvent('suggestion_reward', {
      suggestion_id: suggestionId ?? null,
      type: suggestionType,
      reward: 'complete',
      durationMin,
    });
  }, [actions, durationMin, title]);

  const goHome = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

  const queueNextActivity = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logEvent('next_activity_queued_from_completion', {});
    navigation.navigate('Deck', {});
  }, [navigation]);

  const handleAddAsHabit = useCallback(() => {
    if (addedAsHabit) return;
    const newHabit: Habit = {
      id: `habit_${Date.now()}`,
      name: title,
      type: suggestionType === 'AT_HOME' ? 'AT_HOME' : 'GO_OUT',
      lengthMin: durationMin,
      description: description ?? '',
      frequency: 'daily',
      timeOfDay: 'any',
      tags: tags ?? [],
      createdAt: new Date().toISOString(),
      lastCompletedAt: new Date().toISOString(),
      currentStreak: 1,
      longestStreak: 1,
      completionHistory: [new Date().toISOString().slice(0, 10)],
    };
    actions.addHabit(newHabit);
    setAddedAsHabit(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logEvent('habit_added_from_completion', { title });
  }, [addedAsHabit, title, suggestionType, durationMin, description, tags, actions]);

  const handleRememberSessionIntent = useCallback(() => {
    if (!sessionActivityIntent || rememberedSessionIntent) return;
    const existingDescription = state.prefs.selfDescription?.trim() ?? '';
    const sessionLine = `Session goal: ${sessionActivityIntent}`;
    const nextDescription = existingDescription
      ? `${existingDescription}\n${sessionLine}`
      : sessionLine;
    actions.setPrefs({ ...state.prefs, selfDescription: nextDescription });
    actions.setSessionActivityIntent('');
    setRememberedSessionIntent(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    logEvent('session_intent_promoted_to_profile', { title, intent: sessionActivityIntent });
  }, [actions, rememberedSessionIntent, sessionActivityIntent, state.prefs, title]);

  const confettiEmojis = emojis?.length ? emojis : ['✨', '🎉', '⭐', '🔥'];

  const typeLabel = suggestionType === 'AT_HOME' ? 'routine' : suggestionType === 'EVENT' ? 'event' : 'outing';

  const checkRotateInterp = checkRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['-30deg', '0deg'],
  });

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.lg }]}
    >
      {/* Big animated checkmark */}
      <View style={styles.heroSection}>
        <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }, { rotate: checkRotateInterp }] }]}>
          <Text style={styles.checkEmoji}>✅</Text>
        </Animated.View>

        <Animated.View style={{ transform: [{ scale: titleScale }] }}>
          <Text style={styles.celebrationTitle}>{celebrationTitle}</Text>
        </Animated.View>

        <Animated.View style={{ opacity: contentOpacity }}>
          <Text style={styles.activityTitle}>{title}</Text>
          <Text style={styles.durationLabel}>{formatDuration(durationMin)} {typeLabel} completed</Text>
        </Animated.View>
      </View>

      {/* Stats and badge section */}
      <Animated.View style={[styles.statsSection, { opacity: contentOpacity }]}>
        <Text style={styles.motivational}>{motivationalLine}</Text>

        {/* This week summary */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{weekStats.count}</Text>
            <Text style={styles.statLabel}>this week</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{formatDuration(weekStats.minutes)}</Text>
            <Text style={styles.statLabel}>total time</Text>
          </View>
          {typeof movementKm === 'number' && movementKm > 0 && (
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{movementKm.toFixed(1)} km</Text>
              <Text style={styles.statLabel}>movement</Text>
            </View>
          )}
        </View>

        {/* Badge level-up callout */}
        {badgeLevelUp && (
          <Pressable
            style={[styles.badgeCallout, { borderColor: badgeLevelUp.color }]}
            onPress={() => navigation.navigate('BadgeDetail', { badgeId: badgeLevelUp.id })}
          >
            <Text style={styles.badgeIcon}>🏅</Text>
            <View style={styles.badgeTextWrap}>
              <Text style={[styles.badgeTitle, { color: badgeLevelUp.color }]}>
                {badgeLevelUp.title} — Level {badgeLevelUp.level}!
              </Text>
              <Text style={styles.badgeSubtitle}>Tap to see your badge progress</Text>
            </View>
          </Pressable>
        )}
      </Animated.View>

      {/* Streak callout for habits */}
      {habit && (habit.currentStreak ?? 0) > 0 && (
        <Animated.View style={[styles.streakCallout, { opacity: contentOpacity }]}>
          <Text style={styles.streakBigEmoji}>{streakEmoji(habit.currentStreak)}</Text>
          <Text style={styles.streakBigNum}>{habit.currentStreak}-day streak!</Text>
          {(habit.longestStreak ?? 0) > (habit.currentStreak ?? 0) && (
            <Text style={styles.streakBest}>Best: {habit.longestStreak}</Text>
          )}
        </Animated.View>
      )}

      {sessionActivityIntent && !rememberedSessionIntent && (
        <Animated.View style={[styles.intentCallout, { opacity: contentOpacity }]}>
          <Text style={styles.intentTitle}>Want to remember this for later?</Text>
          <Text style={styles.intentSubtitle}>
            We can save “{sessionActivityIntent}” into your daily-life profile so future suggestions can lean this way too.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.intentButton, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}
            onPress={handleRememberSessionIntent}
          >
            <Text style={styles.intentButtonText}>Save to profile</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Add as habit CTA (only if not already a habit) */}
      {!habitId && !addedAsHabit && (
        <Animated.View style={[styles.habitCta, { opacity: contentOpacity }]}>
          <Text style={styles.habitCtaTitle}>Make this a habit? 🌱</Text>
          <Text style={styles.habitCtaSubtitle}>Add "{title}" to your daily deck and build a streak.</Text>
          <Pressable
            style={({ pressed }) => [styles.habitCtaBtn, pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }]}
            onPress={handleAddAsHabit}
          >
            <Text style={styles.habitCtaBtnText}>+ Add as habit</Text>
          </Pressable>
        </Animated.View>
      )}
      {addedAsHabit && (
        <Animated.View style={[styles.habitCtaAdded, { opacity: contentOpacity }]}>
          <Text style={styles.habitCtaAddedText}>✅ Added to your habits!</Text>
        </Animated.View>
      )}

      {/* Back to home + Next activity */}
      <Animated.View style={[styles.bottomSection, { opacity: contentOpacity, transform: [{ translateY: buttonSlide }] }]}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}
          onPress={goHome}
        >
          <Text style={styles.backButtonText}>← Home</Text>
        </Pressable>
        <PrimaryButton label="Next activity" onPress={queueNextActivity} glow style={styles.nextButtonWrap} />
      </Animated.View>

      <EmojiConfetti visible={showConfetti} emojis={confettiEmojis} />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    justifyContent: 'space-between',
  },
  heroSection: {
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  checkEmoji: {
    fontSize: 40,
  },
  celebrationTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 32,
    color: theme.colors.text,
    textAlign: 'center',
  },
  activityTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  durationLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  statsSection: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  motivational: {
    fontFamily: theme.fonts.body,
    fontSize: 15,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: theme.spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statNumber: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    color: theme.colors.accent,
  },
  statLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  badgeCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    borderWidth: 2,
    gap: theme.spacing.sm,
  },
  badgeIcon: {
    fontSize: 28,
  },
  badgeTextWrap: {
    flex: 1,
  },
  badgeTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
  },
  badgeSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  bottomSection: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  backButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.text,
  },
  nextButtonWrap: {
    width: '100%',
  },
  hint: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  /* ── Streak callout ─── */
  streakCallout: {
    alignItems: 'center',
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: 4,
    marginBottom: theme.spacing.md,
  },
  streakBigEmoji: { fontSize: 32 },
  streakBigNum: { fontFamily: theme.fonts.heading, fontSize: 20, color: theme.colors.accentDark },
  streakBest: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },
  intentCallout: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.accentSoft,
    marginBottom: theme.spacing.md,
  },
  intentTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'center',
  },
  intentSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  intentButton: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  },
  intentButtonText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.accentText,
  },
  /* ── Add-as-habit CTA ─── */
  habitCta: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  habitCtaTitle: { fontFamily: theme.fonts.semibold, fontSize: 16, color: theme.colors.text },
  habitCtaSubtitle: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.textMuted, textAlign: 'center' },
  habitCtaBtn: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  },
  habitCtaBtnText: { fontFamily: theme.fonts.semibold, fontSize: 14, color: '#fff' },
  habitCtaAdded: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  habitCtaAddedText: { fontFamily: theme.fonts.semibold, color: theme.colors.accent },
});
