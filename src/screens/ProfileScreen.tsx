import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { signOutUser } from '../services/auth';
import { firebaseEnabled } from '../services/firebase';

type Props = StackScreenProps<RootStackParamList, 'Profile'>;

export const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();

  const handleSignOut = async () => {
    await signOutUser();
  };

  const signedInLabel = state.userEmail ?? state.userId ?? 'Guest';

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Profile</Text>
        <Text style={styles.subtitle}>
          Signed in as {signedInLabel}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <PrimaryButton label="Log out" onPress={handleSignOut} />
          {!firebaseEnabled && (
            <Text style={styles.rowText}>Firebase config missing. Add it to enable accounts.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Profile setup</Text>
          <PrimaryButton
            label="Edit preferences"
            onPress={() => navigation.navigate('Settings')}
          />
          <Pressable
            onPress={async () => {
              await actions.resetData();
            }}
          >
            <Text style={styles.link}>Restart onboarding</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current preferences</Text>
          <Text style={styles.rowText}>Radius: {state.prefs.radiusKm} km</Text>
          <Text style={styles.rowText}>
            Interests: {state.prefs.interestTags.length ? state.prefs.interestTags.join(', ') : 'None'}
          </Text>
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
    padding: theme.spacing.lg,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    marginTop: theme.spacing.sm,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
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
  link: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  rowText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
