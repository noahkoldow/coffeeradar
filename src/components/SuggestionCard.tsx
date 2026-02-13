import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { formatDuration, formatTime, fromISO } from '../utils/time';
import { MapThumbnail } from './MapThumbnail';

type Props = {
  suggestion: DeckSuggestion;
  preview?: boolean;
};

const formatEta = (etaMin?: number): string | null => {
  if (!etaMin) return null;
  if (etaMin < 60) return `${etaMin}m away`;
  const hours = Math.floor(etaMin / 60);
  const mins = etaMin % 60;
  return `${hours}h ${mins}m away`;
};

const formatDistance = (distanceKm?: number): string | null => {
  if (!distanceKm) return null;
  return `${distanceKm.toFixed(1)} km`;
};

const getInstructions = (suggestion: DeckSuggestion): string[] => {
  if (suggestion.instructions?.length) return suggestion.instructions;
  if (suggestion.type === 'AT_HOME') {
    return (suggestion.steps || []).map((step) => step.label);
  }
  if (suggestion.type === 'GO_OUT') {
    return [
      `Head to ${suggestion.place?.name ?? 'your spot'}.`,
      'Leave with a 10 minute buffer.',
      `Spend ${formatDuration(suggestion.durationMin)} there.`,
    ];
  }
  return [
    'Open tickets and confirm details.',
    'Leave with a 10 minute buffer.',
    'Arrive a bit early.',
  ];
};

export const SuggestionCard: React.FC<Props> = ({ suggestion, preview }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const stepPreviewCount = preview ? 2 : 3;
  const tagPreviewCount = preview ? 2 : 3;
  const renderSubheader = () => {
    if (suggestion.whyNow) {
      return <Text style={styles.subheader}>{suggestion.whyNow}</Text>;
    }
    if (suggestion.type === 'AT_HOME') {
      return <Text style={styles.subheader}>Fits in {formatDuration(suggestion.durationMin)}</Text>;
    }

    if (suggestion.type === 'EVENT') {
      const startIn = suggestion.meta?.startInMin;
      const eta = formatEta(suggestion.meta?.etaMin);
      if (startIn) {
        return (
          <Text style={styles.subheader}>
            Starts in {startIn}m{eta ? ` - ${eta}` : ''}
          </Text>
        );
      }
      const startAt = fromISO(suggestion.event?.startAt);
      return (
        <Text style={styles.subheader}>
          Starts at {startAt ? formatTime(startAt) : 'soon'}{eta ? ` - ${eta}` : ''}
        </Text>
      );
    }

    const leaveBy = fromISO(suggestion.meta?.leaveBy);
    const eta = formatEta(suggestion.meta?.etaMin);
    const leaveNow = leaveBy ? leaveBy.getTime() - Date.now() <= 5 * 60 * 1000 : false;
    return (
      <Text style={styles.subheader}>
        {leaveBy ? (leaveNow ? 'Leave now' : `Leave by ${formatTime(leaveBy)}`) : `Fits in ${formatDuration(suggestion.durationMin)}`}
        {eta ? ` - ${eta}` : ''}
      </Text>
    );
  };
  return (
    <View style={styles.card}>
      {suggestion.source === 'ticketmaster' && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Ticketmaster</Text>
        </View>
      )}
      {suggestion.source === 'habit' && (
        <View style={[styles.badge, styles.badgeHabit]}>
          <Text style={[styles.badgeText, styles.badgeTextHabit]}>Habit</Text>
        </View>
      )}
      <Text style={styles.title}>{suggestion.title}</Text>
      {renderSubheader()}

      {suggestion.type === 'AT_HOME' && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Why this now</Text>
          <Text style={styles.description}>{suggestion.description}</Text>
          <Text style={styles.eyebrow}>You'll do</Text>
          <View style={styles.steps}>
            {getInstructions(suggestion).slice(0, stepPreviewCount).map((step, index) => (
              <Text key={`${suggestion.id}_step_${index}`} style={styles.stepText}>
                - {step}
              </Text>
            ))}
          </View>
          <Text style={styles.eyebrow}>Good for</Text>
          <View style={styles.tagsRow}>
            <View style={styles.tag}><Text style={styles.tagText}>{formatDuration(suggestion.durationMin)}</Text></View>
            {(suggestion.equipment || []).slice(0, 2).map((item) => (
              <View key={item} style={styles.tag}>
                <Text style={styles.tagText}>{item}</Text>
              </View>
            ))}
            {(suggestion.tags || []).slice(0, tagPreviewCount).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {suggestion.type === 'GO_OUT' && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Why this now</Text>
          <Text style={styles.description}>{suggestion.description}</Text>
          <Text style={styles.eyebrow}>You'll do</Text>
          <View style={styles.steps}>
            {getInstructions(suggestion).slice(0, stepPreviewCount).map((step, index) => (
              <Text key={`${suggestion.id}_go_${index}`} style={styles.stepText}>
                - {step}
              </Text>
            ))}
          </View>
          <View style={styles.metaRow}>
            {formatDistance(suggestion.meta?.distanceKm) && (
              <Text style={styles.metaText}>{formatDistance(suggestion.meta?.distanceKm)}</Text>
            )}
            {formatEta(suggestion.meta?.etaMin) && (
              <Text style={styles.metaText}>{formatEta(suggestion.meta?.etaMin)}</Text>
            )}
            {typeof suggestion.rating === 'number' && (
              <Text style={styles.metaText}>
                {suggestion.rating.toFixed(1)} rating{suggestion.ratingCount ? ` (${suggestion.ratingCount})` : ''}
              </Text>
            )}
            {suggestion.meta?.openStatus === 'open_now' && (
              <Text style={styles.metaText}>Open now</Text>
            )}
            {suggestion.meta?.openStatus === 'opens_soon' && (
              <Text style={styles.metaText}>
                {suggestion.meta.opensInMin ? `Opens in ${suggestion.meta.opensInMin}m` : 'Opens soon'}
              </Text>
            )}
            {suggestion.place?.costHint && (
              <Text style={styles.metaText}>{suggestion.place.costHint}</Text>
            )}
          </View>
          <Text style={styles.eyebrow}>Good for</Text>
          <View style={styles.tagsRow}>
            {(suggestion.tags || []).slice(0, tagPreviewCount).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <MapThumbnail lat={suggestion.place?.lat} lng={suggestion.place?.lng} height={120} />
        </View>
      )}

      {suggestion.type === 'EVENT' && (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Why this now</Text>
          <Text style={styles.description}>{suggestion.description}</Text>
          <Text style={styles.eyebrow}>You'll do</Text>
          <View style={styles.steps}>
            {getInstructions(suggestion).slice(0, stepPreviewCount).map((step, index) => (
              <Text key={`${suggestion.id}_event_${index}`} style={styles.stepText}>
                - {step}
              </Text>
            ))}
          </View>
          <View style={styles.metaRow}>
            {suggestion.event?.priceRange && (
              <Text style={styles.metaText}>{suggestion.event.priceRange}</Text>
            )}
            {suggestion.meta?.etaMin && (
              <Text style={styles.metaText}>{formatEta(suggestion.meta?.etaMin)}</Text>
            )}
            <Text style={styles.metaText}>Tickets</Text>
          </View>
          <Text style={styles.eyebrow}>Good for</Text>
          <View style={styles.tagsRow}>
            {(suggestion.tags || []).slice(0, tagPreviewCount).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          <MapThumbnail lat={suggestion.place?.lat} lng={suggestion.place?.lng} height={120} />
        </View>
      )}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  badge: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    backgroundColor: theme.colors.info,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeHabit: {
    backgroundColor: theme.colors.success,
    right: theme.spacing.md,
    top: theme.spacing.md + 28,
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
    fontSize: 26,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  subheader: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  eyebrow: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: theme.spacing.sm,
  },
  section: {
    gap: theme.spacing.sm,
  },
  description: {
    fontFamily: theme.fonts.body,
    fontSize: 15,
    color: theme.colors.text,
  },
  steps: {
    marginTop: theme.spacing.sm,
  },
  stepText: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: theme.spacing.sm,
  },
  tag: {
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
  },
  tagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
});
