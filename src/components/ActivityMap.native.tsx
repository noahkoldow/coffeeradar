import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { ActivityMapDiagram } from './ActivityMapDiagram';
import { ActivityMapProps, isMapCoordinate, mapViewport, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';

export const ActivityMap: React.FC<ActivityMapProps> = props => {
  const { activities, origin, onSelect, preview, accent, accentText } = props;
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const [aspect, setAspect] = useState(1.8);
  const color = accent ?? theme.colors.accent;
  const foreground = accentText ?? theme.colors.accentText;
  // Measure and render the final surface while covered so promotion never
  // replaces the diagram or refits a newly mounted map after the swipe.
  if (!isMapCoordinate(origin)) return <ActivityMapDiagram {...props} />;
  const options = activities.filter(activity => isMapCoordinate(activity.coordinate)).slice(0, 3);
  return (
    <View
      pointerEvents={preview ? 'none' : 'auto'}
      accessibilityElementsHidden={preview}
      importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}
      style={styles.wrap} onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) setAspect(width / height);
    }}>
      <MapView
        style={StyleSheet.absoluteFill}
        region={mapViewport(origin, options, aspect)}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        zoomTapEnabled={false}
        moveOnMarkerPress={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsScale={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsPointsOfInterest={false}
        userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
      >
        <Marker coordinate={origin} anchor={{ x: 0.5, y: 0.3 }} tappable={false} zIndex={0}>
          <View style={styles.origin}>
            <View style={[styles.originHalo, { backgroundColor: theme.colors.card }]}><View style={[styles.originDot, { backgroundColor: color }]} /></View>
            <Text style={[styles.originLabel, { color: theme.colors.text, backgroundColor: theme.colors.card, fontFamily: theme.fonts.semibold }]}>{de ? 'Du' : 'You'}</Text>
          </View>
        </Marker>
        {options.map(option => (
          <Marker
            key={option.suggestion.id}
            identifier={option.suggestion.id}
            coordinate={option.coordinate}
            anchor={{ x: 0.5, y: 0.55 }}
            zIndex={2}
            tappable={!preview}
            onPress={event => { event.stopPropagation(); if (!preview) onSelect(option.suggestion.id); }}
            accessibilityRole="button"
            accessibilityLabel={`${option.suggestion.title}, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}`}
          >
            <View style={styles.pin}>
              <View style={[styles.pinCircle, { backgroundColor: theme.colors.card, borderColor: color }]}><Text style={styles.emoji}>{option.emoji}</Text></View>
              <View style={[styles.timeBadge, { backgroundColor: color }]}><Text maxFontSizeMultiplier={1.2} style={[styles.timeText, { color: foreground, fontFamily: theme.fonts.semibold }]}>{travelIcon(option.travelMode)} ≈ {travelMinutes(option.travelMin)} min</Text></View>
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', borderRadius: 14, minHeight: 140 },
  origin: { alignItems: 'center', padding: 2 },
  originHalo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  originDot: { width: 12, height: 12, borderRadius: 6 },
  originLabel: { fontSize: 10, borderRadius: 4, paddingHorizontal: 4, marginTop: 2 },
  pin: { width: 76, minHeight: 62, alignItems: 'center', paddingTop: 3 },
  pinCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 22, lineHeight: 28 },
  timeBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: -2 },
  timeText: { fontSize: 10, lineHeight: 14 },
});
