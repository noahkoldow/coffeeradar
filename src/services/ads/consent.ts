import { useSyncExternalStore } from 'react';
import { adsSdk, initializeAds, isAdsAvailable } from './mobileAds';

// Compliance baseline: app is 13+ and defaults to stricter ad treatment.
const REQUEST_UNDER_AGE_OF_CONSENT = true;

export type AdsComplianceState = {
  initialized: boolean;
  canRequestAds: boolean;
  requestNonPersonalizedAdsOnly: boolean;
  consentStatus: string;
  privacyOptionsRequired: boolean;
};

const DEFAULT_STATE: AdsComplianceState = {
  initialized: false,
  canRequestAds: false,
  requestNonPersonalizedAdsOnly: true,
  consentStatus: 'UNKNOWN',
  privacyOptionsRequired: false,
};

let complianceState: AdsComplianceState = { ...DEFAULT_STATE };
let initPromise: Promise<AdsComplianceState> | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const updateState = (patch: Partial<AdsComplianceState>) => {
  complianceState = { ...complianceState, ...patch };
  notify();
};

export const subscribeAdsCompliance = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getAdsComplianceState = (): AdsComplianceState => complianceState;

export const useAdsCompliance = (): AdsComplianceState => {
  return useSyncExternalStore(subscribeAdsCompliance, getAdsComplianceState, getAdsComplianceState);
};

const resolvePersonalization = async (consentInfo: any): Promise<boolean> => {
  // Outside regulated regions, consent may not be required.
  if (consentInfo?.status === 'NOT_REQUIRED') return true;

  try {
    const choices = await adsSdk?.AdsConsent?.getUserChoices?.();
    return !!(choices?.selectPersonalisedAds && choices?.createAPersonalisedAdsProfile);
  } catch {
    return false;
  }
};

export const initializeAdsCompliance = async (): Promise<AdsComplianceState> => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isAdsAvailable) {
      updateState({ initialized: true, canRequestAds: false, requestNonPersonalizedAdsOnly: true });
      return complianceState;
    }

    await initializeAds();

    try {
      const mobileAds = adsSdk?.default;
      const maxRating = adsSdk?.MaxAdContentRating;
      await mobileAds?.().setRequestConfiguration({
        maxAdContentRating: maxRating?.PG,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: REQUEST_UNDER_AGE_OF_CONSENT,
      });
    } catch (error) {
      console.warn('[ads] failed to set global request configuration', error);
    }

    try {
      const consentApi = adsSdk?.AdsConsent;

      if (!consentApi?.gatherConsent) {
        // Fall back to non-personalized ads only if consent helper is missing.
        updateState({
          initialized: true,
          canRequestAds: true,
          requestNonPersonalizedAdsOnly: true,
          consentStatus: 'UNKNOWN',
          privacyOptionsRequired: false,
        });
        return complianceState;
      }

      const consentInfo = await consentApi.gatherConsent({
        tagForUnderAgeOfConsent: REQUEST_UNDER_AGE_OF_CONSENT,
      });

      const personalizationAllowed = consentInfo?.canRequestAds
        ? await resolvePersonalization(consentInfo)
        : false;

      updateState({
        initialized: true,
        canRequestAds: !!consentInfo?.canRequestAds,
        requestNonPersonalizedAdsOnly: !personalizationAllowed,
        consentStatus: String(consentInfo?.status ?? 'UNKNOWN'),
        privacyOptionsRequired: String(consentInfo?.privacyOptionsRequirementStatus ?? 'UNKNOWN') === 'REQUIRED',
      });
      return complianceState;
    } catch (error) {
      console.warn('[ads] consent flow failed; falling back to non-personalized requests only', error);
      updateState({
        initialized: true,
        canRequestAds: true,
        requestNonPersonalizedAdsOnly: true,
        consentStatus: 'UNKNOWN',
      });
      return complianceState;
    }
  })();

  return initPromise;
};

export const showAdsPrivacyOptions = async (): Promise<AdsComplianceState> => {
  if (!isAdsAvailable) return complianceState;

  try {
    const consentApi = adsSdk?.AdsConsent;
    if (consentApi?.showPrivacyOptionsForm) {
      await consentApi.showPrivacyOptionsForm();
    }

    const consentInfo = await consentApi?.getConsentInfo?.();
    const personalizationAllowed = consentInfo?.canRequestAds
      ? await resolvePersonalization(consentInfo)
      : false;

    updateState({
      initialized: true,
      canRequestAds: !!consentInfo?.canRequestAds,
      requestNonPersonalizedAdsOnly: !personalizationAllowed,
      consentStatus: String(consentInfo?.status ?? 'UNKNOWN'),
      privacyOptionsRequired: String(consentInfo?.privacyOptionsRequirementStatus ?? 'UNKNOWN') === 'REQUIRED',
    });
  } catch (error) {
    console.warn('[ads] privacy options update failed', error);
  }

  return complianceState;
};

export const resetAdsConsent = async (): Promise<AdsComplianceState> => {
  if (!isAdsAvailable) {
    updateState({ ...DEFAULT_STATE, initialized: true });
    return complianceState;
  }

  try {
    await adsSdk?.AdsConsent?.reset?.();
  } catch (error) {
    console.warn('[ads] consent reset failed', error);
  }

  complianceState = { ...DEFAULT_STATE };
  notify();
  initPromise = null;
  return initializeAdsCompliance();
};

export const buildAdRequestOptions = (keywords: string[] = []): { keywords: string[]; requestNonPersonalizedAdsOnly: boolean } | null => {
  if (!complianceState.initialized || !complianceState.canRequestAds) return null;
  return {
    keywords,
    requestNonPersonalizedAdsOnly: complianceState.requestNonPersonalizedAdsOnly,
  };
};
