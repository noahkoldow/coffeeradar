import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { DeckSuggestion, Commitment, SuggestionType, Habit } from '../types';
import { getConfirmedSocialProofCount, isSocialActivitySuggestion } from '../utils/social';
import { getVisibleTags } from '../utils/visibleTags';

type Props = StackScreenProps<RootStackParamList, 'Library'>;
type FilterType = 'all' | SuggestionType;

const isChallengeSuggestion = (suggestion: DeckSuggestion): boolean => {
  const haystack = [suggestion.title, suggestion.cta, suggestion.hook, suggestion.description].join(' ').toLowerCase();
  return /challenge|quest|mission|race|sprint|try this/.test(haystack);
};

type BadgeTone = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
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
  if (/(challenge|quest|mission|sprint|hard|intense|push)/.test(t)) {
    return { hue: 280, saturation: 44, textColor: '#6A2B8E' };
  }
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

const getTagTone = (tag: string): BadgeTone => {
  const normalized = tag.trim().toLowerCase();
  const family = getTagFamily(normalized);
  const offset = hashString(normalized) % 5;
  const palette = pastelFromHue((family.hue + offset * 7) % 360, family.saturation, offset);
  return {
    ...palette,
    textColor: family.textColor,
  };
};

const getTypeTone = (type: SuggestionType, theme: ReturnType<typeof useTheme>): BadgeTone => {
  if (type === 'AT_HOME') {
    return {
      backgroundColor: theme.isDark ? 'rgba(120, 168, 255, 0.24)' : '#EAF1FF',
      borderColor: theme.isDark ? 'rgba(120, 168, 255, 0.4)' : '#C7D8FF',
      textColor: theme.isDark ? '#BBD3FF' : '#2F5DB8',
    };
  }
  if (type === 'GO_OUT') {
    return {
      backgroundColor: theme.isDark ? 'rgba(91, 196, 154, 0.22)' : '#E8F7EF',
      borderColor: theme.isDark ? 'rgba(91, 196, 154, 0.38)' : '#B7DEC8',
      textColor: theme.isDark ? '#9DD9BB' : '#2E8055',
    };
  }
  return {
    backgroundColor: theme.isDark ? 'rgba(248, 160, 98, 0.22)' : '#FFF1E7',
    borderColor: theme.isDark ? 'rgba(248, 160, 98, 0.38)' : '#F1D0B9',
    textColor: theme.isDark ? '#F7C7A5' : '#A05A2D',
  };
};

const formatSavedLabel = (savedAtIso: string): string => {
  const savedAt = new Date(savedAtIso).getTime();
  const diffMs = Date.now() - savedAt;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / dayMs);
  if (days <= 0) return 'Saved today';
  if (days === 1) return 'Saved yesterday';
  if (days < 7) return `Saved ${days} days ago`;
  return `Saved on ${new Date(savedAtIso).toLocaleDateString()}`;
};

const SavedActivityCard: React.FC<{
  item: { id: string; savedAt: string; suggestion: DeckSuggestion };
  onRemove: () => void;
  onStart: () => void;
  onAddHabit: () => void;
}> = ({ item, onRemove, onStart, onAddHabit }) => {
  const theme = useTheme();
  const cardStyles = useMemo(() => createCardStyles(theme), [theme]);
  const [flipped, setFlipped] = useState(false);
  const rotate = useRef(new Animated.Value(0)).current;
  const pan = useRef(new Animated.Value(0)).current;

  const isSocialActivity = useMemo(() => isSocialActivitySuggestion(item.suggestion), [item.suggestion]);
  const socialProofCount = useMemo(() => getConfirmedSocialProofCount(item.suggestion), [item.suggestion]);
  const isChallenge = isChallengeSuggestion(item.suggestion);
  const typeTone = useMemo(() => getTypeTone(item.suggestion.type, theme), [item.suggestion.type, theme]);
  const frontTags = useMemo(() => getVisibleTags(item.suggestion.tags, 4), [item.suggestion.tags]);
  const backTags = useMemo(() => getVisibleTags(item.suggestion.tags, 5), [item.suggestion.tags]);
  const primaryTone = useMemo(
    () => (frontTags.length ? getTagTone(frontTags[0]) : typeTone),
    [frontTags, typeTone],
  );

  const flip = () => {
    const toValue = flipped ? 0 : 1;
    Animated.spring(rotate, { toValue, tension: 90, friction: 9, useNativeDriver: true }).start();
    setFlipped(!flipped);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => {
      pan.setValue(gesture.dx);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < -90) {
        Animated.timing(pan, { toValue: -420, duration: 180, useNativeDriver: true }).start(() => {
          onRemove();
          pan.setValue(0);
        });
        return;
      }
      if (gesture.dx > 90) {
        Animated.timing(pan, { toValue: 420, duration: 180, useNativeDriver: true }).start(() => {
          onStart();
          pan.setValue(0);
        });
        return;
      }
      Animated.spring(pan, { toValue: 0, tension: 110, friction: 12, useNativeDriver: true }).start();
      if (Math.abs(gesture.dx) < 6) flip();
    },
    onPanResponderTerminate: () => {
      Animated.spring(pan, { toValue: 0, tension: 110, friction: 12, useNativeDriver: true }).start();
    },
  }), [onRemove, onStart, pan, flipped]);

  const frontRotate = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = rotate.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const frontOpacity = rotate.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [1, 1, 0, 0] });
  const backOpacity = rotate.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [0, 0, 1, 1] });

  const front = (
    <View style={cardStyles.cardFront}>
      <View style={[cardStyles.topAccent, { backgroundColor: primaryTone.borderColor }]} />
      <View style={cardStyles.cardHeader}>
        <View style={cardStyles.tagRow}>
          <View style={[cardStyles.typePill, { backgroundColor: typeTone.backgroundColor, borderColor: typeTone.borderColor }]}>
            <Text style={[cardStyles.typePillText, { color: typeTone.textColor }]}>{item.suggestion.type.replace('_', ' ')}</Text>
          </View>
          {isChallenge && (
            <View style={cardStyles.challengePill}>
              <Text style={cardStyles.challengePillText}>Challenge</Text>
            </View>
          )}
        </View>
        {isSocialActivity && (
          <View style={cardStyles.avatarStack}>
            <View style={cardStyles.socialBadge}>
              <Text style={cardStyles.socialBadgeText}>
                {socialProofCount > 0 ? `${socialProofCount} going` : 'Social'}
              </Text>
            </View>
          </View>
        )}
      </View>

      <Text style={cardStyles.title}>{item.suggestion.title}</Text>
      <Text style={cardStyles.meta}>{formatSavedLabel(item.savedAt)} · {item.suggestion.durationMin} min</Text>
      <Text style={cardStyles.desc} numberOfLines={3}>{item.suggestion.description}</Text>
      {frontTags.length > 0 && (
        <View style={cardStyles.frontTagRow}>
          {frontTags.map((tag) => {
            const tone = getTagTone(tag);
            return (
              <View key={tag} style={[cardStyles.frontTag, { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor }]}>
                <Text style={[cardStyles.frontTagText, { color: tone.textColor }]} numberOfLines={1}>{tag}</Text>
              </View>
            );
          })}
        </View>
      )}
      {item.suggestion.place?.name && (
        <Text style={cardStyles.place} numberOfLines={1}>
          {item.suggestion.place.name}{item.suggestion.place.address ? ` · ${item.suggestion.place.address}` : ''}
        </Text>
      )}
      <Text style={cardStyles.flipHint}>Do now →</Text>
    </View>
  );

  const back = (
    <View style={[cardStyles.cardFront, cardStyles.cardBack]}>
      <Text style={cardStyles.backKicker}>Saved activity</Text>
      <Text style={cardStyles.backTitle}>Turn this into a habit</Text>
      <Text style={cardStyles.backDesc}>{item.suggestion.hook ?? item.suggestion.description}</Text>
      <View style={cardStyles.backMetaRow}>
        {backTags.map((tag) => {
          const tone = getTagTone(tag);
          return (
          <View key={tag} style={[cardStyles.backTag, { backgroundColor: tone.backgroundColor, borderColor: tone.borderColor }]}>
            <Text style={[cardStyles.backTagText, { color: tone.textColor }]}>{tag}</Text>
          </View>
          );
        })}
      </View>
      <Pressable style={({ pressed }) => [cardStyles.addHabitBtn, pressed && { opacity: 0.85 }]} onPress={onAddHabit}>
        <Text style={cardStyles.addHabitBtnText}>Add Habit</Text>
      </Pressable>
      <Text style={cardStyles.backHint}>Swipe right to do it now · swipe left to delete</Text>
    </View>
  );

  return (
    <Animated.View style={[cardStyles.outer, { transform: [{ translateX: pan }] }]} {...panResponder.panHandlers}>
      <Pressable onPress={flip}>
        <View style={cardStyles.cardWrap}>
          <Animated.View style={[cardStyles.card, { opacity: frontOpacity, transform: [{ perspective: 1000 }, { rotateY: frontRotate }] }]} pointerEvents={flipped ? 'none' : 'auto'}>
            {front}
          </Animated.View>
          <Animated.View style={[cardStyles.card, cardStyles.cardBackLayer, { opacity: backOpacity, transform: [{ perspective: 1000 }, { rotateY: backRotate }] }]} pointerEvents={flipped ? 'auto' : 'none'}>
            {back}
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

export const LibraryScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { state, actions } = useAppState();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const filterEmojis: Record<FilterType, string> = {
    all: '📚',
    AT_HOME: '🏠',
    GO_OUT: '🌍',
    EVENT: '🎭',
  };

  const filterLabels: Record<FilterType, string> = {
    all: 'All',
    AT_HOME: 'At Home',
    GO_OUT: 'Go Out',
    EVENT: 'Events',
  };

  const allItems = [...state.savedSuggestions].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  const items = activeFilter === 'all' ? allItems : allItems.filter((item) => item.suggestion.type === activeFilter);
  const filterCounts = {
    all: allItems.length,
    AT_HOME: allItems.filter((item) => item.suggestion.type === 'AT_HOME').length,
    GO_OUT: allItems.filter((item) => item.suggestion.type === 'GO_OUT').length,
    EVENT: allItems.filter((item) => item.suggestion.type === 'EVENT').length,
  } as Record<FilterType, number>;

  const addHabitFromSuggestion = (suggestion: DeckSuggestion) => {
    const habit: Habit = {
      id: `habit_${Date.now()}`,
      name: suggestion.title,
      type: suggestion.type === 'AT_HOME' ? 'AT_HOME' : 'GO_OUT',
      lengthMin: suggestion.durationMin,
      description: suggestion.description,
      frequency: 'daily',
      timeOfDay: 'any',
      tags: suggestion.tags ?? [],
      createdAt: new Date().toISOString(),
      lastCompletedAt: null,
      currentStreak: 0,
      longestStreak: 0,
      completionHistory: [],
    };
    actions.addHabit(habit);
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved Library</Text>
        <Text style={styles.subtitle}>Saved activities now feel like cards, not a list.</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {(['all', 'AT_HOME', 'GO_OUT', 'EVENT'] as FilterType[]).map((filter) => (
          <Pressable
            key={filter}
            style={[styles.filterButton, activeFilter === filter && styles.filterButtonActive]}
            onPress={() => setActiveFilter(filter)}
          >
            <Text style={[styles.filterEmoji, activeFilter === filter && styles.filterEmojiActive]}>{filterEmojis[filter]}</Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={[styles.filterLabel, activeFilter === filter && styles.filterLabelActive]}
            >
              {filterLabels[filter]}
            </Text>
            <View style={[styles.filterCountPill, activeFilter === filter && styles.filterCountPillActive]}>
              <Text style={[styles.filterCountText, activeFilter === filter && styles.filterCountTextActive]}>{filterCounts[filter]}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>↞</Text>
          <Text style={styles.legendText}>Delete</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>↠</Text>
          <Text style={styles.legendText}>Do it</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {items.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Your library is waiting</Text>
            <Text style={styles.empty}>
              {allItems.length === 0
                ? 'No saved ideas yet. Use Save for later in the deck to keep your favorites here.'
                : `No ${filterLabels[activeFilter]} ideas saved yet. Try a different filter.`}
            </Text>
          </View>
        )}

        {items.map((item) => (
          <SavedActivityCard
            key={item.id}
            item={item}
            onRemove={() => actions.removeSavedSuggestion(item.id)}
            onStart={() => {
              const now = new Date();
              const commitment: Commitment = {
                suggestionId: item.suggestion.id,
                type: item.suggestion.type,
                title: item.suggestion.title,
                startAt: now.toISOString(),
                endAt: new Date(now.getTime() + item.suggestion.durationMin * 60000).toISOString(),
              };
              navigation.navigate('Plan', { commitment, suggestion: item.suggestion });
            }}
            onAddHabit={() => addHabitFromSuggestion(item.suggestion)}
          />
        ))}
      </ScrollView>
    </LinearGradient>
  );
};

const createCardStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  outer: {
    marginBottom: theme.spacing.md,
  },
  cardWrap: {
    minHeight: 282,
  },
  card: {
    minHeight: 282,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    backfaceVisibility: 'hidden',
    shadowColor: theme.colors.shadow,
    shadowOpacity: theme.isDark ? 0.26 : 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  cardBackLayer: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  cardFront: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  topAccent: {
    position: 'absolute',
    top: -theme.spacing.lg,
    left: -theme.spacing.md,
    right: -theme.spacing.md,
    height: 14,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    opacity: 0.9,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    flex: 1,
  },
  typePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typePillText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  challengePill: {
    backgroundColor: theme.colors.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  challengePillText: {
    fontFamily: theme.fonts.semibold,
    color: '#fff',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  socialBadge: {
    backgroundColor: theme.colors.info,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  socialBadgeText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.infoText,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  title: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    fontSize: 22,
    lineHeight: 26,
  },
  meta: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  desc: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  frontTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frontTag: {
    borderRadius: theme.radius.full,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    maxWidth: '48%',
  },
  frontTagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
  },
  place: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  flipHint: {
    marginTop: 'auto',
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
    fontSize: 11,
    textAlign: 'right',
  },
  backKicker: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
  },
  backTitle: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    fontSize: 20,
  },
  backDesc: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  backMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  backTag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  backTagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
  },
  addHabitBtn: {
    marginTop: 'auto',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addHabitBtnText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
  },
  backHint: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
});

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1, padding: theme.spacing.lg },
  header: { marginBottom: theme.spacing.md },
  back: { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold },
  title: { marginTop: theme.spacing.sm, fontSize: 28, color: theme.colors.text, fontFamily: theme.fonts.heading },
  subtitle: { marginTop: theme.spacing.xs, color: theme.colors.textMuted, fontFamily: theme.fonts.body, lineHeight: 20 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingRight: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 9,
    borderRadius: theme.radius.md,
    backgroundColor: theme.isDark ? theme.colors.card : '#F6F8FC',
    borderWidth: 1,
    borderColor: theme.colors.border,
    minWidth: 92,
    maxWidth: 150,
    flexShrink: 1,
  },
  filterButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  filterEmoji: { fontSize: 16 },
  filterEmojiActive: { transform: [{ scale: 1.02 }] },
  filterLabel: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    flexShrink: 1,
  },
  filterLabelActive: {
    color: theme.colors.accentText,
  },
  filterCountPill: {
    marginLeft: 2,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.card,
  },
  filterCountPillActive: {
    backgroundColor: theme.isDark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.22)',
  },
  filterCountText: {
    color: theme.colors.text,
    textAlign: 'center',
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
  },
  filterCountTextActive: {
    color: theme.colors.accentText,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendIcon: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
  },
  legendText: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.body,
    fontSize: 12,
  },
  content: { gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  emptyCard: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.heading,
    fontSize: 20,
  },
  empty: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, marginTop: theme.spacing.md },
});
