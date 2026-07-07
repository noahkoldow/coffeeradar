import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import { getCampaigns } from '../services/campaigns';
import { Campaign, CampaignStatus } from '../types/business';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

const STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: '#84cc16',
  pending_approval: '#f59e0b',
  approved: '#10b981',
  active: '#06b6d4',
  paused: '#8b5cf6',
  ended: '#6b7280',
  rejected: '#ef4444',
};

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  rejected: 'Rejected',
};

export const CampaignListScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<CampaignStatus | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const loadCampaigns = async () => {
    if (!state.businessProfile) {
      setLoading(false);
      return;
    }

    try {
      const data = await getCampaigns(state.businessProfile.id);
      setCampaigns(data);
    } catch (error) {
      console.error('Error loading campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [state.businessProfile]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadCampaigns();
    setRefreshing(false);
  };

  const filteredCampaigns = useMemo(() => {
    if (selectedStatus === 'all') return campaigns;
    return campaigns.filter((c) => c.status === selectedStatus);
  }, [campaigns, selectedStatus]);

  const renderCampaignCard = ({ item }: { item: Campaign }) => {
    const metrics = item.metrics || {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      ctr: 0,
      conversionRate: 0,
      engagements: 0,
      activityStarts: 0,
      calendarAdds: 0,
      uniqueUsers: 0,
      lastUpdated: '',
    };

    return (
      <Pressable
        onPress={() => {
          // Navigate to campaign details
          console.log('TODO: Navigate to campaign details');
        }}
        style={styles.campaignCard}
      >
        <View style={styles.cardHeader}>
          <View style={styles.titleSection}>
            <Text style={styles.campaignTitle}>{item.title}</Text>
            <Text style={styles.campaignHook}>{item.hook}</Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: STATUS_COLORS[item.status] },
            ]}
          >
            <Text style={styles.statusText}>{STATUS_LABELS[item.status]}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Impressions</Text>
            <Text style={styles.metricValue}>
              {metrics.impressions?.toLocaleString()}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Clicks</Text>
            <Text style={styles.metricValue}>
              {metrics.clicks?.toLocaleString()}
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>CTR</Text>
            <Text style={styles.metricValue}>
              {(metrics.ctr * 100).toFixed(2)}%
            </Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Conversions</Text>
            <Text style={styles.metricValue}>
              {metrics.conversions?.toLocaleString()}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.dateText}>
            {new Date(item.createdAt).toLocaleDateString()}
          </Text>
          <Text style={styles.arrowText}>→</Text>
        </View>
      </Pressable>
    );
  };

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
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Campaigns</Text>
        <View style={styles.spacer} />
      </View>

      {/* Status Filter */}
      <View style={styles.filterSection}>
        <Pressable
          onPress={() => setSelectedStatus('all')}
          style={[
            styles.filterButton,
            selectedStatus === 'all' && styles.filterButtonActive,
          ]}
        >
          <Text
            style={[
              styles.filterText,
              selectedStatus === 'all' && styles.filterTextActive,
            ]}
          >
            All
          </Text>
        </Pressable>
        {(['draft', 'pending_approval', 'active', 'paused'] as CampaignStatus[]).map(
          (status) => (
            <Pressable
              key={status}
              onPress={() => setSelectedStatus(status)}
              style={[
                styles.filterButton,
                selectedStatus === status && styles.filterButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  selectedStatus === status && styles.filterTextActive,
                ]}
              >
                {STATUS_LABELS[status]}
              </Text>
            </Pressable>
          )
        )}
      </View>

      {/* Campaigns List */}
      {filteredCampaigns.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No campaigns yet</Text>
          <Text style={styles.emptySubtitle}>
            Create your first campaign to get started
          </Text>
          <PrimaryButton
            label="Create Campaign"
            onPress={() => {
              // Navigate to campaign creation
              console.log('TODO: Navigate to campaign creation');
            }}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <FlatList
          data={filteredCampaigns}
          renderItem={renderCampaignCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Create Campaign Button */}
      {filteredCampaigns.length > 0 && (
        <View style={styles.createButtonContainer}>
          <PrimaryButton
            label="+ Create Campaign"
            onPress={() => {
              // Navigate to campaign creation
              console.log('TODO: Navigate to campaign creation');
            }}
          />
        </View>
      )}
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
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
    filterSection: {
      flexDirection: 'row',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
      overflow: 'hidden',
    },
    filterButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.card,
    },
    filterButtonActive: {
      backgroundColor: theme.colors.accent,
    },
    filterText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    filterTextActive: {
      color: theme.colors.accentText,
    },
    listContent: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.md,
    },
    campaignCard: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    titleSection: {
      flex: 1,
      marginRight: theme.spacing.md,
    },
    campaignTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
    },
    campaignHook: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.xs,
    },
    statusBadge: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radius.full,
    },
    statusText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
      color: '#fff',
    },
    metricsRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      justifyContent: 'space-between',
    },
    metricItem: {
      flex: 1,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
      alignItems: 'center',
    },
    metricLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 10,
      color: theme.colors.textMuted,
    },
    metricValue: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      marginTop: theme.spacing.xs,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    dateText: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    arrowText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
    },
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    emptyTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    emptySubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginBottom: theme.spacing.lg,
    },
    emptyButton: {
      marginTop: theme.spacing.lg,
    },
    createButtonContainer: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
  });
