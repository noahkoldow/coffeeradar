import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  Dimensions,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { Campaign, CampaignStatus } from '../types/business';
import { BusinessHeader } from '../components/BusinessHeader';
import { useI18n } from '../i18n/I18nProvider';

interface BusinessDashboardProps extends StackScreenProps<RootStackParamList, 'BusinessHub'> {
  businessName?: string;
  activeCampaigns?: number;
  totalImpressions?: number;
  totalClicks?: number;
  totalConversions?: number;
  recentCampaigns?: Campaign[];
  onCreateCampaign?: () => void;
  onViewCampaigns?: () => void;
  onViewAnalytics?: () => void;
}

const KPI_CARDS = [
  { id: 'active', label: 'Active Campaigns', icon: '🎯', color: '#4F46E5' },
  { id: 'impressions', label: 'Total Impressions', icon: '👁️', color: '#06B6D4' },
  { id: 'clicks', label: 'Total Clicks', icon: '👆', color: '#8B5CF6' },
  { id: 'conversions', label: 'Total Conversions', icon: '✨', color: '#EC4899' },
];

export const BusinessDashboardScreen: React.FC<BusinessDashboardProps> = ({
  businessName,
  activeCampaigns,
  totalImpressions,
  totalClicks,
  totalConversions,
  recentCampaigns,
  onCreateCampaign,
  onViewCampaigns,
  onViewAnalytics,
  navigation,
}) => {
  const theme = useTheme();
  const { state } = useAppState();
  const { language } = useI18n();
  const isGerman = language === 'de';
  const styles = useMemo(() => createStyles(theme), [theme]);
  const businessProfile = state.businessProfile;
  const resolvedCampaigns = recentCampaigns ?? [];
  const resolvedBusinessName = businessName ?? businessProfile?.businessName ?? 'Your Business';
  const resolvedActiveCampaigns = activeCampaigns ?? resolvedCampaigns.filter((campaign) => campaign.status === 'active').length;
  const resolvedImpressions = totalImpressions ?? resolvedCampaigns.reduce((sum, campaign) => sum + (campaign.metrics?.impressions ?? 0), 0);
  const resolvedClicks = totalClicks ?? resolvedCampaigns.reduce((sum, campaign) => sum + (campaign.metrics?.clicks ?? 0), 0);
  const resolvedConversions = totalConversions ?? resolvedCampaigns.reduce((sum, campaign) => sum + (campaign.metrics?.conversions ?? 0), 0);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.72] });
  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
  const handleCreateCampaign = onCreateCampaign ?? (() => {
    navigation.navigate('BusinessCampaignForm', undefined);
  });
  const handleViewCampaigns = onViewCampaigns ?? (() => {
    navigation.navigate('BusinessCampaignsList', undefined);
  });
  const handleViewAnalytics = onViewAnalytics ?? (() => {
    navigation.navigate('BusinessAnalytics', undefined);
  });
  const handleReviewIdeas = () => {
    navigation.navigate('ApprovalQueue');
  };
  const navigateInParentChain = (routeName: keyof RootStackParamList): boolean => {
    let currentNav: any = navigation;

    while (currentNav) {
      const state = currentNav.getState?.();
      if (state?.routeNames?.includes(routeName)) {
        currentNav.navigate(routeName);
        return true;
      }
      currentNav = currentNav.getParent?.();
    }

    return false;
  };

  const handleOpenBusinessSettings = () => {
    if (!navigateInParentChain('BusinessSettings')) {
      Alert.alert(isGerman ? 'Navigationsfehler' : 'Navigation error', isGerman ? 'Business-Einstellungen sind aktuell nicht verfugbar.' : 'Business settings are currently unavailable.');
    }
  };

  const kpiData = [
    { ...KPI_CARDS[0], label: isGerman ? 'Aktive Kampagnen' : KPI_CARDS[0].label, value: resolvedActiveCampaigns.toString() },
    { ...KPI_CARDS[1], label: isGerman ? 'Impressionen gesamt' : KPI_CARDS[1].label, value: resolvedImpressions.toLocaleString() },
    { ...KPI_CARDS[2], label: isGerman ? 'Klicks gesamt' : KPI_CARDS[2].label, value: resolvedClicks.toLocaleString() },
    { ...KPI_CARDS[3], label: isGerman ? 'Conversions gesamt' : KPI_CARDS[3].label, value: resolvedConversions.toLocaleString() },
  ];

  const getStatusColor = (status: CampaignStatus) => {
    const statusColors: Record<CampaignStatus, string> = {
      draft: '#94A3B8',
      pending_approval: '#F59E0B',
      approved: '#10B981',
      active: '#4F46E5',
      paused: '#6B7280',
      ended: '#94A3B8',
      rejected: '#EF4444',
      archived: '#9CA3AF',
    };
    return statusColors[status] || '#94A3B8';
  };

  const getStatusLabel = (status: CampaignStatus) => {
    const labels: Record<CampaignStatus, string> = {
      draft: isGerman ? 'Entwurf' : 'Draft',
      pending_approval: isGerman ? 'Ausstehend' : 'Pending',
      approved: isGerman ? 'Freigegeben' : 'Approved',
      active: isGerman ? 'Aktiv' : 'Active',
      paused: isGerman ? 'Pausiert' : 'Paused',
      ended: isGerman ? 'Beendet' : 'Ended',
      rejected: isGerman ? 'Abgelehnt' : 'Rejected',
      archived: isGerman ? 'Archiviert' : 'Archived',
    };
    return labels[status] || status;
  };

  const renderCampaignItem = ({ item }: { item: Campaign }) => (
    <View style={styles.campaignCardWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.campaignPulseBorder,
          {
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          },
        ]}
      />
      <View style={styles.campaignCard}>
      <View style={styles.campaignHeader}>
        <View style={styles.campaignTitleSection}>
          <Text style={styles.campaignTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.campaignHook} numberOfLines={1}>
            {item.hook}
          </Text>
        </View>
        <View
          style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}
        >
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {getStatusLabel(item.status)}
          </Text>
        </View>
      </View>

      {item.metrics && (
        <View style={styles.campaignMetrics}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>{isGerman ? 'Impressionen' : 'Impressions'}</Text>
            <Text style={styles.metricValue}>{item.metrics.impressions.toLocaleString()}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>{isGerman ? 'Klicks' : 'Clicks'}</Text>
            <Text style={styles.metricValue}>{item.metrics.clicks.toLocaleString()}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>CTR</Text>
            <Text style={styles.metricValue}>{(item.metrics.ctr * 100).toFixed(1)}%</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>{isGerman ? 'Conversions' : 'Conversions'}</Text>
            <Text style={styles.metricValue}>{item.metrics.conversions.toLocaleString()}</Text>
          </View>
        </View>
      )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <BusinessHeader 
        onSettingsPress={handleOpenBusinessSettings}
        showSettingsIcon={true}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.contentContainer}>
      {/* Welcome Header */}
      <View style={styles.headerSection}>
        <Text style={styles.greeting}>{isGerman ? 'Willkommen zuruck,' : 'Welcome back,'}</Text>
        <Text style={styles.businessName}>{resolvedBusinessName}</Text>
        <Text style={styles.headerSubtitle}>{isGerman ? 'Deine Kampagnen erreichen engagierte Nutzer' : 'Your campaigns are reaching engaged users'}</Text>
      </View>

      {/* Primary CTA */}
      <Pressable onPress={handleCreateCampaign} style={styles.primaryCta}>
        <Text style={styles.primaryCtaIcon}>✨</Text>
        <View style={styles.primaryCtaContent}>
          <Text style={styles.primaryCtaTitle}>{isGerman ? 'Neue Kampagne erstellen' : 'Create New Campaign'}</Text>
          <Text style={styles.primaryCtaSubtitle}>{isGerman ? 'Starte Anzeigen fur engagierte Nutzer' : 'Launch ads to engaged users'}</Text>
        </View>
        <Text style={styles.primaryCtaArrow}>→</Text>
      </Pressable>

      {/* KPI Cards Grid */}
      <View style={styles.kpiGrid}>
        {kpiData.map((kpi) => (
          <View key={kpi.id} style={styles.kpiCard}>
            <View style={[styles.kpiIcon, { backgroundColor: kpi.color + '20' }]}>
              <Text style={styles.kpiIconText}>{kpi.icon}</Text>
            </View>
            <Text style={styles.kpiValue}>{kpi.value}</Text>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActionsSection}>
        <Text style={styles.sectionTitle}>{isGerman ? 'Schnellaktionen' : 'Quick Actions'}</Text>
        <View style={styles.quickActionsGrid}>
          <Pressable onPress={handleViewCampaigns} style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>📋</Text>
            <Text style={styles.quickActionText}>{isGerman ? 'Kampagnen verwalten' : 'Manage Campaigns'}</Text>
          </Pressable>
          <Pressable onPress={handleViewAnalytics} style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>📊</Text>
            <Text style={styles.quickActionText}>{isGerman ? 'Analysen' : 'Analytics'}</Text>
          </Pressable>
          <Pressable onPress={() => navigation.navigate('BusinessAudience', undefined)} style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>🎯</Text>
            <Text style={styles.quickActionText}>{isGerman ? 'Zielgruppe' : 'Audience'}</Text>
          </Pressable>
          <Pressable onPress={handleReviewIdeas} style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>✍️</Text>
            <Text style={styles.quickActionText}>{isGerman ? 'Ideen prufen' : 'Review Ideas'}</Text>
          </Pressable>
          <Pressable onPress={handleOpenBusinessSettings} style={styles.quickAction}>
            <Text style={styles.quickActionIcon}>⚙️</Text>
            <Text style={styles.quickActionText}>{isGerman ? 'Einstellungen' : 'Settings'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Recent Campaigns */}
      {resolvedCampaigns.length > 0 && (
        <View style={styles.recentCampaignsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{isGerman ? 'Letzte Kampagnen' : 'Recent Campaigns'}</Text>
            <Pressable onPress={handleViewCampaigns}>
              <Text style={styles.viewAllLink}>{isGerman ? 'Alle anzeigen →' : 'View All →'}</Text>
            </Pressable>
          </View>
          <FlatList
            data={resolvedCampaigns.slice(0, 3)}
            renderItem={renderCampaignItem}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
          />
        </View>
      )}

      {/* Empty State Alternative */}
      {resolvedCampaigns.length === 0 && (
        <View style={styles.emptyStateSection}>
          <View style={styles.emptyStateIcon}>
            <Text style={styles.emptyStateIconText}>🚀</Text>
          </View>
          <Text style={styles.emptyStateTitle}>{isGerman ? 'Bereit fur deine erste Kampagne?' : 'Ready to Launch Your First Campaign?'}</Text>
          <Text style={styles.emptyStateText}>
            {isGerman
              ? 'Erstelle zielgerichtete Anzeigen, die engagierte Nutzer bei der Aktivitatsentdeckung erreichen'
              : 'Create targeted ads that reach engaged users discovering activities'}
          </Text>
          <Pressable onPress={handleCreateCampaign} style={styles.emptyStateButton}>
            <Text style={styles.emptyStateButtonText}>{isGerman ? 'Kampagne erstellen' : 'Create Campaign'}</Text>
          </Pressable>
        </View>
      )}

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Text style={styles.infoBannerIcon}>💡</Text>
        <View style={styles.infoBannerContent}>
          <Text style={styles.infoBannerTitle}>{isGerman ? 'Pro-Tipp' : 'Pro Tip'}</Text>
          <Text style={styles.infoBannerText}>
            {isGerman
              ? 'Kampagnen mit klaren Interessen und Standorten erzielen im Schnitt 3x hoheres Engagement.'
              : 'Campaigns with specific interests and locations see 3x higher engagement on average.'}
          </Text>
        </View>
      </View>
      </ScrollView>
    </View>
  );
};

export default BusinessDashboardScreen;

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scroll: {
      flex: 1,
    },
    contentContainer: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 32,
    },
    headerSection: {
      marginBottom: 24,
    },
    greeting: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
      marginBottom: 4,
    },
    businessName: {
      fontFamily: theme.fonts.heading,
      fontSize: 32,
      color: theme.colors.text,
      marginBottom: 6,
    },
    headerSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    primaryCta: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 16,
      backgroundColor: theme.colors.accent,
      borderRadius: 16,
      marginBottom: 24,
      gap: 12,
    },
    primaryCtaIcon: {
      fontSize: 24,
    },
    primaryCtaContent: {
      flex: 1,
    },
    primaryCtaTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 15,
      color: '#FFFFFF',
      marginBottom: 2,
    },
    primaryCtaSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: 'rgba(255,255,255,0.7)',
    },
    primaryCtaArrow: {
      fontSize: 18,
      color: '#FFFFFF',
    },
    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 28,
    },
    kpiCard: {
      width: (Dimensions.get('window').width - 32 - 12) / 2,
      paddingVertical: 14,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'flex-start',
    },
    kpiIcon: {
      width: 36,
      height: 36,
      borderRadius: 8,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 8,
    },
    kpiIconText: {
      fontSize: 16,
    },
    kpiValue: {
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
      marginBottom: 2,
    },
    kpiLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    quickActionsSection: {
      marginBottom: 28,
    },
    quickActionsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 12,
    },
    quickAction: {
      width: (Dimensions.get('window').width - 32 - 12) / 2,
      paddingVertical: 16,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      gap: 6,
    },
    quickActionIcon: {
      fontSize: 20,
    },
    quickActionText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
      textAlign: 'center',
    },
    sectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    viewAllLink: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.accent,
    },
    recentCampaignsSection: {
      marginBottom: 28,
    },
    campaignCardWrap: {
      position: 'relative',
      marginBottom: 10,
    },
    campaignPulseBorder: {
      position: 'absolute',
      top: -1,
      right: -1,
      bottom: -1,
      left: -1,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: '#3B82F6',
      shadowColor: '#3B82F6',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.45,
      shadowRadius: 10,
      elevation: 6,
    },
    campaignCard: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: theme.colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: 0,
    },
    campaignHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 10,
      gap: 10,
    },
    campaignTitleSection: {
      flex: 1,
    },
    campaignTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: 2,
    },
    campaignHook: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    statusBadge: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    statusText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 10,
    },
    campaignMetrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    metricItem: {
      flex: 1,
      alignItems: 'center',
    },
    metricLabel: {
      fontFamily: theme.fonts.body,
      fontSize: 10,
      color: theme.colors.textMuted,
      marginBottom: 2,
    },
    metricValue: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.accent,
    },
    emptyStateSection: {
      alignItems: 'center',
      paddingVertical: 40,
      marginBottom: 28,
    },
    emptyStateIcon: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: theme.colors.accentSoft,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    emptyStateIconText: {
      fontSize: 28,
    },
    emptyStateTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    emptyStateText: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      textAlign: 'center',
      marginBottom: 16,
      paddingHorizontal: 20,
    },
    emptyStateButton: {
      paddingVertical: 12,
      paddingHorizontal: 24,
      backgroundColor: theme.colors.accent,
      borderRadius: 10,
    },
    emptyStateButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: '#FFFFFF',
    },
    infoBanner: {
      flexDirection: 'row',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.accentSoft,
      borderRadius: 12,
      gap: 12,
    },
    infoBannerIcon: {
      fontSize: 20,
    },
    infoBannerContent: {
      flex: 1,
    },
    infoBannerTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.accentDark,
      marginBottom: 2,
    },
    infoBannerText: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.accentDark,
      lineHeight: 16,
    },
  });
