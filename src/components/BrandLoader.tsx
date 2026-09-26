import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, ColorValue, Easing, Image, StyleSheet, View, ViewProps } from 'react-native';

type BrandLoaderProps = ViewProps & {
  size?: 'small' | 'large' | number;
  color?: ColorValue;
  animating?: boolean;
  hidesWhenStopped?: boolean;
};

const loadingMark = require('../../assets/b_loading.png');

/** One centered turn, then a brief rest before the next turn. */
export const BrandLoader: React.FC<BrandLoaderProps> = ({
  size = 'small',
  color,
  animating = true,
  hidesWhenStopped = true,
  style,
  accessibilityLabel = 'Loading',
  accessibilityState,
  ...viewProps
}) => {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const dimension = typeof size === 'number' ? size : size === 'large' ? 48 : 24;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    const motionSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const appSubscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => {
      mounted = false;
      motionSubscription.remove();
      appSubscription.remove();
    };
  }, []);

  useEffect(() => {
    progress.setValue(0);
    if (!animating || reduceMotion || !appActive) return;

    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
        isInteraction: false,
      }),
      Animated.timing(progress, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
        isInteraction: false,
      }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [animating, appActive, progress, reduceMotion]);

  if (!animating && hidesWhenStopped) return null;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, busy: animating }}
      {...viewProps}
      style={[styles.container, style]}
    >
      <Animated.View
        style={{
          width: dimension,
          height: dimension,
          transform: [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }}
      >
        <Image
          accessible={false}
          source={loadingMark}
          resizeMode="contain"
          style={{
            width: dimension,
            height: dimension,
            tintColor: color,
            // Center the visible mark, compensating for the PNG's transparent padding.
            // Source: 547 × 456; visible bounds: x 101–429, y 28–439.
            transform: [{ translateX: dimension * 8 / 547 }, { translateY: -dimension * 6 / 547 }],
          }}
        />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
