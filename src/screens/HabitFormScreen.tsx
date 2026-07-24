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
import { useI18n } from '../i18n/I18nProvider';

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
  const { language } = useI18n();
  const isGerman = language === 'de';
  const typeLabel = (id: HabitType): string => (isGerman ? (id === 'AT_HOME' ? 'Zu Hause' : 'DrauBen') : (id === 'AT_HOME' ? 'At home' : 'Go out'));
  const frequencyLabel = (id: HabitFrequency): string => {
    if (!isGerman) return frequencyOptions.find((item) => item.id === id)?.label ?? id;
    if (id === 'daily') return 'Jeden Tag';
    if (id === 'weekly') return 'Wochentlich';
    if (id === 'fortnightly') return 'Alle zwei Wochen';
    return 'Monatlich';
  };
  const timeOfDayLabel = (id: HabitTimeOfDay): string => {
    if (!isGerman) return timeOptions.find((item) => item.id === id)?.label ?? id;
    if (id === 'any') return 'Jederzeit';
    if (id === 'morning') return 'Morgens';
    if (id === 'afternoon') return 'Nachmittags';
    return 'Abends';
  };
  const weekdayLabel = (short: string): string => {
    if (!isGerman) return short;
    const map: Record<string, string> = { Mon: 'Mo', Tue: 'Di', Wed: 'Mi', Thu: 'Do', Fri: 'Fr', Sat: 'Sa', Sun: 'So' };
    return map[short] ?? short;
  };
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
      Alert.alert(isGerman ? 'Details fehlen' : 'Missing details', isGerman ? 'Bitte Name, Dauer und Beschreibung angeben.' : 'Add a name, length, and what to do.');
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
          <Text style={styles.back}>{isGerman ? 'Zuruck' : 'Back'}</Text>
        </Pressable>
        <Text style={styles.title}>{isEditing ? (isGerman ? 'Gewohnheit bearbeiten' : 'Edit habit') : (isGerman ? 'Neue Gewohnheit' : 'New habit')}</Text>
        <Text style={styles.subtitle}>{isEditing ? (isGerman ? 'Aktualisiere die Details deiner Gewohnheit.' : 'Update your habit details.') : (isGerman ? 'Erstelle eine wiederholbare Aktivitat, die du beibehalten willst.' : 'Create a repeatable activity you want to keep up.')}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Name' : 'Name'}</Text>
          <TextInput
            style={styles.input}
            placeholder={isGerman ? 'z. B. 20 Min Dehnen' : 'e.g. 20-min stretch'}
            placeholderTextColor={theme.colors.textMuted}
            value={name}
            onChangeText={setName}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Typ' : 'Type'}</Text>
          <View style={styles.row}>
            {typeOptions.map((option) => (
              <Chip
                key={option.id}
                label={typeLabel(option.id)}
                selected={habitType === option.id}
                onPress={() => setHabitType(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Dauer (Minuten)' : 'Length (minutes)'}</Text>
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
          <Text style={styles.label}>{isGerman ? 'Was tun' : 'What to do'}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder={isGerman ? 'Beschreibe Schritte oder Ergebnis.' : 'Describe the steps or outcome.'}
            placeholderTextColor={theme.colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Wie oft' : 'How often'}</Text>
          <View style={styles.rowWrap}>
            {frequencyOptions.map((option) => (
              <Chip
                key={option.id}
                label={frequencyLabel(option.id)}
                selected={frequency === option.id}
                onPress={() => setFrequency(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Tageszeit' : 'Time of day'}</Text>
          <View style={styles.rowWrap}>
            {timeOptions.map((option) => (
              <Chip
                key={option.id}
                label={timeOfDayLabel(option.id)}
                selected={timeOfDay === option.id}
                onPress={() => setTimeOfDay(option.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Wochentage (optional)' : 'Weekdays (optional)'}</Text>
          <Text style={styles.hint}>{isGerman ? 'Wenn ausgewahlt, ist diese Gewohnheit nur an diesen Tagen fallig.' : 'If selected, this habit is only due on those days.'}</Text>
          <View style={styles.rowWrap}>
            {weekdayOptions.map((day) => (
              <Chip
                key={day.id}
                label={weekdayLabel(day.label)}
                selected={scheduledWeekdays.includes(day.id)}
                onPress={() => toggleWeekday(day.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Genaue Uhrzeit (optional)' : 'Exact time (optional)'}</Text>
          <Text style={styles.hint}>{isGerman ? 'Nutze den Picker statt die Uhrzeit manuell einzugeben.' : 'Use the picker instead of typing time manually.'}</Text>
          <View style={styles.rowWrap}>
            <Chip
              label={isGerman ? 'Keine genaue Uhrzeit' : 'No exact time'}
              selected={!usePreferredTime}
              onPress={() => setUsePreferredTime(false)}
            />
            <Chip
              label={isGerman ? 'Genaue Uhrzeit setzen' : 'Set exact time'}
              selected={usePreferredTime}
              onPress={() => setUsePreferredTime(true)}
            />
          </View>
          {usePreferredTime && (
            <TimePickerScroll value={preferredTime} onChange={setPreferredTime} />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{isGerman ? 'Tags' : 'Tags'}</Text>
          <Text style={styles.hint}>{isGerman ? 'Wahle Tags, damit die Gewohnheit besser zu deinen Interessen passt.' : 'Pick tags so this habit fits your interests and gets scored better.'}</Text>
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
      <PrimaryButton label={isEditing ? (isGerman ? 'Gewohnheit aktualisieren' : 'Update habit') : (isGerman ? 'Gewohnheit speichern' : 'Save habit')} onPress={onSave} style={styles.button} />
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
