import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { formatDuration, formatTime, fromISO, minutesBetween } from '../utils/time';
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
  const [frontCanScroll, setFrontCanScroll] = useState(false);
  const [backCanScroll, setBackCanScroll] = useState(false);
  const [frontViewportH, setFrontViewportH] = useState(0);
  const [backViewportH, setBackViewportH] = useState(0);
  const flipAnim = useRef(new Animated.Value(0)).current;
  const entranceAnim = useRef(new Animated.Value(0)).current;

  // Reset flip state when suggestion changes
  useEffect(() => {
    setFlipped(false);
    setFrontCanScroll(false);
    setBackCanScroll(false);
    flipAnim.setValue(0);
    entranceAnim.setValue(0);
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [suggestion.id, flipAnim, entranceAnim]);

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
    const planStart = fromISO(suggestion.meta?.planStartAt);
    const planEnd = fromISO(suggestion.meta?.planEndAt);
    const planBeforeEnd = fromISO(suggestion.meta?.planBeforeEndsAt);
    const planAfterStart = fromISO(suggestion.meta?.planAfterStartsAt);
    const hasPlanTimeline = !!(planStart && planEnd);
    const activityMin = hasPlanTimeline ? Math.max(10, minutesBetween(planStart!, planEnd!)) : suggestion.durationMin;
    const beforeGapMin = hasPlanTimeline
      ? Math.max(5, planBeforeEnd ? minutesBetween(planBeforeEnd, planStart!) : Math.round(activityMin * 0.6))
      : 20;
    const afterGapMin = hasPlanTimeline
      ? Math.max(5, planAfterStart ? minutesBetween(planEnd!, planAfterStart) : Math.round(activityMin * 0.6))
      : 20;
    const toWeight = (minutes: number): number => Math.max(1, Math.min(4, minutes / 20));
    const beforeWeight = toWeight(beforeGapMin);
    const activityWeight = toWeight(activityMin);
    const afterWeight = toWeight(afterGapMin);
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
        const minutesUntilLeave = Math.max(0, minutesBetween(new Date(), leaveBy));
        subParts.push(leaveNow ? 'Leave now' : `Leave in ${formatDuration(minutesUntilLeave)}`);
      }
    }
    if (!subParts.length) {
      subParts.push(`Fits in ${formatDuration(suggestion.durationMin)}`);
    }

    const hasMap = isGoOut && !!suggestion.place?.lat && !!suggestion.place?.lng;
    const frontSteps = hasMap ? [] : getInstructions(suggestion).slice(0, 3);

    return (
      <ScrollView
        style={styles.sideScroll}
        contentContainerStyle={styles.frontContent}
        showsVerticalScrollIndicator={frontCanScroll}
        scrollEnabled={frontCanScroll}
        nestedScrollEnabled
        onLayout={(e) => setFrontViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setFrontCanScroll(frontViewportH > 0 && h > frontViewportH + 4)}
      >
        {/* Source badge */}
        {suggestion.source === 'gemini' && (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>AI</Text>
          </View>
        )}
        {suggestion.source === 'ticketmaster' && (
          <View style={styles.badge}><Text style={styles.badgeText}>Ticketmaster</Text></View>
        )}
        {suggestion.source === 'habit' && (
          <View style={[styles.badge, styles.badgeHabit]}><Text style={[styles.badgeText, styles.badgeTextHabit]}>Habit</Text></View>
        )}

        {suggestion.hook && (
          <View style={styles.hookBlock}>
            <Text style={styles.hookText}>{suggestion.hook}</Text>
          </View>
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

        {hasPlanTimeline && (
          <View style={styles.timelineCard}>
            <Text style={styles.timelineTitle}>How this fits your day</Text>
            <View style={styles.timelineRow}>
              <View style={[styles.timelineBlock, styles.timelineBefore, { flex: beforeWeight }]}> 
                <Text style={styles.timelineLabel}>Before</Text>
                <Text style={styles.timelineMain} numberOfLines={1}>{suggestion.meta?.planBeforeTitle ?? 'Open time'}</Text>
                <Text style={styles.timelineSub} numberOfLines={1}>{planBeforeEnd ? `Until ${formatTime(planBeforeEnd)}` : 'No hard stop'}</Text>
              </View>
              <View style={[styles.timelineBlock, styles.timelineActivity, { flex: activityWeight }]}> 
                <Text style={styles.timelineLabel}>Planned</Text>
                <Text style={styles.timelineMain} numberOfLines={1}>{suggestion.title}</Text>
                <Text style={styles.timelineSub} numberOfLines={1}>{`${formatTime(planStart)} - ${formatTime(planEnd)}`}</Text>
              </View>
              <View style={[styles.timelineBlock, styles.timelineAfter, { flex: afterWeight }]}> 
                <Text style={styles.timelineLabel}>After</Text>
                <Text style={styles.timelineMain} numberOfLines={1}>{suggestion.meta?.planAfterTitle ?? 'Free time'}</Text>
                <Text style={styles.timelineSub} numberOfLines={1}>{planAfterStart ? `From ${formatTime(planAfterStart)}` : 'Rest of day open'}</Text>
              </View>
            </View>
          </View>
        )}

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

        {/* Decorative emoji row is now part of the crown above (uses the same emojis) */}

        {/* Flip hint */}
        {!preview && (
          <Text style={styles.flipHint}>Tap for details →</Text>
        )}
      </ScrollView>
    );
  };

  /* ── Back side ─────────────────────────────────── */
  const renderBack = () => {
    const instructions = getInstructions(suggestion);
    return (
      <ScrollView
        style={styles.sideScroll}
        contentContainerStyle={styles.backContent}
        showsVerticalScrollIndicator={backCanScroll}
        scrollEnabled={backCanScroll}
        nestedScrollEnabled
        onLayout={(e) => setBackViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setBackCanScroll(backViewportH > 0 && h > backViewportH + 4)}
      >
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
      </ScrollView>
    );
  };

  return (
    <Animated.View
      style={[
        styles.cardOuter,
        {
          opacity: entranceAnim,
          transform: [
            {
              translateY: entranceAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            },
          ],
        },
      ]}
    >
      {/* Achievement Crown backdrop: circle only (behind card) */}
      <View style={styles.emojiCrownBack} pointerEvents="none">
        <View style={styles.emojiPartialCircle} />
      </View>

      {/* Achievement Crown: floating emojis (in front of card) */}
      <View style={styles.emojiCrown} pointerEvents="none">
        {/* Pick emojis from the suggestion (fallbacks maintained) */}
        {(() => {
          const left = emojis[0] ?? '📚';
          const center = emojis[1] ?? emojis[0] ?? '🧭';
          const right = emojis[2] ?? emojis[0] ?? '✨';
          // Peripherals should be a bit higher than center; center slightly lower
          const peripheralOffset = -10; // move peripherals up
          const centerOffset = 8; // move center down
          return (
            <>
              <Text
                style={[
                  styles.emoji,
                  styles.emojiLeft,
                  { transform: [{ rotate: '-8deg' }, { translateY: peripheralOffset }] },
                ]}
              >
                {left}
              </Text>

              <Text
                style={[
                  styles.emoji,
                  styles.emojiCenter,
                  { transform: [{ rotate: '2deg' }, { translateY: centerOffset }] },
                ]}
              >
                {center}
              </Text>

              <Text
                style={[
                  styles.emoji,
                  styles.emojiRight,
                  { transform: [{ rotate: '8deg' }, { translateY: peripheralOffset }] },
                ]}
              >
                {right}
              </Text>
            </>
          );
        })()}
      </View>

      <Pressable onPress={handleFlip} style={styles.cardOuterPressable}>
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
    </Animated.View>
  );
};

const CARD_HEIGHT = 420;

export { CARD_HEIGHT };

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  cardOuter: {
    minHeight: CARD_HEIGHT,
  },
  cardOuterPressable: {
    minHeight: CARD_HEIGHT,
    zIndex: 4,
  },
  card: {
    minHeight: CARD_HEIGHT,
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
    zIndex: 3,
  },
  cardBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: CARD_HEIGHT,
  },
  frontContent: {
    minHeight: '100%',
    gap: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  backContent: {
    minHeight: '100%',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  sideScroll: {
    flex: 1,
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
  aiBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 3,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  aiBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hookBlock: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    marginTop: 8,
  },
  hookText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.accentDark,
    lineHeight: 18,
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
  timelineCard: {
    marginTop: theme.spacing.xs,
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 8,
  },
  timelineTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  timelineBlock: {
    flex: 1,
    borderRadius: theme.radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 2,
  },
  timelineBefore: {
    backgroundColor: theme.colors.card,
  },
  timelineActivity: {
    backgroundColor: theme.colors.accentSoft,
  },
  timelineAfter: {
    backgroundColor: theme.colors.card,
  },
  timelineLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  timelineMain: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.text,
  },
  timelineSub: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
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
  heroEmojiRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: -2,
    marginBottom: theme.spacing.sm,
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 32,
    lineHeight: 36,
  },
  /* ── Achievement crown (behind the card) ───────────────── */
  emojiCrown: {
    position: 'absolute',
    top: -64,
    left: '50%',
    width: 320,
    height: 180,
    marginLeft: -160,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  emojiCrownBack: {
    position: 'absolute',
    top: -80,
    left: '50%',
    width: 320,
    height: 180,
    marginLeft: -160,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  emojiPartialCircle: {
    position: 'absolute',
    width: 210,
    height: 90,
    backgroundColor: '#EAF3FF',
    opacity: 0.95,
    borderTopLeftRadius: 105,
    borderTopRightRadius: 105,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    top: 20,
    left: '50%',
    marginLeft: -105,
    zIndex: 0,
  },
  emoji: {
    position: 'absolute',
    fontSize: 44,
    textShadowColor: 'rgba(0,0,0,0.08)',
    textShadowOffset: { width: 0, height: 6 },
    textShadowRadius: 10,
    zIndex: 2,
  },
  emojiLeft: {
    left: 92,
    top: 20,
    fontSize: 38,
    zIndex: 0,
  },
  emojiCenter: {
    left: '50%',
    marginLeft: -26,
    top: 10,
    fontSize: 52,
    zIndex: 1,
  },
  emojiRight: {
    right: 92,
    top: 20,
    fontSize: 38,
    zIndex: 0,
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
