import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'Premium'>;

type ComparisonRow = {
  feature: string;
  free: string;
  premium: string;
};

const COMPARISON_ROWS: ComparisonRow[] = [
  { feature: 'Smart Calendar auto-planning', free: 'Locked', premium: 'Unlocked' },
  { feature: 'To-do import from photo', free: 'Preview only', premium: 'Included' },
  { feature: 'Swipe credits max', free: '20', premium: '30' },
  { feature: 'Swipe regeneration', free: 'Standard', premium: 'Faster' },
  { feature: 'Habit fit into schedule', free: 'Basic', premium: 'Smart' },
];

export const PremiumScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const isGerman = language === 'de';
  const purchaseTemporarilyDisabled = true;
  const nextRenewalDate = useMemo(() => {
    const renewal = new Date();
    renewal.setMonth(renewal.getMonth() + 1);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(renewal);
  }, []);

  const PREMIUM_BENEFITS = [
    isGerman ? 'Smart Calendar Auto-Planung' : 'Smart Calendar auto-planning',
    isGerman ? 'To-do-Import per Foto' : 'To-do import from photo',
    isGerman ? 'Maximal 30 Swipe-Credits' : '30 swipe credits max',
    isGerman ? 'Schnellere Swipe-Regeneration' : 'Faster swipe regeneration',
    isGerman ? 'Intelligenteres Habit-Schedule-Matching' : 'Smarter habit-to-schedule fitting',
  ];

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xl },
        ]}
      >
        {state.isPremium ? (
          <>
            <View style={[styles.heroCard, styles.activeHeroCard]}>
              <Text style={styles.heroEyebrow}>BITS PREMIUM</Text>
              <Text style={styles.title}>{isGerman ? 'Du nutzt Premium' : 'You are Premium'}</Text>
              <Text style={styles.subtitle}>
                {isGerman
                  ? 'Dein Konto ist aktiv und alle Premium-Planungsfunktionen sind freigeschaltet.'
                  : 'Your account is active and all premium planning features are unlocked.'}
              </Text>
            </View>

            <View style={styles.activeBenefitsCard}>
              <Text style={styles.activeBenefitsTitle}>{isGerman ? 'Deine Vorteile' : 'Your benefits'}</Text>
              {PREMIUM_BENEFITS.map((benefit) => (
                <View key={benefit} style={styles.benefitRow}>
                  <Text style={styles.benefitIcon}>✦</Text>
                  <Text style={styles.benefitText}>{benefit}</Text>
                </View>
              ))}
            </View>

            <View style={styles.renewalCard}>
              <Text style={styles.renewalLabel}>{isGerman ? 'Nächstes Verlängerungsdatum' : 'Next renewal date'}</Text>
              <Text style={styles.renewalDate}>{nextRenewalDate}</Text>
              <Text style={styles.renewalMeta}>{isGerman ? 'Deine Mitgliedschaft verlängert sich an diesem Datum automatisch.' : 'Your membership renews automatically on this date.'}</Text>
            </View>

            <View style={styles.secondaryAction}>
              <PrimaryButton label={isGerman ? 'Zuruck' : 'Back'} variant="muted" onPress={() => navigation.goBack()} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>BITS PREMIUM</Text>
              <Text style={styles.title}>{isGerman ? 'Mehr aus deiner Zeit machen' : 'Upgrade your momentum'}</Text>
              <Text style={styles.subtitle}>
                {isGerman ? 'Schalte smartere Planung frei und hol mehr aus deiner freien Zeit.' : 'Unlock smarter planning and get more from your free time.'}
              </Text>
            </View>

            <View style={styles.tableCard}>
              <View style={[styles.tableRow, styles.headerRow]}>
                <Text style={[styles.headerCell, styles.featureCell]}>Feature</Text>
                <Text style={styles.headerCell}>{isGerman ? 'Gratis' : 'Free'}</Text>
                <Text style={styles.headerCell}>Premium</Text>
              </View>
              {COMPARISON_ROWS.map((row) => (
                <View key={row.feature} style={styles.tableRow}>
                  <Text style={[styles.featureCell, styles.featureText]}>{row.feature}</Text>
                  <Text style={styles.freeValue}>{row.free}</Text>
                  <Text style={styles.premiumValue}>{row.premium}</Text>
                </View>
              ))}
            </View>

            <View style={styles.purchaseCard}>
              <Text style={styles.priceLabel}>€4.99 / month</Text>
              <Text style={styles.priceSubtext}>{isGerman ? 'Jederzeit kündbar. Sofortiger Zugriff nach dem Kauf.' : 'Cancel anytime. Instant access after purchase.'}</Text>
              <PrimaryButton
                label={isGerman ? 'Premium kaufen (bald verfügbar)' : 'Purchase Premium (Coming soon)'}
                onPress={() => undefined}
                disabled={purchaseTemporarilyDisabled}
              />
              <View style={styles.secondaryAction}>
                <PrimaryButton label={isGerman ? 'Zuruck' : 'Back'} variant="muted" onPress={() => navigation.goBack()} />
              </View>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>{isGerman ? 'Weitere Infos' : 'Further info'}</Text>
              <Text style={styles.infoText}>
                {isGerman
                  ? 'Bits Premium hilft dir, leere Zeitblöcke zu vermeiden - mit besseren Vorschlagen, besserem Schedule-Fit und konstanterem Umsetzen der Dinge, die dir wichtig sind.'
                  : 'Bits Premium helps you avoid empty time blocks with smarter suggestions, better schedule fit, and more consistent follow-through on the activities that matter to you.'}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  heroCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  activeHeroCard: {
    borderColor: '#E8D889',
    backgroundColor: '#FFF9E6',
  },
  heroEyebrow: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    letterSpacing: 1,
    color: '#C89A00',
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 30,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.textMuted,
  },
  tableCard: {
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  headerRow: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  headerCell: {
    flex: 1,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  featureCell: {
    flex: 2.2,
  },
  featureText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 14,
  },
  freeValue: {
    flex: 1,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  premiumValue: {
    flex: 1,
    fontFamily: theme.fonts.semibold,
    color: '#C89A00',
    fontSize: 14,
  },
  purchaseCard: {
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.md,
  },
  priceLabel: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    fontSize: 26,
  },
  priceSubtext: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  secondaryAction: {
    marginTop: theme.spacing.xs,
  },
  activeBenefitsCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: '#E8D889',
    gap: theme.spacing.sm,
  },
  activeBenefitsTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 18,
    marginBottom: 2,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  benefitIcon: {
    color: '#B78A00',
    fontSize: 14,
    lineHeight: 14,
  },
  benefitText: {
    flex: 1,
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 14,
  },
  renewalCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: '#FFF9E6',
    borderWidth: 1,
    borderColor: '#E8D889',
    gap: theme.spacing.xs,
  },
  renewalLabel: {
    fontFamily: theme.fonts.semibold,
    color: '#7A5A00',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  renewalDate: {
    fontFamily: theme.fonts.heading,
    color: '#5B4200',
    fontSize: 28,
  },
  renewalMeta: {
    fontFamily: theme.fonts.body,
    color: '#7A5A00',
    fontSize: 13,
  },
  infoCard: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  infoTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 16,
  },
  infoText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
});

export default PremiumScreen;
