import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

const MESSAGES = [
  { text: 'Finding things you can do right now...', emoji: '🔍' },
  { text: 'Checking what fits your schedule...', emoji: '⏱️' },
  { text: 'Life is short — let\u2019s make this count.', emoji: '🚀' },
  { text: 'Your next adventure is loading...', emoji: '✨' },
  { text: 'Something good is coming...', emoji: '🎯' },
  { text: 'Scanning nearby options...', emoji: '📍' },
  { text: 'You showed up — that\u2019s step one.', emoji: '💪' },
  { text: 'Building your perfect set...', emoji: '🃏' },
];

export const DeckLoader: React.FC = () => {
  const theme = useTheme();
  const [msgIndex, setMsgIndex] = useState(0);

  // Pulsing dot animation
  const pulse = useRef(new Animated.Value(0.3)).current;
  // Message fade
  const fade = useRef(new Animated.Value(1)).current;
  // Spinner rotation
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Continuous pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    // Continuous spin
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }),
    ).start();

    // Cycle messages every 1.5s
    const interval = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setMsgIndex((prev) => (prev + 1) % MESSAGES.length);
        Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [pulse, spin, fade]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const msg = MESSAGES[msgIndex];

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.spinnerWrap, { transform: [{ rotate: rotation }] }]}>
        <View style={[styles.spinnerDot, { backgroundColor: theme.colors.accent }]} />
        <View style={[styles.spinnerDot, styles.spinnerDot2, { backgroundColor: theme.colors.accentDark ?? theme.colors.accent }]} />
      </Animated.View>

      <Animated.Text style={[styles.emoji, { opacity: pulse }]}>{msg.emoji}</Animated.Text>

      <Animated.Text
        style={[
          styles.message,
          { color: theme.colors.text, fontFamily: theme.fonts.semibold, opacity: fade },
        ]}
      >
        {msg.text}
      </Animated.Text>

      <Animated.View style={[styles.dots, { opacity: pulse }]}>
        <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
        <View style={[styles.dot, { backgroundColor: theme.colors.accent, opacity: 0.6 }]} />
        <View style={[styles.dot, { backgroundColor: theme.colors.accent, opacity: 0.3 }]} />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 32,
  },
  spinnerWrap: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: 0,
    left: 18,
  },
  spinnerDot2: {
    top: 36,
    left: 18,
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.5,
  },
  emoji: {
    fontSize: 40,
  },
  message: {
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 26,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
