import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import {
  getCampaignsByBusiness,
  deleteCampaign,
  activateCampaign,
  pauseCampaign,
  endCampaign,
  submitCampaignForApproval,
} from '../services/business';
import { Campaign, CampaignStatus } from '../types/business';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = StackScreenProps<RootStackParamList, 'BusinessCampaignsList'>;

export const BusinessCampaignsListScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<CampaignStatus>('draft');
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
      setCampaigns(loaded.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (error) {
      Alert.alert('Error', 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (campaignId: string) => {
    Alert.alert('Delete Campaign', 'Are you sure you want to archive this campaign?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!businessId) return;
          try {
            await deleteCampaign(businessId, campaignId);
            setCampaigns((prev) => prev.filter((c) => c.id !== campaignId));
            Alert.alert('Success', 'Campaign archived successfully');
          } catch (error) {
            Alert.alert('Error', 'Failed to archive campaign');
          }
        },
      },
    ]);
  };

  const handleStatusChange = async (campaignId: string, newStatus: CampaignStatus) => {
    if (!businessId) return;

    try {
      if (newStatus === 'pending_approval') {
        await submitCampaignForApproval(businessId, campaignId);
      } else if (newStatus === 'active') {
        await activateCampaign(businessId, campaignId);
      } else if (newStatus === 'paused') {
        await pauseCampaign(businessId, campaignId);
      } else if (newStatus === 'ended') {
        await endCampaign(businessId, campaignId);
      }

      setCampaigns((prev) =>
        prev.map((c) => (c.id === campaignId ? { ...c, status: newStatus } : c))
      );
    } catch (error) {
      Alert.alert('Error', `Failed to ${newStatus} campaign`);
    }
  };

  const filteredCampaigns = campaigns.filter((c) => c.status === selectedTab);

  const getStatusColor = (status: CampaignStatus) => {
    const colors: Record<CampaignStatus, string> = {
      draft: '#94A3B8',
      pending_approval: '#F59E0B',
      approved: '#10B981',
      active: '#4F46E5',
      paused: '#6B7280',
      ended: '#94A3B8',
      rejected: '#EF4444',
      archived: '#9CA3AF',
    };
    return colors[status];
  };

  const renderCampaignItem = ({ item }: { item: Campaign }) => (
    <View style={[styles.campaignCard, { borderLeftColor: getStatusColor(item.status), borderLeftWidth: 4 }]}>
      <View style={styles.campaignHeader}>
        <View style={styles.campaignInfo}>
          <Text style={styles.campaignTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.campaignHook} numberOfLines={1}>
            {item.hook}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.replace('_', ' ')}
          </Text>
        </View>
      </View>

      {item.metrics && (
        <View style={styles.metrics}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Impressions</Text>
            <Text style={styles.metricValue}>{item.metrics.impressions.toLocaleString()}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Clicks</Text>
            <Text style={styles.metricValue}>{item.metrics.clicks.toLocaleString()}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>CTR</Text>
            <Text style={styles.metricValue}>{(item.metrics.ctr * 100).toFixed(1)}%</Text>
          </View>
        </View>
      )}

      <View style={styles.actions}>
        {item.status === 'draft' && (
          <>
            <Pressable
              onPress={() =>
                navigation.navigate('BusinessCampaignForm', { campaignId: item.id })
              }
              style={[styles.actionButton, styles.editButton]}
            >
              <Text style={styles.actionButtonText}>✏️ Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => handleStatusChange(item.id, 'pending_approval')}
              style={[styles.actionButton, styles.submitButton]}
            >
              <Text style={styles.actionButtonText}>📤 Submit</Text>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item.id)}
              style={[styles.actionButton, styles.deleteButton]}
            >
              <Text style={styles.actionButtonText}>🗑️ Delete</Text>
            </Pressable>
          </>
        )}
        {item.status === 'approved' && (
          <Pressable
            onPress={() => handleStatusChange(item.id, 'active')}
            style={[styles.actionButton, styles.activateButton]}
          >
            <Text style={styles.actionButtonText}>▶️ Activate</Text>
          </Pressable>
        )}
        {item.status === 'active' && (
          <Pressable
            onPress={() => handleStatusChange(item.id, 'paused')}
            style={[styles.actionButton, styles.pauseButton]}
          >
            <Text style={styles.actionButtonText}>⏸️ Pause</Text>
          </Pressable>
        )}
        {item.status === 'paused' && (
          <Pressable
            onPress={() => handleStatusChange(item.id, 'active')}
            style={[styles.actionButton, styles.activateButton]}
          >
            <Text style={styles.actionButtonText}>▶️ Resume</Text>
          </Pressable>
        )}
        {(item.status === 'active' || item.status === 'paused') && (
          <Pressable
            onPress={() => handleStatusChange(item.id, 'ended')}
            style={[styles.actionButton, styles.endButton]}
          >
            <Text style={styles.actionButtonText}>🏁 End</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const tabs: CampaignStatus[] = ['draft', 'pending_approval', 'active', 'paused', 'ended'];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Manage Campaigns</Text>
        <Pressable onPress={() => navigation.navigate('BusinessCampaignForm')}>
          <Text style={styles.createButton}>+ New</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {tabs.map((tab) => {
          const count = campaigns.filter((c) => c.status === tab).length;
          return (
            <Pressable
              key={tab}
              onPress={() => setSelectedTab(tab)}
              style={[styles.tab, selectedTab === tab && styles.tabActive]}
            >
              <Text
                style={[styles.tabText, selectedTab === tab && styles.tabTextActive]}
              >
                {tab.replace('_', ' ')} {count > 0 ? `(${count})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.accent} size="large" />
        </View>
      ) : filteredCampaigns.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No campaigns</Text>
          <Text style={styles.emptyText}>
            {selectedTab === 'draft'
              ? 'Create your first campaign to get started'
              : `No ${selectedTab.replace('_', ' ')} campaigns yet`}
          </Text>
          {selectedTab === 'draft' && (
            <Pressable
              onPress={() => navigation.navigate('BusinessCampaignForm')}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Create Campaign</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredCampaigns}
          renderItem={renderCampaignItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          scrollEnabled={false}
        />
      )}
    </View>
  );
};

export default BusinessCampaignsListScreen;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    backButton: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    headerTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
    },
    createButton: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    tabs: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    tab: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      marginRight: theme.spacing.sm,
    },
    tabActive: {
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.accent,
    },
    tabText: {
      fontSize: 12,
      color: theme.colors.textMuted,
      fontWeight: '500',
    },
    tabTextActive: {
      color: theme.colors.accent,
      fontWeight: '600',
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
      marginBottom: theme.spacing.lg,
    },
    emptyButton: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.accent,
      borderRadius: 8,
    },
    emptyButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    listContent: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    campaignCard: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      backgroundColor: theme.colors.card,
      borderRadius: 14,
      marginBottom: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    campaignHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.sm,
    },
    campaignInfo: {
      flex: 1,
      marginRight: theme.spacing.md,
    },
    campaignTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    campaignHook: {
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    statusBadge: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      borderRadius: 6,
    },
    statusText: {
      fontSize: 10,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    metrics: {
      flexDirection: 'row',
      paddingVertical: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      marginBottom: theme.spacing.sm,
    },
    metricItem: {
      flex: 1,
      alignItems: 'center',
    },
    metricLabel: {
      fontSize: 10,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    metricValue: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.accent,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      flexWrap: 'wrap',
    },
    actionButton: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      borderRadius: 6,
      marginRight: theme.spacing.xs,
    },
    editButton: {
      backgroundColor: '#3B82F6' + '20',
    },
    submitButton: {
      backgroundColor: '#8B5CF6' + '20',
    },
    deleteButton: {
      backgroundColor: '#EF4444' + '20',
    },
    activateButton: {
      backgroundColor: '#10B981' + '20',
    },
    pauseButton: {
      backgroundColor: '#F59E0B' + '20',
    },
    endButton: {
      backgroundColor: '#6B7280' + '20',
    },
    actionButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.text,
    },
  });
