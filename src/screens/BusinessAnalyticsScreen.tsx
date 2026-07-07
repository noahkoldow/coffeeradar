import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { getCampaignsByBusiness } from '../services/business';
import { Campaign } from '../types/business';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = StackScreenProps<RootStackParamList, 'BusinessAnalytics'>;

export const BusinessAnalyticsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const businessId = state.userId ?? state.businessProfile?.ownerId ?? state.businessProfile?.id;

  useFocusEffect(
    React.useCallback(() => {
      loadCampaigns();
    }, [businessId])
  );

  const loadCampaigns = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const loaded = await getCampaignsByBusiness(businessId);
      setCampaigns(
        loaded
          .filter((c) => c.status === 'active' || c.status === 'paused' || c.status === 'ended')
          .sort((a, b) => (b.metrics?.impressions || 0) - (a.metrics?.impressions || 0))
      );
      if (loaded.length > 0) {
        setSelectedCampaignId(loaded[0].id);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId);
  const metrics = selectedCampaign?.metrics;

  interface TotalMetrics {
    impressions: number;
    clicks: number;
    engagements: number;
    conversions: number;
    uniqueUsers: number;
  }

  const totalMetrics: TotalMetrics = campaigns.reduce<TotalMetrics>(
    (acc, c) => ({
      impressions: (acc.impressions || 0) + (c.metrics?.impressions || 0),
      clicks: (acc.clicks || 0) + (c.metrics?.clicks || 0),
      engagements: (acc.engagements || 0) + (c.metrics?.engagements || 0),
      conversions: (acc.conversions || 0) + (c.metrics?.conversions || 0),
      uniqueUsers: (acc.uniqueUsers || 0) + (c.metrics?.uniqueUsers || 0),
    }),
    {
      impressions: 0,
      clicks: 0,
      engagements: 0,
      conversions: 0,
      uniqueUsers: 0,
    }
  );

  const avgCTR = (totalMetrics.clicks || 0) / (totalMetrics.impressions || 1);
  const avgConversionRate = (totalMetrics.conversions || 0) / (totalMetrics.clicks || 1);

  const MetricCard = ({
    label,
    value,
    icon,
  }: {
    label: string;
    value: string | number;
    icon: string;
  }) => (
    <View style={styles.metricCard}>
      <View style={styles.metricIconContainer}>
        <Text style={styles.metricIcon}>{icon}</Text>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value.toLocaleString?.() || value}</Text>
    </View>
  );

  const renderCampaignMetric = ({ item }: { item: Campaign }) => (
    <Pressable
      onPress={() => setSelectedCampaignId(item.id)}
      style={[
        styles.campaignMetricItem,
        selectedCampaignId === item.id && styles.campaignMetricItemActive,
      ]}
    >
      <Text style={styles.campaignMetricTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <View style={styles.campaignMetricStats}>
        <Text style={styles.campaignMetricStat}>
          👁️ {(item.metrics?.impressions || 0).toLocaleString()}
        </Text>
        <Text style={styles.campaignMetricStat}>
          👆 {(item.metrics?.clicks || 0).toLocaleString()}
        </Text>
        <Text style={styles.campaignMetricStat}>
          ✨ {((item.metrics?.ctr || 0) * 100).toFixed(1)}%
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Analytics</Text>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
        </View>
      ) : campaigns.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={styles.emptyTitle}>No Active Campaigns</Text>
          <Text style={styles.emptyText}>
            Create and activate a campaign to see analytics data
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Overall Stats */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Overall Performance</Text>
            <View style={styles.metricsGrid}>
              <MetricCard
                label="Total Impressions"
                value={totalMetrics.impressions || 0}
                icon="👁️"
              />
              <MetricCard
                label="Total Clicks"
                value={totalMetrics.clicks || 0}
                icon="👆"
              />
              <MetricCard
                label="Avg Click Rate"
                value={`${(avgCTR * 100).toFixed(1)}%`}
                icon="📈"
              />
              <MetricCard
                label="Total Users"
                value={totalMetrics.uniqueUsers || 0}
                icon="👥"
              />
              <MetricCard
                label="Conversions"
                value={totalMetrics.conversions || 0}
                icon="✨"
              />
              <MetricCard
                label="Conversion Rate"
                value={`${(avgConversionRate * 100).toFixed(1)}%`}
                icon="🎯"
              />
            </View>
          </View>

          {/* Campaign Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>By Campaign</Text>
            <FlatList
              data={campaigns}
              renderItem={renderCampaignMetric}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
            />
          </View>

          {/* Selected Campaign Details */}
          {selectedCampaign && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Detailed Metrics: {selectedCampaign.title}</Text>

              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Impressions</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.impressions || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Clicks</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.clicks || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Click-Through Rate (CTR)</Text>
                  <Text style={styles.detailValue}>
                    {((metrics?.ctr || 0) * 100).toFixed(2)}%
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Engagements</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.engagements || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Activity Starts</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.activityStarts || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Calendar Adds</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.calendarAdds || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Conversions</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.conversions || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Unique Users</Text>
                  <Text style={styles.detailValue}>
                    {(metrics?.uniqueUsers || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.detailRow, styles.detailRowLast]}>
                  <Text style={styles.detailLabel}>Conversion Rate</Text>
                  <Text style={styles.detailValue}>
                    {((metrics?.conversionRate || 0) * 100).toFixed(2)}%
                  </Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
};

export default BusinessAnalyticsScreen;

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
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    emptyIcon: {
      fontSize: 48,
      marginBottom: theme.spacing.md,
    },
    emptyTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
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
    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    metricCard: {
      width: '48%',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
    },
    metricIconContainer: {
      marginBottom: theme.spacing.sm,
    },
    metricIcon: {
      fontSize: 24,
    },
    metricLabel: {
      fontSize: 11,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
      textAlign: 'center',
    },
    metricValue: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.accent,
      fontWeight: '700',
    },
    campaignMetricItem: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    campaignMetricItemActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accent + '10',
    },
    campaignMetricTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    campaignMetricStats: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    campaignMetricStat: {
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    detailCard: {
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    detailRowLast: {
      borderBottomWidth: 0,
    },
    detailLabel: {
      fontSize: 13,
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.body,
    },
    detailValue: {
      fontSize: 14,
      color: theme.colors.accent,
      fontFamily: theme.fonts.semibold,
      fontWeight: '600',
    },
  });
