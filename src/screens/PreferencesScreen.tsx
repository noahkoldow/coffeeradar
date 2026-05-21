import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { PrimaryButton } from '../components/PrimaryButton';
import { Chip } from '../components/Chip';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { normalizeClockTime } from '../utils/time';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const bitsLogo = require('../../assets/logo.png');

type Props = StackScreenProps<RootStackParamList, 'Preferences'>;
const interestGroups = [
  {
    title: 'Active',
    options: [
      { id: 'fitness', label: '🏋️ Fitness' },
      { id: 'cycling', label: '🚴 Cycling' },
      { id: 'running', label: '🏃 Running' },
      { id: 'swimming', label: '🏊 Swimming' },
      { id: 'hiking', label: '🥾 Hiking' },
      { id: 'wellness', label: '🧘 Wellness' },
    ],
  },
  {
    title: 'Explore',
    options: [
      { id: 'nature', label: '🌿 Nature' },
      { id: 'beaches', label: '🏖️ Beaches' },
      { id: 'parks', label: '🌳 Parks' },
      { id: 'explore', label: '🧭 Explore' },
    ],
  },
  {
    title: 'Food & Drink',
    options: [
      { id: 'coffee', label: '☕ Coffee & Cafés' },
      { id: 'food', label: '🍽️ Dining' },
      { id: 'street_food', label: '🌮 Street Food' },
    ],
  },
  {
    title: 'Culture & Learning',
    options: [
      { id: 'art', label: '🎨 Art' },
      { id: 'music', label: '🎵 Music' },
      { id: 'movies', label: '🎬 Movies' },
      { id: 'learning', label: '📚 Learning' },
    ],
  },
  {
    title: 'Productivity & Social',
    options: [
      { id: 'focus', label: '🎯 Focus' },
      { id: 'social', label: '🫢 Social' },
    ],
  },
];

export const PreferencesScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [radiusKm, setRadiusKm] = useState(state.prefs.radiusKm);
  const [interestTags, setInterestTags] = useState<string[]>(state.prefs.interestTags || []);
  const [customInterests, setCustomInterests] = useState<string[]>(state.prefs.customInterests ?? []);
  const [interestInput, setInterestInput] = useState('');
  const [selfDescription, setSelfDescription] = useState(state.prefs.selfDescription ?? '');
  const [lifestyle, setLifestyle] = useState(state.prefs.lifestyle ?? 'mixed');
  const [wakeStartTime, setWakeStartTime] = useState(normalizeClockTime(state.prefs.wakeStartTime ?? '07:00', '07:00'));
  const [wakeEndTime, setWakeEndTime] = useState(normalizeClockTime(state.prefs.wakeEndTime ?? '23:00', '23:00'));

  const toggleInterest = (tag: string) => {
    setInterestTags((prev) => (
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    ));
  };

  const normalizeInterest = (value: string): string => value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const addCustomInterest = () => {
    const normalized = normalizeInterest(interestInput);
    if (!normalized) return;
    setCustomInterests((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setInterestTags((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setInterestInput('');
  };

  const onContinue = () => {
    actions.setPrefs({
      openToGoingOut: state.prefs.openToGoingOut,
      allowSerendipity: state.prefs.allowSerendipity,
      radiusKm,
      interestTags,
      customInterests,
      lifestyle,
      selfDescription: selfDescription.trim(),
      wakeStartTime: normalizeClockTime(wakeStartTime, '07:00'),
      wakeEndTime: normalizeClockTime(wakeEndTime, '23:00'),
      themeMode: state.prefs.themeMode,
    });
    actions.completeOnboarding();
    // Reset the nav stack so the user lands on Home with a clean history
    // (no back-arrow to onboarding screens).
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] }),
    );
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Quick preferences</Text>
          <Text style={styles.subtitle}>One tap each. You can change later.</Text>
          <Text style={styles.sectionTitle}>Pick a few interests</Text>
          {interestGroups.map((group) => (
            <View key={group.title}>
              <Text style={styles.groupLabel}>{group.title}</Text>
              <View style={styles.chipsWrap}>
                {group.options.map((interest) => (
                  <Chip
                    key={interest.id}
                    label={interest.label}
                    selected={interestTags.includes(interest.id)}
                    onPress={() => toggleInterest(interest.id)}
                  />
                ))}
              </View>
            </View>
          ))}
          <Text style={styles.sectionTitle}>Radius — {radiusKm} km</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={25}
            step={1}
            value={radiusKm}
            onValueChange={setRadiusKm}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.border}
            thumbTintColor={theme.colors.accent}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1 km</Text>
            <Text style={styles.sliderLabel}>25 km</Text>
          </View>

          <Text style={styles.sectionTitle}>Add your own interests</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={styles.textInput}
              value={interestInput}
              onChangeText={setInterestInput}
              placeholder="e.g. pottery, climbing, stand-up comedy"
              placeholderTextColor={theme.colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={addCustomInterest}
            />
            <Pressable onPress={addCustomInterest} style={styles.addPill}>
              <Text style={styles.addPillText}>Add</Text>
            </Pressable>
          </View>
          {customInterests.length > 0 && (
            <View style={styles.chipsWrap}>
              {customInterests.map((item) => (
                <Chip
                  key={item}
                  label={`#${item.replace(/_/g, ' ')}`}
                  selected
                  onPress={() => {
                    setCustomInterests((prev) => prev.filter((x) => x !== item));
                    setInterestTags((prev) => prev.filter((x) => x !== item));
                  }}
                />
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>Your lifestyle</Text>
          <View style={styles.chipsWrap}>
            {[
              { id: 'active', label: 'Active' },
              { id: 'moderate', label: 'Moderate' },
              { id: 'chill', label: 'Chill' },
              { id: 'mixed', label: 'Mixed' },
            ].map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={lifestyle === item.id}
                onPress={() => setLifestyle(item.id as 'active' | 'moderate' | 'chill' | 'mixed')}
              />
            ))}
          </View>

          <Text style={styles.sectionTitle}>Tell us about your daily life</Text>
          <TextInput
            style={styles.textArea}
            value={selfDescription}
            onChangeText={setSelfDescription}
            placeholder="What do your days look like? What energizes you? What do you usually avoid?"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={420}
          />

          <Text style={styles.sectionTitle}>Wake window</Text>
          <Text style={styles.helperText}>Used to keep suggestions away from sleep time unless you are already awake irregularly.</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={styles.timeInput}
              value={wakeStartTime}
              onChangeText={setWakeStartTime}
              placeholder="07:00"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="number-pad"
              maxLength={5}
            />
            <Text style={styles.timeDash}>to</Text>
            <TextInput
              style={styles.timeInput}
              value={wakeEndTime}
              onChangeText={setWakeEndTime}
              placeholder="23:00"
              placeholderTextColor={theme.colors.textMuted}
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
        </View>
        <View style={styles.buttonSpacer} />
        <PrimaryButton label="Continue" onPress={onContinue} style={styles.button} />
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  content: {
    marginTop: theme.spacing.xxl,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 30,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 16,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    marginTop: theme.spacing.lg,
    color: theme.colors.textMuted,
  },
  chips: {
    flexDirection: 'row',
    marginTop: theme.spacing.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  groupLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.md,
    marginBottom: 2,
    opacity: 0.7,
  },
  button: {
    marginBottom: theme.spacing.xl,
  },
  buttonSpacer: {
    height: theme.spacing.lg,
  },
  slider: {
    width: '100%',
    height: 40,
    marginTop: theme.spacing.sm,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.card,
  },
  textArea: {
    marginTop: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 110,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.card,
  },
  addPill: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  },
  addPillText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.semibold,
  },
  helperText: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.card,
    textAlign: 'center',
  },
  timeDash: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
});
