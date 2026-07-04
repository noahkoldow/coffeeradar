import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

interface BillingScreenProps extends StackScreenProps<RootStackParamList, 'Deck'> {}

export const BillingScreen: React.FC<BillingScreenProps> = ({
  navigation,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Billing</Text>
          <View style={styles.spacer} />
        </View>

        {/* Current Plan */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Current Plan</Text>
          <View style={styles.planCard}>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>Professional</Text>
              <View style={styles.planBadge}>
                <Text style={styles.planBadgeText}>Active</Text>
              </View>
            </View>
            <Text style={styles.planPrice}>
              <Text style={styles.currencySymbol}>$</Text>
              <Text style={styles.priceValue}>29</Text>
              <Text style={styles.pricePeriod}>/month</Text>
            </Text>
            <View style={styles.planFeatures}>
              <Text style={styles.feature}>✓ Up to 10 active campaigns</Text>
              <Text style={styles.feature}>✓ $500/month spend included</Text>
              <Text style={styles.feature}>✓ CPM pricing: $0.03</Text>
              <Text style={styles.feature}>✓ Analytics dashboard</Text>
              <Text style={styles.feature}>✓ Priority support</Text>
            </View>
          </View>

          <View style={styles.nextBillingBox}>
            <Text style={styles.nextBillingLabel}>Next billing date</Text>
            <Text style={styles.nextBillingDate}>February 15, 2026</Text>
          </View>
        </View>

        {/* Pricing Models */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pricing Models</Text>
          <Text style={styles.sectionSubtitle}>
            Choose how you pay for impressions
          </Text>

          <View style={styles.pricingModels}>
            <View style={styles.pricingModel}>
              <Text style={styles.pricingName}>📊 CPM</Text>
              <Text style={styles.pricingDesc}>Cost per 1000 impressions</Text>
              <Text style={styles.pricingRate}>$0.03 - $0.05</Text>
              <Text style={styles.pricingNote}>Best for high volume</Text>
            </View>

            <View style={styles.pricingModel}>
              <Text style={styles.pricingName}>👆 CPC</Text>
              <Text style={styles.pricingDesc}>Cost per click</Text>
              <Text style={styles.pricingRate}>$0.10 - $0.25</Text>
              <Text style={styles.pricingNote}>Best for traffic</Text>
            </View>

            <View style={styles.pricingModel}>
              <Text style={styles.pricingName}>🎯 Conversion</Text>
              <Text style={styles.pricingDesc}>Cost per conversion</Text>
              <Text style={styles.pricingRate}>$2.00 - $5.00</Text>
              <Text style={styles.pricingNote}>Best for ROI</Text>
            </View>
          </View>
        </View>

        {/* Account Balance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Balance</Text>
          <View style={styles.balanceBox}>
            <Text style={styles.balanceLabel}>Current balance</Text>
            <Text style={styles.balanceAmount}>$145.50</Text>
            <Text style={styles.balanceSubtext}>
              Earned from 45,230 impressions this month
            </Text>
          </View>
          <PrimaryButton label="Withdraw Earnings" onPress={() => console.log('TODO: Withdraw')} />
        </View>

        {/* Spending History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Monthly Spending</Text>
          <View style={styles.sparklineContainer}>
            <View style={[styles.sparklineBar, { height: '40%' }]} />
            <View style={[styles.sparklineBar, { height: '55%' }]} />
            <View style={[styles.sparklineBar, { height: '50%' }]} />
            <View style={[styles.sparklineBar, { height: '70%' }]} />
            <View style={[styles.sparklineBar, { height: '65%' }]} />
            <View style={[styles.sparklineBar, { height: '80%' }]} />
          </View>
          <View style={styles.spendingStats}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>This month</Text>
              <Text style={styles.statValue}>$234.50</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Last month</Text>
              <Text style={styles.statValue}>$198.75</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Average</Text>
              <Text style={styles.statValue}>$216.63</Text>
            </View>
          </View>
        </View>

        {/* Billing History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Billing History</Text>
          <View style={styles.invoiceList}>
            {[
              { date: 'Jan 15, 2026', amount: '$198.75', status: 'Paid' },
              { date: 'Dec 15, 2025', amount: '$187.50', status: 'Paid' },
              { date: 'Nov 15, 2025', amount: '$212.00', status: 'Paid' },
              { date: 'Oct 15, 2025', amount: '$195.25', status: 'Paid' },
            ].map((invoice, idx) => (
              <View key={idx} style={styles.invoiceRow}>
                <View style={styles.invoiceInfo}>
                  <Text style={styles.invoiceDate}>{invoice.date}</Text>
                  <Text style={styles.invoiceStatus}>{invoice.status}</Text>
                </View>
                <Text style={styles.invoiceAmount}>{invoice.amount}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Upgrade Plan Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Want more?</Text>
          <View style={styles.upgradePromo}>
            <Text style={styles.upgradeTitle}>Upgrade to Business Plan</Text>
            <Text style={styles.upgradeDesc}>
              Unlimited campaigns, $1000/month spend included, and dedicated support
            </Text>
            <Text style={styles.upgradePrice}>$79/month</Text>
            <PrimaryButton label="Upgrade Now" onPress={() => console.log('TODO: Upgrade')} />
          </View>
        </View>

        {/* Support Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Questions?</Text>
          <Pressable style={styles.supportLink}>
            <Text style={styles.supportLinkText}>📧 Contact billing support</Text>
          </Pressable>
          <Pressable style={styles.supportLink}>
            <Text style={styles.supportLinkText}>📖 View billing FAQ</Text>
          </Pressable>
        </View>
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    back: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
    },
    title: {
      fontFamily: theme.fonts.heading,
      fontSize: 24,
      color: theme.colors.text,
    },
    spacer: {
      width: 40,
    },
    section: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    sectionSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.md,
    },
    planCard: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    planHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    planName: {
      fontFamily: theme.fonts.semibold,
      fontSize: 18,
      color: theme.colors.text,
    },
    planBadge: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
    },
    planBadgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 10,
      color: theme.colors.accentText,
    },
    planPrice: {
      marginBottom: theme.spacing.md,
    },
    currencySymbol: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    priceValue: {
      fontFamily: theme.fonts.heading,
      fontSize: 32,
      color: theme.colors.text,
    },
    pricePeriod: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    planFeatures: {
      gap: theme.spacing.xs,
    },
    feature: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.text,
    },
    nextBillingBox: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginTop: theme.spacing.md,
    },
    nextBillingLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    nextBillingDate: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginTop: theme.spacing.xs,
    },
    pricingModels: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    pricingModel: {
      flex: 1,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      alignItems: 'center',
    },
    pricingName: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    pricingDesc: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    pricingRate: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.accent,
      marginTop: theme.spacing.sm,
    },
    pricingNote: {
      fontFamily: theme.fonts.body,
      fontSize: 10,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.xs,
    },
    balanceBox: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
      alignItems: 'center',
    },
    balanceLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    balanceAmount: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.accent,
      marginTop: theme.spacing.xs,
    },
    balanceSubtext: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.xs,
    },
    sparklineContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: 60,
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.md,
    },
    sparklineBar: {
      flex: 1,
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.xs,
    },
    spendingStats: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      gap: theme.spacing.md,
    },
    statItem: {
      flex: 1,
      backgroundColor: theme.colors.background,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      alignItems: 'center',
    },
    statLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    statValue: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginTop: theme.spacing.xs,
    },
    invoiceList: {
      gap: theme.spacing.md,
    },
    invoiceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    invoiceInfo: {
      flex: 1,
    },
    invoiceDate: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    invoiceStatus: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: '#10b981',
      marginTop: theme.spacing.xs,
    },
    invoiceAmount: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
    },
    upgradePromo: {
      backgroundColor: theme.colors.accentDark,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
    },
    upgradeTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: '#fff',
      marginBottom: theme.spacing.xs,
    },
    upgradeDesc: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: 'rgba(255,255,255,0.9)',
      marginBottom: theme.spacing.md,
    },
    upgradePrice: {
      fontFamily: theme.fonts.semibold,
      fontSize: 18,
      color: '#fff',
      marginBottom: theme.spacing.md,
    },
    supportLink: {
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    supportLinkText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
    },
  });
