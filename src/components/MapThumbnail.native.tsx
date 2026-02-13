import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  lat?: number;
  lng?: number;
  height?: number;
};

export const MapThumbnail: React.FC<Props> = ({ lat, lng, height = 120 }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!lat || !lng) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>Map preview unavailable</Text>
      </View>
    );
  }

  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        style={styles.map}
        pointerEvents="none"
        cacheEnabled
        region={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        <Marker coordinate={{ latitude: lat, longitude: lng }} />
      </MapView>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  mapWrap: {
    width: '100%',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
