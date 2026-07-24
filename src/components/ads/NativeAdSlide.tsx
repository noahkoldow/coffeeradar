import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { CARD_HEIGHT } from '../SuggestionCard';
import { AD_UNIT_IDS } from '../../services/ads/adConfig';
import { adsSdk, isAdsAvailable } from '../../services/ads/mobileAds';
import { buildAdRequestOptions } from '../../services/ads/consent';

type Props = {
  suggestion: DeckSuggestion;
  preview?: boolean;
  deckColors?: { bg: string; text: string };
};

/**
 * A native AdMob ad rendered to look like a regular deck slide. Only used for
 * `source === 'ad'` cards. Keywords carried on `suggestion.adKeywords` make the
 * ad request as relevant as possible to the user (interests, mode, location).
 */
export const NativeAdSlide: React.FC<Props> = ({ suggestion, preview, deckColors }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, deckColors), [theme, deckColors]);
  const [nativeAd, setNativeAd] = useState<any>(null);
  const adRef = useRef<any>(null);

  useEffect(() => {
    // Never load a real ad for the background "next" preview card.
    if (preview || !isAdsAvailable) return undefined;

    let mounted = true;
    const { NativeAd } = adsSdk;

    const requestOptions = buildAdRequestOptions(suggestion.adKeywords ?? []);
    if (!requestOptions) return undefined;

    NativeAd.createForAdRequest(AD_UNIT_IDS.native, requestOptions)
      .then((ad: any) => {
        if (!mounted) {
          ad?.destroy?.();
          return;
        }
        adRef.current = ad;
        setNativeAd(ad);
      })
      .catch((error: unknown) => {
        console.warn('[ads] native ad failed to load', error);
      });

    return () => {
      mounted = false;
      adRef.current?.destroy?.();
      adRef.current = null;
    };
  }, [preview, suggestion.adKeywords]);

  const Sponsored = (
    <View style={styles.adBadge}>
      <Text style={styles.adBadgeText}>SPONSORED AD</Text>
    </View>
  );

  // Placeholder while loading, in preview, or when the SDK is unavailable.
  if (!nativeAd || !isAdsAvailable) {
    return (
      <View style={styles.card}>
        <View style={styles.topRow}>
          {Sponsored}
          <Text style={styles.sponsoredHint}>Sponsored content</Text>
        </View>
        <View style={styles.placeholderMedia}>
          {!preview && isAdsAvailable ? (
            <ActivityIndicator color={deckColors?.bg ?? theme.colors.accent} />
          ) : null}
        </View>
        <View style={styles.bottom}>
          <Text style={styles.placeholderTitle}>Sponsored activity</Text>
          <Text style={styles.placeholderSub}>Handpicked for you</Text>
        </View>
      </View>
    );
  }

  const { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } = adsSdk;

  return (
    <NativeAdView nativeAd={nativeAd} style={styles.card}>
      <View style={styles.topRow}>
        {Sponsored}
        {nativeAd.advertiser ? (
          <NativeAsset assetType={NativeAssetType.ADVERTISER}>
            <Text style={styles.advertiser} numberOfLines={1}>{nativeAd.advertiser}</Text>
          </NativeAsset>
        ) : (
          <Text style={styles.sponsoredHint}>Sponsored</Text>
        )}
      </View>

      <NativeMediaView style={styles.media} resizeMode="cover" />

      <View style={styles.bottom}>
        <View style={styles.headlineRow}>
          {nativeAd.icon?.url ? (
            <NativeAsset assetType={NativeAssetType.ICON}>
              <Image source={{ uri: nativeAd.icon.url }} style={styles.iconWrap} />
            </NativeAsset>
          ) : null}
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.headline} numberOfLines={2}>{nativeAd.headline}</Text>
          </NativeAsset>
        </View>

        {nativeAd.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={styles.body} numberOfLines={2}>{nativeAd.body}</Text>
          </NativeAsset>
        ) : null}

        {nativeAd.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <View style={styles.cta}>
              <Text style={styles.ctaText} numberOfLines={1}>{nativeAd.callToAction}</Text>
            </View>
          </NativeAsset>
        ) : null}
      </View>
    </NativeAdView>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>, deckColors?: { bg: string; text: string }) => {
  const accent = deckColors?.bg ?? theme.colors.accent;
  const accentText = deckColors?.text ?? theme.colors.accentText;
  const cardBackground = theme.isDark ? theme.colors.card : '#FFFFFF';
  return StyleSheet.create({
    card: {
      minHeight: CARD_HEIGHT,
      backgroundColor: cardBackground,
      borderWidth: 1,
      borderColor: '#CFD4DD',
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.15,
      shadowRadius: 24,
      elevation: 8,
      overflow: 'hidden',
      justifyContent: 'space-between',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    adBadge: {
      backgroundColor: '#1F2937',
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 6,
    },
    adBadgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: '#FFFFFF',
      letterSpacing: 0.8,
    },
    sponsoredHint: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
    },
    advertiser: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: theme.colors.text,
      flexShrink: 1,
    },
    media: {
      flex: 1,
      marginVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.backgroundAlt,
      minHeight: 180,
      overflow: 'hidden',
    },
    placeholderMedia: {
      flex: 1,
      marginVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.backgroundAlt,
      minHeight: 180,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bottom: {
      gap: theme.spacing.xs,
    },
    headlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: theme.colors.backgroundAlt,
    },
    headline: {
      flex: 1,
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: theme.colors.text,
    },
    body: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
    cta: {
      marginTop: theme.spacing.sm,
      backgroundColor: accent,
      borderRadius: theme.radius.full,
      paddingVertical: 12,
      alignItems: 'center',
    },
    ctaText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 15,
      color: accentText,
    },
    placeholderTitle: {
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: theme.colors.text,
    },
    placeholderSub: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
  });
};

export default NativeAdSlide;
