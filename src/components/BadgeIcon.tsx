import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

/**
 * Badge icons drawn in the same stick-figure / landscape SVG style
 * as the ActivityBanner characters and terrain.
 */

type Props = {
  badgeId: string;
  size?: number;
  color: string;
};

/* ── Focus — person reading at a desk ───────────────────── */
const FocusIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Desk */}
    <Line x1={6} y1={30} x2={34} y2={30} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={10} y1={30} x2={10} y2={36} stroke={color} strokeWidth={1.2} />
    <Line x1={30} y1={30} x2={30} y2={36} stroke={color} strokeWidth={1.2} />
    {/* Book on desk */}
    <Path d="M14 28 L14 24 L24 24 L24 28" stroke={color} strokeWidth={1.2} fill="none" />
    <Line x1={19} y1={24} x2={19} y2={28} stroke={color} strokeWidth={0.8} />
    {/* Person sitting */}
    <Circle cx={19} cy={12} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={19} y1={16} x2={19} y2={24} stroke={color} strokeWidth={1.4} />
    {/* Arms reaching to book */}
    <Line x1={19} y1={19} x2={14} y2={25} stroke={color} strokeWidth={1.2} />
    <Line x1={19} y1={19} x2={24} y2={25} stroke={color} strokeWidth={1.2} />
    {/* Legs */}
    <Line x1={19} y1={24} x2={15} y2={30} stroke={color} strokeWidth={1.2} />
    <Line x1={19} y1={24} x2={23} y2={30} stroke={color} strokeWidth={1.2} />
    {/* Little lightbulb idea */}
    <Circle cx={28} cy={8} r={2.5} stroke={color} strokeWidth={1} fill="none" />
    <Line x1={28} y1={11} x2={28} y2={12} stroke={color} strokeWidth={0.8} />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const rad = (a * Math.PI) / 180;
      return <Line key={a} x1={28 + Math.cos(rad) * 4} y1={8 + Math.sin(rad) * 4} x2={28 + Math.cos(rad) * 5.5} y2={8 + Math.sin(rad) * 5.5} stroke={color} strokeWidth={0.6} opacity={0.5} />;
    })}
  </Svg>
);

/* ── Fitness — person lifting weights ───────────────────── */
const FitnessIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Head */}
    <Circle cx={20} cy={7} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Body */}
    <Line x1={20} y1={11} x2={20} y2={24} stroke={color} strokeWidth={1.6} />
    {/* Arms holding barbell up */}
    <Line x1={20} y1={14} x2={8} y2={8} stroke={color} strokeWidth={1.3} />
    <Line x1={20} y1={14} x2={32} y2={8} stroke={color} strokeWidth={1.3} />
    {/* Barbell */}
    <Line x1={6} y1={8} x2={34} y2={8} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Rect x={4} y={5} width={4} height={6} rx={1} stroke={color} strokeWidth={1.2} fill="none" />
    <Rect x={32} y={5} width={4} height={6} rx={1} stroke={color} strokeWidth={1.2} fill="none" />
    {/* Legs wide stance */}
    <Line x1={20} y1={24} x2={13} y2={34} stroke={color} strokeWidth={1.4} />
    <Line x1={13} y1={34} x2={11} y2={36} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    <Line x1={20} y1={24} x2={27} y2={34} stroke={color} strokeWidth={1.4} />
    <Line x1={27} y1={34} x2={29} y2={36} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    {/* Ground */}
    <Line x1={8} y1={37} x2={32} y2={37} stroke={color} strokeWidth={1} opacity={0.3} />
  </Svg>
);

/* ── Nature — tree and path landscape ───────────────────── */
const NatureIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Ground line */}
    <Path d="M0 34 Q10 30 20 34 Q30 38 40 32" stroke={color} strokeWidth={1.2} fill="none" />
    {/* Tree trunk */}
    <Line x1={12} y1={22} x2={12} y2={34} stroke={color} strokeWidth={1.6} />
    {/* Tree canopy */}
    <Circle cx={12} cy={14} r={8} stroke={color} strokeWidth={1.4} fill="none" />
    <Circle cx={7} cy={18} r={5} stroke={color} strokeWidth={1} fill="none" opacity={0.6} />
    <Circle cx={17} cy={18} r={5} stroke={color} strokeWidth={1} fill="none" opacity={0.6} />
    {/* Small bush */}
    <Ellipse cx={32} cy={30} rx={5} ry={4} stroke={color} strokeWidth={1.2} fill="none" />
    {/* Sun */}
    <Circle cx={34} cy={8} r={3} stroke={color} strokeWidth={1} fill="none" />
    {[0, 60, 120, 180, 240, 300].map((a) => {
      const rad = (a * Math.PI) / 180;
      return <Line key={a} x1={34 + Math.cos(rad) * 4.5} y1={8 + Math.sin(rad) * 4.5} x2={34 + Math.cos(rad) * 6} y2={8 + Math.sin(rad) * 6} stroke={color} strokeWidth={0.8} opacity={0.5} />;
    })}
    {/* Bird */}
    <Path d="M22 10 Q24 7 26 10" stroke={color} strokeWidth={0.8} fill="none" />
  </Svg>
);

/* ── Wellness — person meditating ───────────────────────── */
const WellnessIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Head */}
    <Circle cx={20} cy={10} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Body */}
    <Line x1={20} y1={14} x2={20} y2={24} stroke={color} strokeWidth={1.6} />
    {/* Cross-legged */}
    <Path d="M14 30 Q17 24 20 28 Q23 24 26 30" stroke={color} strokeWidth={1.3} fill="none" />
    <Line x1={20} y1={24} x2={16} y2={28} stroke={color} strokeWidth={1.2} />
    <Line x1={20} y1={24} x2={24} y2={28} stroke={color} strokeWidth={1.2} />
    {/* Arms on knees */}
    <Line x1={20} y1={18} x2={13} y2={26} stroke={color} strokeWidth={1.2} />
    <Line x1={20} y1={18} x2={27} y2={26} stroke={color} strokeWidth={1.2} />
    {/* Aura/energy circles */}
    <Circle cx={20} cy={18} r={12} stroke={color} strokeWidth={0.6} fill="none" opacity={0.2} />
    <Circle cx={20} cy={18} r={16} stroke={color} strokeWidth={0.4} fill="none" opacity={0.12} />
    {/* Stars */}
    <Circle cx={8} cy={8} r={1} fill={color} opacity={0.4} />
    <Circle cx={33} cy={12} r={1} fill={color} opacity={0.4} />
    <Circle cx={10} cy={32} r={0.8} fill={color} opacity={0.3} />
  </Svg>
);

/* ── Social — two people together ───────────────────────── */
const SocialIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Person 1 */}
    <Circle cx={14} cy={8} r={3} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={14} y1={11} x2={14} y2={22} stroke={color} strokeWidth={1.4} />
    <Line x1={14} y1={22} x2={10} y2={32} stroke={color} strokeWidth={1.2} />
    <Line x1={14} y1={22} x2={18} y2={32} stroke={color} strokeWidth={1.2} />
    <Line x1={14} y1={15} x2={8} y2={19} stroke={color} strokeWidth={1.2} />
    {/* Person 2 */}
    <Circle cx={26} cy={8} r={3} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={26} y1={11} x2={26} y2={22} stroke={color} strokeWidth={1.4} />
    <Line x1={26} y1={22} x2={22} y2={32} stroke={color} strokeWidth={1.2} />
    <Line x1={26} y1={22} x2={30} y2={32} stroke={color} strokeWidth={1.2} />
    <Line x1={26} y1={15} x2={32} y2={19} stroke={color} strokeWidth={1.2} />
    {/* Arms meeting / high five */}
    <Line x1={14} y1={15} x2={20} y2={13} stroke={color} strokeWidth={1.2} />
    <Line x1={26} y1={15} x2={20} y2={13} stroke={color} strokeWidth={1.2} />
    {/* Ground */}
    <Line x1={6} y1={34} x2={34} y2={34} stroke={color} strokeWidth={0.8} opacity={0.3} />
    {/* Chat bubble */}
    <Ellipse cx={20} cy={4} rx={4} ry={2} stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
  </Svg>
);

/* ── Art — person painting on easel ─────────────────────── */
const ArtIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Easel legs */}
    <Line x1={14} y1={8} x2={10} y2={36} stroke={color} strokeWidth={1.2} />
    <Line x1={26} y1={8} x2={30} y2={36} stroke={color} strokeWidth={1.2} />
    <Line x1={20} y1={18} x2={20} y2={36} stroke={color} strokeWidth={1.2} />
    {/* Canvas */}
    <Rect x={12} y={6} width={16} height={14} rx={1} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Art on canvas — little landscape */}
    <Path d="M14 18 L18 12 L22 16 L26 10" stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
    <Circle cx={24} cy={9} r={1.5} stroke={color} strokeWidth={0.6} fill="none" opacity={0.5} />
    {/* Person */}
    <Circle cx={34} cy={16} r={2.5} stroke={color} strokeWidth={1.2} fill="none" />
    <Line x1={34} y1={19} x2={34} y2={28} stroke={color} strokeWidth={1.3} />
    {/* Arm reaching to canvas */}
    <Line x1={34} y1={22} x2={28} y2={16} stroke={color} strokeWidth={1.1} />
    {/* Other arm */}
    <Line x1={34} y1={22} x2={38} y2={25} stroke={color} strokeWidth={1.1} />
    {/* Palette */}
    <Ellipse cx={38} cy={26} rx={2} ry={1.5} stroke={color} strokeWidth={0.8} fill="none" />
    {/* Legs */}
    <Line x1={34} y1={28} x2={31} y2={36} stroke={color} strokeWidth={1.2} />
    <Line x1={34} y1={28} x2={37} y2={36} stroke={color} strokeWidth={1.2} />
  </Svg>
);

/* ── Food — steaming coffee cup ─────────────────────────── */
const FoodIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Saucer */}
    <Ellipse cx={20} cy={34} rx={14} ry={3} stroke={color} strokeWidth={1.2} fill="none" />
    {/* Cup body */}
    <Path d="M10 18 L10 30 Q10 34 20 34 Q30 34 30 30 L30 18" stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={10} y1={18} x2={30} y2={18} stroke={color} strokeWidth={1.4} />
    {/* Handle */}
    <Path d="M30 21 Q36 21 36 26 Q36 31 30 31" stroke={color} strokeWidth={1.2} fill="none" />
    {/* Steam */}
    <Path d="M15 16 Q15 12 17 10 Q17 8 15 6" stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
    <Path d="M20 14 Q20 10 22 8 Q22 6 20 4" stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
    <Path d="M25 16 Q25 12 27 10 Q27 8 25 6" stroke={color} strokeWidth={0.8} fill="none" opacity={0.5} />
    {/* Coffee in cup */}
    <Ellipse cx={20} cy={22} rx={8} ry={1.5} stroke={color} strokeWidth={0.6} fill="none" opacity={0.4} />
  </Svg>
);

/* ── Habits — calendar with checkmarks ──────────────────── */
const HabitsIcon = ({ color, s }: { color: string; s: number }) => (
  <Svg width={s} height={s} viewBox="0 0 40 40">
    {/* Calendar body */}
    <Rect x={5} y={8} width={30} height={28} rx={3} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Calendar top bar */}
    <Line x1={5} y1={14} x2={35} y2={14} stroke={color} strokeWidth={1.2} />
    {/* Calendar hooks */}
    <Line x1={13} y1={5} x2={13} y2={11} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={27} y1={5} x2={27} y2={11} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    {/* Checkmarks in cells */}
    <Path d="M10 20 L13 23 L18 17" stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" />
    <Path d="M22 20 L25 23 L30 17" stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" />
    <Path d="M10 28 L13 31 L18 25" stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" />
    {/* Streak flame */}
    <Path d="M27 25 Q29 22 28 28 Q30 26 29 30 Q27 32 25 28 Q26 26 27 25" stroke={color} strokeWidth={1} fill="none" opacity={0.6} />
  </Svg>
);

/* ── Lookup ──────────────────────────────────────────────── */

const ICON_MAP: Record<string, React.FC<{ color: string; s: number }>> = {
  focus: FocusIcon,
  fitness: FitnessIcon,
  nature: NatureIcon,
  wellness: WellnessIcon,
  social: SocialIcon,
  art: ArtIcon,
  food: FoodIcon,
  habits: HabitsIcon,
};

export const BadgeIcon: React.FC<Props> = ({ badgeId, size = 56, color }) => {
  const IconComponent = ICON_MAP[badgeId];
  if (!IconComponent) return null;
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <IconComponent color={color} s={size} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
