import { DeckSuggestion } from '../types';

export const getAvatarInitial = (email?: string | null): string => {
  if (!email) return '?';
  const localPart = email.split('@')[0]?.trim() ?? '';
  const firstCharacter = localPart.charAt(0).toUpperCase();
  return firstCharacter || email.trim().charAt(0).toUpperCase() || '?';
};

const hasFixedPlace = (suggestion: DeckSuggestion): boolean => {
  if (suggestion.type === 'EVENT') {
    return !!suggestion.event?.venue?.trim() || !!suggestion.place?.name?.trim();
  }
  return !!suggestion.place?.name?.trim();
};

const hasFixedTime = (suggestion: DeckSuggestion): boolean => {
  if (suggestion.type === 'EVENT') {
    return !!suggestion.event?.startAt;
  }
  return !!suggestion.meta?.planStartAt;
};

export const isSocialActivitySuggestion = (suggestion: DeckSuggestion): boolean => {
  if (suggestion.type !== 'GO_OUT' && suggestion.type !== 'EVENT') return false;
  return hasFixedPlace(suggestion) && hasFixedTime(suggestion);
};

export const getConfirmedSocialProofCount = (suggestion: DeckSuggestion): number => {
  const count = suggestion.meta?.socialProofCount;
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count as number));
};
