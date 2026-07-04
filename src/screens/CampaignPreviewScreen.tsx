import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Dimensions,
  Image,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { PrimaryButton } from '../components/PrimaryButton';
import { getCampaign } from '../services/campaigns';
import { Campaign } from '../types/business';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

interface PreviewScreenProps extends StackScreenProps<RootStackParamList, 'Deck'> {
  campaignId: string;
}

const { width } = Dimensions.get('window');
const CARD_HEIGHT = (width - 32) * 1.5; // 9:16 aspect ratio

export const CampaignPreviewScreen: React.FC<PreviewScreenProps> = ({
  navigation,
  campaignId,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state } = useAppState();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [mediaLayout, setMediaLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const businessLogoUrl = state.businessProfile?.id === campaign?.businessId ? state.businessProfile?.logo?.url : undefined;
  const logoToShow = campaign?.logoUrl ?? businessLogoUrl;
  const isCardFormat = campaign?.media?.[0]?.aspectRatio === '16:9';

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
    // load natural image size for first media
    if (!campaign?.media?.[0]?.url) return;
    const uri = campaign.media[0].url;
    Image.getSize(
      uri,
      (w, h) => setImgNaturalSize({ width: w, height: h }),
      (err) => {
        // ignore
      }
    );
  }, [campaign?.media?.[0]?.url]);

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
          <Text style={styles.title}>Campaign Preview</Text>
          <View style={styles.spacer} />
        </View>

        {/* Preview Instructions */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoTitle}>📱 How it looks in Bits</Text>
          <Text style={styles.infoText}>
            This is how your campaign will appear to users when their mood and interests match.
          </Text>
        </View>

        {/* Campaign Card Preview */}
        <View style={styles.previewContainer}>
          <View
            style={[
              styles.campaignCardPreview,
              isCardFormat ? styles.campaignCardPreviewCard : { height: CARD_HEIGHT },
            ]}
          >
            {isCardFormat ? (
              <>
                <View
                  style={styles.cardMediaWrap}
                  onLayout={(e) => setMediaLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
                >
                  {campaign.media && campaign.media.length > 0 ? (
                    (() => {
                      const media = campaign.media![0];
                      const focalX = media.focalX ?? 0.5;
                      const focalY = media.focalY ?? 0.5;
                      if (!imgNaturalSize || mediaLayout.width === 0) {
                        return <Image source={{ uri: media.url }} style={styles.mediaContainerCard} />;
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
                    })()
                  ) : (
                    <View style={styles.placeholderMediaCard}>
                      <Text style={styles.placeholderText}>📸</Text>
                      <Text style={styles.placeholderSmallText}>No media uploaded</Text>
                    </View>
                  )}
                  <View style={styles.cardOverlayRow}>
                    <View style={styles.cardAdBadge}>
                      <Text style={styles.cardAdBadgeText}>Ad</Text>
                    </View>
                    {logoToShow ? <Image source={{ uri: logoToShow }} style={styles.cardLogo} /> : null}
                  </View>
                </View>

                <View style={styles.cardContentCard}>
                  <Text style={styles.cardHook}>{campaign.hook}</Text>
                  <Text style={styles.cardTitle}>{campaign.title}</Text>
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {campaign.description}
                  </Text>

                  <Pressable style={styles.ctaButton}>
                    <Text style={styles.ctaButtonText}>{campaign.cta.text}</Text>
                  </Pressable>

                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{campaign.category}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.storyHeader}>
                  <View style={styles.cardBadge}>
                    <Text style={styles.cardBadgeText}>Ad</Text>
                  </View>
                  {logoToShow ? <Image source={{ uri: logoToShow }} style={styles.storyLogo} /> : null}
                </View>

                {campaign.media && campaign.media.length > 0 ? (
                  (() => {
                    const media = campaign.media![0];
                    const focalX = media.focalX ?? 0.5;
                    const focalY = media.focalY ?? 0.5;
                    return (
                      <View onLayout={(e) => setMediaLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} style={{ width: '100%', height: 300, overflow: 'hidden' }}>
                        {(!imgNaturalSize || mediaLayout.width === 0) ? (
                          <Image source={{ uri: media.url }} style={styles.mediaContainer} />
                        ) : (
                          (() => {
                            const iw = imgNaturalSize!.width;
                            const ih = imgNaturalSize!.height;
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
                            return <Image source={{ uri: media.url }} style={{ position: 'absolute', width: sw, height: sh, left: translateX, top: translateY }} />;
                          })()
                        )}
                      </View>
                    );
                  })()
                ) : (
                  <View style={styles.placeholderMedia}>
                    <Text style={styles.placeholderText}>📸</Text>
                    <Text style={styles.placeholderSmallText}>No media uploaded</Text>
                  </View>
                )}

                <View style={styles.cardContent}>
                  <Text style={styles.cardHook}>{campaign.hook}</Text>
                  <Text style={styles.cardTitle}>{campaign.title}</Text>
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {campaign.description}
                  </Text>

                  <Pressable style={styles.ctaButton}>
                    <Text style={styles.ctaButtonText}>{campaign.cta.text}</Text>
                  </Pressable>

                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{campaign.category}</Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Preview Info */}
          <View style={styles.previewInfo}>
            <Text style={styles.previewLabel}>Safe zone overlay</Text>
            <Text style={styles.previewDetails}>
              The dotted border shows the safe area for important content. Avoid placing crucial text outside this area.
            </Text>
          </View>
        </View>

        {/* Campaign Details */}
        <View style={styles.detailsSection}>
          <Text style={styles.sectionTitle}>Campaign Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Title</Text>
            <Text style={styles.detailValue}>{campaign.title}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Hook</Text>
            <Text style={styles.detailValue}>{campaign.hook}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>CTA</Text>
            <Text style={styles.detailValue}>
              {campaign.cta.text} → {campaign.cta.value}
            </Text>
          </View>
        </View>

        {/* Targeting Info */}
        <View style={styles.detailsSection}>
          <Text style={styles.sectionTitle}>Who will see this?</Text>
          {campaign.targeting.moods.length > 0 && (
            <View style={styles.targetItem}>
              <Text style={styles.targetLabel}>😊 Moods:</Text>
              <Text style={styles.targetValue}>
                {campaign.targeting.moods.join(', ')}
              </Text>
            </View>
          )}
          {campaign.targeting.weather.length > 0 && (
            <View style={styles.targetItem}>
              <Text style={styles.targetLabel}>⛅ Weather:</Text>
              <Text style={styles.targetValue}>
                {campaign.targeting.weather.join(', ')}
              </Text>
            </View>
          )}
          {campaign.targeting.interests.length > 0 && (
            <View style={styles.targetItem}>
              <Text style={styles.targetLabel}>🎯 Interests:</Text>
              <Text style={styles.targetValue}>
                {campaign.targeting.interests.join(', ')}
              </Text>
            </View>
          )}
        </View>

        {/* Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Tips for better engagement</Text>
          <Text style={styles.tipItem}>• Keep hooks short and punchy (under 40 chars)</Text>
          <Text style={styles.tipItem}>• Use high-quality, vertical photos (9:16 ratio)</Text>
          <Text style={styles.tipItem}>• Clear CTAs convert better than vague ones</Text>
          <Text style={styles.tipItem}>• Test different hooks to see what works</Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <PrimaryButton
          label="Edit Campaign"
          onPress={() => console.log('TODO: Edit')}
        />
        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Back to Campaign</Text>
        </Pressable>
      </View>
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
      fontSize: 20,
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
    infoBanner: {
      backgroundColor: theme.colors.card,
      borderLeftWidth: 4,
      borderLeftColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    infoTitle: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    infoText: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
      lineHeight: 16,
    },
    previewContainer: {
      marginBottom: theme.spacing.lg,
    },
    campaignCardPreview: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.md,
    },
    campaignCardPreviewCard: {
      minHeight: 0,
    },
    storyHeader: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cardHeader: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cardBadge: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    cardBadgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 10,
      color: theme.colors.accentText,
    },
    cardAdBadge: {
      backgroundColor: 'rgba(0,0,0,0.72)',
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 2,
    },
    cardAdBadgeText: {
      color: '#fff',
      fontFamily: theme.fonts.semibold,
      fontSize: 10,
      letterSpacing: 0.4,
    },
    cardLogo: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.92)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.9)',
    },
    cardMediaWrap: {
      position: 'relative',
    },
    cardOverlayRow: {
      position: 'absolute',
      top: theme.spacing.sm,
      left: theme.spacing.sm,
      right: theme.spacing.sm,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    mediaContainer: {
      height: 200,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mediaContainerCard: {
      height: 124,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    mediaText: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    placeholderMedia: {
      height: 200,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderMediaCard: {
      height: 124,
      backgroundColor: theme.colors.backgroundAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderText: {
      fontSize: 32,
      marginBottom: theme.spacing.xs,
    },
    placeholderSmallText: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    cardContent: {
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      flex: 1,
      justifyContent: 'flex-end',
    },
    cardContentCard: {
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    cardHook: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.accent,
    },
    cardTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 18,
      color: theme.colors.text,
    },
    cardDescription: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      lineHeight: 16,
    },
    ctaButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      marginTop: theme.spacing.xs,
    },
    ctaButtonText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      color: theme.colors.accentText,
    },
    categoryBadge: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs,
      alignSelf: 'flex-start',
      marginTop: theme.spacing.xs,
    },
    categoryText: {
      fontFamily: theme.fonts.body,
      fontSize: 10,
      color: theme.colors.textMuted,
    },
    previewInfo: {
      backgroundColor: theme.colors.backgroundAlt,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
    },
    previewLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    previewDetails: {
      fontFamily: theme.fonts.body,
      fontSize: 11,
      color: theme.colors.textMuted,
      lineHeight: 15,
    },
    detailsSection: {
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
    detailRow: {
      marginBottom: theme.spacing.md,
    },
    detailLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.xs,
    },
    detailValue: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.text,
    },
    targetItem: {
      marginBottom: theme.spacing.md,
    },
    targetLabel: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    targetValue: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    tipsSection: {
      backgroundColor: theme.colors.card,
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
    tipItem: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      lineHeight: 18,
    },
    footer: {
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.lg,
      backgroundColor: theme.colors.background,
      gap: theme.spacing.sm,
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
