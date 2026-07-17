import { Platform } from 'react-native';
import { LocationState, UserPrefs } from '../../types';

/**
 * AdMob configuration for the two production apps (iOS "bits_ios" / Android
 * "bits_android"). Ads are only ever shown to free (non-premium) users.
 *
 * In development we always fall back to Google's official sample unit IDs so
 * we never risk serving (or accidentally clicking) live ads while testing.
 */

/** Google-provided sample unit IDs — safe to click, always fill. */
const TEST_UNIT_IDS = {
  native: Platform.select({
    ios: 'ca-app-pub-3940256099942544/3986624511',
    android: 'ca-app-pub-3940256099942544/2247696110',
    default: 'ca-app-pub-3940256099942544/2247696110',
  }) as string,
  // Video ad → served as a full-screen interstitial before a new deck.
  video: Platform.select({
    ios: 'ca-app-pub-3940256099942544/4411468910',
    android: 'ca-app-pub-3940256099942544/1033173712',
    default: 'ca-app-pub-3940256099942544/1033173712',
  }) as string,
};

/** Live production units supplied for bits_ios / bits_android. */
const PROD = {
  ios: {
    appId: 'ca-app-pub-5666991539216529~5496136737',
    native: 'ca-app-pub-5666991539216529/2452417831', // ios_ad_slide
    video: 'ca-app-pub-5666991539216529/7645034766', // ios_ad_video
  },
  android: {
    appId: 'ca-app-pub-5666991539216529~8814610819',
    native: 'ca-app-pub-5666991539216529/4875365806', // android_ad_slide
    video: 'ca-app-pub-5666991539216529/9810786263', // android_ad_video
  },
} as const;

const platformProd = Platform.OS === 'ios' ? PROD.ios : PROD.android;

/** Resolved app id for the current platform (used by the config plugin). */
export const AD_APP_ID = platformProd.appId;

/** Resolved ad unit ids for the current platform + environment. */
export const AD_UNIT_IDS = {
  native: __DEV__ ? TEST_UNIT_IDS.native : platformProd.native,
  video: __DEV__ ? TEST_UNIT_IDS.video : platformProd.video,
};

/** Cadence / placement rules. */
export const AD_RULES = {
  /** Show a native ad slide in every Nth deck (2 = every second deck). */
  nativeEveryNthDeck: 2,
  /** Random 1-based slot for the native ad slide within a deck (inclusive). */
  nativeSlotMin: 2,
  nativeSlotMax: 5,
  /** Play a video ad on every Nth "new set" request (2 = every second). */
  videoEveryNthNewSet: 2,
};

/**
 * Build a compact keyword list from the user's preferences, location and the
 * current deck mode so the served ad is as relevant as possible.
 * AdMob accepts free-form keywords on the ad request.
 */
export const buildAdKeywords = (
  prefs: UserPrefs | undefined,
  location: LocationState | undefined,
  mode: 'all' | 'productive' | 'tomorrow' | 'at_home' | 'challenge_me',
): string[] => {
  const keywords = new Set<string>();

  // Deck mode as intent signal.
  keywords.add(`mode:${mode}`);

  // Interests (curated + custom).
  prefs?.interestTags?.forEach((t) => t && keywords.add(t.toLowerCase()));
  prefs?.customInterests?.forEach((t) => t && keywords.add(t.toLowerCase()));

  // Lifestyle / willingness to go out.
  if (prefs?.lifestyle) keywords.add(`lifestyle:${prefs.lifestyle}`);
  if (typeof prefs?.openToGoingOut === 'boolean') {
    keywords.add(prefs.openToGoingOut ? 'going-out' : 'stay-in');
  }

  // Coarse location signal (area label only — never raw coordinates).
  if (location?.areaLabel) {
    keywords.add(location.areaLabel.toLowerCase());
  }

  return Array.from(keywords).filter(Boolean).slice(0, 12);
};
