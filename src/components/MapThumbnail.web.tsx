import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  lat?: number;
  lng?: number;
  height?: number;
};

export const MapThumbnail: React.FC<Props> = ({ height = 120 }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={[styles.placeholder, { height }]}>
      <Text style={styles.placeholderText}>Map preview unavailable on web</Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
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
