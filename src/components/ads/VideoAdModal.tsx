import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { adsSdk, isAdsAvailable } from '../../services/ads/mobileAds';
import { destroyVideoAd } from '../../services/ads/videoAd';

type Props = {
  ad: any | null;
  onClose: () => void;
  deckColors?: { bg: string; text: string };
};

/** Seconds the ad must be on screen before it can be skipped. */
const SKIP_AFTER_SECONDS = 5;

/**
 * Full-screen "video" ad rendered from a Native Advanced ad (with a video
 * creative). Shown before a new deck for free users. Styled to match the app.
 */
export const VideoAdModal: React.FC<Props> = ({ ad, onClose, deckColors }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, deckColors, insets.top, insets.bottom), [theme, deckColors, insets.top, insets.bottom]);
  const [remaining, setRemaining] = useState(SKIP_AFTER_SECONDS);
  const adRef = useRef<any>(null);

  const isPlaceholderAd = !!ad?.__placeholder || !isAdsAvailable;
  const visible = !!ad;

  useEffect(() => {
    if (!visible) return undefined;
    adRef.current = ad;
    setRemaining(SKIP_AFTER_SECONDS);
    const timer = setInterval(() => {
      setRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [visible, ad]);

  const handleClose = () => {
    destroyVideoAd(adRef.current);
    adRef.current = null;
    onClose();
  };

  const canSkip = remaining <= 0;

  if (!visible) return null;

  if (isPlaceholderAd) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={canSkip ? handleClose : undefined}>
        <View style={styles.backdrop}>
          <View style={styles.container}>
            <View style={styles.topBar}>
              <View style={styles.adBadge}>
                <Text style={styles.adBadgeText}>Preview</Text>
              </View>
              <Pressable
                onPress={canSkip ? handleClose : undefined}
                disabled={!canSkip}
                hitSlop={10}
                style={[styles.skipButton, !canSkip && styles.skipButtonDisabled]}
              >
                <Text style={styles.skipText}>{canSkip ? 'Skip  ✕' : `Skip in ${remaining}s`}</Text>
              </Pressable>
            </View>

            <View style={styles.placeholderHero}>
              <Text style={styles.placeholderEyebrow}>Sponsored surface</Text>
              <Text style={styles.placeholderHeadline}>AdMob is unavailable in Expo Go</Text>
              <Text style={styles.placeholderBody}>
                This is the fallback layout that keeps the ad slot visible without loading the native SDK.
              </Text>
              <View style={styles.placeholderMedia}>
                <View style={styles.placeholderMediaInset} />
              </View>
            </View>

            <View style={styles.info}>
              <View style={styles.infoHeader}>
                <View style={styles.icon} />
                <View style={styles.infoText}>
                  <Text style={styles.headline} numberOfLines={2}>Sponsored preview</Text>
                  <Text style={styles.advertiser} numberOfLines={1}>Fallback ad infrastructure</Text>
                </View>
              </View>

              <View style={styles.cta}>
                <Text style={styles.ctaText} numberOfLines={1}>Continue</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  const { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } = adsSdk;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={canSkip ? handleClose : undefined}>
      <View style={styles.backdrop}>
        <NativeAdView nativeAd={ad} style={styles.container}>
          <View style={styles.topBar}>
            <View style={styles.adBadge}>
              <Text style={styles.adBadgeText}>Ad</Text>
            </View>
            <Pressable
              onPress={canSkip ? handleClose : undefined}
              disabled={!canSkip}
              hitSlop={10}
              style={[styles.skipButton, !canSkip && styles.skipButtonDisabled]}
            >
              <Text style={styles.skipText}>{canSkip ? 'Skip  ✕' : `Skip in ${remaining}s`}</Text>
            </Pressable>
          </View>

          <NativeMediaView style={styles.media} resizeMode="contain" />

          <View style={styles.info}>
            <View style={styles.infoHeader}>
              {ad.icon?.url ? (
                <NativeAsset assetType={NativeAssetType.ICON}>
                  <Image source={{ uri: ad.icon.url }} style={styles.icon} />
                </NativeAsset>
              ) : null}
              <View style={styles.infoText}>
                <NativeAsset assetType={NativeAssetType.HEADLINE}>
                  <Text style={styles.headline} numberOfLines={2}>{ad.headline}</Text>
                </NativeAsset>
                {ad.advertiser ? (
                  <NativeAsset assetType={NativeAssetType.ADVERTISER}>
                    <Text style={styles.advertiser} numberOfLines={1}>{ad.advertiser}</Text>
                  </NativeAsset>
                ) : null}
              </View>
            </View>

            {ad.callToAction ? (
              <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
                <View style={styles.cta}>
                  <Text style={styles.ctaText} numberOfLines={1}>{ad.callToAction}</Text>
                </View>
              </NativeAsset>
            ) : null}
          </View>
        </NativeAdView>
      </View>
    </Modal>
  );
};

const createStyles = (
  theme: ReturnType<typeof useTheme>,
  deckColors: { bg: string; text: string } | undefined,
  topInset: number,
  bottomInset: number,
) => {
  const accent = deckColors?.bg ?? theme.colors.accent;
  const accentText = deckColors?.text ?? theme.colors.accentText;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: '#000000',
    },
    container: {
      flex: 1,
      paddingTop: topInset + theme.spacing.md,
      paddingBottom: bottomInset + theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      justifyContent: 'space-between',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    adBadge: {
      backgroundColor: accent,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 6,
    },
    adBadgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: accentText,
      letterSpacing: 0.6,
    },
    skipButton: {
      backgroundColor: 'rgba(255,255,255,0.16)',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: theme.radius.full,
    },
    skipButtonDisabled: {
      opacity: 0.7,
    },
    skipText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 13,
      color: '#FFFFFF',
    },
    media: {
      flex: 1,
      marginVertical: theme.spacing.lg,
    },
    placeholderHero: {
      flex: 1,
      marginVertical: theme.spacing.lg,
      justifyContent: 'center',
      gap: theme.spacing.md,
    },
    placeholderEyebrow: {
      fontFamily: theme.fonts.semibold,
      fontSize: 12,
      color: 'rgba(255,255,255,0.68)',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    placeholderHeadline: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      lineHeight: 34,
      color: '#FFFFFF',
    },
    placeholderBody: {
      fontFamily: theme.fonts.body,
      fontSize: 15,
      lineHeight: 22,
      color: 'rgba(255,255,255,0.76)',
    },
    placeholderMedia: {
      marginTop: theme.spacing.md,
      height: 220,
      borderRadius: theme.radius.lg,
      backgroundColor: 'rgba(255,255,255,0.08)',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
      padding: 12,
    },
    placeholderMediaInset: {
      flex: 1,
      borderRadius: theme.radius.md,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.08)',
      borderStyle: 'dashed',
    },
    info: {
      gap: theme.spacing.sm,
    },
    infoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    infoText: {
      flex: 1,
      gap: 2,
    },
    headline: {
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: '#FFFFFF',
    },
    advertiser: {
      fontFamily: theme.fonts.body,
      fontSize: 13,
      color: 'rgba(255,255,255,0.7)',
    },
    cta: {
      marginTop: theme.spacing.xs,
      backgroundColor: accent,
      borderRadius: theme.radius.full,
      paddingVertical: 15,
      alignItems: 'center',
    },
    ctaText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 16,
      color: accentText,
    },
  });
};

export default VideoAdModal;
