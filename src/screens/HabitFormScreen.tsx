import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { TimePickerScroll } from '../components/TimePickerScroll';
import { useTheme } from '../theme/ThemeProvider';
import { Habit, HabitFrequency, HabitTimeOfDay, HabitType } from '../types';
import { useAppState } from '../state/AppState';
import { normalizeClockTime } from '../utils/time';

type Props = StackScreenProps<RootStackParamList, 'HabitForm'>;

const typeOptions: { id: HabitType; label: string }[] = [
  { id: 'AT_HOME', label: 'At home' },
  { id: 'GO_OUT', label: 'Go out' },
];

const frequencyOptions: { id: HabitFrequency; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'fortnightly', label: 'Fortnightly' },
  { id: 'monthly', label: 'Monthly' },
];

const timeOptions: { id: HabitTimeOfDay; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
];

const weekdayOptions = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' },
];

const tagOptions = [
  { id: 'fitness', label: '🏋️ Fitness' },
  { id: 'wellness', label: '🧘 Wellness' },
  { id: 'nature', label: '🌿 Nature' },
  { id: 'coffee', label: '☕ Coffee' },
  { id: 'food', label: '🍽️ Food' },
  { id: 'art', label: '🎨 Art' },
  { id: 'music', label: '🎵 Music' },
  { id: 'learning', label: '📚 Learning' },
  { id: 'focus', label: '🎯 Focus' },
  { id: 'social', label: '👫 Social' },
  { id: 'explore', label: '🧭 Explore' },
  { id: 'creative', label: '✏️ Creative' },
  { id: 'cycling', label: '🚴 Cycling' },
  { id: 'running', label: '🏃 Running' },
];

export const HabitFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { actions } = useAppState();
  const insets = useSafeAreaInsets();
  const existing = route.params?.habit;
  const isEditing = !!existing;
  const [name, setName] = useState(existing?.name ?? '');
  const [habitType, setHabitType] = useState<HabitType>(existing?.type ?? 'AT_HOME');
  const [lengthMin, setLengthMin] = useState(existing ? String(existing.lengthMin) : '20');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [frequency, setFrequency] = useState<HabitFrequency>(existing?.frequency ?? 'daily');
  const [timeOfDay, setTimeOfDay] = useState<HabitTimeOfDay>(existing?.timeOfDay ?? 'any');
  const [preferredTime, setPreferredTime] = useState(normalizeClockTime(existing?.preferredTime, '07:30'));
  const [usePreferredTime, setUsePreferredTime] = useState(Boolean(existing?.preferredTime));
  const [scheduledWeekdays, setScheduledWeekdays] = useState<number[]>(existing?.scheduledWeekdays ?? []);
  const [selectedTags, setSelectedTags] = useState<string[]>(existing?.tags ?? []);

  useEffect(() => {
    setName(existing?.name ?? '');
    setHabitType(existing?.type ?? 'AT_HOME');
    setLengthMin(existing ? String(existing.lengthMin) : '20');
    setDescription(existing?.description ?? '');
    setFrequency(existing?.frequency ?? 'daily');
    setTimeOfDay(existing?.timeOfDay ?? 'any');
    setPreferredTime(normalizeClockTime(existing?.preferredTime, '07:30'));
    setUsePreferredTime(Boolean(existing?.preferredTime));
    setScheduledWeekdays(existing?.scheduledWeekdays ?? []);
    setSelectedTags(existing?.tags ?? []);
  }, [existing]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const toggleWeekday = (weekday: number) => {
    setScheduledWeekdays((prev) =>
      prev.includes(weekday) ? prev.filter((d) => d !== weekday) : [...prev, weekday].sort((a, b) => a - b),
    );
  };

  const onSave = () => {
    const length = Number(lengthMin);
    if (!name.trim() || !description.trim() || Number.isNaN(length) || length <= 0) {
      Alert.alert('Missing details', 'Add a name, length, and what to do.');
      return;
    }
    if (isEditing && existing) {
      actions.updateHabit({
        ...existing,
        name: name.trim(),
        type: habitType,
        lengthMin: length,
        description: description.trim(),
        frequency,
        timeOfDay,
        preferredTime: usePreferredTime ? preferredTime : undefined,
        scheduledWeekdays,
        tags: selectedTags,
      });
    } else {
      const habit: Habit = {
        id: `habit_${Date.now()}`,
        name: name.trim(),
        type: habitType,
        lengthMin: length,
        description: description.trim(),
        frequency,
        timeOfDay,
        preferredTime: usePreferredTime ? preferredTime : undefined,
        scheduledWeekdays,
        tags: selectedTags,
        createdAt: new Date().toISOString(),
        lastCompletedAt: null,
        currentStreak: 0,
        longestStreak: 0,
        completionHistory: [],
      };
      actions.addHabit(habit);
    }
    navigation.goBack();
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>{isEditing ? 'Edit habit' : 'New habit'}</Text>
        <Text style={styles.subtitle}>{isEditing ? 'Update your habit details.' : 'Create a repeatable activity you want to keep up.'}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 20-min stretch"
            placeholderTextColor={theme.colors.textMuted}
            value={name}
            onChangeText={setName}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.row}>
            {typeOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={habitType === option.id}
                onPress={() => setHabitType(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Length (minutes)</Text>
          <TextInput
            style={styles.input}
            placeholder="20"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="numeric"
            value={lengthMin}
            onChangeText={setLengthMin}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>What to do</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the steps or outcome."
            placeholderTextColor={theme.colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>How often</Text>
          <View style={styles.rowWrap}>
            {frequencyOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={frequency === option.id}
                onPress={() => setFrequency(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Time of day</Text>
          <View style={styles.rowWrap}>
            {timeOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                selected={timeOfDay === option.id}
                onPress={() => setTimeOfDay(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Weekdays (optional)</Text>
          <Text style={styles.hint}>If selected, this habit is only due on those days.</Text>
          <View style={styles.rowWrap}>
            {weekdayOptions.map((day) => (
              <Chip
                key={day.id}
                label={day.label}
                selected={scheduledWeekdays.includes(day.id)}
                onPress={() => toggleWeekday(day.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Exact time (optional)</Text>
          <Text style={styles.hint}>Use the picker instead of typing time manually.</Text>
          <View style={styles.rowWrap}>
            <Chip
              label="No exact time"
              selected={!usePreferredTime}
              onPress={() => setUsePreferredTime(false)}
            />
            <Chip
              label="Set exact time"
              selected={usePreferredTime}
              onPress={() => setUsePreferredTime(true)}
            />
          </View>
          {usePreferredTime && (
            <TimePickerScroll value={preferredTime} onChange={setPreferredTime} />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Tags</Text>
          <Text style={styles.hint}>Pick tags so this habit fits your interests and gets scored better.</Text>
          <View style={styles.rowWrap}>
            {tagOptions.map((tag) => (
              <Chip
                key={tag.id}
                label={tag.label}
                selected={selectedTags.includes(tag.id)}
                onPress={() => toggleTag(tag.id)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
      <PrimaryButton label={isEditing ? 'Update habit' : 'Save habit'} onPress={onSave} style={styles.button} />
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
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  hint: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  field: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  label: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  button: {
    margin: theme.spacing.lg,
  },
});
