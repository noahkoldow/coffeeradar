import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = StackScreenProps<RootStackParamList, 'BusinessAudience'>;

export const BusinessAudienceScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const [targeting, setTargeting] = useState({
    byMood: true,
    byWeather: true,
    byLocation: true,
    byInterest: true,
    byTimeOfDay: true,
  });

  const [advancedOptions, setAdvancedOptions] = useState({
    newUsersOnly: false,
    highEngagementUsers: true,
    regularUsers: true,
  });

  const features = [
    {
      id: 'byMood',
      title: 'Target by Mood',
      description: 'Show your campaign when users are feeling relaxed, energetic, or social',
      icon: '😊',
      available: true,
    },
    {
      id: 'byWeather',
      title: 'Target by Weather',
      description: 'Display ads based on current weather conditions (sunny, rainy, cloudy)',
      icon: '🌤️',
      available: true,
    },
    {
      id: 'byLocation',
      title: 'Target by Location',
      description: 'Reach users within specific geographic areas and radius',
      icon: '📍',
      available: true,
    },
    {
      id: 'byInterest',
      title: 'Target by Interest',
      description: 'Focus on users interested in fitness, food, music, and more',
      icon: '🎯',
      available: true,
    },
    {
      id: 'byTimeOfDay',
      title: 'Target by Time of Day',
      description: 'Show campaigns during specific time windows or days',
      icon: '⏰',
      available: true,
    },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Audience Targeting</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Introduction */}
        <View style={styles.introSection}>
          <Text style={styles.introText}>
            Precisely target your ideal audience using multiple dimensions of targeting. Campaigns
            with specific targeting see 3x higher engagement on average.
          </Text>
        </View>

        {/* Targeting Features */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Targeting Dimensions</Text>
          {features.map((feature) => (
            <View key={feature.id} style={styles.featureCard}>
              <View style={styles.featureContent}>
                <View style={styles.featureIcon}>
                  <Text style={styles.featureIconText}>{feature.icon}</Text>
                </View>
                <View style={styles.featureInfo}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDescription}>{feature.description}</Text>
                </View>
              </View>
              {feature.available && (
                <Switch
                  value={targeting[feature.id as keyof typeof targeting]}
                  onValueChange={(value) =>
                    setTargeting({
                      ...targeting,
                      [feature.id]: value,
                    })
                  }
                  trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
                  thumbColor={theme.colors.card}
                />
              )}
              {!feature.available && (
                <Text style={styles.comingSoonBadge}>Coming Soon</Text>
              )}
            </View>
          ))}
        </View>

        {/* Advanced Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Segmentation</Text>
          <View style={styles.optionCard}>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>High Engagement Users</Text>
              <Text style={styles.optionDescription}>
                Users who actively engage with activity recommendations
              </Text>
            </View>
            <Switch
              value={advancedOptions.highEngagementUsers}
              onValueChange={(value) =>
                setAdvancedOptions({
                  ...advancedOptions,
                  highEngagementUsers: value,
                })
              }
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor={theme.colors.card}
            />
          </View>

          <View style={styles.optionCard}>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Regular Users</Text>
              <Text style={styles.optionDescription}>
                Users with consistent app usage patterns
              </Text>
            </View>
            <Switch
              value={advancedOptions.regularUsers}
              onValueChange={(value) =>
                setAdvancedOptions({
                  ...advancedOptions,
                  regularUsers: value,
                })
              }
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor={theme.colors.card}
            />
          </View>

          <View style={styles.optionCard}>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>New Users Only</Text>
              <Text style={styles.optionDescription}>
                Reach users who recently joined the platform
              </Text>
            </View>
            <Switch
              value={advancedOptions.newUsersOnly}
              onValueChange={(value) =>
                setAdvancedOptions({
                  ...advancedOptions,
                  newUsersOnly: value,
                })
              }
              trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
              thumbColor={theme.colors.card}
            />
          </View>
        </View>

        {/* Pro Tip */}
        <View style={styles.proTipCard}>
          <Text style={styles.proTipIcon}>💡</Text>
          <View style={styles.proTipContent}>
            <Text style={styles.proTipTitle}>Pro Tip</Text>
            <Text style={styles.proTipText}>
              Combine multiple targeting dimensions for better results. For example, target yoga
              enthusiasts in sunny weather during morning hours for your fitness class campaign.
            </Text>
          </View>
        </View>

        {/* CTA */}
        <Pressable onPress={() => navigation.goBack()} style={styles.doneButton}>
          <Text style={styles.doneButtonText}>Got it, close guide</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
};

export default BusinessAudienceScreen;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    backButton: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
      marginRight: theme.spacing.md,
    },
    headerTitle: {
      flex: 1,
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
    },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    introSection: {
      backgroundColor: theme.colors.accent + '15',
      borderRadius: 12,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      marginBottom: theme.spacing.xl,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.accent,
    },
    introText: {
      fontSize: 14,
      color: theme.colors.text,
      lineHeight: 20,
    },
    section: {
      marginBottom: theme.spacing.xl,
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    featureCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    featureContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginRight: theme.spacing.md,
    },
    featureIcon: {
      marginRight: theme.spacing.md,
    },
    featureIconText: {
      fontSize: 24,
    },
    featureInfo: {
      flex: 1,
    },
    featureTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    featureDescription: {
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 16,
    },
    comingSoonBadge: {
      fontSize: 10,
      color: theme.colors.textMuted,
      fontWeight: '600',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    optionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    optionContent: {
      flex: 1,
      marginRight: theme.spacing.md,
    },
    optionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    optionDescription: {
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    proTipCard: {
      flexDirection: 'row',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: '#FEF08A',
      borderRadius: 12,
      marginBottom: theme.spacing.xl,
      borderLeftWidth: 4,
      borderLeftColor: '#F59E0B',
    },
    proTipIcon: {
      fontSize: 24,
      marginRight: theme.spacing.md,
    },
    proTipContent: {
      flex: 1,
    },
    proTipTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: '#78350F',
      marginBottom: theme.spacing.xs,
    },
    proTipText: {
      fontSize: 12,
      color: '#A16207',
      lineHeight: 16,
    },
    doneButton: {
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    doneButtonText: {
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      fontWeight: '600',
    },
  });
