type ChallengeCandidate = {
  id?: string;
  type?: string;
  title?: string;
  hook?: string;
  cta?: string;
  description?: string;
  tags?: string[];
  durationMin?: number;
};

type ChallengeProfile = {
  interestTags?: string[];
  customInterests?: string[];
  topPositiveTags?: string[];
};

type ChallengeSelectionOptions = {
  minStrict?: number;
  minReturn?: number;
};

const CHALLENGE_TERMS = [
  'challenge',
  'mission',
  'quest',
  'dare',
  'push',
  'hard',
  'intense',
  'outside comfort zone',
  'unfamiliar',
  'do something you avoid',
  'no excuses',
  'no phone',
  'cold shower',
  'stranger',
  'introduce yourself',
  'ask someone',
  'public',
  'bold',
  'courage',
  'fear',
  'discipline',
];

const STRETCH_TAGS = new Set([
  'challenge',
  'social',
  'explore',
  'fitness',
  'sport',
  'learning',
  'creative',
  'outdoor',
  'public',
  'networking',
  'leadership',
  'short_term',
  'long_term',
  'easy',
  'medium',
  'hard',
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

const normalizeTags = (tags?: string[]): string[] =>
  (tags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);

const getTextBlob = (candidate: ChallengeCandidate): string =>
  [candidate.title, candidate.hook, candidate.cta, candidate.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const buildComfortSet = (profile?: ChallengeProfile): Set<string> => {
  const tokens = new Set<string>();
  const seed = [
    ...(profile?.interestTags ?? []),
    ...(profile?.customInterests ?? []),
    ...(profile?.topPositiveTags ?? []),
  ];
  for (const item of seed) {
    for (const token of tokenize(item)) {
      tokens.add(token);
    }
  }
  return tokens;
};

const hasChallengeSignal = (candidate: ChallengeCandidate): boolean => {
  const tags = normalizeTags(candidate.tags);
  if (tags.some((tag) => CHALLENGE_TERMS.some((term) => tag.includes(term)))) return true;
  const text = getTextBlob(candidate);
  return CHALLENGE_TERMS.some((term) => text.includes(term));
};

const hasMeasurableConstraint = (candidate: ChallengeCandidate): boolean => {
  const text = getTextBlob(candidate);
  return /\b\d+\s?(min|mins|minute|minutes|rep|reps|set|sets|round|rounds|step|steps|km|question|questions|call|calls|floor|floors|day|days|week|weeks)\b/i.test(text)
    || /\b(streak|project|skill ladder|accountability|commitment)\b/i.test(text)
    || /\b(without|no\s+phone|cold|approach|introduce|speak\s+to|ask\s+for)\b/i.test(text);
};

const scoreChallengeCandidate = (candidate: ChallengeCandidate, profile?: ChallengeProfile): number => {
  let score = 0;
  const tags = normalizeTags(candidate.tags);
  const text = getTextBlob(candidate);
  const comfort = buildComfortSet(profile);

  if (hasChallengeSignal(candidate)) score += 4;
  if (hasMeasurableConstraint(candidate)) score += 2;
  if (tags.includes('challenge')) score += 2;
  if (tags.some((tag) => STRETCH_TAGS.has(tag))) score += 2;
  if (candidate.type === 'GO_OUT') score += 1;

  const duration = candidate.durationMin ?? 0;
  if (duration >= 15 && duration <= 90) score += 1;
  else if (duration > 0 && duration <= 120) score += 0.5;

  if (/\b(outside\s+your\s+comfort|unfamiliar|new\s+person|public|bold|courage|fear)\b/.test(text)) {
    score += 2;
  }

  if (comfort.size > 0) {
    const overlap = tags.reduce((count, tag) => count + (comfort.has(tag) ? 1 : 0), 0);
    if (overlap === 0) score += 2;
    else score -= Math.min(2, overlap * 0.5);
  }

  return score;
};

export const selectChallengeCandidates = <T extends ChallengeCandidate>(
  cards: T[],
  profile?: ChallengeProfile,
  options?: ChallengeSelectionOptions,
): T[] => {
  const minStrict = options?.minStrict ?? 3;
  const minReturn = options?.minReturn ?? 3;

  const scored = cards
    .map((card) => ({
      card,
      score: scoreChallengeCandidate(card, profile),
      hasSignal: hasChallengeSignal(card),
      strict: hasChallengeSignal(card) && hasMeasurableConstraint(card),
    }))
    .sort((a, b) => b.score - a.score);

  const strictCards = scored
    .filter((entry) => entry.strict && entry.score >= 5)
    .map((entry) => entry.card);

  if (strictCards.length >= minStrict) {
    return strictCards;
  }

  const moderate = scored
    .filter((entry) => entry.hasSignal && entry.score >= 4)
    .map((entry) => entry.card);

  if (moderate.length >= minReturn) {
    return moderate;
  }

  return scored
    .filter((entry) => entry.hasSignal && entry.score >= 3)
    .map((entry) => entry.card);
};
