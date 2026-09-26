import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import type { SessionMapEntry } from '../services/sessionMap';
import { SessionActivityMap } from './SessionActivityMap';
import { MapActivityOption, MapCoordinate, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';
import { CARD_HEIGHT } from './cardConstants';

type Props = {
  entries: readonly SessionMapEntry[];
  origin?: MapCoordinate | null;
  activities: readonly MapActivityOption[];
  onSelect: (id: string) => void;
  deckColors?: { bg: string; text: string };
};

export const SessionMapPanel: React.FC<Props> = ({ entries, origin, activities, onSelect, deckColors }) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const [group, setGroup] = useState<string[] | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const travel = useMemo(() => new Map(activities.map(option => [option.suggestion.id, option])), [activities]);
  const rows = group ? entries.filter(entry => group.includes(entry.suggestion.id)) : entries;
  const accent = deckColors?.bg ?? theme.colors.accent;
  return (
    <View testID="session-map-panel" style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border, shadowColor: theme.colors.shadow }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.heading }]}>{de ? 'Noch eine Möglichkeit' : 'Another possibility'}</Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.subtitle, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{de ? 'Deine Alternativen für diese Session' : 'Your alternatives for this session'}</Text>
        </View>
        <Text maxFontSizeMultiplier={1.2} style={[styles.total, { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold }]}>{entries.length}</Text>
      </View>
      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.emptyEmoji}>🗺️</Text>
          <Text style={[styles.emptyTitle, { color: theme.colors.text, fontFamily: theme.fonts.heading }]}>{de ? 'Deine Ideen bleiben in Reichweite' : 'Keep your possibilities close'}</Text>
          <Text style={[styles.emptyCopy, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{de ? 'Übersprungene und gespeicherte Aktivitäten sammeln sich hier. Wenn du die Session verlässt, beginnt die Karte wieder leer.' : 'Skipped and saved activities collect here. Leaving this session clears the map for a fresh start.'}</Text>
        </View>
      ) : (
        <>
          {activities.length > 0 ? <View style={styles.map}>
            <SessionActivityMap activities={activities} origin={origin} accent={accent} accentText={deckColors?.text ?? theme.colors.accentText} onSelect={onSelect} onSelectGroup={ids => { setGroup(ids); scrollRef.current?.scrollTo({ y: 0, animated: false }); }} />
          </View> : <View style={[styles.listOnly, { backgroundColor: theme.colors.accentDim }]}>
            <Text style={styles.listOnlyEmoji}>🏡</Text>
            <Text style={[styles.listOnlyCopy, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{de ? 'Für diese Ideen ist noch kein Kartenpunkt verfügbar. Alle Details findest du unten.' : 'Map pins are not available for these ideas yet. Find all their details below.'}</Text>
          </View>}
          <View style={styles.listHeader}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.listHeading, { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold }]}>{group ? `${rows.length} ${de ? 'Ideen an diesem Ort' : 'ideas in this area'}` : de ? 'ALLE IDEEN' : 'ALL IDEAS'}</Text>
            {group ? <Pressable accessibilityRole="button" accessibilityLabel={de ? 'Alle Ideen anzeigen' : 'Show all ideas'} onPress={() => setGroup(null)} style={styles.allButton}><Text style={[styles.allText, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{de ? 'Alle anzeigen' : 'Show all'}</Text></Pressable> : activities.length > 0 && <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.estimates, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{de ? 'Reisezeiten geschätzt' : 'Travel times estimated'}</Text>}
          </View>
          <ScrollView ref={scrollRef} testID="session-map-list" style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator nestedScrollEnabled>
            {rows.map(entry => {
              const suggestion = entry.suggestion;
              const option = travel.get(suggestion.id);
              const atHome = suggestion.type === 'AT_HOME';
              const subtitle = atHome ? (de ? 'Zu Hause' : 'At home') : suggestion.place?.name?.trim() || (de ? 'Ohne festen Kartenpunkt' : 'No fixed map pin');
              const savedLabel = entry.saved ? (de ? 'Gespeichert' : 'Saved') : '';
              const travelLabel = option ? `${travelIcon(option.travelMode)} ≈ ${travelMinutes(option.travelMin)} min` : '';
              return <Pressable
                key={suggestion.id}
                testID={`session-map-row-${suggestion.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${suggestion.title}, ${subtitle}${savedLabel ? `, ${savedLabel}` : ''}${option ? `, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}` : ''}`}
                accessibilityHint={de ? 'Aktivitätskarte öffnen' : 'Open activity card'}
                onPress={() => onSelect(suggestion.id)}
                style={({ pressed }) => [styles.row, { borderTopColor: theme.colors.border, backgroundColor: pressed ? theme.colors.accentDim : 'transparent' }]}
              >
                <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentDim }]}><Text style={styles.rowEmoji}>{option?.emoji ?? suggestion.emojis?.[0] ?? (atHome ? '🏡' : '✨')}</Text></View>
                <View style={styles.rowCopy}>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.rowTitle, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{suggestion.title}</Text>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.rowPlace, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{subtitle}</Text>
                </View>
                <View style={styles.rowDetail}>
                  {!!travelLabel && <Text maxFontSizeMultiplier={1.2} style={[styles.rowTime, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{travelLabel}</Text>}
                  {entry.saved && <Text maxFontSizeMultiplier={1.2} style={[styles.saved, { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold }]}>♥ {savedLabel}</Text>}
                </View>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, { color: theme.colors.textMuted }]}>›</Text>
              </Pressable>;
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { width: '100%', height: CARD_HEIGHT, borderRadius: 22, borderWidth: 1, overflow: 'hidden', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 18, elevation: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 15, paddingBottom: 11 },
  heading: { flex: 1, minWidth: 0 },
  title: { fontSize: 21, lineHeight: 27 },
  subtitle: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  total: { fontSize: 14, lineHeight: 20 },
  map: { height: 178, marginHorizontal: 10 },
  listOnly: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, padding: 13, borderRadius: 12 },
  listOnlyEmoji: { fontSize: 25 },
  listOnlyCopy: { flex: 1, fontSize: 12, lineHeight: 18 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 37, gap: 8 },
  listHeading: { flexShrink: 1, fontSize: 10, lineHeight: 15, letterSpacing: 0.5 },
  estimates: { fontSize: 9, lineHeight: 13, flexShrink: 1 },
  allButton: { minHeight: 44, justifyContent: 'center', paddingLeft: 8 },
  allText: { fontSize: 11, lineHeight: 16 },
  list: { flex: 1, minHeight: 0 },
  listContent: { paddingHorizontal: 12, paddingBottom: 10 },
  row: { minHeight: 53, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, gap: 8, paddingHorizontal: 2, paddingVertical: 6 },
  rowIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { fontSize: 19 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12, lineHeight: 17 },
  rowPlace: { fontSize: 10, lineHeight: 14 },
  rowDetail: { alignItems: 'flex-end', maxWidth: 95, gap: 1 },
  rowTime: { fontSize: 10, lineHeight: 15 },
  saved: { fontSize: 9, lineHeight: 13 },
  chevron: { fontSize: 22, lineHeight: 26 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 28 },
  emptyEmoji: { fontSize: 52, marginBottom: 19 },
  emptyTitle: { fontSize: 20, lineHeight: 26, textAlign: 'center', marginBottom: 11 },
  emptyCopy: { fontSize: 13, lineHeight: 21, textAlign: 'center' },
});
