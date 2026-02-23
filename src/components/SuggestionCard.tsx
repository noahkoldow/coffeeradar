import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { formatDuration, formatTime, fromISO } from '../utils/time';
import { MapThumbnail } from './MapThumbnail';
import { chooseTravelMode } from '../services/travel';

type Props = {
  suggestion: DeckSuggestion;
  preview?: boolean;
};

/* ── Helpers ──────────────────────────────────────────────── */

const formatEta = (suggestion: DeckSuggestion): string | null => {
  const etaMin = suggestion.meta?.etaMin;
  if (!etaMin) return null;
  const distKm = suggestion.meta?.distanceKm;
  const mode = distKm ? chooseTravelMode(distKm) : 'transit';
  const modeLabel = mode === 'walk' ? 'walk' : 'transit';
  if (etaMin < 60) return `~${etaMin} min ${modeLabel}`;
  const hours = Math.floor(etaMin / 60);
  const mins = etaMin % 60;
  return `~${hours}h ${mins}m ${modeLabel}`;
};

const getInstructions = (suggestion: DeckSuggestion): string[] => {
  if (suggestion.instructions?.length) return suggestion.instructions;
  if (suggestion.type === 'AT_HOME') {
    return (suggestion.steps || []).map((step) => step.label);
  }
  if (suggestion.type === 'GO_OUT') {
    return [
      `Head to ${suggestion.place?.name ?? 'your spot'}.`,
      'Catch the next bus/train.',
      `Spend ${formatDuration(suggestion.durationMin)} there.`,
    ];
  }
  return [
    'Open tickets and confirm details.',
    'Catch the next bus/train.',
    'Arrive a bit early.',
  ];
};

/** Map tags to emoji shorthand for the "good for" row */
const tagToEmoji = (tag: string): string => {
  const t = tag.toLowerCase();
  if (t.includes('relax') || t.includes('calm') || t.includes('chill')) return '🧘';
  if (t.includes('fitness') || t.includes('workout') || t.includes('exercise')) return '💪';
  if (t.includes('social') || t.includes('friends') || t.includes('date')) return '👫';
  if (t.includes('nature') || t.includes('outdoor') || t.includes('park') || t.includes('walk')) return '🌿';
  if (t.includes('creative') || t.includes('art') || t.includes('music')) return '🎨';
  if (t.includes('food') || t.includes('cafe') || t.includes('coffee') || t.includes('cook')) return '☕';
  if (t.includes('focus') || t.includes('productive') || t.includes('deep work')) return '🧠';
  if (t.includes('explore') || t.includes('adventure')) return '🗺️';
  if (t.includes('water') || t.includes('swim') || t.includes('beach')) return '🏊';
  if (t.includes('photo') || t.includes('sunset') || t.includes('view')) return '📸';
  if (t.includes('learn') || t.includes('read') || t.includes('study')) return '📚';
  if (t.includes('fun') || t.includes('play') || t.includes('game')) return '🎮';
  if (t.includes('shop') || t.includes('market')) return '🛍️';
  if (t.includes('bike') || t.includes('cycle')) return '🚴';
  if (t.includes('run') || t.includes('jog')) return '🏃';
  if (t.includes('clean') || t.includes('tidy')) return '🧹';
  if (t.includes('stretch') || t.includes('yoga')) return '🤸';
  if (t.includes('meditat')) return '🧘‍♂️';
  return '✨';
};

/** Build emoji row from tags + equipment + emojis */
const buildEmojiRow = (suggestion: DeckSuggestion): string[] => {
  // Prefer explicit emojis on the suggestion
  if (suggestion.emojis?.length) return suggestion.emojis.slice(0, 5);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of [...(suggestion.tags ?? []), ...(suggestion.equipment ?? [])]) {
    const e = tagToEmoji(tag);
    if (!seen.has(e)) { seen.add(e); result.push(e); }
    if (result.length >= 5) break;
  }
  // Fallback emojis based on type
  if (!result.length) {
    if (suggestion.type === 'AT_HOME') return ['🏠', '✨'];
    if (suggestion.type === 'GO_OUT') return ['🚶', '🌤️'];
    if (suggestion.type === 'EVENT') return ['🎫', '🎶'];
  }
  return result;
};

const getWeatherEmoji = (condition?: string): string => {
  if (!condition) return '🌤️';
  if (condition === 'clear') return '☀️';
  if (condition === 'cloudy') return '☁️';
  if (condition === 'rain') return '🌧️';
  if (condition === 'snow') return '❄️';
  return '🌤️';
};

/* ================================================================
 *  Card component (flip)
 * ================================================================ */

export const SuggestionCard: React.FC<Props> = ({ suggestion, preview }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [flipped, setFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  // Reset flip state when suggestion changes
  useEffect(() => {
    setFlipped(false);
    flipAnim.setValue(0);
  }, [suggestion.id]);

  const handleFlip = () => {
    if (preview) return; // no flip for preview cards
    const toValue = flipped ? 0 : 1;
    Animated.spring(flipAnim, {
      toValue,
      friction: 8,
      tension: 80,
      useNativeDriver: true,
    }).start();
    setFlipped(!flipped);
  };

  // Front rotates 0→90, Back rotates 90→0
  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '90deg', '90deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-90deg', '-90deg', '0deg'],
  });
  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.501, 1],
    outputRange: [1, 1, 0, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.499, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  const emojis = useMemo(() => buildEmojiRow(suggestion), [suggestion]);

  const eta = formatEta(suggestion);
  const isGoOut = suggestion.type === 'GO_OUT' || suggestion.type === 'EVENT';

  /* ── Front side ────────────────────────────────── */
  const renderFront = () => {
    // Build subheader with timing info
    const subParts: string[] = [];
    if (suggestion.type === 'EVENT') {
      const startIn = suggestion.meta?.startInMin;
      if (startIn) {
        subParts.push(`Starts in ${startIn}m`);
      } else {
        const startAt = fromISO(suggestion.event?.startAt);
        if (startAt) subParts.push(`Starts at ${formatTime(startAt)}`);
      }
    } else if (isGoOut) {
      const leaveBy = fromISO(suggestion.meta?.leaveBy);
      if (leaveBy) {
        const leaveNow = leaveBy.getTime() - Date.now() <= 5 * 60 * 1000;
        subParts.push(leaveNow ? 'Leave now' : `Leave by ${formatTime(leaveBy)}`);
      }
    }
    if (!subParts.length) {
      subParts.push(`Fits in ${formatDuration(suggestion.durationMin)}`);
    }

    const hasMap = isGoOut && !!suggestion.place?.lat && !!suggestion.place?.lng;
    const frontSteps = hasMap ? [] : getInstructions(suggestion).slice(0, 3);

    return (
      <View style={styles.frontContent}>
        {/* Source badge */}
        {suggestion.source === 'ticketmaster' && (
          <View style={styles.badge}><Text style={styles.badgeText}>Ticketmaster</Text></View>
        )}
        {suggestion.source === 'habit' && (
          <View style={[styles.badge, styles.badgeHabit]}><Text style={[styles.badgeText, styles.badgeTextHabit]}>Habit</Text></View>
        )}

        {/* CTA / motivational headline */}
        {suggestion.cta ? (
          <View style={styles.ctaBlock}>
            <Text style={styles.ctaText}>{suggestion.cta}</Text>
            <Text style={styles.titleSubline}>{suggestion.title}</Text>
          </View>
        ) : (
          <Text style={styles.title}>{suggestion.title}</Text>
        )}

        {/* Weather + timing line */}
        <View style={styles.infoRow}>
          {isGoOut && (
            <Text style={styles.infoChip}>🌤️ Go outside</Text>
          )}
          <Text style={styles.infoChip}>{subParts.join(' · ')}</Text>
          {typeof suggestion.rating === 'number' && (
            <Text style={styles.ratingChip}>⭐ {suggestion.rating.toFixed(1)}</Text>
          )}
        </View>

        {/* Map + ETA for go-out / event */}
        {isGoOut && suggestion.place?.lat && suggestion.place?.lng && (
          <View style={styles.mapSection}>
            <MapThumbnail lat={suggestion.place.lat} lng={suggestion.place.lng} height={110} />
            {eta && <Text style={styles.etaLabel}>{eta}</Text>}
          </View>
        )}

        {/* Description + step preview for non-map cards */}
        {!hasMap && (
          <View style={styles.frontExtra}>
            <Text style={styles.frontDescription} numberOfLines={3}>
              {suggestion.description}
            </Text>
            {frontSteps.length > 0 && (
              <View style={styles.frontSteps}>
                {frontSteps.map((step, i) => (
                  <View key={`fs_${i}`} style={styles.frontStepRow}>
                    <Text style={styles.frontStepNum}>{i + 1}</Text>
                    <Text style={styles.frontStepLabel} numberOfLines={1}>{step}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Good-for emoji row */}
        {emojis.length > 0 && (
          <View style={styles.emojiRow}>
            {emojis.map((e, i) => (
              <Text key={`${e}_${i}`} style={styles.emoji}>{e}</Text>
            ))}
          </View>
        )}

        {/* Flip hint */}
        {!preview && (
          <Text style={styles.flipHint}>Tap for details →</Text>
        )}
      </View>
    );
  };

  /* ── Back side ─────────────────────────────────── */
  const renderBack = () => {
    const instructions = getInstructions(suggestion);
    return (
      <View style={styles.backContent}>
        {/* Header row: title on the left, rating badge on the top right */}
        <View style={styles.backHeader}>
          <Text style={[styles.backTitle, { flex: 1 }]}>{suggestion.title}</Text>
          {typeof suggestion.rating === 'number' && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingBadgeText}>⭐ {suggestion.rating.toFixed(1)}</Text>
              {typeof suggestion.ratingCount === 'number' && (
                <Text style={styles.ratingBadgeCount}>{suggestion.ratingCount} reviews</Text>
              )}
            </View>
          )}
        </View>

        {/* Activity description */}
        <Text style={styles.eyebrow}>
          {isGoOut && suggestion.place
            ? (suggestion.source === 'curated' ? 'The plan' : 'About this place')
            : 'Why this is cool'}
        </Text>
        <Text style={styles.description}>{suggestion.description}</Text>

        {/* Venue details for place-enriched curated cards */}
        {isGoOut && suggestion.place && suggestion.source === 'curated' && (
          <>
            <Text style={styles.eyebrow}>Your spot</Text>
            <Text style={styles.venueInfo}>
              📍 {suggestion.place.name}
              {suggestion.place.address ? ` · ${suggestion.place.address.split(',')[0]}` : ''}
            </Text>
          </>
        )}
        {suggestion.whyNow && (
          <Text style={styles.whyNowText}>{suggestion.whyNow}</Text>
        )}

        <Text style={styles.eyebrow}>What you'll do</Text>
        <View style={styles.steps}>
          {instructions.map((step, i) => (
            <Text key={`back_step_${i}`} style={styles.stepText}>
              {i + 1}. {step}
            </Text>
          ))}
        </View>

        {/* Meta details */}
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>⏱ {formatDuration(suggestion.durationMin)}</Text>
          {eta && <Text style={styles.metaText}>🚀 {eta}</Text>}
          {suggestion.place?.costHint && (
            <Text style={styles.metaText}>💰 {suggestion.place.costHint}</Text>
          )}
          {suggestion.event?.priceRange && (
            <Text style={styles.metaText}>🎟️ {suggestion.event.priceRange}</Text>
          )}
        </View>

        {/* Tags as text on the back */}
        {(suggestion.tags?.length ?? 0) > 0 && (
          <View style={styles.tagsRow}>
            {suggestion.tags!.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.flipHint}>← Tap to flip back</Text>
      </View>
    );
  };

  return (
    <Pressable onPress={handleFlip} style={styles.cardOuter}>
      {/* Front */}
      <Animated.View
        style={[
          styles.card,
          { transform: [{ perspective: 1000 }, { rotateY: frontRotate }], opacity: frontOpacity },
        ]}
        pointerEvents={flipped ? 'none' : 'auto'}
      >
        {renderFront()}
      </Animated.View>

      {/* Back */}
      <Animated.View
        style={[
          styles.card,
          styles.cardBack,
          { transform: [{ perspective: 1000 }, { rotateY: backRotate }], opacity: backOpacity },
        ]}
        pointerEvents={flipped ? 'auto' : 'none'}
      >
        {renderBack()}
      </Animated.View>
    </Pressable>
  );
};

const CARD_HEIGHT = 420;

export { CARD_HEIGHT };

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  cardOuter: {
    height: CARD_HEIGHT,
  },
  card: {
    height: CARD_HEIGHT,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
    backfaceVisibility: 'hidden',
    overflow: 'hidden',
  },
  cardBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CARD_HEIGHT,
  },
  frontContent: {
    flex: 1,
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  backContent: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.info,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeHabit: {
    backgroundColor: theme.colors.success,
  },
  badgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.infoText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  badgeTextHabit: {
    color: theme.colors.successText,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 24,
    color: theme.colors.text,
  },
  ctaBlock: {
    gap: 4,
  },
  ctaText: {
    fontFamily: theme.fonts.heading,
    fontSize: 22,
    lineHeight: 28,
    color: theme.colors.accent,
  },
  titleSubline: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  infoChip: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  ratingChip: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: '#B8860B',
    backgroundColor: '#FDF6E3',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  mapSection: {
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    marginTop: theme.spacing.xs,
  },
  etaLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  frontExtra: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  frontDescription: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textMuted,
  },
  frontSteps: {
    gap: 6,
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  frontStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  frontStepNum: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.accent,
    width: 16,
    textAlign: 'center',
  },
  frontStepLabel: {
    flex: 1,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.text,
  },
  emojiRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: theme.spacing.xs,
  },
  emoji: {
    fontSize: 22,
  },
  flipHint: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.border,
    textAlign: 'right',
    marginTop: theme.spacing.xs,
  },
  /* ── Back ────────────────── */
  backHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  backTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 20,
    color: theme.colors.text,
  },
  ratingBadge: {
    backgroundColor: '#FDF6E3',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
    minWidth: 52,
  },
  ratingBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: '#B8860B',
  },
  ratingBadgeCount: {
    fontFamily: theme.fonts.body,
    fontSize: 9,
    color: '#9A7209',
    marginTop: 1,
  },
  eyebrow: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: theme.spacing.xs,
  },
  description: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.text,
  },
  whyNowText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.accent,
    fontStyle: 'italic',
  },
  venueInfo: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 18,
  },
  ratingLine: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: '#B8860B',
  },
  steps: {
    gap: 4,
  },
  stepText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: theme.spacing.xs,
  },
  metaText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.spacing.xs,
  },
  tag: {
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  tagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
  },
});
