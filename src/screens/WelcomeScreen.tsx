import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const bitsLogo = require('../../assets/logo.png');

type Props = StackScreenProps<RootStackParamList, 'Welcome'>;

type PreviewCardSpec = {
  id: string;
  top: number;
  leftDelay: number;
  duration: number;
  tilt: number;
  scale: number;
  crown: string;
  map: string;
  header: string;
};

const PREVIEW_CARDS: PreviewCardSpec[] = [
  { id: 'crown-1', top: 8, leftDelay: 0, duration: 12500, tilt: -5, scale: 0.92, crown: '👑', map: 'Map a quick escape', header: 'Tiny win, right now' },
  { id: 'map-1', top: 60, leftDelay: 650, duration: 14500, tilt: 3, scale: 0.88, crown: '👑', map: 'Find a nearby bit', header: 'No planning needed' },
  { id: 'crown-2', top: 24, leftDelay: 1400, duration: 13200, tilt: -2, scale: 0.84, crown: '👑', map: 'One tap to start', header: 'Do something now' },
  { id: 'map-2', top: 88, leftDelay: 2200, duration: 15200, tilt: 4, scale: 0.9, crown: '👑', map: 'Little map preview', header: 'Try it in seconds' },
  { id: 'crown-3', top: 142, leftDelay: 3100, duration: 13800, tilt: -3, scale: 0.86, crown: '👑', map: 'Right now, not later', header: 'Bite-sized and ready' },
  { id: 'map-3', top: 176, leftDelay: 3900, duration: 15600, tilt: 2, scale: 0.82, crown: '👑', map: 'A fast little bit', header: 'Start here' },
];

const EMOJIS = ['☕', '🍩', '🍪', '🌤️', '🎧', '📍', '🏃', '🚶', '🪄', '✨', '📸', '🎯', '🫶', '🍦', '🌮'];

const PreviewCard: React.FC<{
  spec: PreviewCardSpec;
  index: number;
  width: number;
  theme: ReturnType<typeof useTheme>;
  screenStyles: ReturnType<typeof createStyles>;
}> = ({ spec, index, width, theme, screenStyles }) => {
  const drift = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const earlyCard = spec.leftDelay < 1600;
    const extra = Math.random() * (earlyCard ? 120 : 320);
    const startDelay = Math.max(0, spec.leftDelay * (earlyCard ? 0.12 : 0.55) + extra);
    const variedDuration = Math.max(3800, spec.duration * (earlyCard ? 0.42 : 0.75) + (Math.random() * 1200 - 600));

    drift.setValue(earlyCard ? 0.42 + Math.random() * 0.18 : 0);

    const driftLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(startDelay),
        Animated.timing(drift, {
          toValue: 1,
          duration: variedDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    driftLoop.start();
    bobLoop.start();

    // fade in quickly so the first cards are already visible when the screen opens
    Animated.timing(opacity, { toValue: 1, duration: earlyCard ? 160 : 240, delay: Math.max(0, startDelay - 80), useNativeDriver: true }).start();

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleFlip = () => {
      if (cancelled) return;
      const wait = 1400 + Math.random() * 2600;
      timer = setTimeout(() => {
        if (cancelled) return;

        // ~33% chance this card will perform a fast rightward spin of 3-4 turns
        const shouldSpin = Math.random() < 0.33;
        if (shouldSpin) {
          const turns = 3 + Math.floor(Math.random() * 2); // 3 or 4
          // animate from 0 -> 1 where interpolation maps to 0 -> 360 * turns
          Animated.timing(flip, {
            toValue: turns,
            duration: 180 * turns, // quick spin
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            // reset and schedule next possible spin
            flip.setValue(0);
            scheduleFlip();
          });
        } else {
          // no spin this time — schedule the next check
          scheduleFlip();
        }
      }, wait);
    };
    scheduleFlip();

    return () => {
      cancelled = true;
      driftLoop.stop();
      bobLoop.stop();
      if (timer) clearTimeout(timer);
    };
  }, [bob, drift, flip, spec.duration, spec.leftDelay]);

  const translateX = drift.interpolate({
    inputRange: [0, 1],
    // start off-screen to the right and travel fully to off-screen left
    outputRange: [width + 160, -(width + 160)],
  });
  const translateY = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -7],
  });
  const rotateZ = `${spec.tilt}deg`;
  const rotateY = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
    extrapolate: 'extend',
  });
  const cardLeft = index < 3
    ? width * 0.66 + index * 12
    : index < 5
      ? width * 0.44 + (index - 3) * 14
      : width * 0.22 + (index - 5) * 14;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        screenStyles.previewCardWrap,
        {
          top: spec.top,
          left: cardLeft,
          opacity,
          transform: [{ translateX }, { translateY }, { rotateZ }, { scale: spec.scale }, { perspective: 900 }, { rotateY }],
        },
      ]}
    >
      <View style={[screenStyles.previewCard, { borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}> 
        <View style={screenStyles.previewHeaderRow}>
          <Text style={screenStyles.previewCrown}>{useMemo(() => EMOJIS[Math.floor(Math.random() * EMOJIS.length)], [])}</Text>
          <View style={[screenStyles.previewPill, { backgroundColor: theme.colors.backgroundAlt }]}> 
            <Text style={[screenStyles.previewMap, { color: theme.colors.textMuted }]}>{spec.map}</Text>
          </View>
        </View>
        <Text style={[screenStyles.previewHeadline, { color: theme.colors.text }]}>{spec.header}</Text>
        <View style={[screenStyles.previewFooter, { backgroundColor: theme.colors.backgroundAlt }]}> 
          <View style={[screenStyles.previewDot, { backgroundColor: theme.colors.accent }]} />
          <View style={[screenStyles.previewLine, { backgroundColor: theme.colors.border }]} />
        </View>
      </View>
    </Animated.View>
  );
};

export const WelcomeScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Bored? Stuck? Let’s fix that.</Text>
        <Text style={styles.subtitle}>Discover bite-sized ideas you can act on right now. No planning required.</Text>
      </View>
      <View style={[styles.previewStage, { width }]}> 
        {PREVIEW_CARDS.map((spec, index) => (
          <PreviewCard key={spec.id} spec={spec} index={index} width={width} theme={theme} screenStyles={styles} />
        ))}
      </View>
      <PrimaryButton
        label="Find my first bit"
        onPress={() => navigation.navigate('CalendarPermission')}
        style={styles.button}
      />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  content: {
    marginTop: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    marginBottom: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 34,
    lineHeight: 40,
    color: theme.colors.text,
    maxWidth: 320,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 17,
    lineHeight: 24,
    color: theme.colors.textMuted,
    maxWidth: 320,
  },
  previewStage: {
    flex: 1,
    minHeight: Dimensions.get('window').height * 0.34,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    overflow: 'visible',
  },
  previewCardWrap: {
    position: 'absolute',
    zIndex: 0,
    backfaceVisibility: 'hidden',
  },
  previewCard: {
    width: 108,
    height: 128,
    borderRadius: 18,
    borderWidth: 1,
    padding: 10,
    justifyContent: 'space-between',
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    backfaceVisibility: 'hidden',
  },
  previewHeaderRow: {
    gap: 6,
  },
  previewCrown: {
    fontSize: 18,
  },
  previewPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  previewMap: {
    fontFamily: theme.fonts.semibold,
    fontSize: 8.5,
    letterSpacing: 0.2,
  },
  previewHeadline: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    lineHeight: 15,
    maxWidth: 80,
  },
  previewFooter: {
    borderRadius: 12,
    padding: 8,
    gap: 6,
  },
  previewDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  previewLine: {
    height: 6,
    borderRadius: 999,
    width: '82%',
  },
  button: {
    marginBottom: theme.spacing.xl,
  },
});
