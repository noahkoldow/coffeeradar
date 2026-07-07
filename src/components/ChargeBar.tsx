import React, { useEffect, useRef } from 'react';
import { Animated, GestureResponderEvent, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  current: number;
  max: number;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
};

export const ChargeBar: React.FC<Props> = ({ current, max, style, onPress, disabled = false }) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const borderPulse = useRef(new Animated.Value(0)).current;
  const lowCreditLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (current <= 5 && current > 0) {
      if (lowCreditLoopRef.current) return;
      lowCreditLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(borderPulse, { toValue: 1, duration: 520, useNativeDriver: false }),
          Animated.timing(borderPulse, { toValue: 0, duration: 520, useNativeDriver: false }),
        ]),
      );
      lowCreditLoopRef.current.start();
    } else {
      lowCreditLoopRef.current?.stop();
      lowCreditLoopRef.current = null;
      borderPulse.setValue(0);
    }
    return () => {
      lowCreditLoopRef.current?.stop();
      lowCreditLoopRef.current = null;
    };
  }, [borderPulse, current]);

  const empty = current <= 0;
  const danger = current <= 5 && current > 0;
  const overflow = current > max ? Math.round(current - max) : 0;
  const warningBorderColor = borderPulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255, 77, 79, 0.35)', theme.colors.error],
  });

  const content = (
    <View style={[styles.container, style]}>
      <Animated.View
        style={[
          styles.pill,
          empty ? styles.emptyPill : danger ? styles.dangerPill : styles.normalPill,
        ]}
      >
        {danger && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.dangerInnerBorder,
              {
                borderColor: warningBorderColor,
              },
            ]}
          />
        )}
        <Text style={[styles.text, empty && styles.emptyText, empty && styles.emptyCurrentText]}>{Math.min(current, max)}</Text>
        <Text style={styles.slash}>/</Text>
        <Text style={styles.text}>{max}</Text>
        {overflow > 0 && (
          <Text style={styles.overflow}>+{overflow}</Text>
        )}
      </Animated.View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={disabled ? undefined : onPress} style={[styles.pressable, disabled && styles.disabledPressable]} disabled={disabled}>
        {content}
      </Pressable>
    );
  }

  return <View style={styles.nonInteractive} pointerEvents="none">{content}</View>;
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  pressable: {
    zIndex: 50,
  },
  disabledPressable: {
    opacity: 0.55,
  },
  nonInteractive: {
    zIndex: 50,
    pointerEvents: 'none',
  },
  container: {
    zIndex: 50,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 56,
    justifyContent: 'center',
    backgroundColor: theme.colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  normalPill: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dangerPill: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dangerInnerBorder: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  emptyPill: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  text: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 13,
  },
  emptyText: {
    color: theme.colors.textMuted,
  },
  emptyCurrentText: {
    opacity: 0.6,
  },
  overflow: {
    marginLeft: 6,
    color: theme.colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  slash: {
    color: theme.colors.text,
    marginHorizontal: 6,
    opacity: 0.6,
  },
});

export default ChargeBar;
