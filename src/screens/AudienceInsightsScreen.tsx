import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

interface AudienceInsightsScreenProps extends StackScreenProps<RootStackParamList, 'Deck'> {
  campaignId?: string;
}

export const AudienceInsightsScreen: React.FC<AudienceInsightsScreenProps> = ({
  navigation,
  campaignId,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Load audience insights data
    setLoading(false);
  }, [campaignId]);

  if (loading) {
    return (
      <LinearGradient
        colors={[theme.colors.background, theme.colors.backgroundAlt]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.centerContent}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
        </View>
      </LinearGradient>
    );
  }

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
          <Text style={styles.title}>Audience Insights</Text>
          <View style={styles.spacer} />
        </View>

        {/* Overview Cards */}
        <View style={styles.cardsGrid}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Unique Users</Text>
            <Text style={styles.cardValue}>2,340</Text>
            <Text style={styles.cardChange}>+12% from last week</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Avg. Engagement</Text>
            <Text style={styles.cardValue}>4.2%</Text>
            <Text style={styles.cardChange}>+0.5% from last week</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Top Interest</Text>
            <Text style={styles.cardValue}>Fitness</Text>
            <Text style={styles.cardChange}>42% of audience</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Peak Activity</Text>
            <Text style={styles.cardValue}>10:00 AM</Text>
            <Text style={styles.cardChange}>Weekday mornings</Text>
          </View>
        </View>

        {/* Demographics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Demographics</Text>

          <View style={styles.demographicItem}>
            <Text style={styles.demographicLabel}>Age Groups</Text>
            <View style={styles.barChart}>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { width: '35%', backgroundColor: theme.colors.accent }]} />
                <Text style={styles.barLabel}>18-25 (35%)</Text>
              </View>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { width: '38%', backgroundColor: theme.colors.accentDark }]} />
                <Text style={styles.barLabel}>26-35 (38%)</Text>
              </View>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { width: '20%', backgroundColor: '#10b981' }]} />
                <Text style={styles.barLabel}>36-45 (20%)</Text>
              </View>
              <View style={styles.barWrapper}>
                <View style={[styles.bar, { width: '7%', backgroundColor: '#8b5cf6' }]} />
                <Text style={styles.barLabel}>46+ (7%)</Text>
              </View>
            </View>
          </View>

          <View style={styles.demographicItem}>
            <Text style={styles.demographicLabel}>Top Interests</Text>
            <View style={styles.interestsList}>
              <View style={styles.interestItem}>
                <Text style={styles.interestName}>🏋️ Fitness</Text>
                <Text style={styles.interestCount}>980 users</Text>
              </View>
              <View style={styles.interestItem}>
                <Text style={styles.interestName}>☕ Coffee</Text>
                <Text style={styles.interestCount}>742 users</Text>
              </View>
              <View style={styles.interestItem}>
                <Text style={styles.interestName}>🧘 Wellness</Text>
                <Text style={styles.interestCount}>654 users</Text>
              </View>
              <View style={styles.interestItem}>
                <Text style={styles.interestName}>🎨 Arts & Culture</Text>
                <Text style={styles.interestCount}>531 users</Text>
              </View>
              <View style={styles.interestItem}>
                <Text style={styles.interestName}>🍽️ Food</Text>
                <Text style={styles.interestCount}>428 users</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Engagement by Time */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Engagement by Time of Day</Text>
          <View style={styles.timelineChart}>
            {['12am', '6am', '10am', '2pm', '6pm', '10pm'].map((time, idx) => (
              <View key={time} style={styles.timelineItem}>
                <Text style={styles.timelineLabel}>{time}</Text>
                <View
                  style={[
                    styles.timelineBar,
                    { height: Math.random() * 80 + 20 },
                  ]}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Mood Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Moods</Text>
          <View style={styles.moodGrid}>
            {[
              { emoji: '😊', label: 'Relaxed', pct: 32 },
              { emoji: '⚡', label: 'Energetic', pct: 28 },
              { emoji: '🤝', label: 'Social', pct: 22 },
              { emoji: '🎯', label: 'Focused', pct: 18 },
            ].map((mood) => (
              <View key={mood.label} style={styles.moodItem}>
                <Text style={styles.moodEmoji}>{mood.emoji}</Text>
                <Text style={styles.moodLabel}>{mood.label}</Text>
                <Text style={styles.moodPercent}>{mood.pct}%</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Location Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Locations</Text>
          <View style={styles.locationList}>
            {[
              { city: 'Berlin', count: 412, pct: 18 },
              { city: 'Munich', count: 287, pct: 12 },
              { city: 'Hamburg', count: 203, pct: 9 },
              { city: 'Frankfurt', count: 156, pct: 7 },
              { city: 'Other', count: 1282, pct: 54 },
            ].map((loc) => (
              <View key={loc.city} style={styles.locationRow}>
                <View style={styles.locationInfo}>
                  <Text style={styles.locationCity}>{loc.city}</Text>
                  <Text style={styles.locationCount}>{loc.count} users</Text>
                </View>
                <Text style={styles.locationPercent}>{loc.pct}%</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Insights & Recommendations</Text>
          <Text style={styles.tip}>• Your peak engagement is 10-11 AM on weekdays</Text>
          <Text style={styles.tip}>• Fitness enthusiasts make up your core audience</Text>
          <Text style={styles.tip}>• Relaxed mood users engage 2.3x more</Text>
          <Text style={styles.tip}>• Consider targeting early birds (6-8 AM)</Text>
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
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    card: {
      flex: 1,
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      minWidth: '45%',
    },
    cardLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    cardValue: {
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: theme.colors.text,
      marginTop: theme.spacing.xs,
    },
    cardChange: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: '#10b981',
      marginTop: theme.spacing.xs,
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
    demographicItem: {
      marginBottom: theme.spacing.lg,
    },
    demographicLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    barChart: {
      gap: theme.spacing.sm,
    },
    barWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    bar: {
      height: 20,
      borderRadius: theme.radius.xs,
    },
    barLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    interestsList: {
      gap: theme.spacing.sm,
    },
    interestItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    interestName: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    interestCount: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    timelineChart: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'flex-end',
      height: 120,
      gap: theme.spacing.sm,
    },
    timelineItem: {
      alignItems: 'center',
      flex: 1,
    },
    timelineLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 10,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    timelineBar: {
      width: '100%',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.xs,
    },
    moodGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    moodItem: {
      alignItems: 'center',
      flex: 1,
    },
    moodEmoji: {
      fontSize: 28,
      marginBottom: theme.spacing.xs,
    },
    moodLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
      color: theme.colors.text,
    },
    moodPercent: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
      marginTop: theme.spacing.xs,
    },
    locationList: {
      gap: theme.spacing.sm,
    },
    locationRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    locationInfo: {
      flex: 1,
    },
    locationCity: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    locationCount: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.xs,
    },
    locationPercent: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.accent,
    },
    tipsSection: {
      backgroundColor: theme.colors.card,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
    },
    tipsTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    tip: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
    },
  });
