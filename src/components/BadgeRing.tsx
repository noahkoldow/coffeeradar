import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

type Props = {
  size?: number;
  strokeWidth?: number;
  progress: number;
  level: number;
  color: string;
  /** When true, show the level number centred inside the ring */
  showLevel?: boolean;
};

export const BadgeRing: React.FC<Props> = ({ size = 64, strokeWidth = 6, progress, level, color, showLevel = false }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {showLevel && (
        <View style={styles.center}>
          <Text
            style={[
              styles.levelSilhouette,
              {
                fontSize: Math.round(size * 0.42),
              },
            ]}
          >
            {level}
          </Text>
          <Text style={[styles.levelText, { fontSize: Math.round(size * 0.32), color }]}>{level}</Text>
        </View>
      )}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 16,
  },
  levelSilhouette: {
    position: 'absolute',
    fontFamily: theme.fonts.semibold,
    color: '#FFFFFF',
    opacity: 0.95,
    textShadowColor: 'rgba(255,255,255,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
});
