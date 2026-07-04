import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { dateFromLocalClockTime, extractClockLabelFromText, formatDuration, formatTime, fromISO, minutesBetween } from '../utils/time';
import { MapThumbnail } from './MapThumbnail';
import { chooseTravelMode } from '../services/travel';

type Props = {
  suggestion: DeckSuggestion;
  preview?: boolean;
  deckColors?: { bg: string; text: string };
  showSourceDebug?: boolean;
};

const SOURCE_DEBUG_CONFIG: Record<string, { bg: string; text: string; emoji: string }> = {
  gemini:       { bg: 'rgba(123,79,191,0.92)',  text: '#fff', emoji: '🤖' },
  curated:      { bg: 'rgba(41,128,185,0.92)',  text: '#fff', emoji: '✍️' },
  ticketmaster: { bg: 'rgba(26,74,138,0.92)',   text: '#fff', emoji: '🎟️' },
  habit:        { bg: 'rgba(39,174,96,0.92)',   text: '#fff', emoji: '🔁' },
  library:      { bg: 'rgba(230,126,34,0.92)',  text: '#fff', emoji: '📚' },
  todo:         { bg: 'rgba(22,160,133,0.92)',  text: '#fff', emoji: '✅' },
  fallback:     { bg: 'rgba(192,57,43,0.92)',   text: '#fff', emoji: '⚠️' },
  business:     { bg: 'rgba(233,30,140,0.92)',  text: '#fff', emoji: '🏪' },
  community:    { bg: 'rgba(0,188,212,0.92)',   text: '#fff', emoji: '👥' },
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

const getInstructionDepartureAt = (suggestion: DeckSuggestion, now: Date): Date | null => {
  const instructions = suggestion.instructions ?? [];
  for (const line of instructions) {
    if (!/\b(leave|depart|head|go|walk|travel|catch)\b/i.test(line)) continue;
    const clockLabel = extractClockLabelFromText(line);
    if (!clockLabel) continue;
    const candidate = dateFromLocalClockTime(clockLabel, now, suggestion.meta?.timeZone);
    if (!candidate) continue;
    if (candidate.getTime() < now.getTime() - 6 * 60 * 60 * 1000) {
      return new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    }
    return candidate;
  }
  return null;
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

const isChallengeSuggestion = (suggestion: DeckSuggestion): boolean => {
  const haystack = [suggestion.title, suggestion.cta, suggestion.hook, suggestion.description].join(' ').toLowerCase();
  return /challenge|quest|mission|race|sprint|try this/.test(haystack);
};

const isSocialActivitySuggestion = (suggestion: DeckSuggestion): boolean => {
  if (suggestion.type !== 'GO_OUT' && suggestion.type !== 'EVENT') return false;
  const hasFixedPlace = suggestion.type === 'EVENT'
    ? !!suggestion.event?.venue?.trim() || !!suggestion.place?.name?.trim()
    : !!suggestion.place?.name?.trim();
  const hasFixedTime = suggestion.type === 'EVENT' ? !!suggestion.event?.startAt : !!suggestion.meta?.planStartAt;
  return hasFixedPlace && hasFixedTime;
};

const getConfirmedSocialProofCount = (suggestion: DeckSuggestion): number => {
  const count = suggestion.meta?.socialProofCount;
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count as number));
};

const getWeatherEmoji = (condition?: string): string => {
  if (!condition) return '🌤️';
  if (condition === 'clear') return '☀️';
  if (condition === 'cloudy') return '☁️';
  if (condition === 'drizzle') return '🌦️';
  if (condition === 'rain') return '🌧️';
  if (condition === 'snow') return '❄️';
  return '🌤️';
};

type BadgeTone = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

const getSourceBadge = (source?: DeckSuggestion['source']): { label: string; tone: BadgeTone } | null => {
  switch (source) {
    case 'ticketmaster':
      return {
        label: 'Ticketmaster',
        tone: {
          backgroundColor: 'rgba(102, 147, 255, 0.16)',
          borderColor: 'rgba(102, 147, 255, 0.32)',
          textColor: '#3559B8',
        },
      };
    case 'habit':
      return {
        label: 'Habit',
        tone: {
          backgroundColor: 'rgba(89, 188, 138, 0.16)',
          borderColor: 'rgba(89, 188, 138, 0.32)',
          textColor: '#2E8055',
        },
      };
    case 'library':
      return {
        label: 'Library',
        tone: {
          backgroundColor: 'rgba(249, 189, 95, 0.18)',
          borderColor: 'rgba(249, 189, 95, 0.34)',
          textColor: '#9A6A12',
        },
      };
    case 'todo':
      return {
        label: 'To-do',
        tone: {
          backgroundColor: 'rgba(91, 187, 206, 0.16)',
          borderColor: 'rgba(91, 187, 206, 0.32)',
          textColor: '#2D7080',
        },
      };
    default:
      return null;
  }
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

type TagFamily = {
  hue: number;
  saturation: number;
  textColor: string;
};

const getTagFamily = (tag: string): TagFamily => {
  const t = tag.toLowerCase();
  if (/(nature|outdoor|park|walk|hike|garden|forest|tree|green|trail|fresh air|sunset|view)/.test(t)) {
    return { hue: 132, saturation: 40, textColor: '#3C7D50' };
  }
  if (/(fitness|workout|exercise|run|jog|bike|cycle|sport|movement|active)/.test(t)) {
    return { hue: 150, saturation: 42, textColor: '#2E8055' };
  }
  if (/(social|friends|date|meet|party|group|community|hangout)/.test(t)) {
    return { hue: 335, saturation: 44, textColor: '#9B4D72' };
  }
  if (/(coffee|cafe|food|cook|eat|drink|restaurant|market|snack|brunch|lunch|dinner)/.test(t)) {
    return { hue: 38, saturation: 46, textColor: '#9A6A12' };
  }
  if (/(learn|read|study|focus|work|project|planning|organize|library|cowork|brain|research)/.test(t)) {
    return { hue: 216, saturation: 42, textColor: '#3559B8' };
  }
  if (/(creative|art|music|draw|paint|write|craft|design|photo|film)/.test(t)) {
    return { hue: 24, saturation: 45, textColor: '#A05A2D' };
  }
  if (/(relax|calm|rest|self care|sleep|stretch|yoga|meditat|breathe|mindful)/.test(t)) {
    return { hue: 262, saturation: 40, textColor: '#6A56A8' };
  }
  if (/(clean|tidy|declutter|laundry|home|repair|prep|routine|organise|organize)/.test(t)) {
    return { hue: 198, saturation: 26, textColor: '#4F6472' };
  }
  if (/(shopping|market|store|browse|gift|fashion|style)/.test(t)) {
    return { hue: 305, saturation: 32, textColor: '#955A8D' };
  }
  if (/(explore|adventure|trip|travel|discover|wander|city|museum|gallery|daytrip)/.test(t)) {
    return { hue: 174, saturation: 30, textColor: '#3D7880' };
  }
  return { hue: 224, saturation: 22, textColor: '#5C6775' };
};

const pastelFromHue = (hue: number, saturation: number, variant: number): BadgeTone => {
  const bgLightness = 90 + (variant % 4);
  const borderLightness = 76 + (variant % 3);
  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${bgLightness}%)`,
    borderColor: `hsl(${hue} ${Math.min(60, saturation + 12)}% ${borderLightness}%)`,
    textColor: '#274050',
  };
};

const getTagPalette = (tag: string): BadgeTone => {
  const normalized = tag.trim().toLowerCase();
  const family = getTagFamily(normalized);
  const offset = hashString(normalized) % 5;
  const palette = pastelFromHue((family.hue + offset * 7) % 360, family.saturation, offset);
  return {
    ...palette,
    textColor: family.textColor,
  };
};

const buildSocialAvatarLabels = (count: number): string[] => {
  if (count <= 0) return [];
  const labels = ['A', 'B', 'C'];
  if (count <= labels.length) return labels.slice(0, count);
  return ['A', 'B', `+${count - 2}`];
};

/* ================================================================
 *  Card component (flip)
 * ================================================================ */

export const SuggestionCard: React.FC<Props> = ({ suggestion, preview, deckColors, showSourceDebug }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, deckColors), [theme, deckColors]);
  const [flipped, setFlipped] = useState(false);
  const [frontCanScroll, setFrontCanScroll] = useState(false);
  const [backCanScroll, setBackCanScroll] = useState(false);
  const [frontViewportH, setFrontViewportH] = useState(0);
  const [backViewportH, setBackViewportH] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
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

  useEffect(() => {
    if (preview) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [preview]);

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
  const isChallenge = isChallengeSuggestion(suggestion);
  const isSocialActivity = useMemo(() => isSocialActivitySuggestion(suggestion), [suggestion]);
  const socialProofCount = useMemo(() => getConfirmedSocialProofCount(suggestion), [suggestion]);
  const now = new Date(nowMs);

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
      const startAt = fromISO(suggestion.event?.startAt);
      if (startAt) {
        const startIn = Math.max(0, minutesBetween(now, startAt));
        if (startIn <= 180) {
          subParts.push(startIn <= 0 ? 'Starting now' : `Starts in ${formatDuration(startIn)}`);
        } else {
          subParts.push(`Starts at ${formatTime(startAt)}`);
        }
      } else if (typeof suggestion.meta?.startInMin === 'number') {
        const startIn = Math.max(0, suggestion.meta.startInMin);
        if (startIn <= 180) {
          subParts.push(startIn <= 0 ? 'Starting now' : `Starts in ${formatDuration(startIn)}`);
        } else {
          subParts.push(`Starts in ${formatDuration(startIn)}`);
        }
      }
    } else if (isGoOut) {
      const instructionLeaveAt = getInstructionDepartureAt(suggestion, now);
      const leaveBy = instructionLeaveAt ?? fromISO(suggestion.meta?.leaveBy);
      if (leaveBy) {
        const leaveNow = leaveBy.getTime() - now.getTime() <= 5 * 60 * 1000;
        const minutesUntilLeave = Math.max(0, minutesBetween(now, leaveBy));
        subParts.push(leaveNow ? 'Leave now' : `Leave in ${formatDuration(minutesUntilLeave)}`);
      }
    }
    if (!subParts.length) {
      subParts.push(`⏱ ${formatDuration(suggestion.durationMin)}`);
    }

    const hasMap = isGoOut && !!suggestion.place?.lat && !!suggestion.place?.lng;
    const frontSteps = hasMap ? [] : getInstructions(suggestion).slice(0, 3);
    const sourceBadge = getSourceBadge(suggestion.source);
    const socialAvatarLabels = buildSocialAvatarLabels(socialProofCount);

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
        <View style={styles.frontTopRow}>
          <View style={styles.badgeCluster}>
            {sourceBadge && (
              <View style={styles.badgePillWrap}>
                <View
                  style={[
                    styles.badgePill,
                    {
                      backgroundColor: sourceBadge.tone.backgroundColor,
                      borderColor: sourceBadge.tone.borderColor,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: sourceBadge.tone.textColor }]}>{sourceBadge.label}</Text>
                </View>
              </View>
            )}
            {isChallenge && (
              <View style={styles.badgePillWrap}>
                <View style={[styles.badgePill, styles.challengeBadge]}>
                  <Text style={styles.challengeBadgeText}>Challenge</Text>
                </View>
              </View>
            )}
            {isSocialActivity && (
              <View style={styles.badgePillWrap}>
                <View style={[styles.badgePill, styles.socialBadge]}>
                  <Text style={styles.socialBadgeText}>
                    {socialProofCount > 0 ? `${socialProofCount} going` : 'Social'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {socialAvatarLabels.length > 0 && (
            <View style={styles.socialStack}>
              {socialAvatarLabels.map((label, index) => (
                <View
                  key={`${label}_${index}`}
                  style={[
                    styles.socialAvatar,
                    index > 0 && styles.socialAvatarOverlap,
                    index === socialAvatarLabels.length - 1 && socialProofCount > 3 && styles.socialAvatarCount,
                  ]}
                >
                  <Text style={styles.socialAvatarText}>{label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

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
          <Text style={styles.infoChip}>{subParts.join(' · ')}</Text>
          {eta && (
            <Text style={styles.infoChipRight}>📍 {eta}</Text>
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
    const backRatingLabel = typeof suggestion.rating === 'number'
      ? `⭐ ${suggestion.rating.toFixed(1)}${typeof suggestion.ratingCount === 'number' ? ` · ${suggestion.ratingCount}` : ''}`
      : null;
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
        {/* Header row: title on the left, time badge on the top right */}
        <View style={styles.backHeader}>
          <Text style={[styles.backTitle, { flex: 1 }]}>{suggestion.title}</Text>
          <View style={styles.backHeaderRight}>
            <View style={styles.backTimeBadge}>
              <Text style={styles.backTimeBadgeText}>⏱ {formatDuration(suggestion.durationMin)}</Text>
            </View>
            {backRatingLabel && (
              <Text style={styles.backTimeBadgeSub}>{backRatingLabel}</Text>
            )}
          </View>
        </View>

        {/* Activity description */}
        <View style={styles.eyebrowSpacer} />
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
        <Text style={styles.eyebrow}>What you'll do</Text>
        <View style={styles.backSteps}>
          {instructions.map((step, i) => (
            <View key={`back_step_${i}`} style={styles.backStepRow}>
              <Text style={styles.backStepNum}>{i + 1}</Text>
              <Text style={styles.backStepText}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Meta details */}
        <View style={styles.metaRow}>
          {eta && <Text style={styles.metaText}>🚀 {eta}</Text>}
          {suggestion.place?.costHint && (
            <Text style={styles.metaText}>💰 {suggestion.place.costHint}</Text>
          )}
          {suggestion.event?.priceRange && (
            <Text style={styles.metaText}>🎟️ {suggestion.event.priceRange}</Text>
          )}
          {typeof suggestion.rating === 'number' && (
            <Text style={styles.metaText}>⭐ {suggestion.rating.toFixed(1)}</Text>
          )}
        </View>

        {/* Tags as text on the back */}
        {(suggestion.tags?.length ?? 0) > 0 && (
          <View style={styles.tagsRow}>
            {suggestion.tags!.map((tag) => {
              const palette = getTagPalette(tag);
              return (
                <View
                  key={tag}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: palette.backgroundColor,
                      borderColor: palette.borderColor,
                    },
                  ]}
                >
                  <Text style={[styles.tagText, { color: palette.textColor }]}>{tag}</Text>
                </View>
              );
            })}
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

      {/* Admin source debug overlay */}
      {showSourceDebug && (() => {
        const src = suggestion.source ?? 'unknown';
        const cfg = SOURCE_DEBUG_CONFIG[src] ?? { bg: 'rgba(80,80,80,0.92)', text: '#fff', emoji: '❓' };
        return (
          <View
            pointerEvents="none"
            style={[
              styles.sourceDebugStrip,
              { backgroundColor: cfg.bg },
            ]}
          >
            <Text style={[styles.sourceDebugText, { color: cfg.text }]}>
              {src[0].toUpperCase() + src.slice(1)} · {suggestion.id.slice(0, 10)}
            </Text>
          </View>
        );
      })()}
    </Animated.View>
  );
};

const CARD_HEIGHT = 420;

export { CARD_HEIGHT };

const createStyles = (theme: ReturnType<typeof useTheme>, deckColors?: { bg: string; text: string }) => {
  const accent = deckColors?.bg ?? theme.colors.accent;
  const accentText = deckColors?.text ?? theme.colors.accentText;
  const cardBackground = theme.isDark ? theme.colors.card : '#FFFFFF';
  return StyleSheet.create({
  cardOuter: {
    minHeight: CARD_HEIGHT,
  },
  cardOuterPressable: {
    minHeight: CARD_HEIGHT,
    zIndex: 4,
  },
  sourceDebugStrip: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    right: 12,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    zIndex: 20,
    alignItems: 'center',
  },
  sourceDebugText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  card: {
    minHeight: CARD_HEIGHT,
    backgroundColor: cardBackground,
    borderWidth: 1,
    borderColor: '#E5E7EB',
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
  badgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.infoText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  frontTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  badgeCluster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  challengeBadge: {
    backgroundColor: 'rgba(235, 107, 120, 0.16)',
    borderColor: 'rgba(235, 107, 120, 0.34)',
  },
  challengeBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#B33C50',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  socialStack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  socialBadge: {
    backgroundColor: 'rgba(238, 155, 191, 0.16)',
    borderColor: 'rgba(238, 155, 191, 0.34)',
  },
  socialBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: '#9B4D72',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
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
    color: deckColors?.text ?? theme.colors.accentDark,
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
    color: accent,
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
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoChipRight: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.textMuted,
    textAlign: 'right',
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
    backgroundColor: cardBackground,
  },
  timelineActivity: {
    backgroundColor: theme.colors.accentSoft,
  },
  timelineAfter: {
    backgroundColor: cardBackground,
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
    flex: 1,
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
    color: accent,
    width: 16,
    textAlign: 'center',
  },
  frontStepLabel: {
    flex: 1,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.text,
  },
  badgePillWrap: {
    alignSelf: 'flex-start',
  },
  badgePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  socialAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarOverlap: {
    marginLeft: -6,
  },
  socialAvatarCount: {
    backgroundColor: 'rgba(205, 217, 227, 0.92)',
  },
  socialAvatarText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
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
    flex: 1,
  },
  backHeaderRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
  },
  backTimeBadge: {
    backgroundColor: 'rgba(205, 217, 227, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(205, 217, 227, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignItems: 'center',
    minWidth: 60,
  },
  backTimeBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.text,
  },
  backTimeBadgeSub: {
    fontFamily: theme.fonts.body,
    fontSize: 9,
    color: theme.colors.textMuted,
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
  eyebrowSpacer: {
    height: 0,
  },
  venueInfo: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 18,
  },
  backSteps: {
    gap: 6,
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  backStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  backStepNum: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: accent,
    width: 18,
    textAlign: 'center',
  },
  backStepText: {
    flex: 1,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.text,
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
    gap: 8,
    marginTop: theme.spacing.sm,
  },
  tag: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  tagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
  },
});
};
