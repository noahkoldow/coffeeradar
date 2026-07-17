import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Safe wrapper around `react-native-google-mobile-ads`.
 *
 * The SDK is a native module and is therefore unavailable on web and inside
 * Expo Go. We resolve it lazily via require() so importing anything from the
 * ads layer never crashes those environments — callers guard on
 * `isAdsAvailable` before touching the SDK.
 */

const isExpoGo = Constants.appOwnership === 'expo';

const loadAdsSdk = (): any => {
  if (Platform.OS === 'web' || isExpoGo) return null;

  try {
    // Use indirect eval to avoid Metro statically resolving this module in Expo Go.
    const dynamicRequire = (0, eval)('require') as (id: string) => any;
    return dynamicRequire('react-native-google-mobile-ads');
  } catch {
    return null;
  }
};

let sdk: any = loadAdsSdk();

export const adsSdk = sdk;

/** True when the native AdMob SDK is present and usable on this platform. */
export const isAdsAvailable: boolean = !!sdk && Platform.OS !== 'web' && !isExpoGo;

let initPromise: Promise<void> | null = null;

/** Initialize the AdMob SDK exactly once. No-op when unavailable. */
export const initializeAds = async (): Promise<void> => {
  if (!isAdsAvailable) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mobileAds = sdk.default;
      await mobileAds().initialize();
    } catch (error) {
      console.warn('[ads] initialization failed', error);
    }
  })();

  return initPromise;
};
