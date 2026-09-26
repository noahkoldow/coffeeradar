import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

type Props = { current: number; max: number; active: boolean; compact?: boolean };

/** A small line-drawn charging scene, in the same style as the activity banner. */
export const SwipeBattery: React.FC<Props> = ({ current, max, active, compact = false }) => {
  const theme = useTheme();
  const [reduceMotion, setReduceMotion] = useState(true);
  const charge = useRef(new Animated.Value(0)).current;
  const level = Math.min(1, Math.max(0, current / Math.max(1, max)));
  const full = current >= max;
  const { accent, accentSoft, border, textMuted, success } = theme.colors;
  const chargeColor = full ? success : accent;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    charge.setValue(0);
    if (full || reduceMotion || !active) return;
    const loop = Animated.loop(Animated.timing(charge, {
      toValue: 1,
      duration: 2400,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [active, charge, full, reduceMotion]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Battery ${Math.round(level * 100)}% charged`}
      style={[styles.banner, compact && styles.bannerCompact]}
    >
      <View style={[styles.scene, compact && styles.sceneCompact]}>
        <Svg width={272} height={120} viewBox="0 0 272 120" accessible={false}>
          <Ellipse cx={169} cy={101} rx={81} ry={4} fill={border} opacity={0.4} />
          <Line x1={18} y1={101} x2={254} y2={101} stroke={border} strokeWidth={1} />
          {/* A swipe card feeding the battery through its charging cable. */}
          <Rect x={21} y={42} width={25} height={34} rx={5} stroke={border} strokeWidth={1.5} fill="none" transform="rotate(-12 33 59)" />
          <Rect x={27} y={38} width={25} height={34} rx={5} stroke={textMuted} strokeWidth={1.5} fill={theme.colors.background} />
          <Path d="M34 55h11m-4-4 4 4-4 4" stroke={chargeColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M52 58h44" stroke={border} strokeWidth={1.5} fill="none" />
          <Circle cx={74} cy={58} r={2.5} fill={chargeColor} opacity={0.35} />
          {/* Charge level is based on real credits, including partial cells. */}
          <Rect x={96} y={26} width={146} height={64} rx={12} stroke={textMuted} strokeWidth={1.8} fill="none" />
          <Path d="M242 48h5a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3h-5" stroke={textMuted} strokeWidth={1.8} fill="none" />
          {[0, 1, 2, 3, 4].map((index) => {
            const filled = Math.min(1, Math.max(0, level * 5 - index));
            return (
              <React.Fragment key={index}>
                <Rect x={106 + index * 25} y={36} width={21} height={44} rx={4} fill={accentSoft} opacity={0.45} />
                {filled > 0 && <Rect x={106 + index * 25} y={36} width={21 * filled} height={44} rx={Math.min(4, 10.5 * filled)} fill={chargeColor} opacity={0.8} />}
              </React.Fragment>
            );
          })}
          {full ? (
            <Path d="m163 13 4 4 8-8" stroke={success} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ) : (
            <Path d="m173 3-9 12h7l-4 9 11-13h-8l3-8Z" fill={accent} />
          )}
        </Svg>
        {!full && !reduceMotion && active && (
          <>
            <Animated.View style={[
              styles.energy,
              {
                backgroundColor: accent,
                opacity: charge.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 1, 1, 0] }),
                transform: [{ translateX: charge.interpolate({ inputRange: [0, 1], outputRange: [0, 40] }) }],
              },
            ]} />
            <Animated.View style={[
              styles.glow,
              {
                borderColor: accent,
                opacity: charge.interpolate({ inputRange: [0, 0.55, 0.8, 1], outputRange: [0, 0.08, 0.4, 0] }),
                transform: [{ scale: charge.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
              },
            ]} />
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: { width: '100%', height: 152, alignItems: 'center', justifyContent: 'center' },
  bannerCompact: { height: 96 },
  scene: { width: 272, height: 120 },
  sceneCompact: { transform: [{ scale: 0.8 }] },
  energy: { position: 'absolute', left: 52, top: 55.5, width: 5, height: 5, borderRadius: 2.5 },
  glow: { position: 'absolute', left: 93, top: 23, width: 152, height: 70, borderRadius: 15, borderWidth: 1.5 },
});
