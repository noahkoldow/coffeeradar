import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActivityMapProps, isMapCoordinate, mapPosition, mapViewport, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';

/** A geographic overview for web and card previews; it deliberately does not invent roads. */
export const ActivityMapDiagram: React.FC<ActivityMapProps> = ({
  activities, origin, onSelect, preview, accent, accentText,
}) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const [size, setSize] = useState({ width: 320, height: 180 });
  const options = activities.filter(activity => isMapCoordinate(activity.coordinate)).slice(0, 3);
  const viewport = mapViewport(origin, options, size.width / size.height);
  const user = mapPosition(isMapCoordinate(origin) ? origin : { latitude: 0, longitude: 0 }, viewport);
  const color = accent ?? theme.colors.accent;
  const foreground = accentText ?? theme.colors.accentText;
  const positions = (() => {
    const placed = [{ x: user.x * size.width / 100, y: user.y * size.height / 100, width: 24, height: 36 }];
    return options.map(option => {
      const point = mapPosition(option.coordinate, viewport);
      let x = Math.max(40, Math.min(size.width - 40, point.x * size.width / 100));
      let y = Math.max(31, Math.min(size.height - 44, point.y * size.height / 100));
      // If places share an address, separate their buttons and retain a leader
      // to the real coordinate so all three choices remain reachable.
      const overlaps = (candidateX: number, candidateY: number) => placed.some(other => (
        Math.abs(other.x - candidateX) < (other.width + 70) / 2 + 4
        && Math.abs(other.y - candidateY) < (other.height + 56) / 2 + 4
      ));
      const awayFromOrigin = Math.atan2(point.y - user.y, point.x - user.x);
      let found = !overlaps(x, y);
      for (let radius = 16; radius <= 112 && !found; radius += 16) {
        for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
          const angle = awayFromOrigin + turn * Math.PI / 4;
          const candidateX = Math.max(40, Math.min(size.width - 40, point.x * size.width / 100 + Math.cos(angle) * radius));
          const candidateY = Math.max(31, Math.min(size.height - 44, point.y * size.height / 100 + Math.sin(angle) * radius));
          if (overlaps(candidateX, candidateY)) continue;
          x = candidateX;
          y = candidateY;
          found = true;
          break;
        }
      }
      placed.push({ x, y, width: 70, height: 56 });
      return { option, x, y, actualX: point.x * size.width / 100, actualY: point.y * size.height / 100 };
    });
  })();

  return (
    <View
      pointerEvents={preview ? 'none' : 'auto'}
      accessibilityElementsHidden={preview}
      importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) setSize(current => current.width === width && current.height === height ? current : { width, height });
      }}
      style={[styles.map, { backgroundColor: theme.isDark ? '#172B2B' : '#EAF2EB' }]}
    >
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFillObject]} pointerEvents="none">
        {[0.25, 0.5, 0.75].map(fraction => (
          <React.Fragment key={fraction}>
            <Line x1={size.width * fraction} y1={0} x2={size.width * fraction} y2={size.height} stroke={theme.isDark ? '#284140' : '#DBE5DC'} />
            <Line x1={0} y1={size.height * fraction} x2={size.width} y2={size.height * fraction} stroke={theme.isDark ? '#284140' : '#DBE5DC'} />
          </React.Fragment>
        ))}
        {[36, 72, 108].map(radius => <Circle key={radius} cx={user.x * size.width / 100} cy={user.y * size.height / 100} r={radius} fill="none" stroke={color} strokeOpacity={0.12} strokeWidth={1} />)}
        {positions.map(({ option, x, y, actualX, actualY }) => (
          <React.Fragment key={option.suggestion.id}>
            <Line x1={actualX} y1={actualY} x2={x} y2={y} stroke={color} strokeOpacity={0.6} strokeWidth={1.5} />
            <Circle cx={actualX} cy={actualY} r={3} fill={color} />
          </React.Fragment>
        ))}
      </Svg>
      <View pointerEvents="none" style={styles.north}>
        <Text style={[styles.northText, { color: theme.colors.textMuted, fontFamily: theme.fonts.semibold }]}>↑ N</Text>
      </View>
      <View pointerEvents="none" style={[styles.origin, { left: `${user.x}%`, top: `${user.y}%` }]}>
        <View style={[styles.originHalo, { backgroundColor: theme.colors.card }]}><View style={[styles.originDot, { backgroundColor: color }]} /></View>
        <Text style={[styles.originLabel, { color: theme.colors.text, backgroundColor: theme.colors.card, fontFamily: theme.fonts.semibold }]}>{de ? 'Du' : 'You'}</Text>
      </View>
      {positions.map(({ option, x, y }) => (
        <Pressable
          key={option.suggestion.id}
          disabled={preview}
          accessibilityRole="button"
          accessibilityLabel={`${option.suggestion.title}, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}`}
          accessibilityHint={de ? 'Aktivitätskarte öffnen' : 'Open activity card'}
          onPress={() => onSelect(option.suggestion.id)}
          style={({ pressed }) => [styles.pin, { left: x - 35, top: y - 25, opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.pinCircle, { backgroundColor: theme.colors.card, borderColor: color }]}><Text style={styles.emoji}>{option.emoji}</Text></View>
          <View style={[styles.timeBadge, { backgroundColor: color }]}><Text maxFontSizeMultiplier={1.2} style={[styles.timeText, { color: foreground, fontFamily: theme.fonts.semibold }]}>{travelIcon(option.travelMode)} ≈ {travelMinutes(option.travelMin)} min</Text></View>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  map: { flex: 1, overflow: 'hidden', borderRadius: 14, minHeight: 140 },
  north: { position: 'absolute', right: 10, top: 8 },
  northText: { fontSize: 11 },
  origin: { position: 'absolute', alignItems: 'center', marginLeft: -15, marginTop: -10, zIndex: 1 },
  originHalo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  originDot: { width: 12, height: 12, borderRadius: 6 },
  originLabel: { fontSize: 10, borderRadius: 4, paddingHorizontal: 4, marginTop: 2 },
  pin: { position: 'absolute', width: 70, minHeight: 56, alignItems: 'center', zIndex: 2 },
  pinCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 2 },
  emoji: { fontSize: 22, lineHeight: 28 },
  timeBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: -2 },
  timeText: { fontSize: 10, lineHeight: 14 },
});
