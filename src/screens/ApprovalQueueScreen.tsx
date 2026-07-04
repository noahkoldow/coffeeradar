import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuth } from 'firebase/auth';
import { Timestamp, collection, doc, getDoc, getDocs, getFirestore, query, where } from 'firebase/firestore';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { approveCampaign, rejectCampaign, getCampaign } from '../services/campaigns_prod';
import { communityIdeaToSuggestion, reviewCommunityIdea } from '../services/communityIdeas';
import { loadPendingBusinessSubmissions, reviewBusinessSubmission } from '../services/user';
import { BusinessSubmission, CommunityIdeaSubmission, DeckSuggestion } from '../types';
import { Campaign } from '../types/business';
import { SuggestionCard } from '../components/SuggestionCard';

type Props = StackScreenProps<RootStackParamList, 'ApprovalQueue'>;

type ApprovalQueueItem =
  | {
      kind: 'campaign';
      id: string;
      campaignId: string;
      businessId: string;
      businessName: string;
      businessLogoUrl?: string;
      submittedAt: Timestamp;
      campaign: Campaign;
    }
  | {
      kind: 'community_idea';
      id: string;
      ideaId: string;
      submission: CommunityIdeaSubmission;
      submittedAt: Timestamp;
    }
  | {
      kind: 'business_submission';
      id: string;
      submission: BusinessSubmission;
      submittedAt: Timestamp;
    };

export const ApprovalQueueScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const auth = getAuth();
  const db = getFirestore();

  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ApprovalQueueItem | null>(null);
  const [previewItem, setPreviewItem] = useState<ApprovalQueueItem | null>(null);

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return 'Not provided';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }, []);

  const formatTimestamp = useCallback((value?: Timestamp | null) => {
    if (!value) return 'Not provided';
    return value.toDate().toLocaleString();
  }, []);

  const toTimestamp = useCallback((value: string | Timestamp | null | undefined) => {
    if (value instanceof Timestamp) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return Timestamp.fromDate(parsed);
      }
    }
    return Timestamp.now();
  }, []);

  const firstString = useCallback((...values: Array<unknown>): string | undefined => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return undefined;
  }, []);

  const getBusinessAssetUrls = useCallback((submission: BusinessSubmission): string[] => {
    const raw = submission.business as any;
    const candidates = [
      raw?.logo?.url,
      raw?.logo,
      raw?.imageUrl,
      raw?.coverImageUrl,
      raw?.photoUrl,
      ...(Array.isArray(raw?.photos) ? raw.photos : []),
      ...(Array.isArray(raw?.images) ? raw.images : []),
      ...(Array.isArray(raw?.media) ? raw.media.map((item: any) => item?.url) : []),
    ];

    const uniqueUrls = new Set<string>();
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        uniqueUrls.add(candidate);
      }
    }
    return Array.from(uniqueUrls);
  }, []);

  const getCampaignPreviewMedia = useCallback((item: Extract<ApprovalQueueItem, { kind: 'campaign' }>): string | undefined => {
    return firstString(item.campaign.media[0]?.url, item.campaign.mediaUrl);
  }, [firstString]);

  const getCampaignLogo = useCallback((item: Extract<ApprovalQueueItem, { kind: 'campaign' }>): string | undefined => {
    return firstString(item.campaign.logoUrl, item.businessLogoUrl);
  }, [firstString]);

  useEffect(() => {
    const loadQueue = async () => {
      setLoading(true);
      try {
        const [snap, businessSubmissions] = await Promise.all([
          getDocs(query(collection(db, 'approval_queue'), where('status', '==', 'pending'))),
          loadPendingBusinessSubmissions(),
        ]);
        const queueItems: ApprovalQueueItem[] = businessSubmissions.map((submission) => ({
          kind: 'business_submission',
          id: submission.id,
          submission,
          submittedAt: toTimestamp(submission.submittedAt),
        }));

        for (const approvalDoc of snap.docs) {
          const data = approvalDoc.data() as any;
          if (data.kind === 'community_idea') {
            const ideaId = data.ideaId as string;
            if (!ideaId) continue;

            const ideaSnap = await getDoc(doc(db, 'community_ideas', ideaId));
            if (!ideaSnap.exists()) continue;

            queueItems.push({
              kind: 'community_idea',
              id: approvalDoc.id,
              ideaId,
              submission: { id: ideaSnap.id, ...(ideaSnap.data() as Omit<CommunityIdeaSubmission, 'id'>) },
              submittedAt: data.submittedAt ?? Timestamp.now(),
            });
            continue;
          }

          const businessId = data.businessId as string;
          const campaignId = data.campaignId as string;
          if (!businessId || !campaignId) continue;
          const campaign = await getCampaign(businessId, campaignId);
          if (!campaign) continue;
          const businessRef = doc(db, 'businesses', businessId);
          const businessDoc = await getDoc(businessRef);
          let businessData: any = businessDoc.exists() ? businessDoc.data() : null;

          if (!businessData) {
            const businessSnap = await getDocs(query(collection(db, 'businesses'), where('id', '==', businessId)));
            businessData = businessSnap.docs.length > 0 ? businessSnap.docs[0].data() : null;
          }

          const businessName = firstString(businessData?.businessName, businessData?.name, businessId) ?? businessId;
          const businessLogoUrl = firstString(businessData?.logoUrl, businessData?.logo?.url, businessData?.logo);

          queueItems.push({
            kind: 'campaign',
            id: approvalDoc.id,
            campaignId,
            businessId,
            businessName,
            businessLogoUrl,
            submittedAt: data.submittedAt ?? Timestamp.now(),
            campaign,
          });
        }

        queueItems.sort((a, b) => b.submittedAt.toMillis() - a.submittedAt.toMillis());
        setItems(queueItems);
      } catch (error) {
        console.error('Error loading approval queue:', error);
        Alert.alert('Error', 'Failed to load submissions');
      } finally {
        setLoading(false);
      }
    };

    loadQueue();
  }, [db, firstString, toTimestamp]);

  const handleApprove = useCallback((item: ApprovalQueueItem) => {
    if (item.kind === 'campaign') {
      Alert.alert('Approve campaign?', 'This campaign will be activated immediately.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            if (!auth.currentUser) return;
            setReviewing(item.id);
            try {
              await approveCampaign(item.businessId, item.campaignId, auth.currentUser.uid);
              setItems((prev) => prev.filter((entry) => entry.id !== item.id));
              Alert.alert('Approved', 'Campaign has been activated');
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve campaign');
            } finally {
              setReviewing(null);
            }
          },
        },
      ]);
      return;
    }

    if (item.kind === 'business_submission') {
      Alert.alert('Approve business account?', 'This business account will be verified and activated.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            if (!auth.currentUser) return;
            setReviewing(item.id);
            try {
              const ok = await reviewBusinessSubmission(item.id, 'approve');
              if (!ok) throw new Error('Failed to approve business account');
              setItems((prev) => prev.filter((entry) => entry.id !== item.id));
              setSelectedItem((current) => (current?.id === item.id ? null : current));
              Alert.alert('Approved', 'Business account has been verified');
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve business account');
            } finally {
              setReviewing(null);
            }
          },
        },
      ]);
      return;
    }

    Alert.alert('Approve idea?', 'This community idea will become visible in the deck.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          if (!auth.currentUser) return;
          setReviewing(item.id);
          try {
            await reviewCommunityIdea(item.ideaId, 'approve', auth.currentUser.uid);
            setItems((prev) => prev.filter((entry) => entry.id !== item.id));
            Alert.alert('Approved', 'Community idea is now eligible for the deck');
          } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve idea');
          } finally {
            setReviewing(null);
          }
        },
      },
    ]);
  }, [auth.currentUser]);

  const handleReject = useCallback((item: ApprovalQueueItem) => {
    const prompt = item.kind === 'campaign'
      ? 'Tell the business why this campaign was rejected:'
      : item.kind === 'business_submission'
        ? 'Tell the business why this account was rejected:'
        : 'Tell the user why this idea was rejected:';

    Alert.prompt(
      item.kind === 'campaign' ? 'Reject campaign' : item.kind === 'business_submission' ? 'Reject business account' : 'Reject idea',
      prompt,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          onPress: async (reason) => {
            if (!reason?.trim()) {
              Alert.alert('Error', 'Please provide a reason for rejection');
              return;
            }
            if (!auth.currentUser) return;

            setReviewing(item.id);
            try {
              if (item.kind === 'campaign') {
                await rejectCampaign(item.businessId, item.campaignId, reason.trim(), auth.currentUser.uid);
              } else if (item.kind === 'business_submission') {
                const ok = await reviewBusinessSubmission(item.id, 'reject', reason.trim());
                if (!ok) throw new Error('Failed to reject business account');
              } else {
                await reviewCommunityIdea(item.ideaId, 'reject', auth.currentUser.uid, reason.trim());
              }
              setItems((prev) => prev.filter((entry) => entry.id !== item.id));
              setSelectedItem((current) => (current?.id === item.id ? null : current));
              Alert.alert('Rejected', 'Submission has been removed from the queue');
            } catch (error) {
              Alert.alert('Error', error instanceof Error ? error.message : 'Failed to reject submission');
            } finally {
              setReviewing(null);
            }
          },
          style: 'destructive',
        },
      ],
      'plain-text',
    );
  }, [auth.currentUser]);

  const renderItem = ({ item }: { item: ApprovalQueueItem }) => {
    const minutesAgo = Math.floor((Date.now() - item.submittedAt.toMillis()) / (1000 * 60));
    const title = item.kind === 'campaign'
      ? item.campaign.title
      : item.kind === 'business_submission'
        ? item.submission.business.name
        : item.submission.title;
    const subtitle = item.kind === 'campaign'
      ? item.businessName
      : item.kind === 'business_submission'
        ? item.submission.submittedByEmail ?? 'Business submission'
        : item.submission.submittedByEmail ?? 'Community submission';
    const previewTitle = item.kind === 'campaign'
      ? item.campaign.hook
      : item.kind === 'business_submission'
        ? item.submission.business.description
        : item.submission.hook;
    const previewCta = item.kind === 'campaign'
      ? `CTA: ${item.campaign.cta.text}`
      : item.kind === 'business_submission'
        ? item.submission.business.place.address
        : item.submission.description;
    const tagCountLabel = item.kind === 'campaign'
      ? 'Campaign'
      : item.kind === 'business_submission'
        ? 'Business'
        : `${item.submission.durationMin}m`;

    return (
      <View style={styles.campaignCard}>
        <Pressable onPress={() => setSelectedItem(item)}>
          <View style={styles.campaignHeader}>
            <View style={styles.campaignInfo}>
              <Text style={styles.campaignTitle} numberOfLines={2}>
                {title}
              </Text>
              <Text style={styles.businessName} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <Text style={styles.submittedTime}>{minutesAgo < 1 ? 'now' : `${minutesAgo}m ago`}</Text>
          </View>

          <View style={styles.previewSection}>
            <Text style={styles.previewLabel}>{item.kind === 'campaign' ? 'Campaign preview' : item.kind === 'business_submission' ? 'Business preview' : 'Idea preview'}</Text>
            <View style={styles.previewBox}>
              <View style={styles.previewContent}>
                <Text style={styles.previewTitle} numberOfLines={2}>
                  {previewTitle}
                </Text>
                <Text style={styles.previewCta} numberOfLines={2}>
                  {previewCta}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.targetingSection}>
            <Text style={styles.targetingLabel}>Details</Text>
            <View style={styles.tagContainer}>
              <View style={styles.tag}><Text style={styles.tagText}>⏱️ {tagCountLabel}</Text></View>
              {item.kind === 'campaign' ? (
                <>
                  {(item.campaign.targeting?.moods ?? []).slice(0, 3).map((mood, i) => (
                    <View key={`mood-${i}`} style={styles.tag}><Text style={styles.tagText}>😊 {mood}</Text></View>
                  ))}
                  {(item.campaign.targeting?.locations ?? []).slice(0, 2).map((loc, i) => (
                    <View key={`loc-${i}`} style={styles.tag}><Text style={styles.tagText}>📍 Location</Text></View>
                  ))}
                </>
              ) : item.kind === 'business_submission' ? (
                <>
                  {item.submission.business.targetTags.slice(0, 4).map((tag, i) => (
                    <View key={`business-tag-${i}`} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
                  ))}
                  {item.submission.business.isVerified ? null : <View style={styles.tag}><Text style={styles.tagText}>⏳ Pending</Text></View>}
                </>
              ) : (
                <>
                  {item.submission.tags?.slice(0, 4).map((tag, i) => (
                    <View key={`tag-${i}`} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
                  ))}
                  {item.submission.place ? <View style={styles.tag}><Text style={styles.tagText}>📍 Location included</Text></View> : null}
                  {item.submission.imageUrl ? <View style={styles.tag}><Text style={styles.tagText}>🖼️ Image attached</Text></View> : null}
                </>
              )}
            </View>
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, styles.previewButton]}
            onPress={() => setPreviewItem(item)}
            disabled={reviewing === item.id}
          >
            <Text style={styles.previewButtonText}>Preview</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => handleReject(item)}
            disabled={reviewing === item.id}
          >
            {reviewing === item.id ? <ActivityIndicator size="small" color={theme.colors.error} /> : <Text style={styles.rejectButtonText}>Reject</Text>}
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => handleApprove(item)}
            disabled={reviewing === item.id}
          >
            {reviewing === item.id ? <ActivityIndicator size="small" color={theme.colors.accent} /> : <Text style={styles.approveButtonText}>Approve</Text>}
          </Pressable>
        </View>
      </View>
    );
  };

  const renderDetailRow = (label: string, value: string | number | null | undefined) => (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value === null || value === undefined || value === '' ? 'Not provided' : String(value)}</Text>
    </View>
  );

  const renderDetailTags = (values: Array<string | undefined | null>, prefix?: string) => (
    <View style={styles.detailTagContainer}>
      {values.filter((value): value is string => !!value && value.trim().length > 0).map((value, index) => (
        <View key={`${prefix ?? 'tag'}-${index}`} style={styles.detailTag}>
          <Text style={styles.detailTagText}>{value}</Text>
        </View>
      ))}
    </View>
  );

  const renderSelectedItemDetails = () => {
    if (!selectedItem) return null;

    return (
      <Modal transparent visible animationType="slide" onRequestClose={() => setSelectedItem(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPressable} onPress={() => setSelectedItem(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {selectedItem.kind === 'campaign'
                  ? selectedItem.campaign.title
                  : selectedItem.kind === 'business_submission'
                    ? selectedItem.submission.business.name
                    : selectedItem.submission.title}
              </Text>
              <Text style={styles.modalSubtitle}>
                {selectedItem.kind === 'campaign'
                  ? selectedItem.businessName
                  : selectedItem.kind === 'business_submission'
                    ? selectedItem.submission.submittedByEmail ?? 'Business submission'
                    : selectedItem.submission.submittedByEmail ?? 'Community submission'}
              </Text>

              {selectedItem.kind === 'campaign' ? (
                <>
                  <Pressable style={styles.previewCtaInline} onPress={() => setPreviewItem(selectedItem)}>
                    <Text style={styles.previewCtaInlineText}>Open card preview</Text>
                  </Pressable>
                  {renderDetailRow('Campaign ID', selectedItem.campaignId)}
                  {renderDetailRow('Business ID', selectedItem.businessId)}
                  {renderDetailRow('Status', selectedItem.campaign.status.replace(/_/g, ' '))}
                  {renderDetailRow('Submitted', formatTimestamp(selectedItem.submittedAt))}
                  {renderDetailRow('Created', formatDateTime(selectedItem.campaign.createdAt))}
                  {renderDetailRow('Updated', formatDateTime(selectedItem.campaign.updatedAt))}
                  {renderDetailRow('Category', selectedItem.campaign.category)}
                  {renderDetailRow('CTA', `${selectedItem.campaign.cta.text} · ${selectedItem.campaign.cta.action}`)}
                  {renderDetailRow('CTA Value', selectedItem.campaign.cta.value)}
                  {renderDetailRow('Date range', `${selectedItem.campaign.dateRange.startDate} → ${selectedItem.campaign.dateRange.endDate}`)}
                  {selectedItem.campaign.budget ? renderDetailRow('Budget', `${selectedItem.campaign.budget.total ?? 'n/a'} ${selectedItem.campaign.budget.currency ?? ''}`.trim()) : null}
                  {renderDetailRow('Hook', selectedItem.campaign.hook)}
                  {renderDetailRow('Description', selectedItem.campaign.description)}
                  {selectedItem.campaign.logoUrl ? renderDetailRow('Campaign logo URL', selectedItem.campaign.logoUrl) : null}
                  {selectedItem.businessLogoUrl ? renderDetailRow('Business logo URL', selectedItem.businessLogoUrl) : null}
                  {selectedItem.campaign.approvalNotes ? renderDetailRow('Approval notes', selectedItem.campaign.approvalNotes) : null}
                  <Text style={styles.modalSectionTitle}>Targeting</Text>
                  {renderDetailTags(selectedItem.campaign.targeting.moods ?? [], 'mood')}
                  {renderDetailTags(selectedItem.campaign.targeting.weatherConditions ?? [], 'weather')}
                  {renderDetailTags(selectedItem.campaign.targeting.interests ?? [], 'interest')}
                  {selectedItem.campaign.targeting.locationName ? renderDetailRow('Location', selectedItem.campaign.targeting.locationName) : null}
                  {selectedItem.campaign.targeting.timeWindows?.length ? renderDetailRow('Time windows', selectedItem.campaign.targeting.timeWindows.map((window) => `${window.day} ${window.startTime}-${window.endTime}`).join(' | ')) : null}
                  {selectedItem.campaign.logoUrl || selectedItem.businessLogoUrl ? (
                    <View style={styles.mediaList}>
                      <View style={styles.mediaItem}>
                        <View style={styles.mediaThumb}>
                          <Image source={{ uri: selectedItem.campaign.logoUrl ?? selectedItem.businessLogoUrl }} style={styles.mediaImage} />
                        </View>
                        <View style={styles.mediaMeta}>
                          <Text style={styles.mediaLabel}>logo</Text>
                          <Text style={styles.mediaUrl} numberOfLines={2}>{selectedItem.campaign.logoUrl ?? selectedItem.businessLogoUrl}</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                  <Text style={styles.modalSectionTitle}>Media</Text>
                  {selectedItem.campaign.media.length > 0 ? (
                    <View style={styles.mediaList}>
                      {selectedItem.campaign.media.map((media) => (
                        <View key={media.id} style={styles.mediaItem}>
                          <View style={styles.mediaThumb}>
                            {media.type === 'image' ? <Image source={{ uri: media.url }} style={styles.mediaImage} /> : <Text style={styles.mediaEmoji}>🎬</Text>}
                          </View>
                          <View style={styles.mediaMeta}>
                            <Text style={styles.mediaLabel}>{media.type}</Text>
                            <Text style={styles.mediaUrl} numberOfLines={2}>{media.url}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    renderDetailRow('Media', 'No media attached')
                  )}
                </>
              ) : selectedItem.kind === 'business_submission' ? (
                <>
                  <Pressable style={styles.previewCtaInline} onPress={() => setPreviewItem(selectedItem)}>
                    <Text style={styles.previewCtaInlineText}>Open business preview</Text>
                  </Pressable>
                  {renderDetailRow('Submission ID', selectedItem.id)}
                  {renderDetailRow('Submitted', formatTimestamp(selectedItem.submittedAt))}
                  {renderDetailRow('Status', selectedItem.submission.status)}
                  {renderDetailRow('Submitted by', selectedItem.submission.submittedByEmail ?? selectedItem.submission.submittedBy)}
                  {renderDetailRow('Business ID', selectedItem.submission.business.id)}
                  {renderDetailRow('Business name', selectedItem.submission.business.name)}
                  {renderDetailRow('Type', selectedItem.submission.business.type)}
                  {renderDetailRow('Description', selectedItem.submission.business.description)}
                  {selectedItem.submission.reviewNote ? renderDetailRow('Review note', selectedItem.submission.reviewNote) : null}
                  {selectedItem.submission.business.website ? renderDetailRow('Website', selectedItem.submission.business.website) : null}
                  {selectedItem.submission.business.phone ? renderDetailRow('Phone', selectedItem.submission.business.phone) : null}
                  {renderDetailRow('Address', selectedItem.submission.business.place.address)}
                  <Text style={styles.modalSectionTitle}>Tags</Text>
                  {selectedItem.submission.business.targetTags.length ? renderDetailTags(selectedItem.submission.business.targetTags, 'business-tag') : renderDetailRow('Target tags', 'No tags provided')}
                  {selectedItem.submission.business.promotionTags?.length ? renderDetailTags(selectedItem.submission.business.promotionTags, 'promotion-tag') : null}
                  <Text style={styles.modalSectionTitle}>Operations</Text>
                  {renderDetailRow('Budget', selectedItem.submission.business.monthlyBudget ? `$${selectedItem.submission.business.monthlyBudget}` : 'Not provided')}
                  {renderDetailRow('Conversion goal', selectedItem.submission.business.conversionGoal ?? 'Not provided')}
                  {selectedItem.submission.business.rating ? renderDetailRow('Rating', String(selectedItem.submission.business.rating)) : null}
                  {selectedItem.submission.business.ratingCount ? renderDetailRow('Rating count', String(selectedItem.submission.business.ratingCount)) : null}
                  <Text style={styles.modalSectionTitle}>Media and logos</Text>
                  {getBusinessAssetUrls(selectedItem.submission).length > 0 ? (
                    <View style={styles.mediaList}>
                      {getBusinessAssetUrls(selectedItem.submission).map((assetUrl, index) => (
                        <View key={`business-asset-${index}`} style={styles.mediaItem}>
                          <View style={styles.mediaThumb}>
                            <Image source={{ uri: assetUrl }} style={styles.mediaImage} />
                          </View>
                          <View style={styles.mediaMeta}>
                            <Text style={styles.mediaLabel}>asset</Text>
                            <Text style={styles.mediaUrl} numberOfLines={2}>{assetUrl}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    renderDetailRow('Assets', 'No media or logo files attached')
                  )}
                </>
              ) : (
                <>
                  <Pressable style={styles.previewCtaInline} onPress={() => setPreviewItem(selectedItem)}>
                    <Text style={styles.previewCtaInlineText}>Open activity preview</Text>
                  </Pressable>
                  {renderDetailRow('Idea ID', selectedItem.ideaId)}
                  {renderDetailRow('Submitted', formatTimestamp(selectedItem.submittedAt))}
                  {renderDetailRow('Status', selectedItem.submission.status)}
                  {renderDetailRow('Type', selectedItem.submission.type)}
                  {renderDetailRow('Duration', `${selectedItem.submission.durationMin} minutes`)}
                  {renderDetailRow('Hook', selectedItem.submission.hook)}
                  {renderDetailRow('Description', selectedItem.submission.description)}
                  {selectedItem.submission.cta ? renderDetailRow('CTA', selectedItem.submission.cta) : null}
                  {selectedItem.submission.reviewNote ? renderDetailRow('Review note', selectedItem.submission.reviewNote) : null}
                  <Text style={styles.modalSectionTitle}>Tags</Text>
                  {selectedItem.submission.tags?.length ? renderDetailTags(selectedItem.submission.tags, 'idea-tag') : renderDetailRow('Tags', 'No tags provided')}
                  {selectedItem.submission.emojis?.length ? renderDetailTags(selectedItem.submission.emojis, 'emoji') : null}
                  <Text style={styles.modalSectionTitle}>Extras</Text>
                  {selectedItem.submission.place ? renderDetailRow('Location', `${selectedItem.submission.place.name}${selectedItem.submission.place.address ? ` · ${selectedItem.submission.place.address}` : ''}`) : renderDetailRow('Location', 'No location included')}
                  {selectedItem.submission.event ? renderDetailRow('Event', selectedItem.submission.event.title ?? 'Event details provided') : null}
                  {selectedItem.submission.imageUrl ? (
                    <View style={styles.mediaList}>
                      <View style={styles.mediaItem}>
                        <View style={styles.mediaThumb}>
                          <Image source={{ uri: selectedItem.submission.imageUrl }} style={styles.mediaImage} />
                        </View>
                        <View style={styles.mediaMeta}>
                          <Text style={styles.mediaLabel}>image</Text>
                          <Text style={styles.mediaUrl} numberOfLines={2}>{selectedItem.submission.imageUrl}</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                </>
              )}

              <View style={styles.modalActions}>
                <Pressable style={[styles.modalButton, styles.modalRejectButton]} onPress={() => handleReject(selectedItem)}>
                  <Text style={styles.modalRejectText}>Reject</Text>
                </Pressable>
                <Pressable style={[styles.modalButton, styles.modalApproveButton]} onPress={() => handleApprove(selectedItem)}>
                  <Text style={styles.modalApproveText}>Approve</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPreviewModal = () => {
    if (!previewItem) return null;

    const closePreview = () => setPreviewItem(null);
    const communitySuggestion: DeckSuggestion | null = previewItem.kind === 'community_idea'
      ? communityIdeaToSuggestion(previewItem.submission)
      : null;

    return (
      <Modal transparent visible animationType="slide" onRequestClose={closePreview}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdropPressable} onPress={closePreview} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Submission preview</Text>
              <Text style={styles.modalSubtitle}>Swipe-card style preview before approval</Text>

              {previewItem.kind === 'campaign' ? (
                <View style={styles.previewCardWrap}>
                  <View style={styles.previewVisualWrap}>
                    {getCampaignPreviewMedia(previewItem) ? (
                      <Image source={{ uri: getCampaignPreviewMedia(previewItem) }} style={styles.previewVisualImage} />
                    ) : (
                      <View style={styles.previewVisualPlaceholder}><Text style={styles.previewVisualPlaceholderText}>No media</Text></View>
                    )}
                    <View style={styles.previewOverlayRow}>
                      <View style={styles.previewAdBadge}><Text style={styles.previewAdBadgeText}>Ad</Text></View>
                      {getCampaignLogo(previewItem) ? <Image source={{ uri: getCampaignLogo(previewItem) }} style={styles.previewLogo} /> : null}
                    </View>
                  </View>
                  <View style={styles.previewBody}>
                    <Text style={styles.previewHook}>{previewItem.campaign.hook}</Text>
                    <Text style={styles.previewBodyTitle}>{previewItem.campaign.title}</Text>
                    <Text style={styles.previewBodyDescription} numberOfLines={3}>{previewItem.campaign.description}</Text>
                    <View style={styles.previewCtaPill}><Text style={styles.previewCtaPillText}>{previewItem.campaign.cta.text}</Text></View>
                    <Text style={styles.previewMeta}>{previewItem.businessName}</Text>
                  </View>
                </View>
              ) : previewItem.kind === 'community_idea' && communitySuggestion ? (
                <View style={styles.communityPreviewWrap}>
                  {previewItem.submission.imageUrl ? (
                    <Image source={{ uri: previewItem.submission.imageUrl }} style={styles.communityPreviewImage} />
                  ) : null}
                  <SuggestionCard suggestion={communitySuggestion} preview />
                </View>
              ) : (
                <View style={styles.previewCardWrap}>
                  <View style={styles.previewBusinessHeader}>
                    {getBusinessAssetUrls(previewItem.submission)[0] ? (
                      <Image source={{ uri: getBusinessAssetUrls(previewItem.submission)[0] }} style={styles.previewBusinessLogo} />
                    ) : (
                      <View style={styles.previewBusinessLogoPlaceholder}><Text style={styles.previewVisualPlaceholderText}>Logo</Text></View>
                    )}
                    <View style={styles.previewBusinessMeta}>
                      <Text style={styles.previewBodyTitle}>{previewItem.submission.business.name}</Text>
                      <Text style={styles.previewMeta}>{previewItem.submission.business.type}</Text>
                    </View>
                  </View>
                  <Text style={styles.previewBodyDescription}>{previewItem.submission.business.description}</Text>
                  <Text style={styles.previewMeta}>{previewItem.submission.business.place.address}</Text>
                  {previewItem.submission.business.targetTags.length ? renderDetailTags(previewItem.submission.business.targetTags.slice(0, 6), 'preview-business') : null}
                </View>
              )}

              <Pressable style={[styles.modalButton, styles.modalApproveButton]} onPress={closePreview}>
                <Text style={styles.modalApproveText}>Close preview</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

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

      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyText}>No submissions pending approval</Text>
        </View>
      ) : (
        <>
          <View style={styles.headline}>
            <Text style={styles.title}>Approval queue</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{items.length}</Text>
            </View>
          </View>
          <FlatList
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            scrollEnabled={false}
          />
        </>
      )}
      {renderSelectedItemDetails()}
      {renderPreviewModal()}
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
    previewButton: {
      backgroundColor: theme.colors.textMuted + '20',
    },
    previewButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
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
    detailRow: {
      marginBottom: theme.spacing.md,
    },
    detailLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    detailValue: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.text,
      lineHeight: 20,
    },
    detailTagContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
      marginBottom: theme.spacing.md,
    },
    detailTag: {
      backgroundColor: theme.colors.accent + '18',
      borderRadius: 999,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
    },
    detailTagText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.accent,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(10, 12, 18, 0.72)',
      justifyContent: 'flex-end',
    },
    modalBackdropPressable: {
      ...StyleSheet.absoluteFillObject,
    },
    modalSheet: {
      maxHeight: '86%',
      backgroundColor: theme.colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      overflow: 'hidden',
    },
    modalHandle: {
      width: 44,
      height: 5,
      borderRadius: 99,
      alignSelf: 'center',
      marginTop: theme.spacing.sm,
      marginBottom: theme.spacing.md,
      backgroundColor: theme.colors.textMuted + '55',
    },
    modalContent: {
      paddingHorizontal: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    modalTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 24,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    modalSubtitle: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.lg,
    },
    modalSectionTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    previewCtaInline: {
      backgroundColor: theme.colors.accent + '1A',
      borderRadius: theme.radius.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.md,
      alignSelf: 'flex-start',
    },
    previewCtaInlineText: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.accent,
      fontSize: 13,
    },
    mediaList: {
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    mediaItem: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.sm,
      alignItems: 'center',
    },
    mediaThumb: {
      width: 52,
      height: 52,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mediaImage: {
      width: '100%',
      height: '100%',
    },
    mediaEmoji: {
      fontSize: 22,
    },
    mediaMeta: {
      flex: 1,
    },
    mediaLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
      color: theme.colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    mediaUrl: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.text,
    },
    previewCardWrap: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    previewVisualWrap: {
      borderRadius: theme.radius.md,
      overflow: 'hidden',
      height: 220,
      backgroundColor: theme.colors.background,
    },
    previewVisualImage: {
      width: '100%',
      height: '100%',
    },
    previewVisualPlaceholder: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewVisualPlaceholderText: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.textMuted,
      fontSize: 13,
    },
    previewOverlayRow: {
      position: 'absolute',
      left: theme.spacing.sm,
      right: theme.spacing.sm,
      top: theme.spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    previewAdBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    previewAdBadgeText: {
      fontFamily: theme.fonts.semibold,
      color: '#FFFFFF',
      fontSize: 11,
    },
    previewLogo: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: theme.colors.background,
    },
    previewBody: {
      gap: theme.spacing.xs,
    },
    previewHook: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.accent,
      fontSize: 12,
      textTransform: 'uppercase',
    },
    previewBodyTitle: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.text,
      fontSize: 18,
    },
    previewBodyDescription: {
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    previewMeta: {
      fontFamily: theme.fonts.body,
      color: theme.colors.textMuted,
      fontSize: 12,
    },
    previewCtaPill: {
      marginTop: theme.spacing.sm,
      backgroundColor: theme.colors.accent + '22',
      borderRadius: 999,
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
    },
    previewCtaPillText: {
      fontFamily: theme.fonts.semibold,
      color: theme.colors.accent,
      fontSize: 13,
    },
    communityPreviewWrap: {
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    communityPreviewImage: {
      width: '100%',
      height: 180,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.background,
    },
    previewBusinessHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    previewBusinessLogo: {
      width: 58,
      height: 58,
      borderRadius: 16,
      backgroundColor: theme.colors.background,
    },
    previewBusinessLogoPlaceholder: {
      width: 58,
      height: 58,
      borderRadius: 16,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewBusinessMeta: {
      flex: 1,
    },
    modalActions: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    modalButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: theme.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalRejectButton: {
      backgroundColor: theme.colors.error + '20',
    },
    modalRejectText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.error,
    },
    modalApproveButton: {
      backgroundColor: theme.colors.accent + '20',
    },
    modalApproveText: {
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
  });
