import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  glow?: boolean;
  variant?: 'default' | 'muted';
};

export const PrimaryButton: React.FC<Props> = ({ label, onPress, disabled, style, glow, variant = 'default' }) => {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!glow) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, pulse]);

  const glowStyle = useMemo(() => {
    if (!glow) return null;
    const scale = pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.02],
    });
    const shadowOpacity = pulse.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.45],
    });
    return {
      transform: [{ scale }],
      shadowColor: theme.colors.accent,
      shadowOpacity,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    };
  }, [glow, pulse, theme.colors.accent]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Animated.View style={[glowStyle, style]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          variant === 'muted' && styles.buttonMuted,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={[styles.label, variant === 'muted' && styles.labelMuted]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  button: {
    backgroundColor: theme.colors.accent,
    paddingVertical: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: theme.colors.accentDark,
  },
  buttonMuted: {
    backgroundColor: theme.colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontFamily: theme.fonts.heading,
    fontSize: 18,
    color: theme.colors.accentText,
    letterSpacing: 0.5,
  },
  labelMuted: {
    color: theme.colors.textMuted,
  },
});
