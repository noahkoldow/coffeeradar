import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { useI18n } from '../i18n/I18nProvider';
import { useTheme } from '../theme/ThemeProvider';
import { isMapCoordinate, travelIcon, travelMinutes, travelModeLabel } from './ActivityMap.types';
import { clusterSessionActivities, SessionActivityMapProps, sessionMapViewport } from './SessionActivityMap.types';

export const SessionActivityMap: React.FC<SessionActivityMapProps> = ({ activities, origin, onSelect, onSelectGroup, accent, accentText }) => {
  const theme = useTheme();
  const { language } = useI18n();
  const de = language === 'de';
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState({ width: 320, height: 178 });
  const viewport = useMemo(() => sessionMapViewport(origin, activities, size.width / size.height), [origin, activities, size]);
  const [region, setRegion] = useState<Region>(viewport);
  const clusters = clusterSessionActivities(activities, region, size.width, size.height);
  const color = accent ?? theme.colors.accent;
  const foreground = accentText ?? theme.colors.accentText;
  // The panel only mounts when explicitly opened. Map panning never competes
  // with the swipe deck, and zooming only changes pin grouping, not the camera.
  const viewportKey = `${viewport.latitude}:${viewport.longitude}:${viewport.latitudeDelta}:${viewport.longitudeDelta}`;
  useEffect(() => {
    setRegion(viewport);
    mapRef.current?.animateToRegion(viewport, 0);
  }, [viewportKey]);

  return <View style={styles.wrap} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={viewport}
      onRegionChangeComplete={setRegion}
      scrollEnabled
      zoomEnabled
      zoomTapEnabled
      rotateEnabled={false}
      pitchEnabled={false}
      moveOnMarkerPress={false}
      toolbarEnabled={false}
      showsCompass={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsPointsOfInterest={false}
      userInterfaceStyle={theme.isDark ? 'dark' : 'light'}
    >
      {origin && isMapCoordinate(origin) && <Marker coordinate={origin} tappable={false} zIndex={0} anchor={{ x: 0.5, y: 0.25 }}>
        <View style={styles.origin}><View style={[styles.originHalo, { backgroundColor: theme.colors.card }]}><View style={[styles.originDot, { backgroundColor: color }]} /></View><Text style={[styles.originLabel, { color: theme.colors.text, backgroundColor: theme.colors.card, fontFamily: theme.fonts.semibold }]}>{de ? 'Du' : 'You'}</Text></View>
      </Marker>}
      {clusters.map(cluster => {
        const option = cluster.activities[0];
        const grouped = cluster.activities.length > 1;
        const label = grouped ? `${cluster.activities.length} ${de ? 'Aktivitäten an diesem Ort' : 'activities in this area'}` : `${option.suggestion.title}, ${de ? 'etwa' : 'about'} ${travelMinutes(option.travelMin)} ${de ? 'Minuten' : 'minutes'} ${travelModeLabel(option.travelMode, de)}`;
        return <Marker
          key={`${cluster.key}:${cluster.activities.length}`}
          identifier={cluster.key}
          coordinate={cluster.coordinate}
          anchor={{ x: 0.5, y: 0.4 }}
          zIndex={2}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={event => { event.stopPropagation(); if (grouped) onSelectGroup(cluster.activities.map(activity => activity.suggestion.id)); else onSelect(option.suggestion.id); }}
        >
          <View style={styles.pin}>
            <View style={[styles.circle, { borderColor: color, backgroundColor: grouped ? color : theme.colors.card }]}><Text style={[grouped ? styles.clusterCount : styles.emoji, { color: foreground, fontFamily: grouped ? theme.fonts.semibold : undefined }]}>{grouped ? cluster.activities.length : option.emoji}</Text></View>
            <View style={[styles.label, { backgroundColor: theme.colors.card }]}><Text maxFontSizeMultiplier={1.2} style={[styles.labelText, { color: theme.colors.text, fontFamily: theme.fonts.semibold }]}>{grouped ? (de ? 'Ideen öffnen' : 'View ideas') : `${travelIcon(option.travelMode)} ≈ ${travelMinutes(option.travelMin)} min`}</Text></View>
          </View>
        </Marker>;
      })}
    </MapView>
  </View>;
};

const styles = StyleSheet.create({
  wrap: { flex: 1, borderRadius: 13, overflow: 'hidden' },
  origin: { alignItems: 'center', padding: 2 },
  originHalo: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  originDot: { width: 12, height: 12, borderRadius: 6 },
  originLabel: { fontSize: 10, lineHeight: 14, borderRadius: 4, paddingHorizontal: 4, marginTop: 2 },
  pin: { width: 76, minHeight: 62, alignItems: 'center', paddingTop: 2 },
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24, lineHeight: 30 },
  clusterCount: { fontSize: 17, lineHeight: 23 },
  label: { borderRadius: 7, paddingHorizontal: 5, paddingVertical: 1, marginTop: -2 },
  labelText: { fontSize: 9, lineHeight: 14 },
});
