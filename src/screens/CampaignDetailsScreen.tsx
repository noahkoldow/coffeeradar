import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Image,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import { getCampaign, pauseCampaign, resumeCampaign, endCampaign } from '../services/campaigns';
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

interface DetailScreenProps extends StackScreenProps<RootStackParamList, 'Deck'> {
  campaignId: string;
}

export const CampaignDetailsScreen: React.FC<DetailScreenProps> = ({
  navigation,
  campaignId,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const { state } = useAppState();
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [mediaLayout, setMediaLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const loadCampaign = async () => {
      try {
        const data = await getCampaign(campaignId);
        setCampaign(data);
      } catch (error) {
        console.error('Error loading campaign:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCampaign();
  }, [campaignId]);

  useEffect(() => {
    if (!campaign?.media?.[0]?.url) return;
    const uri = campaign.media[0].url;
    Image.getSize(uri, (w, h) => setImgNaturalSize({ width: w, height: h }), () => {});
  }, [campaign?.media?.[0]?.url]);

  const handlePause = async () => {
    if (!campaign) return;
    setUpdating(true);
    try {
      await pauseCampaign(campaign.id);
      setCampaign({ ...campaign, status: 'paused' });
    } catch (error) {
      console.error('Error pausing campaign:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleResume = async () => {
    if (!campaign) return;
    setUpdating(true);
    try {
      await resumeCampaign(campaign.id);
      setCampaign({ ...campaign, status: 'active' });
    } catch (error) {
      console.error('Error resuming campaign:', error);
    } finally {
      setUpdating(false);
    }
  };

  const handleEnd = async () => {
    if (!campaign) return;
    setUpdating(true);
    try {
      await endCampaign(campaign.id);
      setCampaign({ ...campaign, status: 'ended' });
    } catch (error) {
      console.error('Error ending campaign:', error);
    } finally {
      setUpdating(false);
    }
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

  if (!campaign) {
    return (
      <LinearGradient
        colors={[theme.colors.background, theme.colors.backgroundAlt]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>Campaign not found</Text>
        </View>
      </LinearGradient>
    );
  }

  const metrics = campaign.metrics || {
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
          <View style={styles.headerSpacer} />
        </View>

        {/* Media Preview */}
        {campaign.media?.[0]?.url ? (
          <View
            style={styles.mediaPreview}
            onLayout={(e) => setMediaLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          >
            {(() => {
              const media = campaign.media![0];
              const focalX = media.focalX ?? 0.5;
              const focalY = media.focalY ?? 0.5;
              if (!imgNaturalSize || mediaLayout.width === 0) {
                return <Image source={{ uri: media.url }} style={styles.mediaFull} />;
              }

              const iw = imgNaturalSize.width;
              const ih = imgNaturalSize.height;
              const cw = mediaLayout.width;
              const ch = mediaLayout.height;
              const scale = Math.max(cw / iw, ch / ih);
              const sw = iw * scale;
              const sh = ih * scale;

              const desiredCenterX = focalX * sw;
              const desiredCenterY = focalY * sh;
              let translateX = Math.round(cw / 2 - desiredCenterX);
              let translateY = Math.round(ch / 2 - desiredCenterY);

              const maxOffsetX = Math.max(0, sw - cw);
              const maxOffsetY = Math.max(0, sh - ch);
              translateX = Math.max(-maxOffsetX, Math.min(0, translateX));
              translateY = Math.max(-maxOffsetY, Math.min(0, translateY));

              return (
                <Image
                  source={{ uri: media.url }}
                  style={{ position: 'absolute', width: sw, height: sh, left: translateX, top: translateY }}
                />
              );
            })()}
          </View>
        ) : null}

        {/* Title & Status */}
        <View style={styles.titleSection}>
          <View style={styles.titleRow}>
            <View style={styles.titleContent}>
              <Text style={styles.title}>{campaign.title}</Text>
              <Text style={styles.hook}>{campaign.hook}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: STATUS_COLORS[campaign.status] },
              ]}
            >
              <Text style={styles.statusText}>
                {campaign.status.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>
          <Text style={styles.description}>{campaign.description}</Text>
        </View>

        {/* Metrics Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Performance Metrics</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Impressions</Text>
              <Text style={styles.metricValue}>
                {metrics.impressions?.toLocaleString()}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Clicks</Text>
              <Text style={styles.metricValue}>
                {metrics.clicks?.toLocaleString()}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>CTR</Text>
              <Text style={styles.metricValue}>
                {(metrics.ctr * 100).toFixed(2)}%
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Conversions</Text>
              <Text style={styles.metricValue}>
                {metrics.conversions?.toLocaleString()}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Activity Starts</Text>
              <Text style={styles.metricValue}>
                {metrics.activityStarts?.toLocaleString()}
              </Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Calendar Adds</Text>
              <Text style={styles.metricValue}>
                {metrics.calendarAdds?.toLocaleString()}
              </Text>
            </View>
          </View>
        </View>

        {/* Campaign Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campaign Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Category</Text>
            <Text style={styles.detailValue}>{campaign.category}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date Range</Text>
            <Text style={styles.detailValue}>
              {new Date(campaign.dateRange.startDate).toLocaleDateString()} -{' '}
              {new Date(campaign.dateRange.endDate).toLocaleDateString()}
            </Text>
          </View>
          {campaign.budget && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Budget</Text>
              <Text style={styles.detailValue}>
                ${campaign.budget.total} {campaign.budget.currency || 'USD'}
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Created</Text>
            <Text style={styles.detailValue}>
              {new Date(campaign.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>

        {/* Targeting Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Targeting</Text>
          {campaign.targeting.interests.length > 0 && (
            <View style={styles.targetingItem}>
              <Text style={styles.targetingLabel}>Interests</Text>
              <Text style={styles.targetingValue}>
                {campaign.targeting.interests.join(', ')}
              </Text>
            </View>
          )}
          {campaign.targeting.moods.length > 0 && (
            <View style={styles.targetingItem}>
              <Text style={styles.targetingLabel}>Moods</Text>
              <Text style={styles.targetingValue}>
                {campaign.targeting.moods.join(', ')}
              </Text>
            </View>
          )}
          {campaign.targeting.weather.length > 0 && (
            <View style={styles.targetingItem}>
              <Text style={styles.targetingLabel}>Weather</Text>
              <Text style={styles.targetingValue}>
                {campaign.targeting.weather.join(', ')}
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsSection}>
          {campaign.status === 'draft' && (
            <>
              <PrimaryButton label="Edit Campaign" onPress={() => console.log('TODO: Edit')} />
              <PrimaryButton label="Preview" onPress={() => console.log('TODO: Preview')} />
              <PrimaryButton
                label="Submit for Approval"
                onPress={() => console.log('TODO: Submit')}
              />
            </>
          )}
          {campaign.status === 'active' && (
            <PrimaryButton
              label="Pause Campaign"
              onPress={handlePause}
              disabled={updating}
            />
          )}
          {campaign.status === 'paused' && (
            <PrimaryButton
              label="Resume Campaign"
              onPress={handleResume}
              disabled={updating}
            />
          )}
          {(campaign.status === 'active' || campaign.status === 'paused') && (
            <Pressable style={styles.secondaryButton} onPress={handleEnd} disabled={updating}>
              <Text style={styles.secondaryButtonText}>End Campaign</Text>
            </Pressable>
          )}
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
    headerSpacer: {
      width: 40,
    },
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    titleSection: {
      marginBottom: theme.spacing.lg,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.sm,
    },
    titleContent: {
      flex: 1,
      marginRight: theme.spacing.md,
    },
    title: {
      fontFamily: theme.fonts.heading,
      fontSize: 24,
      color: theme.colors.text,
    },
    hook: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
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
    description: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
      lineHeight: 20,
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
    mediaPreview: {
      width: '100%',
      height: 220,
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      marginBottom: theme.spacing.lg,
      backgroundColor: theme.colors.backgroundAlt,
    },
    mediaFull: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    metricsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
    },
    metricCard: {
      flex: 1,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      minWidth: '45%',
      alignItems: 'center',
    },
    metricLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    metricValue: {
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
      marginTop: theme.spacing.xs,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    detailLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    detailValue: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.text,
    },
    targetingItem: {
      marginBottom: theme.spacing.md,
    },
    targetingLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    targetingValue: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.text,
    },
    actionsSection: {
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.lg,
    },
    secondaryButton: {
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.card,
    },
    secondaryButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
    },
    errorText: {
      fontFamily: theme.fonts.body,
      fontSize: 16,
      color: theme.colors.textMuted,
    },
  });
