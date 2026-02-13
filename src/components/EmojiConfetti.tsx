import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions, View } from 'react-native';

type ConfettiPiece = {
  id: string;
  emoji: string;
  x: number;
  delay: number;
  span: number;
  drift: number;
  rotate: number;
  size: number;
};

type Props = {
  emojis?: string[];
  visible: boolean;
};

const DEFAULT_EMOJIS = ['✨', '🎉', '⭐'];

export const EmojiConfetti: React.FC<Props> = ({ emojis, visible }) => {
  const { width, height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const emojiPool = emojis && emojis.length ? emojis : DEFAULT_EMOJIS;

  const pieces = useMemo(() => {
    if (!visible) return [] as ConfettiPiece[];
    const count = 18;
    return Array.from({ length: count }).map((_, index) => {
      const pick = emojiPool[Math.floor(Math.random() * emojiPool.length)];
      return {
        id: `${index}_${Math.random().toString(36).slice(2, 7)}`,
        emoji: pick,
        x: Math.max(0, Math.random() * (width - 40)),
        delay: Math.random() * 0.25,
        span: 0.55 + Math.random() * 0.35,
        drift: (Math.random() - 0.5) * 80,
        rotate: Math.random() * 120 - 60,
        size: 18 + Math.random() * 10,
      };
    });
  }, [emojiPool.join('|'), width, visible]);

  useEffect(() => {
    if (!visible) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible, progress]);

  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.container}>
      {pieces.map((piece) => {
        const start = piece.delay;
        const end = Math.min(piece.delay + piece.span, 1);
        const translateY = progress.interpolate({
          inputRange: [0, start, end, 1],
          outputRange: [-30, -30, height + 80, height + 80],
          extrapolate: 'clamp',
        });
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, piece.drift],
          extrapolate: 'clamp',
        });
        const opacity = progress.interpolate({
          inputRange: [0, start, end, 1],
          outputRange: [0, 1, 0.85, 0],
          extrapolate: 'clamp',
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${piece.rotate}deg`],
          extrapolate: 'clamp',
        });
        return (
          <Animated.Text
            key={piece.id}
            style={[
              styles.emoji,
              {
                left: piece.x,
                fontSize: piece.size,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          >
            {piece.emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  emoji: {
    position: 'absolute',
    top: -40,
  },
});
