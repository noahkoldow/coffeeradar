import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const Countdown: React.FC<{ label: string }> = ({ label }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.timer}>{label}</Text>;
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  timer: {
    fontFamily: theme.fonts.heading,
    fontSize: 42,
    color: theme.colors.text,
    letterSpacing: 1,
  },
});
