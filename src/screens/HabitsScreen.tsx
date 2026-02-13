import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { recommendedHabits } from '../data/habits';
import { Habit } from '../types';
import { formatHabitFrequency, formatHabitTimeOfDay, isHabitDue } from '../utils/habits';

type Props = StackScreenProps<RootStackParamList, 'Habits'>;

export const HabitsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();

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
    };
    actions.addHabit(habit);
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <Text style={styles.title}>Habits</Text>
          <Pressable onPress={() => navigation.navigate('HabitForm')}>
            <Text style={styles.addLink}>Add habit</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>Build routines that show up in your swipe deck.</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your habits</Text>
          {state.habits.length === 0 && (
            <Text style={styles.emptyText}>No habits yet. Add one to keep it in your deck.</Text>
          )}
          {state.habits.map((habit) => {
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
        </View>

        {suggestedHabits.length > 0 && (
          <View style={styles.section}>
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
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          onPress={() => navigation.navigate('HabitForm')}
        >
          <Text style={styles.addButtonText}>Add habit</Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  headerRow: {
    marginTop: theme.spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  emptyText: {
    fontFamily: theme.fonts.body,
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
  addLink: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  addButton: {
    marginTop: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  addButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  addButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
});
