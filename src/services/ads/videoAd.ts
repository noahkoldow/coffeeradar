import { AD_UNIT_IDS } from './adConfig';
import { adsSdk, isAdPlaceholderMode, isAdsAvailable } from './mobileAds';
import { buildAdRequestOptions } from './consent';

/**
 * "Video" ad manager.
 *
 * All AdMob units for this app are **Native Advanced**, so the full-screen
 * video shown before a new deck is a native ad (with a video creative) that we
 * preload here and render full-screen via <VideoAdModal>. We keep the next ad
 * warm so it can be shown instantly when a free user requests a new deck.
 */

let videoNativeAd: any = null;
let loading = false;

const createPlaceholderVideoAd = (): any => ({
  __placeholder: true,
  headline: 'Sponsored preview',
  advertiser: 'AdMob unavailable in Expo Go',
  body: 'This build shows the fallback ad surface instead of loading a native Google ad.',
  callToAction: 'Continue',
});

/** Preload the next full-screen video (native) ad. Safe to call repeatedly. */
export const preloadVideoAd = (keywords: string[] = []): void => {
  if (isAdPlaceholderMode) {
    if (!videoNativeAd) {
      videoNativeAd = createPlaceholderVideoAd();
    }
    return;
  }

  if (!isAdsAvailable) return;
  if (videoNativeAd || loading) return;

  const requestOptions = buildAdRequestOptions(keywords);
  if (!requestOptions) return;

  const { NativeAd, NativeMediaAspectRatio } = adsSdk;
  loading = true;

  try {
    NativeAd.createForAdRequest(AD_UNIT_IDS.video, {
      ...requestOptions,
      // Prefer landscape/large video creatives for the full-screen slot.
      aspectRatio: NativeMediaAspectRatio?.LANDSCAPE,
    })
      .then((ad: any) => {
        videoNativeAd = ad;
        loading = false;
      })
      .catch((error: unknown) => {
        console.warn('[ads] video (native) ad failed to load', error);
        loading = false;
      });
  } catch (error) {
    console.warn('[ads] preloadVideoAd error', error);
    loading = false;
  }
};

/** True when a video ad or fallback placeholder is loaded and ready to be shown immediately. */
export const isVideoAdReady = (): boolean => !!videoNativeAd;

/**
 * Hand the loaded native ad to the caller (the modal) and clear it so a fresh
 * one is preloaded for next time. Returns null when nothing is ready.
 */
export const consumeVideoAd = (keywords: string[] = []): any | null => {
  const ad = videoNativeAd;
  videoNativeAd = null;
  // Warm up the next one in the background.
  if (ad) setTimeout(() => preloadVideoAd(keywords), 0);
  return ad;
};

/** Destroy a native ad instance once the modal is done with it. */
export const destroyVideoAd = (ad: any): void => {
  if (ad?.__placeholder) return;
  try {
    ad?.destroy?.();
  } catch {
    // ignore
  }
};
