import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { isMapCoordinate, mapPosition, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';
import { clusterSessionActivities, SessionActivityMapProps, sessionMapViewport } from './SessionActivityMap.types';

/** Web keeps a geographic overview without paid tiles or invented streets. */
export const SessionActivityMap: React.FC<SessionActivityMapProps> = ({ activities, origin, onSelect, onSelectGroup, accent, accentText }) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const [size, setSize] = useState({ width: 320, height: 178 });
  const viewport = sessionMapViewport(origin, activities, size.width / size.height);
  const clusters = clusterSessionActivities(activities, viewport, size.width, size.height);
  const user = origin && isMapCoordinate(origin) ? mapPosition(origin, viewport) : null;
  const color = accent ?? theme.colors.accent;
  const foreground = accentText ?? theme.colors.accentText;
  return <View testID="session-map-overview" onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }} style={[styles.map, { backgroundColor: theme.isDark ? '#172B2B' : '#EAF2EB' }]}>
    <Svg width="100%" height="100%" style={[StyleSheet.absoluteFillObject]} pointerEvents="none">
      {[0.25, 0.5, 0.75].map(fraction => <React.Fragment key={fraction}>
        <Line x1={size.width * fraction} y1={0} x2={size.width * fraction} y2={size.height} stroke={theme.isDark ? '#284140' : '#DBE5DC'} />
        <Line x1={0} y1={size.height * fraction} x2={size.width} y2={size.height * fraction} stroke={theme.isDark ? '#284140' : '#DBE5DC'} />
      </React.Fragment>)}
      {user && [36, 72, 108].map(radius => <Circle key={radius} cx={user.x * size.width / 100} cy={user.y * size.height / 100} r={radius} fill="none" stroke={color} strokeOpacity={0.12} />)}
    </Svg>
    <Text pointerEvents="none" style={[styles.north, { color: theme.colors.textMuted }]}>↑ N</Text>
    {user && <View pointerEvents="none" style={[styles.origin, { left: `${user.x}%`, top: `${user.y}%` }]}>
      <View style={[styles.originHalo, { backgroundColor: theme.colors.card }]}><View style={[styles.originDot, { backgroundColor: color }]} /></View>
      <Text style={[styles.originLabel, { color: theme.colors.text, backgroundColor: theme.colors.card, fontFamily: theme.fonts.semibold }]}>{de ? 'Du' : 'You'}</Text>
    </View>}
    {clusters.map(cluster => {
      const point = mapPosition(cluster.coordinate, viewport);
      const x = Math.max(38, Math.min(size.width - 38, point.x * size.width / 100));
      const y = Math.max(24, Math.min(size.height - 38, point.y * size.height / 100));
      const grouped = cluster.activities.length > 1;
      const option = cluster.activities[0];
      return <Pressable
        key={cluster.key}
        testID={`session-map-pin-${cluster.key}`}
        accessibilityRole="button"
        accessibilityLabel={grouped ? `${cluster.activities.length} ${de ? 'Aktivitäten an diesem Ort' : 'activities in this area'}` : `${option.suggestion.title}, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}`}
        accessibilityHint={grouped ? (de ? 'Ideen in der Liste anzeigen' : 'Show these ideas in the list') : (de ? 'Aktivitätskarte öffnen' : 'Open activity card')}
        onPress={() => grouped ? onSelectGroup(cluster.activities.map(activity => activity.suggestion.id)) : onSelect(option.suggestion.id)}
        style={({ pressed }) => [styles.pin, { left: x - 38, top: y - 22, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.circle, { backgroundColor: grouped ? color : theme.colors.card, borderColor: color }]}><Text style={[grouped ? styles.clusterCount : styles.emoji, { color: foreground, fontFamily: grouped ? theme.fonts.semibold : undefined }]}>{grouped ? cluster.activities.length : option.emoji}</Text></View>
        <View style={[styles.label, { backgroundColor: theme.colors.card }]}><Text maxFontSizeMultiplier={1.2} style={[styles.labelText, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{grouped ? (de ? 'Ideen öffnen' : 'View ideas') : `${travelIcon(option.travelMode)} ≈ ${travelMinutes(option.travelMin)} min`}</Text></View>
      </Pressable>;
    })}
  </View>;
};

const styles = StyleSheet.create({
  map: { flex: 1, overflow: 'hidden', borderRadius: 13 },
  north: { position: 'absolute', right: 8, top: 6, fontSize: 10 },
  origin: { position: 'absolute', alignItems: 'center', marginLeft: -13, marginTop: -10 },
  originHalo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  originDot: { width: 12, height: 12, borderRadius: 6 },
  originLabel: { fontSize: 10, lineHeight: 14, borderRadius: 4, paddingHorizontal: 4, marginTop: 2 },
  pin: { position: 'absolute', width: 76, minHeight: 62, alignItems: 'center', zIndex: 2 },
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24, lineHeight: 30 },
  clusterCount: { fontSize: 17, lineHeight: 23 },
  label: { borderRadius: 7, paddingHorizontal: 5, paddingVertical: 1, marginTop: -2 },
  labelText: { fontSize: 9, lineHeight: 14 },
});
