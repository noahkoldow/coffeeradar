import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { DeckSuggestion } from '../types';
import { SuggestionCard, CARD_HEIGHT } from './SuggestionCard';

export type SwipeDeckHandle = {
  swipeLeft: () => void;
  swipeRight: () => void;
};

type Props = {
  current: DeckSuggestion | null;
  next?: DeckSuggestion | null;
  onSwipeLeft: () => void | Promise<void>;
  onSwipeRight: () => void | Promise<void>;
  disabled?: boolean;
  rightSwipeEnabled?: boolean;
  deckColors?: { bg: string; text: string };
  showSourceDebug?: boolean;
  renderCard?: (suggestion: DeckSuggestion, preview: boolean) => React.ReactNode;
};

type CardLayerProps = Omit<Props, 'current' | 'next'> & {
  suggestion: DeckSuggestion;
  active: boolean;
  width: number;
};

const useNativeDriver = Platform.OS !== 'web';

// Preview and active cards share the same final bounds and motion graph. Only
// the outgoing card moves; promotion never resizes or repositions its successor.
const CardLayer = forwardRef<SwipeDeckHandle, CardLayerProps>((props, ref) => {
  const { suggestion, active, width, deckColors, showSourceDebug } = props;
  const pan = useRef(new Animated.ValueXY()).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const recoveryFrame = useRef<number | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const live = useRef(props);

  useLayoutEffect(() => {
    live.current = props;
  });

  useLayoutEffect(() => {
    pan.setValue({ x: 0, y: 0 });
    busy.current = false;
    return () => {
      // An undo, replacement or unmount must never complete an old swipe.
      generation.current += 1;
      animation.current?.stop();
      if (recoveryFrame.current !== null) cancelAnimationFrame(recoveryFrame.current);
    };
  }, [active, pan]);

  const resetPosition = useCallback(() => {
    busy.current = true;
    animation.current = Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      tension: 180,
      friction: 22,
      useNativeDriver,
    });
    animation.current.start(({ finished }) => {
      if (finished) busy.current = false;
    });
  }, [pan]);

  const completeSwipe = useCallback((direction: 'left' | 'right') => {
    if (busy.current || !live.current.active || live.current.disabled) return;
    if (direction === 'right' && live.current.rightSwipeEnabled === false) { resetPosition(); return; }
    busy.current = true;
    const token = ++generation.current;
    const callback = direction === 'right' ? live.current.onSwipeRight : live.current.onSwipeLeft;
    const isCurrentSwipe = () => generation.current === token && live.current.active;

    // Let React commit the callback's index change before deciding whether this
    // card needs to return (e.g. no credits, no calendar slot or a failed save).
    const recoverIfNeeded = () => {
      if (!isCurrentSwipe()) return;
      recoveryFrame.current = requestAnimationFrame(() => {
        recoveryFrame.current = null;
        if (isCurrentSwipe()) resetPosition();
      });
    };

    animation.current = Animated.timing(pan.x, {
      toValue: (direction === 'right' ? 1 : -1) * (width * 1.25 + CARD_HEIGHT * 0.2),
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    });
    animation.current.start(({ finished }) => {
      if (!finished || !isCurrentSwipe()) return;
      if (live.current.disabled) {
        resetPosition();
        return;
      }
      // Keep the original card mounted for the entire exit, and do any parent
      // state updates only after the native animation has completed.
      try {
        Promise.resolve(callback()).then(recoverIfNeeded, (error) => {
          console.warn('[SwipeDeck] Swipe action failed', error);
          recoverIfNeeded();
        });
      } catch (error) {
        console.warn('[SwipeDeck] Swipe action failed', error);
        recoverIfNeeded();
      }
    });
  }, [pan, resetPosition, width]);

  useImperativeHandle(ref, () => ({
    swipeLeft: () => completeSwipe('left'),
    swipeRight: () => completeSwipe('right'),
  }), [completeSwipe]);

  const panResponder = useMemo(() => {
    const canStart = (_: unknown, gesture: { dx: number; dy: number }) => (
      live.current.active && !live.current.disabled && !busy.current &&
      Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2
    );
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: canStart,
      onMoveShouldSetPanResponderCapture: canStart,
      onPanResponderMove: (_, gesture) => {
        if (busy.current || !live.current.active || live.current.disabled) return;
        pan.setValue({ x: gesture.dx, y: gesture.dy * 0.2 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (busy.current || !live.current.active) return;
        const isFlick = Math.abs(gesture.dx) > 24 && Math.abs(gesture.vx) > 0.5 && gesture.dx * gesture.vx > 0;
        if (!live.current.disabled && (Math.abs(gesture.dx) > width * 0.25 || isFlick)) {
          completeSwipe(gesture.dx > 0 ? 'right' : 'left');
        } else {
          resetPosition();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        if (!busy.current && live.current.active) resetPosition();
      },
    });
  }, [completeSwipe, pan, resetPosition, width]);

  const cardTransform = useMemo(() => [
    ...pan.getTranslateTransform(),
    { rotate: pan.x.interpolate({
      inputRange: [-width, 0, width],
      outputRange: ['-10deg', '0deg', '10deg'],
      extrapolate: 'clamp',
    }) },
  ], [pan, width]);

  return (
    <Animated.View
      testID={`swipe-card-${suggestion.id}`}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.card,
        { zIndex: active ? 2 : 1, transform: cardTransform },
        Platform.OS === 'web' ? ({ touchAction: 'pan-y', userSelect: 'none' } as any) : undefined,
      ]}
      {...(active ? panResponder.panHandlers : {})}
    >
      {props.renderCard ? props.renderCard(suggestion, !active) : <SuggestionCard
        suggestion={suggestion}
        preview={!active}
        animateEntrance={false}
        deckColors={deckColors}
        showSourceDebug={showSourceDebug}
      />}
    </Animated.View>
  );
});

export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(
  ({ current, next, ...props }, ref) => {
    const { width } = useWindowDimensions();
    const activeCard = useRef<SwipeDeckHandle>(null);

    useImperativeHandle(ref, () => ({
      swipeLeft: () => activeCard.current?.swipeLeft(),
      swipeRight: () => activeCard.current?.swipeRight(),
    }), []);

    const cards = current ? (next && next.id !== current.id ? [next, current] : [current]) : [];
    return (
      <View style={styles.container} testID="swipe-deck">
        {cards.map((suggestion) => (
          <CardLayer
            key={suggestion.id}
            ref={suggestion.id === current?.id ? activeCard : undefined}
            suggestion={suggestion}
            active={suggestion.id === current?.id}
            width={width}
            {...props}
          />
        ))}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    height: CARD_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    top: 0,
    width: '100%',
    height: CARD_HEIGHT,
  },
});
