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
import { useI18n } from '../i18n/I18nProvider';

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
  const { language } = useI18n();
  const isGerman = language === 'de';
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
  const [ageInput, setAgeInput] = useState(state.prefs.age ? String(state.prefs.age) : '');
  const transition = useRef(new Animated.Value(0)).current;
  const finishScale = useRef(new Animated.Value(1)).current;
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    // Keep each onboarding step anchored at the top.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    });
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
    const parsedAge = Number.parseInt(ageInput.trim(), 10);
    if (!Number.isFinite(parsedAge)) return;
    if (parsedAge < 13) return;

    Animated.sequence([
      Animated.timing(finishScale, {
        toValue: 0.98,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(finishScale, {
        toValue: 1,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();

    actions.setPrefs({
      openToGoingOut: state.prefs.openToGoingOut,
      allowSerendipity: state.prefs.allowSerendipity,
      radiusKm: state.prefs.radiusKm,
      age: parsedAge,
      interestTags,
      customInterests,
      lifestyle,
      selfDescription: selfDescription.trim(),
      wakeStartTime: normalizeClockTime(wakeStartTime, '07:00'),
      wakeEndTime: normalizeClockTime(wakeEndTime, '23:00'),
      themeMode: state.prefs.themeMode,
    });
    actions.completeOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const parsedAge = Number.parseInt(ageInput.trim(), 10);
  const isAgeValid = Number.isFinite(parsedAge) && parsedAge >= 13;
  const showAgeBlocked = ageInput.trim().length > 0 && Number.isFinite(parsedAge) && parsedAge < 13;

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
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.content, { opacity: contentOpacity, transform: [{ translateY: contentTranslate }] }]}>
          <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
          <Text style={styles.stepLabel}>{isGerman ? 'Schritt' : 'Step'} {step + 1} {isGerman ? 'von' : 'of'} 2</Text>
          <Text style={styles.title}>{step === 0 ? (isGerman ? 'Wahle deine Interessen' : 'Pick your interests') : (isGerman ? 'Stimme den Rest ab' : 'Shape the rest')}</Text>
          <Text style={styles.subtitle}>
            {step === 0
              ? (isGerman ? 'Halte es kurz. Damit passen wir deine ersten Vorschlage an.' : 'Keep this quick. We use these to tailor the first ideas you see.')
              : (isGerman ? 'Setze deinen Rhythmus, damit Vorschlage zu deinem Alltag passen.' : 'Set your rhythm so suggestions fit the way you actually live.')}
          </Text>

          {step === 0 ? (
            <>
              <Text style={styles.sectionTitle}>{isGerman ? 'Wahle ein paar, die zu dir passen' : 'Choose a few that fit you'}</Text>
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

              <Text style={styles.sectionTitle}>{isGerman ? 'Eigene Interessen hinzufugen' : 'Add your own interests'}</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={styles.textInput}
                  value={interestInput}
                  onChangeText={setInterestInput}
                  placeholder={isGerman ? 'z. B. Topfern, Klettern, Stand-up-Comedy' : 'e.g. pottery, climbing, stand-up comedy'}
                  placeholderTextColor={theme.colors.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={addCustomInterest}
                />
                <Pressable onPress={addCustomInterest} style={styles.addPill}>
                  <Text style={styles.addPillText}>{isGerman ? 'Hinzufugen' : 'Add'}</Text>
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
              <Text style={styles.sectionTitle}>{isGerman ? 'Dein Lebensstil' : 'Your lifestyle'}</Text>
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

              <Text style={styles.sectionTitle}>{isGerman ? 'Erzahl uns von deinem Alltag' : 'Tell us about your daily life'}</Text>
              <TextInput
                style={styles.textArea}
                value={selfDescription}
                onChangeText={setSelfDescription}
                placeholder={isGerman ? 'Wie sehen deine Tage aus? Was gibt dir Energie? Was vermeidest du eher?' : 'What do your days look like? What energizes you? What do you usually avoid?'}
                placeholderTextColor={theme.colors.textMuted}
                multiline
                textAlignVertical="top"
                maxLength={420}
              />

              <Text style={styles.sectionTitle}>{isGerman ? 'Wachzeitfenster' : 'Wake window'}</Text>
              <Text style={styles.helperText}>{isGerman ? 'Kann uber Mitternacht gehen, dadurch funktionieren fruhe Morgen und spate Abende.' : 'This can wrap around midnight, so early mornings and late nights both work.'}</Text>
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

              <Text style={styles.sectionTitle}>{isGerman ? 'Dein Alter' : 'Your age'}</Text>
              <TextInput
                style={styles.textInput}
                value={ageInput}
                onChangeText={(value) => setAgeInput(value.replace(/[^0-9]/g, ''))}
                placeholder={isGerman ? 'Gib dein Alter ein' : 'Enter your age'}
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                maxLength={3}
              />
              {showAgeBlocked ? <Text style={styles.blockedText}>{isGerman ? 'Du musst mindestens 13 Jahre alt sein.' : 'You need to be 13 or older.'}</Text> : null}
            </>
          )}
        </Animated.View>

        <View style={styles.buttonRow}>
          {step === 1 ? (
            <PrimaryButton label={isGerman ? 'Zuruck' : 'Back'} onPress={() => setStep(0)} variant="muted" style={styles.secondaryButton} />
          ) : (
            <View style={styles.secondaryButton} />
          )}
          {step === 0 ? (
            <PrimaryButton label={isGerman ? 'Weiter' : 'Next'} onPress={() => setStep(1)} style={styles.primaryButton} />
          ) : (
            <Animated.View style={[styles.primaryButton, { transform: [{ scale: finishScale }] }]}>
              <PrimaryButton label={isGerman ? 'Fertig' : 'Finish'} onPress={onFinish} disabled={!isAgeValid} />
            </Animated.View>
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
  blockedText: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
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
