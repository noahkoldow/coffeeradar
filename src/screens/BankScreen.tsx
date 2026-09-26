import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { RootStackParamList } from '../navigation/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { SwipeBattery } from '../components/SwipeBattery';

type Props = StackScreenProps<RootStackParamList, 'Bank'>;

const RECHARGE_INTERVAL_MS = 10 * 60 * 1000;

export const BankScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const isFocused = useIsFocused();
  const { state } = useAppState();
  const [now, setNow] = useState(Date.now);
  const [limitsExpanded, setLimitsExpanded] = useState(false);
  const current = state.swipeBank?.current ?? 0;
  const max = state.swipeBank?.max ?? 20;
  const fullyCharged = current >= max;
  const compact = (height - insets.top - insets.bottom) / fontScale < 650;

  useEffect(() => {
    if (fullyCharged || !isFocused) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [fullyCharged, isFocused, state.swipeBankLastUpdated]);

  const secondsRemaining = Math.ceil(Math.max(0, RECHARGE_INTERVAL_MS - Math.max(0, now - state.swipeBankLastUpdated)) / 1000);
  const timeUntilCredit = `${Math.floor(secondsRemaining / 60)}m ${String(secondsRemaining % 60).padStart(2, '0')}s`;

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + (compact ? theme.spacing.md : theme.spacing.lg), paddingBottom: insets.bottom + theme.spacing.md },
        ]}
      >
        <Text accessibilityRole="header" style={styles.title}>Swipe bank</Text>

        <View style={[styles.balance, compact && styles.balanceCompact]}>
          <SwipeBattery current={current} max={max} active={isFocused} compact={compact} />
          <Text style={[styles.balanceValue, compact && styles.balanceValueCompact]}>
            {current}<Text style={styles.balanceMax}> / {max}</Text>
          </Text>
          <Text style={styles.balanceLabel}>swipes available</Text>

          <View style={styles.rechargeStatus}>
            <View style={[styles.statusDot, fullyCharged && styles.statusDotFull]} />
            <Text style={styles.rechargeText}>
              {fullyCharged ? 'Fully charged' : secondsRemaining === 0 ? 'Adding your next swipe…' : `Next swipe in ${timeUntilCredit}`}
            </Text>
          </View>
          <Text style={styles.rechargeHint}>
            {fullyCharged ? 'Ready when you are.' : '1 swipe recharges every 10 minutes.'}
          </Text>
        </View>

        <View style={styles.limits}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: limitsExpanded }}
            aria-expanded={limitsExpanded}
            onPress={() => setLimitsExpanded((expanded) => !expanded)}
            style={({ pressed }) => [styles.limitsToggle, pressed && styles.pressed]}
          >
            <Text style={styles.limitsTitle}>Why limits?</Text>
            <Svg width={20} height={20} viewBox="0 0 20 20" accessible={false}>
              <Path
                d={limitsExpanded ? 'M5 12.5 10 7.5 15 12.5' : 'M5 7.5 10 12.5 15 7.5'}
                stroke={theme.colors.textMuted}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
          {limitsExpanded && (
            <Text style={styles.limitsText}>
              Limits help you choose an activity and turn a good idea into a real experience, instead of endlessly swiping.
            </Text>
          )}
        </View>

        <View style={styles.footer}>
          <PrimaryButton label="Back" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  title: {
    fontFamily: theme.fonts.semibold,
    fontSize: 28,
    color: theme.colors.text,
  },
  balance: {
    alignItems: 'center',
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  balanceCompact: { paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md },
  balanceValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 48,
    color: theme.colors.text,
    fontVariant: ['tabular-nums'],
  },
  balanceValueCompact: { fontSize: 38 },
  balanceMax: { fontFamily: theme.fonts.body, fontSize: 22, color: theme.colors.textMuted },
  balanceLabel: { fontFamily: theme.fonts.body, fontSize: 14, color: theme.colors.textMuted },
  rechargeStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: theme.spacing.md,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  statusDotFull: { backgroundColor: theme.colors.success },
  rechargeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  rechargeHint: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
    textAlign: 'center',
  },
  limits: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.border },
  limitsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  pressed: { opacity: 0.65 },
  limitsTitle: { fontFamily: theme.fonts.semibold, fontSize: 15, color: theme.colors.text },
  limitsText: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.textMuted,
    paddingBottom: theme.spacing.md,
  },
  footer: { marginTop: 'auto', paddingTop: theme.spacing.md },
});

export default BankScreen;
