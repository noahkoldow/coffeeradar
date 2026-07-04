import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { findOrGenerateActivity } from '../services/activityGeneration';

type DeckType = 'do_now' | 'productive' | 'plan_tomorrow' | 'homebody';
type LoaderConfig = { messages: Array<{ text: string; emoji: string }>; emojis: string[]; color?: string };

const LOADER_CONFIG: Record<DeckType | 'default', LoaderConfig> = {
  do_now: {
    messages: [
      { text: 'Finding things you can do right now...', emoji: '🔍' },
      { text: 'Let\'s go-go-go! ⚡', emoji: '⚡' },
      { text: 'Adventure time! 🚀', emoji: '🚀' },
      { text: 'Something exciting is coming...', emoji: '✨' },
    ],
    emojis: ['🔥', '⚡', '🎯', '💨', '🚀'],
  },
  productive: {
    messages: [
      { text: 'Curating focused work for you...', emoji: '🧠' },
      { text: 'Finding deep work opportunities...', emoji: '📚' },
      { text: 'Building your focus session...', emoji: '🎯' },
      { text: 'Energizing your productivity...', emoji: '💪' },
    ],
    emojis: ['🧠', '📚', '🎯', '✍️', '🔬'],
  },
  plan_tomorrow: {
    messages: [
      { text: 'Planning your perfect tomorrow...', emoji: '📅' },
      { text: 'Scheduling your day ahead...', emoji: '⏰' },
      { text: 'Building tomorrow\'s itinerary...', emoji: '🗺️' },
      { text: 'Time to strategize...', emoji: '🎲' },
    ],
    emojis: ['📅', '⏰', '🗺️', '🎲', '✅'],
  },
  homebody: {
    messages: [
      { text: 'Finding cozy times for you...', emoji: '🏠' },
      { text: 'Curating your comfort zone...', emoji: '☕' },
      { text: 'Home sweet home ideas...', emoji: '🛋️' },
      { text: 'Relaxation incoming...', emoji: '✨' },
    ],
    emojis: ['🏠', '☕', '🛋️', '🎬', '🎨'],
  },
  default: {
    messages: [
      { text: 'Finding things you can do right now...', emoji: '🔍' },
      { text: 'Checking what fits your schedule...', emoji: '⏱️' },
      { text: 'Life is short — let\'s make this count.', emoji: '🚀' },
      { text: 'Your next adventure is loading...', emoji: '✨' },
      { text: 'Something good is coming...', emoji: '🎯' },
      { text: 'Scanning nearby options...', emoji: '📍' },
      { text: 'You showed up — that\'s step one.', emoji: '💪' },
      { text: 'Building your perfect set...', emoji: '🃏' },
    ],
    emojis: ['✨', '🎯', '💫', '🌟', '⭐'],
  },
};

type Props = {
  deckType?: DeckType;
  request?: {
    attributes?: string[];
    latLonBucket?: string;
    timeHints?: string[];
    minScore?: number;
    onlyVerified?: boolean;
    intentText?: string;
  };
  onResult?: (res: any) => void;
};

export const DeckLoader: React.FC<Props> = ({ deckType, request, onResult }) => {
  const theme = useTheme();
  const [msgIndex, setMsgIndex] = useState(0);
  const [randomEmojis, setRandomEmojis] = useState<string[]>([]);

  const config = LOADER_CONFIG[deckType ?? 'default'];

  // Pulsing dot animation
  const pulse = useRef(new Animated.Value(0.3)).current;
  // Message fade
  const fade = useRef(new Animated.Value(1)).current;
  // Spinner rotation
  const spin = useRef(new Animated.Value(0)).current;
  // Floating emojis
  const floatY = useRef(new Animated.Value(0)).current;

  // derive accent color per deck type so loading UI reflects selected mode
  const getDeckColors = () => {
    if (deckType === 'productive') {
      return theme.isDark
        ? { bg: '#2A4A5E', text: '#D8F0FF' }
        : { bg: '#A8D8EA', text: '#1A3A4A' };
    }
    if (deckType === 'homebody') {
      return theme.isDark
        ? { bg: '#54374A', text: '#F5DDED' }
        : { bg: '#E2B6CF', text: '#3A1A2E' };
    }
    if (deckType === 'plan_tomorrow') {
      return theme.isDark
        ? { bg: '#2E4F45', text: '#D9F6EA' }
        : { bg: '#B5EAD7', text: '#1A4A3A' };
    }
    return { bg: theme.colors.accent, text: theme.colors.accentText };
  };
  const deckColors = getDeckColors();

  useEffect(() => {
    // Pick exactly 3 unique emojis from the type pool
    const pool = [...new Set(config.emojis)];
    const picked: string[] = [];
    while (picked.length < 3 && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    setRandomEmojis(picked);
  }, [deckType, config.emojis]);

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

    // Floating animation for background emojis
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -20, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    // Cycle messages every 1.5s
    const interval = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setMsgIndex((prev) => (prev + 1) % config.messages.length);
        Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, 1500);

    return () => clearInterval(interval);
  }, [pulse, spin, fade, config.messages.length, floatY]);

  useEffect(() => {
    let mounted = true;

    async function runRequest() {
      if (!request) return;
      try {
        const result = await findOrGenerateActivity(request);
        if (!mounted) return;
        onResult?.(result);
      } catch (error) {
        if (!mounted) return;
        onResult?.({ source: 'error', error: String(error) });
      }
    }

    runRequest();
    return () => {
      mounted = false;
    };
  }, [request, onResult]);

  const rotation = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const msg = config.messages[msgIndex];

  return (
    <View style={styles.container}>
      {/* Floating background emojis */}
      <View style={styles.floatingEmojisContainer}>
        {randomEmojis.map((emoji, idx) => (
          <Animated.Text
            key={`float_${idx}`}
            style={[
              styles.floatingEmoji,
              {
                transform: [
                  { translateY: floatY },
                  { translateX: ((idx - 1) * 40) },
                ],
                opacity: 0.3,
              },
            ]}
          >
            {emoji}
          </Animated.Text>
        ))}
      </View>

      <Animated.View style={[styles.spinnerWrap, { transform: [{ rotate: rotation }] }]}>
        <View style={[styles.spinnerDot, { backgroundColor: deckColors.bg }]} />
        <View style={[styles.spinnerDot, styles.spinnerDot2, { backgroundColor: deckColors.bg }]} />
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
        <View style={[styles.dot, { backgroundColor: deckColors.bg }]} />
        <View style={[styles.dot, { backgroundColor: deckColors.bg, opacity: 0.6 }]} />
        <View style={[styles.dot, { backgroundColor: deckColors.bg, opacity: 0.3 }]} />
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
  floatingEmojisContainer: {
    position: 'absolute',
    top: '20%',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 30,
    pointerEvents: 'none',
  },
  floatingEmoji: {
    fontSize: 28,
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
