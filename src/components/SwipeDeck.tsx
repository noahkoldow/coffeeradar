import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { DeckSuggestion } from '../types';
import { SuggestionCard, CARD_HEIGHT } from './SuggestionCard';
import { useTheme } from '../theme/ThemeProvider';

export type SwipeDeckHandle = {
  swipeLeft: () => void;
  swipeRight: () => void;
};

type Props = {
  current: DeckSuggestion | null;
  next?: DeckSuggestion | null;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  disabled?: boolean;
};

/**
 * Departing card layer — animates a snapshot of the swiped card off-screen
 * while the new current card is immediately interactive below it.
 */
const DepartingCard: React.FC<{
  suggestion: DeckSuggestion;
  startX: number;
  startY: number;
  toX: number;
  width: number;
  onDone: () => void;
}> = React.memo(({ suggestion, startX, startY, toX, width, onDone }) => {
  const pos = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;

  useEffect(() => {
    Animated.timing(pos, {
      toValue: { x: toX, y: startY * 0.5 },
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onDone());
    // Run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = pos.x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { width: '100%', height: CARD_HEIGHT, position: 'absolute', top: 0, zIndex: 10 },
        { transform: [...pos.getTranslateTransform(), { rotate }] },
      ]}
    >
      <SuggestionCard suggestion={suggestion} preview />
    </Animated.View>
  );
});

export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(
  ({ current, next, onSwipeLeft, onSwipeRight, disabled }, ref) => {
    const theme = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const { width } = useWindowDimensions();
    const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
    const enter = useRef(new Animated.Value(0)).current;
    const disabledRef = useRef(!!disabled);
    const animatingRef = useRef(false);
    const onSwipeLeftRef = useRef(onSwipeLeft);
    const onSwipeRightRef = useRef(onSwipeRight);

    // Departing card: snapshot of the card that was just swiped
    const [departing, setDeparting] = useState<{
      suggestion: DeckSuggestion;
      startX: number;
      startY: number;
      toX: number;
      key: number;
    } | null>(null);
    const departKeyRef = useRef(0);

    useEffect(() => {
      disabledRef.current = !!disabled;
    }, [disabled]);

    useEffect(() => {
      onSwipeLeftRef.current = onSwipeLeft;
      onSwipeRightRef.current = onSwipeRight;
    }, [onSwipeLeft, onSwipeRight]);

    const isFirstCard = useRef(true);

    useEffect(() => {
      pan.setValue({ x: 0, y: 0 });
      animatingRef.current = false;
      if (isFirstCard.current) {
        isFirstCard.current = false;
        enter.setValue(0);
        Animated.timing(enter, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      } else {
        enter.setValue(1);
      }
    }, [current?.id, pan]);

    const resetPosition = useCallback(() => {
      Animated.spring(pan, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
        tension: 140,
        friction: 12,
      }).start();
    }, [pan]);

    /**
     * Fire-and-forget swipe: captures the current card into a departing
     * snapshot layer, then immediately invokes the callback so the parent
     * can advance the index with zero lag. The snapshot animates off-screen
     * independently above the new current card.
     */
    const completeSwipe = useCallback((direction: 'left' | 'right', gestureX = 0, gestureY = 0) => {
      if (animatingRef.current) return;
      animatingRef.current = true;

      // Read current suggestion synchronously via a ref-like approach:
      // we know `current` hasn't changed yet because we're still in the
      // same synchronous frame as the gesture handler.
      const toX = direction === 'right' ? width * 1.2 : -width * 1.2;

      // Snapshot the card being swiped for the departing layer
      if (currentRef.current) {
        departKeyRef.current += 1;
        setDeparting({
          suggestion: currentRef.current,
          startX: gestureX,
          startY: gestureY,
          toX,
          key: departKeyRef.current,
        });
      }

      // Reset pan for the NEW card that's about to become current
      pan.setValue({ x: 0, y: 0 });

      // Fire callback immediately — no waiting for animation
      if (direction === 'right') {
        onSwipeRightRef.current();
      } else {
        onSwipeLeftRef.current();
      }

      // animatingRef is cleared after a short delay so the new card
      // is immediately swipable but we don't double-fire from the
      // same gesture frame
      requestAnimationFrame(() => {
        animatingRef.current = false;
      });
    }, [width, pan]);

    // Keep a ref to `current` so completeSwipe can read it synchronously
    const currentRef = useRef(current);
    useEffect(() => {
      currentRef.current = current;
    }, [current]);

    const handleDepartDone = useCallback(() => {
      setDeparting(null);
    }, []);

    useImperativeHandle(ref, () => ({
      swipeLeft: () => completeSwipe('left'),
      swipeRight: () => completeSwipe('right'),
    }));

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onStartShouldSetPanResponderCapture: () => false,
          onMoveShouldSetPanResponder: (_, gesture) => (
            !disabledRef.current &&
            !animatingRef.current &&
            Math.abs(gesture.dx) > 8
          ),
          onMoveShouldSetPanResponderCapture: (_, gesture) => (
            !disabledRef.current &&
            !animatingRef.current &&
            Math.abs(gesture.dx) > 8
          ),
          onPanResponderMove: (_, gesture) => {
            if (animatingRef.current) return;
            pan.setValue({ x: gesture.dx, y: gesture.dy });
          },
          onPanResponderRelease: (_, gesture) => {
            if (animatingRef.current) return;
            const threshold = width * 0.25;
            if (gesture.dx > threshold) {
              completeSwipe('right', gesture.dx, gesture.dy);
            } else if (gesture.dx < -threshold) {
              completeSwipe('left', gesture.dx, gesture.dy);
            } else {
              resetPosition();
            }
          },
          onPanResponderTerminationRequest: () => false,
          onPanResponderTerminate: () => {
            animatingRef.current = false;
            resetPosition();
          },
        }),
      [pan, width, completeSwipe, resetPosition],
    );

    const rotate = pan.x.interpolate({
      inputRange: [-width, 0, width],
      outputRange: ['-12deg', '0deg', '12deg'],
      extrapolate: 'clamp',
    });

    const webTouch = Platform.OS === 'web' ? ({ touchAction: 'none' } as any) : undefined;
    const enterScale = enter.interpolate({
      inputRange: [0, 1],
      outputRange: [0.96, 1],
    });
    const enterOpacity = enter.interpolate({
      inputRange: [0, 1],
      outputRange: [0.92, 1],
    });
    const cardStyle = {
      transform: [...pan.getTranslateTransform(), { rotate }, { scale: enterScale }],
      opacity: enterOpacity,
    };

    const nextScale = pan.x.interpolate({
      inputRange: [-width * 0.25, 0, width * 0.25],
      outputRange: [1, 0.94, 1],
      extrapolate: 'clamp',
    });

    const nextOpacity = pan.x.interpolate({
      inputRange: [-width * 0.25, 0, width * 0.25],
      outputRange: [1, 0.88, 1],
      extrapolate: 'clamp',
    });

    const blurOpacity = pan.x.interpolate({
      inputRange: [-width * 0.2, 0, width * 0.2],
      outputRange: [0, 0.35, 0],
      extrapolate: 'clamp',
    });
    const blurTint = theme.isDark ? 'dark' : 'light';

    if (!current) return <View style={styles.empty} />;

    return (
      <View style={styles.container}>
        {/* Layer 1: next card preview (bottom) */}
        {next && (
          <Animated.View
            key={`next_${next.id}`}
            style={[
              styles.card,
              styles.nextCard,
              { transform: [{ scale: nextScale }], opacity: nextOpacity },
            ]}
            pointerEvents="none"
          >
            <SuggestionCard suggestion={next} preview />
            <Animated.View style={[styles.blurOverlay, { opacity: blurOpacity }]}>
              <BlurView intensity={14} tint={blurTint} style={StyleSheet.absoluteFillObject} />
            </Animated.View>
          </Animated.View>
        )}
        {/* Layer 2: current interactive card */}
        <Animated.View
          key={`current_${current.id}`}
          style={[styles.card, cardStyle, webTouch]}
          {...panResponder.panHandlers}
        >
          <SuggestionCard suggestion={current} />
        </Animated.View>
        {/* Layer 3: departing card snapshot (top, non-interactive) */}
        {departing && (
          <DepartingCard
            key={departing.key}
            suggestion={departing.suggestion}
            startX={departing.startX}
            startY={departing.startY}
            toX={departing.toX}
            width={width}
            onDone={handleDepartDone}
          />
        )}
      </View>
    );
  },
);

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    height: CARD_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    height: CARD_HEIGHT,
  },
  nextCard: {
    position: 'absolute',
    top: 0,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
  },
  empty: {
    height: CARD_HEIGHT,
  },
});
