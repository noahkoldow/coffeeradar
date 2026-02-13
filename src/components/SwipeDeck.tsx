import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { DeckSuggestion } from '../types';
import { SuggestionCard } from './SuggestionCard';
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

    useEffect(() => {
      disabledRef.current = !!disabled;
    }, [disabled]);

    useEffect(() => {
      onSwipeLeftRef.current = onSwipeLeft;
      onSwipeRightRef.current = onSwipeRight;
    }, [onSwipeLeft, onSwipeRight]);

    useEffect(() => {
      pan.setValue({ x: 0, y: 0 });
      animatingRef.current = false;
      enter.setValue(0);
      Animated.timing(enter, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, [current?.id, pan]);

    const resetPosition = () => {
      Animated.spring(pan, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
        tension: 140,
        friction: 12,
      }).start();
    };

    const completeSwipe = (direction: 'left' | 'right') => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      const toX = direction === 'right' ? width * 1.2 : -width * 1.2;
      Animated.timing(pan, {
        toValue: { x: toX, y: 0 },
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        animatingRef.current = false;
        if (direction === 'right') {
          onSwipeRightRef.current();
        } else {
          onSwipeLeftRef.current();
        }
      });
    };

    useImperativeHandle(ref, () => ({
      swipeLeft: () => completeSwipe('left'),
      swipeRight: () => completeSwipe('right'),
    }));

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => !disabledRef.current && !animatingRef.current,
          onStartShouldSetPanResponderCapture: () => !disabledRef.current && !animatingRef.current,
          onMoveShouldSetPanResponder: (_, gesture) => (
            !disabledRef.current &&
            !animatingRef.current &&
            Math.abs(gesture.dx) > 4
          ),
          onMoveShouldSetPanResponderCapture: (_, gesture) => (
            !disabledRef.current &&
            !animatingRef.current &&
            Math.abs(gesture.dx) > 4
          ),
          onPanResponderMove: (_, gesture) => {
            if (animatingRef.current) return;
            pan.setValue({ x: gesture.dx, y: gesture.dy });
          },
          onPanResponderRelease: (_, gesture) => {
            if (animatingRef.current) return;
            const threshold = width * 0.25;
            if (gesture.dx > threshold) {
              completeSwipe('right');
            } else if (gesture.dx < -threshold) {
              completeSwipe('left');
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
      [pan, width],
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

    const nextTranslate = pan.x.interpolate({
      inputRange: [-width * 0.25, 0, width * 0.25],
      outputRange: [0, 8, 0],
      extrapolate: 'clamp',
    });

    const blurOpacity = pan.x.interpolate({
      inputRange: [-width * 0.2, 0, width * 0.2],
      outputRange: [0, 0.35, 0],
      extrapolate: 'clamp',
    });
    const blurTint = theme.colors.background === '#1C1A18' ? 'dark' : 'light';

    if (!current) return <View style={styles.empty} />;

    return (
      <View style={styles.container}>
        {next && (
          <Animated.View
            key={`next_${next.id}`}
            style={[
              styles.card,
              styles.nextCard,
              { transform: [{ scale: nextScale }, { translateY: nextTranslate }], opacity: nextOpacity },
            ]}
            pointerEvents="none"
          >
            <SuggestionCard suggestion={next} preview />
            <Animated.View style={[styles.blurOverlay, { opacity: blurOpacity }]}>
              <BlurView intensity={14} tint={blurTint} style={StyleSheet.absoluteFillObject} />
            </Animated.View>
          </Animated.View>
        )}
        <Animated.View
          key={`current_${current.id}`}
          style={[styles.card, cardStyle, webTouch]}
          {...panResponder.panHandlers}
        >
          <SuggestionCard suggestion={current} />
        </Animated.View>
      </View>
    );
  },
);

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
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
    height: 320,
  },
});
