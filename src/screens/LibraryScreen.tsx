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

type Props = StackScreenProps<RootStackParamList, 'Library'>;
type FilterType = 'all' | SuggestionType;

const isChallengeSuggestion = (suggestion: DeckSuggestion): boolean => {
  const haystack = [suggestion.title, suggestion.cta, suggestion.hook, suggestion.description].join(' ').toLowerCase();
  return /challenge|quest|mission|race|sprint|try this/.test(haystack);
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

  const flip = () => {
    const toValue = flipped ? 0 : 1;
    Animated.spring(rotate, { toValue, tension: 90, friction: 9, useNativeDriver: true }).start();
    setFlipped(!flipped);
  };

  const navigateToStart = () => {
    const now = new Date();
    const commitment: Commitment = {
      suggestionId: item.suggestion.id,
      type: item.suggestion.type,
      title: item.suggestion.title,
      startAt: now.toISOString(),
      endAt: new Date(now.getTime() + item.suggestion.durationMin * 60000).toISOString(),
    };
    onStart();
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => {
      pan.setValue(gesture.dx);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < -90) {
        Animated.timing(pan, { toValue: -420, duration: 180, useNativeDriver: true }).start(() => {
          onStart();
          pan.setValue(0);
        });
        return;
      }
      if (gesture.dx > 90) {
        Animated.timing(pan, { toValue: 420, duration: 180, useNativeDriver: true }).start(() => {
          onRemove();
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
      <View style={cardStyles.cardHeader}>
        <View style={cardStyles.tagRow}>
          <View style={cardStyles.typePill}>
            <Text style={cardStyles.typePillText}>{item.suggestion.type.replace('_', ' ')}</Text>
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
      <Text style={cardStyles.meta}>{new Date(item.savedAt).toLocaleDateString()} · {item.suggestion.durationMin} min</Text>
      <Text style={cardStyles.desc} numberOfLines={3}>{item.suggestion.description}</Text>
      {item.suggestion.place?.name && (
        <Text style={cardStyles.place} numberOfLines={1}>
          {item.suggestion.place.name}{item.suggestion.place.address ? ` · ${item.suggestion.place.address}` : ''}
        </Text>
      )}
      <Text style={cardStyles.flipHint}>Tap or swipe to open</Text>
    </View>
  );

  const back = (
    <View style={[cardStyles.cardFront, cardStyles.cardBack]}>
      <Text style={cardStyles.backKicker}>Saved activity</Text>
      <Text style={cardStyles.backTitle}>Turn this into a habit</Text>
      <Text style={cardStyles.backDesc}>{item.suggestion.hook ?? item.suggestion.description}</Text>
      <View style={cardStyles.backMetaRow}>
        {(item.suggestion.tags ?? []).slice(0, 3).map((tag) => (
          <View key={tag} style={cardStyles.backTag}>
            <Text style={cardStyles.backTagText}>{tag}</Text>
          </View>
        ))}
      </View>
      <Pressable style={({ pressed }) => [cardStyles.addHabitBtn, pressed && { opacity: 0.85 }]} onPress={onAddHabit}>
        <Text style={cardStyles.addHabitBtnText}>Add Habit</Text>
      </Pressable>
      <Text style={cardStyles.backHint}>Swipe left to do it now · swipe right to delete</Text>
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

      <View style={styles.filterBar}>
        {(['all', 'AT_HOME', 'GO_OUT', 'EVENT'] as FilterType[]).map((filter) => (
          <Pressable
            key={filter}
            style={[styles.filterButton, activeFilter === filter && styles.filterButtonActive]}
            onPress={() => setActiveFilter(filter)}
          >
            <Text style={styles.filterEmoji}>{filterEmojis[filter]}</Text>
            <Text style={[styles.filterLabel, activeFilter === filter && styles.filterLabelActive]}>{filterLabels[filter]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>↞</Text>
          <Text style={styles.legendText}>Check</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>✓</Text>
          <Text style={styles.legendText}>Do it</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>↠</Text>
          <Text style={styles.legendText}>Delete</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>✕</Text>
          <Text style={styles.legendText}>Remove</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {items.length === 0 && (
          <Text style={styles.empty}>
            {allItems.length === 0
              ? 'No saved ideas yet. Use Save for later in the deck.'
              : `No ${filterLabels[activeFilter]} ideas saved yet. Try a different filter!`}
          </Text>
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
    minHeight: 250,
  },
  card: {
    minHeight: 250,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    backfaceVisibility: 'hidden',
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
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
    backgroundColor: theme.colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typePillText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
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
    backgroundColor: theme.colors.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  backTagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.text,
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
  subtitle: { marginTop: theme.spacing.xs, color: theme.colors.textMuted, fontFamily: theme.fonts.body },
  filterBar: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  filterEmoji: { fontSize: 18 },
  filterLabel: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
  filterLabelActive: {
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
  empty: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, marginTop: theme.spacing.md },
});
