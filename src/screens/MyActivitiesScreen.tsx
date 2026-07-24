import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { firebaseEnabled } from '../services/firebase';
import { loadMyCommunityIdeas } from '../services/communityIdeas';
import { CommunityIdeaSubmission } from '../types';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'MyActivities'>;

const getCompletions = (idea: CommunityIdeaSubmission): number =>
  Math.max(0, Math.floor(idea.completionCount ?? 0));

const getHelpMinutes = (idea: CommunityIdeaSubmission): number => {
  if (Number.isFinite(idea.helpMinutes)) {
    return Math.max(0, Math.round(idea.helpMinutes as number));
  }
  return getCompletions(idea) * (idea.durationMin ?? 0);
};

const formatMinutes = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export const MyActivitiesScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const isGerman = language === 'de';
  const insets = useSafeAreaInsets();
  const [ideas, setIdeas] = useState<CommunityIdeaSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const statusLabel: Record<CommunityIdeaSubmission['status'], string> = isGerman
    ? { pending: 'In Prufung', approved: 'Live', rejected: 'Nicht freigegeben' }
    : { pending: 'In review', approved: 'Live', rejected: 'Not approved' };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      loadMyCommunityIdeas()
        .then((items) => {
          if (active) setIdeas(items);
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const totals = useMemo(() => {
    return ideas.reduce(
      (acc, idea) => {
        acc.people += getCompletions(idea);
        acc.minutes += getHelpMinutes(idea);
        return acc;
      },
      { people: 0, minutes: 0 },
    );
  }, [ideas]);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{isGerman ? 'Zuruck' : 'Back'}</Text>
        </Pressable>

        <Text style={styles.title}>{isGerman ? 'Meine Aktivitaten' : 'My activities'}</Text>
        <Text style={styles.subtitle}>{isGerman ? 'Von dir eingereichte Aktivitaten und ihre Wirkung.' : 'Activities you submitted and the impact they had.'}</Text>

        {!firebaseEnabled && (
          <View style={styles.section}>
            <Text style={styles.rowText}>{isGerman ? 'Firebase-Konfiguration fehlt. Melde dich an, um deine eingereichten Aktivitaten zu sehen.' : 'Firebase config missing. Sign in to see your submitted activities.'}</Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{ideas.length}</Text>
            <Text style={styles.statLabel}>{isGerman ? 'Eingereicht' : 'Submitted'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totals.people}</Text>
            <Text style={styles.statLabel}>{isGerman ? 'Haben es gemacht' : 'People did it'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatMinutes(totals.minutes)}</Text>
            <Text style={styles.statLabel}>{isGerman ? 'Anderen geholfen' : 'Helped others'}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : ideas.length === 0 ? (
          <View style={styles.section}>
            <Text style={styles.emptyTitle}>{isGerman ? 'Noch keine Aktivitaten' : 'No activities yet'}</Text>
            <Text style={styles.rowText}>
              {isGerman
                ? 'Teile eine Aktivitatsidee mit der Community. Wenn Leute sie machen, siehst du, wie viele mitgemacht haben und wie viel Zeit du bereichert hast.'
                : 'Share an activity idea with the community. When people do it, you\'ll see how many joined and how much time you helped them enjoy.'}
            </Text>
            <PrimaryButton label={isGerman ? 'Aktivitat einreichen' : 'Submit an activity'} onPress={() => navigation.navigate('CommunityIdeaForm')} />
          </View>
        ) : (
          <View style={styles.list}>
            {ideas.map((idea) => {
              const completions = getCompletions(idea);
              const minutes = getHelpMinutes(idea);
              return (
                <View key={idea.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {idea.title}
                    </Text>
                    <View
                      style={[
                        styles.statusPill,
                        idea.status === 'approved' && styles.statusApproved,
                        idea.status === 'rejected' && styles.statusRejected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          idea.status === 'approved' && styles.statusTextApproved,
                          idea.status === 'rejected' && styles.statusTextRejected,
                        ]}
                      >
                        {statusLabel[idea.status]}
                      </Text>
                    </View>
                  </View>

                  {!!idea.hook && (
                    <Text style={styles.cardHook} numberOfLines={2}>
                      {idea.hook}
                    </Text>
                  )}

                  <View style={styles.cardStatsRow}>
                    <View style={styles.cardStat}>
                      <Text style={styles.cardStatValue}>{completions}</Text>
                      <Text style={styles.cardStatLabel}>{isGerman ? 'haben es gemacht' : 'people did it'}</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Text style={styles.cardStatValue}>{formatMinutes(minutes)}</Text>
                      <Text style={styles.cardStatLabel}>{isGerman ? 'anderen geholfen' : 'helped others'}</Text>
                    </View>
                    <View style={styles.cardStat}>
                      <Text style={styles.cardStatValue}>{idea.durationMin} min</Text>
                      <Text style={styles.cardStatLabel}>{isGerman ? 'jeweils' : 'each'}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
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
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  statCard: {
    flex: 1,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
    color: theme.colors.text,
  },
  statLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  loadingBox: {
    marginTop: theme.spacing.xl,
    alignItems: 'center',
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  emptyTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  rowText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  list: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  card: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  statusPill: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accentDim,
  },
  statusApproved: {
    backgroundColor: theme.colors.success,
  },
  statusRejected: {
    backgroundColor: theme.colors.accentDim,
  },
  statusText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.accentDark,
  },
  statusTextApproved: {
    color: theme.colors.successText,
  },
  statusTextRejected: {
    color: theme.colors.danger,
  },
  cardHook: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  cardStatsRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: 4,
  },
  cardStat: {
    gap: 2,
  },
  cardStatValue: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
    color: theme.colors.text,
  },
  cardStatLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
});
