import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { Chip } from '../components/Chip';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { Habit, HabitFrequency, HabitTimeOfDay, HabitType } from '../types';
import { useAppState } from '../state/AppState';

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

export const HabitFormScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [habitType, setHabitType] = useState<HabitType>('AT_HOME');
  const [lengthMin, setLengthMin] = useState('20');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<HabitFrequency>('daily');
  const [timeOfDay, setTimeOfDay] = useState<HabitTimeOfDay>('any');

  const onSave = () => {
    const length = Number(lengthMin);
    if (!name.trim() || !description.trim() || Number.isNaN(length) || length <= 0) {
      Alert.alert('Missing details', 'Add a name, length, and what to do.');
      return;
    }
    const habit: Habit = {
      id: `habit_${Date.now()}`,
      name: name.trim(),
      type: habitType,
      lengthMin: length,
      description: description.trim(),
      frequency,
      timeOfDay,
      createdAt: new Date().toISOString(),
      lastCompletedAt: null,
    };
    actions.addHabit(habit);
    navigation.goBack();
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>New habit</Text>
        <Text style={styles.subtitle}>Create a repeatable activity you want to keep up.</Text>

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
      </ScrollView>
      <PrimaryButton label="Save habit" onPress={onSave} style={styles.button} />
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
