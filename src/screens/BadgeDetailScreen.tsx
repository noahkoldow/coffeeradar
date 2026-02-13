import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { BadgeRing } from '../components/BadgeRing';
import { buildBadgeProgress, getBadgeById } from '../utils/badges';

type Props = StackScreenProps<RootStackParamList, 'BadgeDetail'>;

export const BadgeDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state } = useAppState();
  const insets = useSafeAreaInsets();
  const { badgeId } = route.params;

  const badgeProgress = useMemo(
    () => buildBadgeProgress(state.activityLog),
    [state.activityLog],
  );

  const badge = badgeProgress.find((item) => item.id === badgeId);
  const fallback = getBadgeById(badgeId);

  if (!badge && !fallback) {
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.back}>Back</Text>
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

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <View style={styles.header}>
          <BadgeRing size={120} strokeWidth={10} progress={data.progress} level={data.level} color={data.color} />
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.subtitle}>{data.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Progress</Text>
          <Text style={styles.body}>Level {data.level}</Text>
          <Text style={styles.body}>{nextLabel}</Text>
          {data.nextTarget && <Text style={styles.body}>{toNext} to next level</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How to earn</Text>
          <Text style={styles.body}>
            Complete activities tagged: {data.tags.join(', ')}
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
  header: {
    marginTop: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 26,
    color: theme.colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  body: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
