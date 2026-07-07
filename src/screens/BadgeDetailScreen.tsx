import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { BadgeRing } from '../components/BadgeRing';
import { BadgeIcon } from '../components/BadgeIcon';
import { badgeLevelThresholdMinutes, buildBadgeProgress, getBadgeById } from '../utils/badges';

type Props = StackScreenProps<RootStackParamList, 'BadgeDetail'>;

const progressBenefitCopy: Record<string, [string, string]> = {
  focus: [
    'Focus sessions train your brain to stay calm and clear when life gets noisy. They help you finish what you start and make studying or work feel less overwhelming.',
    'Every minute you invest here builds mental stamina, sharper decisions, and the confidence that you can handle complex tasks without burning out.',
  ],
  fitness: [
    'Fitness gives your body an energy reset and your mind a strong mood boost. Even short movement sessions can reduce stress and improve sleep quality.',
    'This progress means you are building strength, resilience, and daily momentum that carries into work, relationships, and overall confidence.',
  ],
  nature: [
    'Nature time helps your nervous system slow down and recover from daily pressure. Fresh air, sunlight, and green spaces can quickly improve mood and clarity.',
    'Each level shows that you are choosing grounding moments that reduce mental fatigue and bring you back feeling more balanced and present.',
  ],
  wellness: [
    'Wellness activities are your personal reset when stress starts to stack up. They help regulate emotions, lower tension, and improve how you feel in your body.',
    'This badge reflects a powerful habit: taking care of yourself before exhaustion hits, so your energy and focus stay stable over time.',
  ],
  social: [
    'Social connection protects mental health and reminds you that you do not have to do everything alone. Meaningful interactions can lower stress and lift motivation.',
    'Your progress here shows emotional courage: reaching out, showing up, and building relationships that make hard days easier to carry.',
  ],
  art: [
    'Art gives your mind a healthy break from pressure while helping you express feelings that are hard to say out loud. Creative flow can calm anxiety and improve mood.',
    'Each step here celebrates your imagination and your courage to create something new, which builds both joy and self-trust over time.',
  ],
  food: [
    'Food and coffee rituals can turn ordinary moments into meaningful recovery breaks. Preparing or sharing something good helps you slow down and reconnect with the present.',
    'This progress reflects a simple but powerful skill: creating small daily experiences that recharge your energy and make life feel richer.',
  ],
  habits: [
    'Habits are how small actions become real life change. Every completed streak proves you can stay consistent even when motivation is not at its peak.',
    'Building this badge means you are training discipline, identity, and momentum so positive behavior becomes automatic instead of effortful.',
  ],
};

export const BadgeDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state } = useAppState();
  const insets = useSafeAreaInsets();
  const { badgeId } = route.params;

  const badgeProgress = useMemo(
    () => buildBadgeProgress(state.activityLog, state.habits),
    [state.activityLog, state.habits],
  );

  const badge = badgeProgress.find((item) => item.id === badgeId);
  const fallback = getBadgeById(badgeId);

  if (!badge && !fallback) {
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
        <View style={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}> 
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.title}>Badge not found</Text>
          <Text style={styles.body}>This badge is missing.</Text>
        </View>
      </LinearGradient>
    );
  }

  const data = badge ?? {
    ...fallback!,
    count: 0,
    level: 0,
    progress: 0,
    currentTarget: 0,
    nextTarget: fallback?.levels?.length ? badgeLevelThresholdMinutes(fallback.levels)[0] : null,
  };

  const toNext = data.nextTarget ? Math.max(0, data.nextTarget - data.count) : 0;
  const progressPercent = Math.round((data.progress || 0) * 100);
  const benefitLines = progressBenefitCopy[data.id] ?? [
    'Building this badge helps you turn healthy choices into habits you can actually stick to.',
    'Over time, these activities improve your energy, focus, and confidence in your daily routine.',
  ];

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <View style={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.md }]}> 
        {/* ── Back Button ── */}
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        {/* ── Badge Hero Section ── */}
        <View style={[styles.heroSection, { backgroundColor: data.color + '15', borderColor: data.color + '30' }]}>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: data.color }]}>{data.title}</Text>
          </View>

          <View style={styles.badgeIconContainer}>
            <BadgeRing size={120} strokeWidth={10} progress={data.progress} level={data.level} color={data.color} showLevel />
          </View>

          <View style={styles.iconContainer}>
            <BadgeIcon badgeId={data.id} size={40} color={data.color} />
          </View>

          <Text style={styles.subtitle}>{data.description}</Text>
        </View>

        {/* ── Progress Section ── */}
        <View style={styles.section}>
          <View style={styles.progressHeader}>
            <Text style={styles.sectionTitle}>Progress</Text>
            <Text style={[styles.progressPercentage, { color: data.color }]}>
              {progressPercent}%
            </Text>
          </View>

          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${progressPercent}%`, backgroundColor: data.color }]} />
          </View>

          <View style={styles.progressStats}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{data.count}m</Text>
              <Text style={styles.statLabel}>Time spent</Text>
            </View>
            {data.nextTarget && (
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: data.color }]}>{toNext}m</Text>
                <Text style={styles.statLabel}>To next level</Text>
              </View>
            )}
          </View>

          <View style={[styles.benefitBox, { backgroundColor: data.color + '14', borderColor: data.color + '30' }]}>
            {benefitLines.map((line) => (
              <Text key={line} style={styles.benefitText}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* ── How to Earn ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎯 How to Earn</Text>
          <View style={styles.tagContainer}>
            {data.tags.map((tag, idx) => (
              <View key={idx} style={[styles.tag, { backgroundColor: data.color + '20', borderColor: data.color + '40' }]}>
                <Text style={[styles.tagText, { color: data.color }]}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
    padding: theme.spacing.md,
    justifyContent: 'space-between',
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
    marginBottom: theme.spacing.sm,
  },

  /* ── Hero Section ── */
  heroSection: {
    borderRadius: theme.radius.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
  },
  badgeIconContainer: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ── Progress Section ── */
  section: {
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 15,
    color: theme.colors.text,
  },
  
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercentage: {
    fontFamily: theme.fonts.heading,
    fontSize: 18,
  },
  progressBarContainer: {
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.backgroundAlt,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressStats: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  statBox: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
    color: theme.colors.text,
  },
  statLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  benefitBox: {
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: 6,
  },
  benefitText: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: theme.colors.text,
  },

  /* ── Tags Section ── */
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  tag: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
  },

  body: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    lineHeight: 20,
  },
});
