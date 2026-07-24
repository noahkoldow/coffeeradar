const normalizeUrl = (value?: string): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

export const getPrivacyPolicyUrl = (): string | null => {
  return normalizeUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL);
};

export const getTermsOfServiceUrl = (): string | null => {
  return normalizeUrl(process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL);
};
