import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { getAuth } from 'firebase/auth';
import { getDocs, collection, query, where, Timestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { approveCampaign, rejectCampaign, getCampaign } from '../services/campaigns_prod';
import { Campaign } from '../types/business';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

interface ApprovalItem {
  campaign: Campaign;
  businessName: string;
  submittedAt: Timestamp;
}

export const ApprovalQueueScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const auth = getAuth();
  const db = getFirestore();

  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);

  // Load pending campaigns from approval queue
  useEffect(() => {
    const loadCampaigns = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, 'approval_queue'),
          where('status', '==', 'pending')
        );
        const snap = await getDocs(q);

        // Load full campaign details for each approval
        const approvalItems: ApprovalItem[] = [];

        for (const approvalDoc of snap.docs) {
          const data = approvalDoc.data();
          try {
            const campaign = await getCampaign(data.businessId, data.campaignId);
            if (campaign) {
              const businessSnap = await getDocs(
                query(collection(db, 'businesses'), where('id', '==', data.businessId))
              );
              const businessName = businessSnap.docs.length > 0 
                ? businessSnap.docs[0].data().businessName 
                : data.businessId;

              approvalItems.push({
                campaign,
                businessName,
                submittedAt: data.submittedAt,
              });
            }
          } catch (err) {
            console.error('Error loading campaign:', err);
          }
        }

        setApprovals(approvalItems);
      } catch (error) {
        console.error('Error loading approval queue:', error);
        Alert.alert('Error', 'Failed to load campaigns for review');
      } finally {
        setLoading(false);
      }
    };

    loadCampaigns();
  }, []);

  const handleApprove = useCallback(
    async (item: ApprovalItem) => {
      Alert.alert(
        'Approve campaign?',
        `"${item.campaign.title}" from ${item.businessName}\n\nThis campaign will be activated immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Approve',
            onPress: async () => {
              if (!auth.currentUser) {
                Alert.alert('Error', 'You must be logged in');
                return;
              }

              setReviewing(item.campaign.id);
              try {
                await approveCampaign(
                  item.campaign.businessId,
                  item.campaign.id,
                  auth.currentUser.uid
                );
                setApprovals((prev) =>
                  prev.filter((a) => a.campaign.id !== item.campaign.id)
                );
                Alert.alert('Success', 'Campaign has been approved and activated');
              } catch (error) {
                console.error('Error approving campaign:', error);
                Alert.alert(
                  'Error',
                  error instanceof Error ? error.message : 'Failed to approve campaign'
                );
              } finally {
                setReviewing(null);
              }
            },
          },
        ]
      );
    },
    [auth.currentUser]
  );

  const handleReject = useCallback(
    async (item: ApprovalItem) => {
      Alert.prompt(
        'Reject campaign',
        `Why should "${item.campaign.title}" be rejected?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reject',
            onPress: async (reason) => {
              if (!reason?.trim()) {
                Alert.alert('Error', 'Please provide a reason for rejection');
                return;
              }

              if (!auth.currentUser) {
                Alert.alert('Error', 'You must be logged in');
                return;
              }

              setReviewing(item.campaign.id);
              try {
                await rejectCampaign(
                  item.campaign.businessId,
                  item.campaign.id,
                  reason.trim(),
                  auth.currentUser.uid
                );
                setApprovals((prev) =>
                  prev.filter((a) => a.campaign.id !== item.campaign.id)
                );
                Alert.alert('Success', 'Campaign has been rejected');
              } catch (error) {
                console.error('Error rejecting campaign:', error);
                Alert.alert(
                  'Error',
                  error instanceof Error ? error.message : 'Failed to reject campaign'
                );
              } finally {
                setReviewing(null);
              }
            },
            style: 'destructive',
          },
        ],
        'plain-text'
      );
    },
    [auth.currentUser]
  );

  const renderApprovalItem = ({ item }: { item: ApprovalItem }) => {
    const minutesAgo = Math.floor(
      (Date.now() - item.submittedAt.toMillis()) / (1000 * 60)
    );

    return (
      <View style={styles.campaignCard}>
        <View style={styles.campaignHeader}>
          <View style={styles.campaignInfo}>
            <Text style={styles.campaignTitle} numberOfLines={2}>
              {item.campaign.title}
            </Text>
            <Text style={styles.businessName}>{item.businessName}</Text>
          </View>
          <Text style={styles.submittedTime}>
            {minutesAgo < 1 ? 'now' : `${minutesAgo}m ago`}
          </Text>
        </View>

        <View style={styles.previewSection}>
          <Text style={styles.previewLabel}>Campaign Content</Text>
          <View style={styles.previewBox}>
            {item.campaign.mediaUrl && (
              <View style={styles.previewImage}>
                <LinearGradient
                  colors={[theme.colors.accent, theme.colors.accentDim]}
                  style={styles.imagePlaceholder}
                >
                  <Text style={styles.imageData}>📸</Text>
                </LinearGradient>
              </View>
            )}
            <View style={styles.previewContent}>
              <Text style={styles.previewTitle} numberOfLines={2}>
                {item.campaign.hook}
              </Text>
              <Text style={styles.previewCta} numberOfLines={1}>
                Button: {item.campaign.cta}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.targetingSection}>
          <Text style={styles.targetingLabel}>Targeting</Text>
          <View style={styles.tagContainer}>
            {item.campaign.targeting?.moods?.map((mood, i) => (
              <View key={`mood-${i}`} style={styles.tag}>
                <Text style={styles.tagText}>😊 {mood}</Text>
              </View>
            ))}
            {item.campaign.targeting?.weatherConditions?.map((cond, i) => (
              <View key={`weather-${i}`} style={styles.tag}>
                <Text style={styles.tagText}>🌤️ {cond}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => handleReject(item)}
            disabled={reviewing === item.campaign.id}
          >
            {reviewing === item.campaign.id ? (
              <ActivityIndicator size="small" color={theme.colors.error} />
            ) : (
              <Text style={styles.rejectButtonText}>Reject</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => handleApprove(item)}
            disabled={reviewing === item.campaign.id}
          >
            {reviewing === item.campaign.id ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Text style={styles.approveButtonText}>Approve</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <LinearGradient
        colors={[theme.colors.background, theme.colors.backgroundAlt]}
        style={[styles.container, { paddingTop: insets.top }]}
      >
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      </View>

      {approvals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyText}>No campaigns pending approval</Text>
        </View>
      ) : (
        <>
          <View style={styles.headline}>
            <Text style={styles.title}>Campaign queue</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{approvals.length}</Text>
            </View>
          </View>
          <FlatList
            data={approvals}
            renderItem={renderApprovalItem}
            keyExtractor={(item) => item.campaign.id}
            contentContainerStyle={styles.list}
          />
        </>
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
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    back: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
    },
    headline: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      marginBottom: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    title: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.text,
    },
    badge: {
      backgroundColor: theme.colors.accent,
      borderRadius: 20,
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    badgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.background,
    },
    list: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.lg,
    },
    campaignCard: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      padding: theme.spacing.lg,
      marginBottom: theme.spacing.md,
    },
    campaignHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: theme.spacing.md,
    },
    campaignInfo: {
      flex: 1,
      marginRight: theme.spacing.md,
    },
    campaignTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    businessName: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    submittedTime: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    previewSection: {
      marginBottom: theme.spacing.md,
    },
    previewLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      textTransform: 'uppercase',
    },
    previewBox: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    previewImage: {
      width: 60,
      height: 80,
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
    },
    imagePlaceholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    imageData: {
      fontSize: 24,
    },
    previewContent: {
      flex: 1,
      justifyContent: 'center',
    },
    previewTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    previewCta: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
    },
    targetingSection: {
      marginBottom: theme.spacing.md,
    },
    targetingLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      textTransform: 'uppercase',
    },
    tagContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    tag: {
      backgroundColor: theme.colors.accent + '20',
      borderRadius: 12,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
    },
    tagText: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.accent,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    actionButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: theme.radius.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rejectButton: {
      backgroundColor: theme.colors.error + '20',
    },
    rejectButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.error,
    },
    approveButton: {
      backgroundColor: theme.colors.accent + '20',
    },
    approveButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accent,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
    },
    emptyIcon: {
      fontSize: 56,
      marginBottom: theme.spacing.lg,
    },
    emptyTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    emptyText: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    centerContent: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
