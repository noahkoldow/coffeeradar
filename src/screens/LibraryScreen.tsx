import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StackScreenProps } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { SuggestionType } from '../types';

type Props = StackScreenProps<RootStackParamList, 'Library'>;
type FilterType = 'all' | SuggestionType;

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

  const allItems = [...state.savedSuggestions]
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  const items = activeFilter === 'all'
    ? allItems
    : allItems.filter(item => item.suggestion.type === activeFilter);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved Library</Text>
        <Text style={styles.subtitle}>Your liked ideas are stored here for quick access.</Text>
      </View>

      <View style={styles.filterBar}>
        {(['all', 'AT_HOME', 'GO_OUT', 'EVENT'] as FilterType[]).map((filter) => (
          <Pressable
            key={filter}
            style={[
              styles.filterButton,
              activeFilter === filter && styles.filterButtonActive,
            ]}
            onPress={() => setActiveFilter(filter)}
          >
            <Text style={styles.filterEmoji}>{filterEmojis[filter]}</Text>
            <Text style={[
              styles.filterLabel,
              activeFilter === filter && styles.filterLabelActive,
            ]}>
              {filterLabels[filter]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Queue suggestions button */}
      {items.length > 0 && (
        <Pressable
          onPress={() => {
            const filter = activeFilter === 'all' ? undefined : 
                          activeFilter === 'AT_HOME' ? 'at_home' :
                          activeFilter === 'GO_OUT' ? 'go_out' : undefined;
            navigation.navigate('Deck', { filter });
          }}
          style={({ pressed }) => [styles.queueButton, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.queueButtonText}>+ Queue suggestions</Text>
        </Pressable>
      )}

      <ScrollView contentContainerStyle={styles.content}>
        {items.length === 0 && (
          <Text style={styles.empty}>
            {allItems.length === 0
              ? "No saved ideas yet. Use \"Save for later\" or \"Just save ❤️\" in the deck."
              : `No ${filterLabels[activeFilter]} ideas saved yet. Try a different filter!`}
          </Text>
        )}

        {items.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.suggestion.title}</Text>
            <Text style={styles.cardMeta}>
              {item.suggestion.type.replace('_', ' ')} · {new Date(item.savedAt).toLocaleString()}
            </Text>
            <Text style={styles.cardDesc}>{item.suggestion.description}</Text>
            {!!item.suggestion.place?.name && (
              <Text style={styles.place}>{item.suggestion.place.name}{item.suggestion.place.address ? `, ${item.suggestion.place.address}` : ''}</Text>
            )}
            <View style={styles.row}>
              <Pressable
                style={styles.action}
                onPress={() => {
                  const filter = item.suggestion.type === 'AT_HOME' ? 'at_home' : 'go_out';
                  navigation.navigate('Deck', { filter });
                }}
              >
                <Text style={styles.actionText}>Do similar now</Text>
              </Pressable>
              <Pressable
                style={styles.action}
                onPress={() => actions.removeSavedSuggestion(item.id)}
              >
                <Text style={styles.actionText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1, padding: theme.spacing.lg },
  header: { marginBottom: theme.spacing.md },
  back: { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold },
  title: { marginTop: theme.spacing.sm, fontSize: 28, color: theme.colors.text, fontFamily: theme.fonts.heading },
  subtitle: { marginTop: theme.spacing.xs, color: theme.colors.textMuted, fontFamily: theme.fonts.body },
  filterBar: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
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
  filterEmoji: {
    fontSize: 18,
  },
  filterLabel: {
    color: theme.colors.textMuted,
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
  },
  filterLabelActive: {
    color: theme.colors.accentText,
  },
  queueButton: {
    marginBottom: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
  },
  queueButtonText: {
    color: '#fff',
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
  },
  content: { gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  empty: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, marginTop: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTitle: { color: theme.colors.text, fontFamily: theme.fonts.semibold, fontSize: 17 },
  cardMeta: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, fontSize: 12 },
  cardDesc: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 14 },
  place: { color: theme.colors.textMuted, fontFamily: theme.fonts.body, fontSize: 13 },
  row: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  action: {
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionText: { color: theme.colors.text, fontFamily: theme.fonts.semibold, fontSize: 13 },
});
