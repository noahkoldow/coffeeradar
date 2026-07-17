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

  const visible = !!ad && isAdsAvailable;

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

  if (!visible) return null;

  const { NativeAdView, NativeAsset, NativeAssetType, NativeMediaView } = adsSdk;
  const canSkip = remaining <= 0;

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
