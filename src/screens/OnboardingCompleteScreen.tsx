import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import * as Haptics from 'expo-haptics';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'OnboardingComplete'>;

export const OnboardingCompleteScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { actions } = useAppState();
  const ripple = useRef(new Animated.Value(0)).current;
  const [rippleConfig, setRippleConfig] = useState<{ left: number; top: number; size: number } | null>(null);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);

  useEffect(() => {
    const centerX = width / 2;
    const centerY = height / 2;
    const distances = [
      Math.hypot(centerX - 0, centerY - 0),
      Math.hypot(centerX - width, centerY - 0),
      Math.hypot(centerX - 0, centerY - height),
      Math.hypot(centerX - width, centerY - height),
    ];
    const size = Math.max(...distances) * 2;

    setRippleConfig({
      left: centerX - size / 2,
      top: centerY - size / 2,
      size,
    });
  }, [height, width]);

  useEffect(() => {
    if (!rippleConfig) return;

    const timer = setTimeout(() => {
      ripple.stopAnimation();
      ripple.setValue(0);
      Animated.timing(ripple, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        actions.completeOnboarding();
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      });
    }, 120);

    return () => {
      clearTimeout(timer);
    };
  }, [actions, navigation, ripple, rippleConfig]);

  const rippleScale = ripple.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 1],
  });

  return (
    <LinearGradient
      colors={['#07111f', '#0b1f39', '#123b66']}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.xl }]}
    >
      <View style={styles.content}>
        <Text style={styles.label}>All set!</Text>
      </View>

      {rippleConfig && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              left: rippleConfig.left,
              top: rippleConfig.top,
              width: rippleConfig.size,
              height: rippleConfig.size,
              borderRadius: rippleConfig.size / 2,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />
      )}
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  content: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    zIndex: 3,
  },
  label: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.background,
    fontSize: 16,
  },
  ripple: {
    position: 'absolute',
    backgroundColor: theme.colors.accent,
  },
});