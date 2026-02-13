import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

export const Chip: React.FC<Props> = ({ label, selected, onPress }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    marginRight: theme.spacing.sm,
  },
  selected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  label: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.text,
  },
  labelSelected: {
    color: theme.colors.accentDark,
  },
});
