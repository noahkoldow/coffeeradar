import React, { useMemo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export const ToggleRow: React.FC<Props> = ({ label, value, onValueChange }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.border, true: theme.colors.accentSoft }}
        thumbColor={value ? theme.colors.accent : theme.colors.card}
      />
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  label: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
});
