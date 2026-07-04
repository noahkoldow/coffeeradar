import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { BadgeRing } from '../components/BadgeRing';
import { BadgeIcon } from '../components/BadgeIcon';
import { buildBadgeProgress, getBadgeById } from '../utils/badges';

type Props = StackScreenProps<RootStackParamList, 'BadgeDetail'>;

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
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>← Back</Text>
          </Pressable>
          <Text style={styles.title}>Badge not found</Text>
          <Text style={styles.body}>This badge is missing.</Text>
        </ScrollView>
      </LinearGradient>
    );
  }

  const data = badge ?? {
    ...fallback!,
    count: 0,
    level: 0,
    progress: 0,
    currentTarget: 0,
    nextTarget: fallback?.levels?.[0] ?? null,
  };

  const nextLabel = data.nextTarget ? `${data.count}/${data.nextTarget}` : `${data.count} total`;
  const toNext = data.nextTarget ? Math.max(0, data.nextTarget - data.count) : 0;
  const progressPercent = Math.round((data.progress || 0) * 100);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        {/* ── Back Button ── */}
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>

        {/* ── Badge Hero Section ── */}
        <View style={[styles.heroSection, { backgroundColor: data.color + '15', borderColor: data.color + '30' }]}>
          <View style={styles.badgeIconContainer}>
            <BadgeRing size={140} strokeWidth={12} progress={data.progress} level={data.level} color={data.color} showLevel />
          </View>

          <View style={styles.titleContainer}>
            <BadgeIcon badgeId={data.id} size={48} color={data.color} />
            <Text style={[styles.title, { color: data.color }]}>{data.title}</Text>
          </View>
          <Text style={styles.subtitle}>{data.description}</Text>

          <View style={styles.levelBadge}>
            <Text style={[styles.levelText, { color: data.color }]}>
              🏆 Level {data.level}
            </Text>
          </View>
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
              <Text style={styles.statValue}>{data.count}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            {data.nextTarget && (
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: data.color }]}>{toNext}</Text>
                <Text style={styles.statLabel}>To next level</Text>
              </View>
            )}
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

        {/* ── Milestone Info ── */}
        {data.nextTarget && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Next Milestone</Text>
            <View style={styles.milestoneBox}>
              <Text style={[styles.milestoneNumber, { color: data.color }]}>
                {data.nextTarget}
              </Text>
              <Text style={styles.milestoneText}>Complete {toNext} more to reach the next level</Text>
            </View>
          </View>
        )}

        {/* ── Encouragement ── */}
        <View style={[styles.section, { backgroundColor: data.color + '10', borderColor: data.color + '20' }]}>
          <Text style={[styles.encouragementText, { color: data.color }]}>
            ✨ Keep going! Every activity brings you closer to leveling up.
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
    paddingBottom: theme.spacing.xxl,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
    marginBottom: theme.spacing.lg,
  },

  /* ── Hero Section ── */
  heroSection: {
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    borderWidth: 1,
  },
  badgeIconContainer: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 26,
    flex: 1,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  levelBadge: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accentSoft,
  },
  levelText: {
    fontFamily: theme.fonts.heading,
    fontSize: 16,
  },

  /* ── Progress Section ── */
  section: {
    marginBottom: theme.spacing.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 16,
    color: theme.colors.text,
  },
  
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercentage: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
  },
  progressBarContainer: {
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.backgroundAlt,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 6,
  },
  progressStats: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  statBox: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    color: theme.colors.text,
  },
  statLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 4,
  },

  /* ── Tags Section ── */
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  tag: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
  },
  tagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },

  /* ── Milestone Section ── */
  milestoneBox: {
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  milestoneNumber: {
    fontFamily: theme.fonts.heading,
    fontSize: 32,
  },
  milestoneText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },

  /* ── Encouragement ── */
  encouragementText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    textAlign: 'center',
  },

  body: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    lineHeight: 20,
  },
});
