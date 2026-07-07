import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { Chip } from '../components/Chip';
import WakeWindowRange from '../components/WakeWindowRange';
import { BrandCollabLockup } from '../components/BrandCollabLockup';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { normalizeClockTime } from '../utils/time';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;

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
  const [step, setStep] = useState(0);
  const [interestTags, setInterestTags] = useState<string[]>(state.prefs.interestTags || []);
  const [customInterests, setCustomInterests] = useState<string[]>(state.prefs.customInterests ?? []);
  const [interestInput, setInterestInput] = useState('');
  const [selfDescription, setSelfDescription] = useState(state.prefs.selfDescription ?? '');
  const [lifestyle, setLifestyle] = useState(state.prefs.lifestyle ?? 'mixed');
  const [wakeStartTime, setWakeStartTime] = useState(normalizeClockTime(state.prefs.wakeStartTime ?? '07:00', '07:00'));
  const [wakeEndTime, setWakeEndTime] = useState(normalizeClockTime(state.prefs.wakeEndTime ?? '23:00', '23:00'));
  const transition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [step, transition]);

  const toggleInterest = (tag: string) => {
    setInterestTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
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

  const onFinish = () => {
    actions.setPrefs({
      openToGoingOut: state.prefs.openToGoingOut,
      allowSerendipity: state.prefs.allowSerendipity,
      radiusKm: state.prefs.radiusKm,
      interestTags,
      customInterests,
      lifestyle,
      selfDescription: selfDescription.trim(),
      wakeStartTime: normalizeClockTime(wakeStartTime, '07:00'),
      wakeEndTime: normalizeClockTime(wakeEndTime, '23:00'),
      themeMode: state.prefs.themeMode,
    });
    navigation.navigate('OnboardingComplete');
  };

  const contentOpacity = transition;
  const contentTranslate = transition.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.content, { opacity: contentOpacity, transform: [{ translateY: contentTranslate }] }]}>
          <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
          <Text style={styles.stepLabel}>Step {step + 1} of 2</Text>
          <Text style={styles.title}>{step === 0 ? 'Pick your interests' : 'Shape the rest'}</Text>
          <Text style={styles.subtitle}>
            {step === 0
              ? 'Keep this quick. We use these to tailor the first ideas you see.'
              : 'Set your rhythm so suggestions fit the way you actually live.'}
          </Text>

          {step === 0 ? (
            <>
              <Text style={styles.sectionTitle}>Choose a few that fit you</Text>
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
            </>
          ) : (
            <>
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
              <Text style={styles.helperText}>This can wrap around midnight, so early mornings and late nights both work.</Text>
              <View style={styles.wakeWindowContainer}>
                <WakeWindowRange
                  start={wakeStartTime}
                  end={wakeEndTime}
                  onChange={(start, end) => {
                    setWakeStartTime(start);
                    setWakeEndTime(end);
                  }}
                />
              </View>
            </>
          )}
        </Animated.View>

        <View style={styles.buttonRow}>
          {step === 1 ? (
            <PrimaryButton label="Back" onPress={() => setStep(0)} variant="muted" style={styles.secondaryButton} />
          ) : (
            <View style={styles.secondaryButton} />
          )}
          {step === 0 ? (
            <PrimaryButton label="Next" onPress={() => setStep(1)} style={styles.primaryButton} />
          ) : (
            <PrimaryButton label="Finish setup" onPress={onFinish} style={styles.primaryButton} />
          )}
        </View>
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
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.lg,
  },
  stepLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.accentDark,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
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
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    marginTop: theme.spacing.lg,
    color: theme.colors.textMuted,
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
  wakeWindowContainer: {
    marginVertical: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  primaryButton: {
    flex: 1,
  },
  secondaryButton: {
    flex: 1,
  },
});
