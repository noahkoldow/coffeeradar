import React, { useMemo, useCallback, useRef, useState } from 'react';
import { Alert, Animated, InteractionManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { recommendedHabits } from '../data/habits';
import { Habit } from '../types';
import {
  formatHabitFrequency,
  formatHabitTimeOfDay,
  isHabitDue,
  weeklyDots,
  weeklyCompletionCount,
  streakEmoji,
  buildWeeklyHistory,
  DAY_LABELS,
  habitToSuggestion,
  getHabitUrgency,
} from '../utils/habits';
import { Commitment, DeckSuggestion } from '../types';

type Props = StackScreenProps<RootStackParamList, 'Habits'>;

const DOT_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/* ── Flip-card wrapper ───────────────────────── */
const FlipCard: React.FC<{ front: React.ReactNode; back: React.ReactNode; flipped: boolean; onFlip: () => void }> = ({ front, back, flipped, onFlip }) => {
  const animRef = useRef(new Animated.Value(flipped ? 1 : 0)).current;

  const doFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFlip();
    Animated.spring(animRef, { toValue: flipped ? 0 : 1, tension: 80, friction: 12, useNativeDriver: true }).start();
  };

  const frontRotate = animRef.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = animRef.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacity = animRef.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [1, 1, 0, 0] });
  const backOpacity = animRef.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [0, 0, 1, 1] });

  return (
    <Pressable onPress={doFlip}>
      <View>
        <Animated.View style={{ backfaceVisibility: 'hidden', opacity: frontOpacity, transform: [{ perspective: 800 }, { rotateY: frontRotate }] }}>
          {front}
        </Animated.View>
        <Animated.View style={{ backfaceVisibility: 'hidden', opacity: backOpacity, position: 'absolute', top: 0, left: 0, right: 0, transform: [{ perspective: 800 }, { rotateY: backRotate }] }}>
          {back}
        </Animated.View>
      </View>
    </Pressable>
  );
};



export const HabitsScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const navigatingRef = useRef(false);
  const flippedParam = route.params?.flippedHabitId;
  const [flippedCards, setFlippedCards] = useState<Set<string>>(
    flippedParam ? new Set([flippedParam]) : new Set(),
  );

  const toggleFlip = useCallback((habitId: string) => {
    setFlippedCards((prev) => {
      const next = new Set(prev);
      if (next.has(habitId)) next.delete(habitId);
      else next.add(habitId);
      return next;
    });
  }, []);

  const suggestedHabits = useMemo(() => {
    const existing = new Set(state.habits.map((habit) => habit.name.toLowerCase()));
    return recommendedHabits.filter((habit) => {
      if (existing.has(habit.name.toLowerCase())) return false;
      if (!state.prefs.allowSerendipity && state.prefs.interestTags.length) {
        return habit.tags.some((tag) => state.prefs.interestTags.includes(tag));
      }
      return true;
    }).slice(0, 8);
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

  const handleComplete = useCallback((habit: Habit) => {
    if (navigatingRef.current) return;
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

  const confirmDelete = useCallback((habit: Habit) => {
    Alert.alert(
      'Delete habit?',
      `Remove "${habit.name}" from your habits? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => actions.removeHabit(habit.id) },
      ],
    );
  }, [actions]);

  const handleDoNow = useCallback((habit: Habit) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const suggestion: DeckSuggestion = {
      ...habitToSuggestion(habit),
      steps: [{ label: habit.name, minutes: habit.lengthMin }],
    };
    const now = new Date();
    const endAt = new Date(now.getTime() + habit.lengthMin * 60_000);
    const commitment: Commitment = {
      suggestionId: suggestion.id,
      type: habit.type,
      title: habit.name,
      startAt: now.toISOString(),
      endAt: endAt.toISOString(),
    };
    InteractionManager.runAfterInteractions(() => {
      navigation.navigate('Plan', { commitment, suggestion });
      navigatingRef.current = false;
    });
  }, [navigation]);

  const renderHabitCard = (habit: Habit) => {
    const due = isHabitDue(habit);
    const dots = weeklyDots(habit);
    const weekCount = weeklyCompletionCount(habit);
    const streak = habit.currentStreak ?? 0;
    const longest = habit.longestStreak ?? 0;
    const isFlipped = flippedCards.has(habit.id);
    const weeklyHistory = buildWeeklyHistory(habit);
    const urgency = getHabitUrgency(habit);

    const front = (
      <View style={styles.habitCard}>
        {/* Header row: name + streak */}
        <View style={styles.habitHeader}>
          <View style={styles.habitNameWrap}>
            <View style={styles.habitNameRow}>
              {(urgency === 'approaching' || urgency === 'overdue') && (
                <Text style={styles.hourglassIcon}>⏳</Text>
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

        {/* Weekly dots */}
        <View style={styles.dotsRow}>
          {dots.map((done, i) => (
            <View key={`dot_${i}`} style={styles.dotCol}>
              <View style={[styles.dot, done ? styles.dotDone : styles.dotEmpty]} />
              <Text style={styles.dotLabel}>{DOT_LABELS_SHORT[i]}</Text>
            </View>
          ))}
          <View style={styles.dotSummary}>
            <Text style={styles.dotSummaryText}>{weekCount}× this week</Text>
          </View>
        </View>

        {/* Stats row */}
        {(streak > 0 || longest > 0) && (
          <View style={styles.statsRow}>
            {streak > 0 && <Text style={styles.statText}>Current: {streak}</Text>}
            {longest > 0 && <Text style={styles.statText}>Best: {longest}</Text>}
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.habitActions}>
          {due ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.completeBtn, pressed && styles.btnPressed]}
                onPress={() => handleComplete(habit)}
              >
                <Text style={styles.completeBtnText}>✓ Mark done</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.doNowBtn, pressed && styles.btnPressed]}
                onPress={() => handleDoNow(habit)}
              >
                <Text style={styles.doNowBtnText}>▶ DO NOW</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.doneLabel, pressed && styles.btnPressed]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); actions.uncompleteHabit(habit.id); actions.removeLatestActivityForHabit(habit.id); }}
              >
                <Text style={styles.doneLabelText}>↩ Undo</Text>
              </Pressable>
              <View style={[styles.doNowBtnDisabled]}>
                <Text style={styles.doNowBtnDisabledText}>▶ DO NOW</Text>
              </View>
            </>
          )}
          <View style={styles.habitActionsRight}>
            <Pressable
              style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
              onPress={() => navigation.navigate('HabitForm', { habit })}
            >
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.deleteIconBtn, pressed && styles.btnPressed]}
              onPress={() => confirmDelete(habit)}
            >
              <Text style={styles.deleteIconText}>🗑</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.flipHint}>Tap card to see history</Text>
      </View>
    );

    const back = (
      <View style={[styles.habitCard, styles.habitCardBack]}>
        <View style={styles.backHeader}>
          <Text style={styles.habitName}>{habit.name} — History</Text>
          <Text style={styles.flipHint}>Tap to flip back</Text>
        </View>
        {/* Day labels header */}
        <View style={styles.weekRow}>
          <View style={styles.weekLabel} />
          {DAY_LABELS.map((d, i) => (
            <View key={`lbl_${i}`} style={styles.historyDotCol}>
              <Text style={styles.historyDayLabel}>{d}</Text>
            </View>
          ))}
        </View>
        <ScrollView style={styles.historyScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {weeklyHistory.map((week, wi) => (
            <View key={`w_${wi}`} style={styles.weekRow}>
              <Text style={styles.weekLabel} numberOfLines={1}>{week.label}</Text>
              {week.days.map((status, di) => (
                <View key={`wd_${wi}_${di}`} style={styles.historyDotCol}>
                  {status === null ? (
                    <View style={[styles.historyDot, styles.historyDotNA]} />
                  ) : (
                    <View style={[styles.historyDot, status ? styles.historyDotDone : styles.historyDotMissed]}>
                      <Text style={[styles.historyDotIcon, status ? styles.historyDotIconDone : styles.historyDotIconMissed]}>
                        {status ? '✓' : '✕'}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    );

    return (
      <View key={habit.id}>
        <FlipCard front={front} back={back} flipped={isFlipped} onFlip={() => toggleFlip(habit.id)} />
      </View>
    );
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        {/* ── Header ── */}
        <View style={styles.headerContainer}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Your Habits</Text>
            <Text style={styles.subtitle}>Build routines that stick 🎯</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('HabitForm')}>
            <View style={styles.addButtonSmall}>
              <Text style={styles.addButtonSmallText}>+ New</Text>
            </View>
          </Pressable>
        </View>

        {/* ── Your Active Habits ── */}
        {state.habits.length > 0 && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>📖 Your Habits</Text>
              <Text style={styles.sectionCount}>{state.habits.length} active</Text>
            </View>
            {state.habits.map(renderHabitCard)}
          </View>
        )}

        {/* ── Empty State ── */}
        {state.habits.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyText}>No habits yet</Text>
            <Text style={styles.emptySubtext}>Start by adding a habit to build streaks!</Text>
            <Pressable
              onPress={() => navigation.navigate('HabitForm')}
              style={({ pressed }) => [styles.emptyButton, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.emptyButtonText}>Create your first habit</Text>
            </Pressable>
          </View>
        )}

        {/* ── Suggested Habits ── */}
        {suggestedHabits.length > 0 && (
          <View style={styles.suggestedSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>✨ Suggestions</Text>
              <Text style={styles.sectionCount}>{suggestedHabits.length} ideas</Text>
            </View>
            {suggestedHabits.map((habit) => (
              <View key={habit.name} style={styles.suggestedCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestedName}>{habit.name}</Text>
                  <Text style={styles.suggestedMeta}>
                    {formatHabitFrequency(habit.frequency)} · {formatHabitTimeOfDay(habit.timeOfDay)} · {habit.lengthMin}m
                  </Text>
                </View>
                <Pressable
                  onPress={() => addSuggestedHabit(habit)}
                  style={({ pressed }) => [styles.suggestedAddBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.suggestedAddBtnText}>+ Add</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  
  /* ── Header ── */
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  back: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 14 },
  title: { fontFamily: theme.fonts.heading, fontSize: 28, color: theme.colors.text, marginBottom: 4 },
  subtitle: { fontFamily: theme.fonts.body, color: theme.colors.textMuted, fontSize: 14 },
  addButtonSmall: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  addButtonSmallText: { fontFamily: theme.fonts.semibold, color: '#fff', fontSize: 12 },

  /* ── Section Headers ── */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: { fontFamily: theme.fonts.heading, fontSize: 18, color: theme.colors.text },
  sectionCount: { fontFamily: theme.fonts.body, fontSize: 13, color: theme.colors.textMuted },

  /* ── Empty State ── */
  emptyCard: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyEmoji: { fontSize: 48 },
  emptyText: { fontFamily: theme.fonts.heading, fontSize: 18, color: theme.colors.text },
  emptySubtext: { fontFamily: theme.fonts.body, color: theme.colors.textMuted, textAlign: 'center' },
  emptyButton: {
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  emptyButtonText: { fontFamily: theme.fonts.semibold, color: '#fff', fontSize: 14 },

  /* ── Habit Card ── */
  habitCard: {
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  habitHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  habitNameWrap: { flex: 1 },
  habitNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hourglassIcon: { fontSize: 16 },
  habitName: { fontFamily: theme.fonts.semibold, fontSize: 16, color: theme.colors.text },
  habitMeta: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
  streakBadge: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
  },
  streakText: { fontFamily: theme.fonts.semibold, fontSize: 13, color: theme.colors.accentDark },

  /* ── Weekly Progress ── */
  dotsRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 8, 
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  dotCol: { alignItems: 'center', gap: 4, flex: 1 },
  dot: { width: 24, height: 24, borderRadius: 12 },
  dotDone: { backgroundColor: theme.colors.accent },
  dotEmpty: { backgroundColor: theme.colors.backgroundAlt, borderWidth: 1.5, borderColor: theme.colors.border },
  dotLabel: { fontFamily: theme.fonts.body, fontSize: 10, color: theme.colors.textMuted, fontWeight: '600' },
  dotSummary: { flex: 0.8, paddingLeft: theme.spacing.sm },
  dotSummaryText: { fontFamily: theme.fonts.semibold, fontSize: 11, color: theme.colors.accent, backgroundColor: theme.colors.accentSoft, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 },

  /* ── Stats ── */
  statsRow: { 
    flexDirection: 'row', 
    gap: 12,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.md,
  },
  statText: { fontFamily: theme.fonts.body, fontSize: 12, color: theme.colors.textMuted },

  /* ── Actions ── */
  habitActions: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  habitActionsRight: { flexDirection: 'row', gap: theme.spacing.xs },
  completeBtn: {
    flex: 1,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  completeBtnText: { fontFamily: theme.fonts.semibold, fontSize: 14, color: '#fff' },
  doNowBtn: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
  },
  doNowBtnText: { fontFamily: theme.fonts.semibold, fontSize: 14, color: theme.colors.accentDark },
  doNowBtnDisabled: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    opacity: 0.5,
  },
  doNowBtnDisabledText: { fontFamily: theme.fonts.semibold, fontSize: 14, color: theme.colors.textMuted },
  doneLabel: {
    flex: 1,
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    alignItems: 'center',
  },
  doneLabelText: { fontFamily: theme.fonts.semibold, fontSize: 14, color: theme.colors.accentDark },
  deleteIconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteIconText: { fontSize: 16 },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
  },
  editBtnText: { fontFamily: theme.fonts.semibold, fontSize: 13, color: theme.colors.textMuted },
  btnPressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },

  /* ── Suggested Section ── */
  suggestedSection: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  suggestedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  suggestedName: { fontFamily: theme.fonts.semibold, color: theme.colors.text, fontSize: 15 },
  suggestedMeta: { fontFamily: theme.fonts.body, color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  suggestedAddBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
  },
  suggestedAddBtnText: { fontFamily: theme.fonts.semibold, color: '#fff', fontSize: 12 },

  /* ── Flip Card ── */
  flipHint: {
    fontFamily: theme.fonts.body,
    fontSize: 10,
    color: theme.colors.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  habitCardBack: {
    backgroundColor: theme.colors.backgroundAlt,
    minHeight: 240,
  },
  backHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  historyScroll: {
    maxHeight: 220,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  weekLabel: {
    width: 80,
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  historyDotCol: {
    flex: 1,
    alignItems: 'center',
  },
  historyDayLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  historyDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyDotDone: {
    backgroundColor: theme.colors.accent,
  },
  historyDotMissed: {
    backgroundColor: theme.colors.card,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  historyDotNA: {
    backgroundColor: theme.colors.backgroundAlt,
    opacity: 0.3,
  },
  historyDotIcon: {
    fontSize: 12,
    fontFamily: theme.fonts.semibold,
  },
  historyDotIconDone: {
    color: '#fff',
  },
  historyDotIconMissed: {
    color: theme.colors.textMuted,
  },
});
