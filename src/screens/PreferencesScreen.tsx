import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { ToggleRow } from '../components/ToggleRow';
import { Chip } from '../components/Chip';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'Preferences'>;

const radiusOptions = [2, 5, 10];
const interestOptions = [
  { id: 'fitness', label: 'Fitness' },
  { id: 'wellness', label: 'Wellness' },
  { id: 'nature', label: 'Nature' },
  { id: 'art', label: 'Art' },
  { id: 'music', label: 'Music' },
  { id: 'movies', label: 'Movies' },
  { id: 'food', label: 'Food' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'learning', label: 'Learning' },
  { id: 'focus', label: 'Focus' },
  { id: 'social', label: 'Social' },
  { id: 'explore', label: 'Explore' },
];

export const PreferencesScreen: React.FC<Props> = () => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [openToGoingOut, setOpenToGoingOut] = useState(state.prefs.openToGoingOut);
  const [allowSerendipity, setAllowSerendipity] = useState(state.prefs.allowSerendipity);
  const [radiusKm, setRadiusKm] = useState(state.prefs.radiusKm);
  const [interestTags, setInterestTags] = useState<string[]>(state.prefs.interestTags || []);

  const toggleInterest = (tag: string) => {
    setInterestTags((prev) => (
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    ));
  };

  const onContinue = () => {
    actions.setPrefs({
      openToGoingOut,
      allowSerendipity,
      radiusKm,
      interestTags,
      themeMode: state.prefs.themeMode,
    });
    actions.completeOnboarding();
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Quick preferences</Text>
        <Text style={styles.subtitle}>One tap each. You can change later.</Text>
        <View style={styles.section}>
          <ToggleRow
            label="Open to going out"
            value={openToGoingOut}
            onValueChange={setOpenToGoingOut}
          />
          <ToggleRow
            label="Surprise me outside my interests"
            value={allowSerendipity}
            onValueChange={setAllowSerendipity}
          />
        </View>
        <Text style={styles.sectionTitle}>Pick a few interests</Text>
        <View style={styles.chipsWrap}>
          {interestOptions.map((interest) => (
            <Chip
              key={interest.id}
              label={interest.label}
              selected={interestTags.includes(interest.id)}
              onPress={() => toggleInterest(interest.id)}
            />
          ))}
        </View>
        <Text style={styles.sectionTitle}>Radius</Text>
        <View style={styles.chips}>
          {radiusOptions.map((radius) => (
            <Chip
              key={radius}
              label={`${radius} km`}
              selected={radiusKm === radius}
              onPress={() => setRadiusKm(radius)}
            />
          ))}
        </View>
      </View>
      <PrimaryButton label="Continue" onPress={onContinue} style={styles.button} />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  content: {
    marginTop: theme.spacing.xxl,
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
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  button: {
    marginBottom: theme.spacing.xl,
  },
});
