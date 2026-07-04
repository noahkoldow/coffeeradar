import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  glow?: boolean;
  variant?: 'default' | 'muted';
  bgColor?: string;
  textColor?: string;
};

export const PrimaryButton: React.FC<Props> = ({ label, onPress, disabled, style, glow, variant = 'default', bgColor, textColor }) => {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    if (disabled) return;
    if (Platform.OS !== 'web') {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    onPress();
  };

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
      outputRange: [0.08, 0.2],
    });
    return {
      transform: [{ scale }],
      shadowColor: theme.colors.accent,
      shadowOpacity,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
    };
  }, [glow, pulse, theme.colors.accent]);

  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Animated.View style={[glowStyle, style]}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          variant === 'muted' && styles.buttonMuted,
          bgColor ? { backgroundColor: bgColor } : null,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={[styles.label, variant === 'muted' && styles.labelMuted, textColor ? { color: textColor } : null]}>{label}</Text>
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
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
