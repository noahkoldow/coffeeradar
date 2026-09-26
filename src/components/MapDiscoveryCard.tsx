import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActivityMap } from './ActivityMap';
import { MapActivityOption, MapCoordinate, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';
import { CARD_HEIGHT } from './cardConstants';

export type { MapActivityOption } from './ActivityMap.types';

type Props = {
  activities: readonly MapActivityOption[];
  origin: MapCoordinate;
  onSelect: (id: string) => void;
  preview?: boolean;
  deckColors?: { bg: string; text: string };
};

export const MapDiscoveryCard: React.FC<Props> = ({ activities, origin, onSelect, preview, deckColors }) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const options = activities.slice(0, 3);
  const accent = deckColors?.bg ?? theme.colors.accent;
  const accentText = deckColors?.text ?? theme.colors.accentText;
  return (
    <View
      pointerEvents={preview ? 'none' : 'auto'}
      accessibilityElementsHidden={preview}
      importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}
      style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border, shadowColor: theme.colors.shadow }]}
    >
      <LinearGradient colors={[theme.colors.accentDim, theme.colors.card]} start={{ x: 1, y: 0 }} end={{ x: 0.15, y: 1 }} style={styles.headerWash} pointerEvents="none" />
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text maxFontSizeMultiplier={1.2} style={[styles.eyebrow, { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold }]}>{de ? 'ENTDECKE DEINE UMGEBUNG' : 'A LITTLE LOCAL DISCOVERY'}</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15} style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.heading }]}>{de ? 'Entdecke die Nähe' : 'Explore nearby'}</Text>
        </View>
        <View style={[styles.corner, { backgroundColor: accent }]}><Text style={[styles.cornerArrow, { color: accentText }]}>↗</Text></View>
      </View>
      <View style={styles.map}>
        <ActivityMap activities={options} origin={origin} onSelect={onSelect} preview={preview} accent={accent} accentText={accentText} />
      </View>
      <View style={styles.legend}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.legendText, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{de ? 'Fahr- & Gehzeiten geschätzt · Tippe eine Idee an' : 'Estimated travel times · choose a pin'}</Text>
      </View>
      <View style={styles.activities}>
        {options.map((option, index) => (
          <Pressable
            key={option.suggestion.id}
            disabled={preview}
            onPress={() => onSelect(option.suggestion.id)}
            accessibilityRole="button"
            accessibilityLabel={`${option.suggestion.title}, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}`}
            accessibilityHint={de ? 'Aktivitätskarte öffnen' : 'Open activity card'}
            style={({ pressed }) => [styles.row, { borderTopColor: index ? theme.colors.border : 'transparent', backgroundColor: pressed ? theme.colors.accentDim : 'transparent' }]}
          >
            <View style={[styles.rowIcon, { backgroundColor: theme.colors.accentDim }]}><Text style={styles.rowEmoji}>{option.emoji}</Text></View>
            <View style={styles.rowCopy}>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.rowTitle, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{option.suggestion.title}</Text>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.rowPlace, { color: theme.colors.textMuted, fontFamily: theme.fonts.body }]}>{option.suggestion.place?.name || (de ? 'In deiner Nähe' : 'Nearby')}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.2} style={[styles.rowTime, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{travelIcon(option.travelMode)} ≈ {travelMinutes(option.travelMin)} min</Text>
            <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.chevron, { color: theme.colors.textMuted }]}>›</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { width: '100%', height: CARD_HEIGHT, borderRadius: 22, borderWidth: 1, overflow: 'hidden', paddingBottom: 9, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  headerWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 100 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 17, paddingTop: 16, paddingBottom: 12 },
  heading: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 9, lineHeight: 13, letterSpacing: 1.25 },
  title: { fontSize: 23, lineHeight: 28, marginTop: 3 },
  corner: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cornerArrow: { fontSize: 27, lineHeight: 30 },
  map: { flex: 1, minHeight: 140, marginHorizontal: 11 },
  legend: { height: 27, justifyContent: 'center', paddingHorizontal: 17 },
  legendText: { fontSize: 10, lineHeight: 14 },
  activities: { paddingHorizontal: 13 },
  row: { height: 43, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, gap: 9, borderRadius: 6, paddingHorizontal: 3 },
  rowIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowEmoji: { fontSize: 18 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12, lineHeight: 16 },
  rowPlace: { fontSize: 9, lineHeight: 13 },
  rowTime: { fontSize: 11, lineHeight: 16 },
  chevron: { fontSize: 23, lineHeight: 27 },
});
