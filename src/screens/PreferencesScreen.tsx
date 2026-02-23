import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
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

  const toggleInterest = (tag: string) => {
    setInterestTags((prev) => (
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    ));
  };

  const onContinue = () => {
    actions.setPrefs({
      openToGoingOut: state.prefs.openToGoingOut,
      allowSerendipity: state.prefs.allowSerendipity,
      radiusKm,
      interestTags,
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
});
