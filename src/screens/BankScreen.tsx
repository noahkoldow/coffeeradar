import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { RootStackParamList } from '../navigation/types';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = StackScreenProps<RootStackParamList, 'Bank'>;

export const BankScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const [timeUntilCredit, setTimeUntilCredit] = useState<string>('');

  useEffect(() => {
    const updateTimer = () => {
      const now = Date.now();
      const lastUpdated = state.swipeBankLastUpdated ?? now;
      const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes per swipe credit
      const maxCredits = state.swipeBank?.max ?? 20;
      const current = state.swipeBank?.current ?? 0;

      if (current >= maxCredits) {
        setTimeUntilCredit('Fully charged');
        return;
      }

      const elapsed = now - lastUpdated;
      const nextCreditMs = REFRESH_INTERVAL - (elapsed % REFRESH_INTERVAL);
      const minutes = Math.floor(nextCreditMs / 60000);
      const seconds = Math.floor((nextCreditMs % 60000) / 1000);
      setTimeUntilCredit(`${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [state.swipeBank, state.swipeBankLastUpdated]);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xl },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Swipe Credits</Text>
          <Text style={styles.subtitle}>You have {state.swipeBank?.current ?? 0} of {state.swipeBank?.max ?? 20}</Text>
        </View>

        <View style={styles.cardRow}>
          <View style={[styles.card, styles.creditCard]}>
            <Text style={styles.cardIcon}>⏱️</Text>
            <Text style={styles.cardLabel}>Next credit in</Text>
            <Text style={styles.timerValue}>{timeUntilCredit}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚡ How it works</Text>
          <View style={styles.infoPoint}>
            <Text style={styles.infoNumber}>1</Text>
            <Text style={styles.infoText}>You start with {state.swipeBank?.max ?? 20} swipes each day</Text>
          </View>
          <View style={styles.infoPoint}>
            <Text style={styles.infoNumber}>2</Text>
            <Text style={styles.infoText}>Each swipe spends one credit</Text>
          </View>
          <View style={styles.infoPoint}>
            <Text style={styles.infoNumber}>3</Text>
            <Text style={styles.infoText}>Credits restore every 10 minutes</Text>
          </View>
          <View style={styles.infoPoint}>
            <Text style={styles.infoNumber}>4</Text>
            <Text style={styles.infoText}>When empty, choose from featured cards instead</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💭 Why limits?</Text>
          <Text style={styles.sectionText}>
            The swipe restriction is not to restrict you. It is to help you make a decision to do something.
          </Text>
          <Text style={[styles.sectionText, { marginTop: theme.spacing.md }]}>
            Swiping activities isn't the solution if you won't settle on one. By limiting swipes, we help you commit to the choices that matter.
          </Text>
        </View>

        <View style={ styles.footer}>
          <PrimaryButton
            label="Back"
            onPress={() => navigation.goBack()}
          />
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
    padding: theme.spacing.xl,
    flexGrow: 1,
  },
  header: {
    marginBottom: theme.spacing.xl,
  },
  title: {
    fontFamily: theme.fonts.semibold,
    fontSize: 28,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
  },
  cardRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginVertical: theme.spacing.xl,
  },
  card: {
    flex: 1,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  creditCard: {
    borderColor: theme.colors.accent,
  },
  cardIcon: {
    fontSize: 30,
  },
  cardLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    fontFamily: theme.fonts.semibold,
    fontSize: 20,
    color: theme.colors.accent,
    marginTop: theme.spacing.sm,
  },
  section: {
    marginVertical: theme.spacing.lg,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  sectionText: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    lineHeight: 22,
  },
  infoPoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  infoNumber: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.accent,
    width: 24,
  },
  infoText: {
    flex: 1,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  footer: {
    marginTop: theme.spacing.xl,
  },
});

export default BankScreen;
