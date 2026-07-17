import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DeckSuggestion } from '../../types';
import { useTheme } from '../../theme/ThemeProvider';
import { CARD_HEIGHT } from '../SuggestionCard';

type Props = {
  suggestion: DeckSuggestion;
  preview?: boolean;
  deckColors?: { bg: string; text: string };
};

/**
 * Web fallback — AdMob has no web SDK, so we render a neutral sponsored
 * placeholder that matches the slide design.
 */
export const NativeAdSlide: React.FC<Props> = ({ deckColors }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme, deckColors), [theme, deckColors]);

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.adBadge}>
          <Text style={styles.adBadgeText}>Ad</Text>
        </View>
        <Text style={styles.sponsoredHint}>Sponsored</Text>
      </View>
      <View style={styles.media} />
      <View style={styles.bottom}>
        <Text style={styles.headline}>Sponsored suggestion</Text>
        <Text style={styles.body}>Ads appear here in the mobile app.</Text>
      </View>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>, deckColors?: { bg: string; text: string }) => {
  const accent = deckColors?.bg ?? theme.colors.accent;
  const accentText = deckColors?.text ?? theme.colors.accentText;
  const cardBackground = theme.isDark ? theme.colors.card : '#FFFFFF';
  return StyleSheet.create({
    card: {
      minHeight: CARD_HEIGHT,
      backgroundColor: cardBackground,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      overflow: 'hidden',
      justifyContent: 'space-between',
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    adBadge: {
      backgroundColor: accent,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
    },
    adBadgeText: {
      fontFamily: theme.fonts.semibold,
      fontSize: 11,
      color: accentText,
      letterSpacing: 0.6,
    },
    sponsoredHint: {
      fontFamily: theme.fonts.body,
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    media: {
      flex: 1,
      marginVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.backgroundAlt,
      minHeight: 180,
    },
    bottom: {
      gap: theme.spacing.xs,
    },
    headline: {
      fontFamily: theme.fonts.heading,
      fontSize: 20,
      color: theme.colors.text,
    },
    body: {
      fontFamily: theme.fonts.body,
      fontSize: 14,
      color: theme.colors.textMuted,
    },
  });
};

export default NativeAdSlide;
