import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeProvider';
import type { WeatherCondition } from '../services/weather';

const GROUND_BANNER_HEIGHT = 56;
const SKY_BANNER_HEIGHT = 56;
const GROUND_W = 400;
const CROSS_DURATION = 10000;
const PAUSE_BETWEEN = 1000;
const MAX_CHARACTERS = 3;

/* ================================================================
 *  Character type pools per weather
 * ================================================================ */

type CharacterType = 'cyclist' | 'runner' | 'hiker' | 'umbrella' | 'cozy' | 'snowman' | 'car';

const WEATHER_CHARACTERS: Record<WeatherCondition, CharacterType[]> = {
  clear: ['cyclist', 'runner', 'hiker'],
  cloudy: ['hiker', 'runner', 'car'],
  drizzle: ['car', 'umbrella', 'cozy'],
  rain: ['umbrella', 'cozy', 'umbrella'],
  snow: ['snowman', 'cozy', 'hiker'],
  unknown: ['runner', 'hiker', 'cyclist'],
};

/* ================================================================
 *  Sky backgrounds — drawn behind everything
 * ================================================================ */

type SkyProps = { width: number; height: number };

const ClearSky = ({ width, height }: SkyProps) => (
  <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    {/* Sun with glow halo */}
    <Circle cx={width * 0.82} cy={height * 0.3} r={20} fill="#FFD93D" opacity={0.12} />
    <Circle cx={width * 0.82} cy={height * 0.3} r={12} fill="#FFD93D" opacity={0.55} />
    {/* Rays */}
    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
      const rad = (angle * Math.PI) / 180;
      const cx = width * 0.82;
      const cy = height * 0.3;
      return <Line key={angle} x1={cx + Math.cos(rad) * 16} y1={cy + Math.sin(rad) * 16} x2={cx + Math.cos(rad) * 22} y2={cy + Math.sin(rad) * 22} stroke="#FFD93D" strokeWidth={1.4} opacity={0.35} />;
    })}
    {/* Fluffy cumulus clouds */}
    <G>
      <Ellipse cx={width * 0.12} cy={height * 0.35} rx={width * 0.08} ry={height * 0.18} fill="#FFF" opacity={0.7} stroke="#C8D4E0" strokeWidth={0.8} />
      <Ellipse cx={width * 0.17} cy={height * 0.28} rx={width * 0.06} ry={height * 0.14} fill="#FFF" opacity={0.6} stroke="#C8D4E0" strokeWidth={0.8} />
      <Ellipse cx={width * 0.07} cy={height * 0.4} rx={width * 0.05} ry={height * 0.12} fill="#FFF" opacity={0.5} stroke="#C8D4E0" strokeWidth={0.8} />
    </G>
    <G>
      <Ellipse cx={width * 0.45} cy={height * 0.25} rx={width * 0.07} ry={height * 0.16} fill="#FFF" opacity={0.6} stroke="#C8D4E0" strokeWidth={0.8} />
      <Ellipse cx={width * 0.5} cy={height * 0.2} rx={width * 0.05} ry={height * 0.12} fill="#FFF" opacity={0.5} stroke="#C8D4E0" strokeWidth={0.8} />
      <Ellipse cx={width * 0.42} cy={height * 0.32} rx={width * 0.04} ry={height * 0.1} fill="#FFF" opacity={0.45} stroke="#C8D4E0" strokeWidth={0.8} />
    </G>
    {/* Wispy high cloud */}
    <Ellipse cx={width * 0.65} cy={height * 0.15} rx={width * 0.06} ry={height * 0.06} fill="#FFF" opacity={0.4} stroke="#C8D4E0" strokeWidth={0.6} />
    {/* Birds */}
    <Path d={`M${width * 0.18} ${height * 0.6} Q${width * 0.2} ${height * 0.5} ${width * 0.22} ${height * 0.6}`} stroke="#AAA" strokeWidth={1} fill="none" />
    <Path d={`M${width * 0.28} ${height * 0.48} Q${width * 0.3} ${height * 0.38} ${width * 0.32} ${height * 0.48}`} stroke="#AAA" strokeWidth={1} fill="none" />
    <Path d={`M${width * 0.55} ${height * 0.55} Q${width * 0.57} ${height * 0.45} ${width * 0.59} ${height * 0.55}`} stroke="#AAA" strokeWidth={1} fill="none" />
  </Svg>
);

const CloudySky = ({ width, height }: SkyProps) => (
  <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
    {/* Dense cloud layer */}
    {[0.08, 0.28, 0.52, 0.78].map((p) => (
      <G key={p}>
        <Ellipse cx={width * p} cy={height * 0.3} rx={width * 0.1} ry={height * 0.22} fill="#E6EBF0" opacity={0.46} stroke="#D3DAE2" strokeWidth={0.8} />
        <Ellipse cx={width * p + width * 0.06} cy={height * 0.22} rx={width * 0.06} ry={height * 0.16} fill="#EEF2F6" opacity={0.42} stroke="#D3DAE2" strokeWidth={0.7} />
        <Ellipse cx={width * p - width * 0.04} cy={height * 0.38} rx={width * 0.05} ry={height * 0.14} fill="#E9EEF3" opacity={0.34} stroke="#D3DAE2" strokeWidth={0.7} />
        <Ellipse cx={width * p + width * 0.02} cy={height * 0.16} rx={width * 0.04} ry={height * 0.1} fill="#F3F6F9" opacity={0.3} stroke="#D3DAE2" strokeWidth={0.6} />
      </G>
    ))}
    {/* Wispy high clouds */}
    {[0.18, 0.42, 0.68, 0.92].map((p) => (
      <Ellipse key={`w${p}`} cx={width * p} cy={height * 0.1} rx={width * 0.06} ry={height * 0.07} fill="#F0F4F8" opacity={0.24} stroke="#D7DEE5" strokeWidth={0.6} />
    ))}
    {/* Lower heavy bases */}
    {[0.2, 0.55, 0.85].map((p) => (
      <G key={`b${p}`}>
        <Ellipse cx={width * p} cy={height * 0.65} rx={width * 0.1} ry={height * 0.16} fill="#D9E0E6" opacity={0.34} stroke="#C4CDD6" strokeWidth={0.7} />
        <Ellipse cx={width * p + width * 0.05} cy={height * 0.6} rx={width * 0.05} ry={height * 0.1} fill="#E4EAF0" opacity={0.28} stroke="#C4CDD6" strokeWidth={0.6} />
      </G>
    ))}
    {/* Dim sun peeking through */}
    <Circle cx={width * 0.85} cy={height * 0.35} r={height * 0.14} fill="#FFE07A" opacity={0.2} />
  </Svg>
);

const RainSky = ({ width, height }: SkyProps) => {
  const drops = Array.from({ length: 22 }, (_, i) => ({
    x: (width / 22) * i + 6,
    yOff: (i % 5) * (height * 0.07),
  }));
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Heavy storm clouds */}
      {[0.05, 0.25, 0.48, 0.72, 0.93].map((p) => (
        <G key={p}>
          <Ellipse cx={width * p} cy={height * 0.24} rx={width * 0.1} ry={height * 0.22} fill="#6E6E6E" opacity={0.48} stroke="#585E64" strokeWidth={0.8} />
          <Ellipse cx={width * p + width * 0.06} cy={height * 0.18} rx={width * 0.06} ry={height * 0.16} fill="#7A7A7A" opacity={0.42} stroke="#585E64" strokeWidth={0.7} />
          <Ellipse cx={width * p - width * 0.04} cy={height * 0.3} rx={width * 0.06} ry={height * 0.14} fill="#7A7A7A" opacity={0.36} stroke="#585E64" strokeWidth={0.7} />
        </G>
      ))}
      {/* Dark lower bases */}
      {[0.15, 0.45, 0.75].map((p) => (
        <Ellipse key={`lb${p}`} cx={width * p} cy={height * 0.5} rx={width * 0.1} ry={height * 0.14} fill="#6E6E6E" opacity={0.28} stroke="#585E64" strokeWidth={0.7} />
      ))}
      {/* Rain streaks */}
      {drops.map(({ x, yOff }, i) => (
        <Line key={i} x1={x} y1={height * 0.48 + yOff} x2={x - 3} y2={height * 0.68 + yOff} stroke="#6BA4D9" strokeWidth={1.2} opacity={0.4} strokeLinecap="round" />
      ))}
    </Svg>
  );
};

const DrizzleSky = ({ width, height }: SkyProps) => {
  // Generate randomized clouds/drops per mount (recompute when size changes)
  const clouds = useMemo(() => {
    const base = [0.1, 0.36, 0.62, 0.86];
    return base.map((p) => {
      const cx = Math.min(0.95, Math.max(0.05, p + (Math.random() - 0.5) * 0.12));
      const cy = 0.22 + (Math.random() - 0.5) * 0.14;
      const rx = 0.05 + Math.random() * 0.08;
      const ry = 0.09 + Math.random() * 0.12;
      const o = 0.22 + Math.random() * 0.12;
      return { cx, cy, rx, ry, o };
    });
  }, [width, height]);

  const drops = useMemo(() =>
    Array.from({ length: 13 }, (_, i) => {
      const baseX = (i + 0.5) / 13;
      const jitter = (Math.random() - 0.5) * 0.08;
      const x = width * Math.min(0.98, Math.max(0.02, baseX + jitter));
      const yOff = (Math.random() - 0.5) * height * 0.12 + (i % 4) * (height * 0.05);
      return { x, yOff };
    }),
    [width, height],
  );

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {clouds.map((c, idx) => (
        <G key={`dcl${idx}`}>
          <Ellipse cx={width * c.cx} cy={height * c.cy} rx={width * c.rx} ry={height * c.ry} fill="#AEB8C4" opacity={c.o} stroke="#94A3B8" strokeWidth={0.7} />
          <Ellipse cx={width * (c.cx + 0.03)} cy={height * (c.cy - 0.04)} rx={width * (c.rx * 0.6)} ry={height * (c.ry * 0.7)} fill="#C4CBD5" opacity={c.o * 0.95} stroke="#A3ADBA" strokeWidth={0.6} />
          <Ellipse cx={width * (c.cx - 0.025)} cy={height * (c.cy + 0.05)} rx={width * (c.rx * 0.5)} ry={height * (c.ry * 0.6)} fill="#C8D0DA" opacity={c.o * 0.8} stroke="#A3ADBA" strokeWidth={0.6} />
        </G>
      ))}

      <Circle cx={width * 0.8} cy={height * 0.22} r={14} fill="#FFD93D" opacity={0.08} />

      {drops.map(({ x, yOff }, i) => (
        <Line key={i} x1={x} y1={height * (0.48 + (i % 3) * 0.02) + yOff} x2={x - 2 - (i % 2)} y2={height * (0.62 + (i % 3) * 0.01) + yOff} stroke="#6BA4D9" strokeWidth={0.9} opacity={0.28} strokeLinecap="round" />
      ))}
    </Svg>
  );
};

const SnowSky = ({ width, height }: SkyProps) => {
  const flakes = Array.from({ length: 18 }, (_, i) => ({
    x: (i / 18) * width * 0.95 + width * 0.02,
    y: height * 0.45 + (i % 5) * (height * 0.08),
    r: i % 3 === 0 ? 2.2 : 1.5,
  }));
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Soft snow clouds */}
      {[0.08, 0.3, 0.55, 0.8].map((p) => (
        <G key={p}>
          <Ellipse cx={width * p} cy={height * 0.25} rx={width * 0.09} ry={height * 0.2} fill="#B0B0B0" opacity={0.38} stroke="#9AA0A8" strokeWidth={0.8} />
          <Ellipse cx={width * p + width * 0.05} cy={height * 0.18} rx={width * 0.06} ry={height * 0.14} fill="#B8B8B8" opacity={0.3} stroke="#9AA0A8" strokeWidth={0.7} />
          <Ellipse cx={width * p - width * 0.03} cy={height * 0.32} rx={width * 0.05} ry={height * 0.12} fill="#B8B8B8" opacity={0.24} stroke="#9AA0A8" strokeWidth={0.7} />
          <Ellipse cx={width * p + width * 0.02} cy={height * 0.13} rx={width * 0.04} ry={height * 0.08} fill="#C4C4C4" opacity={0.2} stroke="#A8B0B8" strokeWidth={0.6} />
        </G>
      ))}
      {/* Misty lower layer */}
      {[0.18, 0.5, 0.82].map((p) => (
        <Ellipse key={`m${p}`} cx={width * p} cy={height * 0.6} rx={width * 0.09} ry={height * 0.1} fill="#C0C0C0" opacity={0.2} stroke="#A8B0B8" strokeWidth={0.6} />
      ))}
      {/* Snowflakes */}
      {flakes.map(({ x, y, r }, i) => (
        <Circle key={i} cx={x} cy={y} r={r} fill="#D0D8E8" opacity={0.5} />
      ))}
    </Svg>
  );
};

const SKY_MAP: Record<WeatherCondition, React.FC<SkyProps>> = {
  clear: ClearSky,
  cloudy: CloudySky,
  drizzle: DrizzleSky,
  rain: RainSky,
  snow: SnowSky,
  unknown: CloudySky,
};

/* ── Night sky — stars and moon, fading top→bottom ───────── */
const NightSky = ({ width, height }: SkyProps) => {
  return (
    <View style={{ width, height }}>
      <LinearGradient
        colors={['rgba(15,27,45,0.92)', 'rgba(18,35,58,0.46)', 'rgba(18,35,58,0.0)']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Moon */}
        <Circle cx={width * 0.78} cy={height * 0.28} r={10} fill="#E8E0C8" opacity={0.85} />
        <Circle cx={width * 0.81} cy={height * 0.24} r={8} fill="#0F1B2D" opacity={0.7} />
        {/* Moon glow */}
        <Circle cx={width * 0.78} cy={height * 0.28} r={18} fill="#E8E0C8" opacity={0.06} />
        {/* Stars — concentrated toward the top, fading lower */}
        {[
          { x: 0.08, y: 0.12, r: 1.2, o: 0.8 }, { x: 0.15, y: 0.3, r: 0.8, o: 0.7 }, { x: 0.22, y: 0.08, r: 1.0, o: 0.85 },
          { x: 0.32, y: 0.22, r: 0.7, o: 0.65 }, { x: 0.4, y: 0.06, r: 1.1, o: 0.9 }, { x: 0.48, y: 0.35, r: 0.9, o: 0.55 },
          { x: 0.55, y: 0.14, r: 0.6, o: 0.75 }, { x: 0.62, y: 0.28, r: 1.0, o: 0.6 }, { x: 0.7, y: 0.42, r: 0.7, o: 0.4 },
          { x: 0.88, y: 0.18, r: 0.9, o: 0.7 }, { x: 0.92, y: 0.1, r: 0.8, o: 0.8 }, { x: 0.35, y: 0.45, r: 0.6, o: 0.35 },
          { x: 0.18, y: 0.5, r: 0.5, o: 0.3 }, { x: 0.58, y: 0.48, r: 0.5, o: 0.25 }, { x: 0.82, y: 0.38, r: 0.5, o: 0.4 },
        ].map(({ x, y, r, o }, i) => (
          <Circle key={i} cx={width * x} cy={height * y} r={r} fill="#FFF" opacity={o} />
        ))}
        {/* Subtle cloud wisp near bottom */}
        <Ellipse cx={width * 0.3} cy={height * 0.75} rx={width * 0.1} ry={height * 0.08} fill="#2A3A5C" opacity={0.2} />
        <Ellipse cx={width * 0.65} cy={height * 0.8} rx={width * 0.08} ry={height * 0.06} fill="#2A3A5C" opacity={0.15} />
      </Svg>
    </View>
  );
};

/** Determine if it's currently nighttime (before 6am or after 20:00) */
const isNightTime = (): boolean => {
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6;
};

/* ================================================================
 *  Static SVG figures — we show two poses and swap them
 * ================================================================ */

/* ── Cyclist — two pedal poses ────────────────────────────── */
const CyclistPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={36} height={36} viewBox="0 0 36 36">
    <Circle cx={8} cy={28} r={6} stroke={color} strokeWidth={1.6} fill="none" />
    <Circle cx={28} cy={28} r={6} stroke={color} strokeWidth={1.6} fill="none" />
    <Line x1={8} y1={28} x2={18} y2={16} stroke={color} strokeWidth={1.4} />
    <Line x1={18} y1={16} x2={28} y2={28} stroke={color} strokeWidth={1.4} />
    <Line x1={18} y1={16} x2={24} y2={16} stroke={color} strokeWidth={1.4} />
    <Line x1={24} y1={16} x2={28} y2={28} stroke={color} strokeWidth={1.4} />
    <Line x1={16} y1={15} x2={21} y2={15} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Line x1={24} y1={14} x2={27} y2={16} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={18} y1={16} x2={18} y2={8} stroke={color} strokeWidth={1.6} />
    <Circle cx={18} cy={6} r={3} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={18} y1={10} x2={24} y2={14} stroke={color} strokeWidth={1.2} />
    {pose === 0 ? (
      <>
        <Line x1={18} y1={16} x2={14} y2={22} stroke={color} strokeWidth={1.2} />
        <Line x1={14} y1={22} x2={10} y2={26} stroke={color} strokeWidth={1.2} />
        <Line x1={18} y1={16} x2={22} y2={24} stroke={color} strokeWidth={1.2} />
        <Line x1={22} y1={24} x2={24} y2={28} stroke={color} strokeWidth={1.2} />
      </>
    ) : (
      <>
        <Line x1={18} y1={16} x2={14} y2={24} stroke={color} strokeWidth={1.2} />
        <Line x1={14} y1={24} x2={10} y2={28} stroke={color} strokeWidth={1.2} />
        <Line x1={18} y1={16} x2={22} y2={22} stroke={color} strokeWidth={1.2} />
        <Line x1={22} y1={22} x2={24} y2={24} stroke={color} strokeWidth={1.2} />
      </>
    )}
  </Svg>
);

/* ── Runner — two stride poses ────────────────────────────── */
const RunnerPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={28} height={36} viewBox="0 0 28 36">
    <Circle cx={14} cy={5} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={14} y1={9} x2={14} y2={20} stroke={color} strokeWidth={1.6} />
    {pose === 0 ? (
      <>
        <Line x1={14} y1={12} x2={20} y2={17} stroke={color} strokeWidth={1.3} />
        <Line x1={14} y1={12} x2={7} y2={16} stroke={color} strokeWidth={1.3} />
        <Line x1={14} y1={20} x2={22} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={22} y1={28} x2={24} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={14} y1={20} x2={6} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={6} y1={28} x2={4} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    ) : (
      <>
        <Line x1={14} y1={12} x2={8} y2={17} stroke={color} strokeWidth={1.3} />
        <Line x1={14} y1={12} x2={21} y2={16} stroke={color} strokeWidth={1.3} />
        <Line x1={14} y1={20} x2={8} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={8} y1={28} x2={6} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={14} y1={20} x2={20} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={20} y1={28} x2={22} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    )}
  </Svg>
);

/* ── Hiker — two stride poses ─────────────────────────────── */
const HikerPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={30} height={36} viewBox="0 0 30 36">
    <Circle cx={15} cy={4} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={10} y1={2} x2={20} y2={2} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Line x1={15} y1={8} x2={15} y2={20} stroke={color} strokeWidth={1.6} />
    <Rect x={16} y={9} width={5} height={8} rx={1.5} stroke={color} strokeWidth={1.2} fill="none" />
    <Line x1={15} y1={12} x2={8} y2={14} stroke={color} strokeWidth={1.3} />
    <Line x1={15} y1={12} x2={21} y2={16} stroke={color} strokeWidth={1.3} />
    {pose === 0 ? (
      <>
        <Line x1={8} y1={10} x2={4} y2={34} stroke={color} strokeWidth={1.2} />
        <Line x1={15} y1={20} x2={10} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={10} y1={28} x2={8} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={15} y1={20} x2={20} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={20} y1={28} x2={22} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    ) : (
      <>
        <Line x1={8} y1={10} x2={6} y2={34} stroke={color} strokeWidth={1.2} />
        <Line x1={15} y1={20} x2={20} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={20} y1={28} x2={22} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={15} y1={20} x2={10} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={10} y1={28} x2={8} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    )}
  </Svg>
);

/* ── Umbrella person — walking in rain ────────────────────── */
const UmbrellaPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={32} height={36} viewBox="0 0 32 36">
    {/* Head */}
    <Circle cx={16} cy={5} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Body */}
    <Line x1={16} y1={9} x2={16} y2={20} stroke={color} strokeWidth={1.6} />
    {/* Umbrella – held in one hand above head */}
    <Line x1={16} y1={12} x2={22} y2={4} stroke={color} strokeWidth={1.3} />
    <Path d="M12 4 Q17 -3 27 4" stroke={color} strokeWidth={1.4} fill="none" />
    <Line x1={12} y1={4} x2={27} y2={4} stroke={color} strokeWidth={0.8} />
    {/* Other arm */}
    <Line x1={16} y1={13} x2={9} y2={17} stroke={color} strokeWidth={1.3} />
    {/* Legs */}
    {pose === 0 ? (
      <>
        <Line x1={16} y1={20} x2={21} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={21} y1={28} x2={23} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={16} y1={20} x2={11} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={11} y1={28} x2={9} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    ) : (
      <>
        <Line x1={16} y1={20} x2={11} y2={27} stroke={color} strokeWidth={1.4} />
        <Line x1={11} y1={27} x2={10} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={16} y1={20} x2={21} y2={27} stroke={color} strokeWidth={1.4} />
        <Line x1={21} y1={27} x2={22} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    )}
  </Svg>
);

/* ── Cozy person — heading home with a mug ────────────────── */
const CozyPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={30} height={36} viewBox="0 0 30 36">
    {/* Head with beanie */}
    <Circle cx={15} cy={6} r={3.5} stroke={color} strokeWidth={1.4} fill="none" />
    <Path d="M11 5 Q15 0 19 5" stroke={color} strokeWidth={1.4} fill="none" />
    <Circle cx={15} cy={1} r={1} fill={color} />
    {/* Body */}
    <Line x1={15} y1={10} x2={15} y2={20} stroke={color} strokeWidth={1.6} />
    {/* Scarf */}
    <Line x1={13} y1={10} x2={17} y2={10} stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Line x1={17} y1={10} x2={18} y2={14} stroke={color} strokeWidth={1.2} />
    {/* Arm holding mug */}
    <Line x1={15} y1={13} x2={22} y2={15} stroke={color} strokeWidth={1.3} />
    <Rect x={22} y={13} width={4} height={5} rx={1} stroke={color} strokeWidth={1} fill="none" />
    {/* Other arm */}
    <Line x1={15} y1={13} x2={8} y2={16} stroke={color} strokeWidth={1.3} />
    {/* Legs */}
    {pose === 0 ? (
      <>
        <Line x1={15} y1={20} x2={19} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={19} y1={28} x2={20} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={15} y1={20} x2={11} y2={28} stroke={color} strokeWidth={1.4} />
        <Line x1={11} y1={28} x2={10} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    ) : (
      <>
        <Line x1={15} y1={20} x2={11} y2={27} stroke={color} strokeWidth={1.4} />
        <Line x1={11} y1={27} x2={10} y2={34} stroke={color} strokeWidth={1.4} />
        <Line x1={15} y1={20} x2={19} y2={27} stroke={color} strokeWidth={1.4} />
        <Line x1={19} y1={27} x2={20} y2={34} stroke={color} strokeWidth={1.4} />
      </>
    )}
  </Svg>
);

/* ── Snowman — static, no leg swap needed ─────────────────── */
const SnowmanPose = ({ color }: { color: string; pose: 0 | 1 }) => (
  <Svg width={28} height={36} viewBox="0 0 28 36">
    {/* Bottom ball */}
    <Circle cx={14} cy={28} r={8} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Middle ball */}
    <Circle cx={14} cy={16} r={6} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Head */}
    <Circle cx={14} cy={6} r={4} stroke={color} strokeWidth={1.4} fill="none" />
    {/* Top hat */}
    <Line x1={10} y1={2} x2={18} y2={2} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    <Rect x={11} y={-2} width={6} height={4} stroke={color} strokeWidth={1} fill="none" />
    {/* Eyes */}
    <Circle cx={12} cy={5} r={0.8} fill={color} />
    <Circle cx={16} cy={5} r={0.8} fill={color} />
    {/* Carrot nose */}
    <Line x1={14} y1={7} x2={18} y2={7.5} stroke="#E67E22" strokeWidth={1.4} strokeLinecap="round" />
    {/* Stick arms */}
    <Line x1={8} y1={16} x2={2} y2={12} stroke={color} strokeWidth={1.2} />
    <Line x1={2} y1={12} x2={0} y2={10} stroke={color} strokeWidth={1} />
    <Line x1={2} y1={12} x2={1} y2={14} stroke={color} strokeWidth={1} />
    <Line x1={20} y1={16} x2={26} y2={12} stroke={color} strokeWidth={1.2} />
    <Line x1={26} y1={12} x2={28} y2={10} stroke={color} strokeWidth={1} />
    <Line x1={26} y1={12} x2={27} y2={14} stroke={color} strokeWidth={1} />
    {/* Buttons */}
    <Circle cx={14} cy={14} r={0.8} fill={color} />
    <Circle cx={14} cy={17} r={0.8} fill={color} />
    <Circle cx={14} cy={26} r={0.8} fill={color} />
    <Circle cx={14} cy={29} r={0.8} fill={color} />
  </Svg>
);

/* ── Stylised car — line-art commuter passing through ───────── */
const CarPose = ({ color, pose }: { color: string; pose: 0 | 1 }) => (
  <Svg width={48} height={36} viewBox="0 0 48 36">
    <Ellipse cx={24} cy={30} rx={16} ry={2.3} fill={color} opacity={0.1} />
    <Path
      d="M7 23.5 L10 16.5 Q12 12.5 18 12.5 L29 12.5 Q34 12.5 37 17 L42 18 Q45 19 45 23.5 L45 26.5 L4 26.5 L4 24.5 Q4 23.5 7 23.5"
      stroke={color}
      strokeWidth={1.4}
      fill={color}
      fillOpacity={0.14}
      strokeLinejoin="round"
    />
    <Path d="M14.5 17 L18 13.8 L28 13.8 L32.8 17.2" stroke={color} strokeWidth={1.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={13.2} cy={27} r={4.3} stroke={color} strokeWidth={1.3} fill={color} fillOpacity={0.18} />
    <Circle cx={34.8} cy={27} r={4.3} stroke={color} strokeWidth={1.3} fill={color} fillOpacity={0.18} />
    <Circle cx={13.2} cy={27} r={1.5} fill={color} opacity={0.7} />
    <Circle cx={34.8} cy={27} r={1.5} fill={color} opacity={0.7} />
    {pose === 0 ? (
      <>
        <Line x1={13.2} y1={23.8} x2={13.2} y2={30.2} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={10.8} y1={27} x2={15.6} y2={27} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={12.2} y1={25} x2={14.2} y2={29} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={34.8} y1={23.8} x2={34.8} y2={30.2} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={32.4} y1={27} x2={37.2} y2={27} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={33.8} y1={25} x2={35.8} y2={29} stroke={color} strokeWidth={0.85} opacity={0.55} />
      </>
    ) : (
      <>
        <Line x1={11.8} y1={24.6} x2={15.2} y2={29.4} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={11.8} y1={29.4} x2={15.2} y2={24.6} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={32.4} y1={24.6} x2={35.8} y2={29.4} stroke={color} strokeWidth={0.85} opacity={0.55} />
        <Line x1={32.4} y1={29.4} x2={35.8} y2={24.6} stroke={color} strokeWidth={0.85} opacity={0.55} />
      </>
    )}
    <Circle cx={40.8} cy={21.5} r={1.5} fill="#FFF" fillOpacity={0.85} />
    <Circle cx={5.8} cy={21.5} r={1.1} fill="#FFF" fillOpacity={0.35} />
    <Line x1={46} y1={21} x2={48} y2={21} stroke={color} strokeWidth={1.2} strokeLinecap="round" opacity={0.45} />
    <Line x1={6} y1={20} x2={3} y2={20} stroke={color} strokeWidth={1.2} strokeLinecap="round" opacity={0.45} />
  </Svg>
);

/* ================================================================
 *  Terrain segments — adjusted per weather
 * ================================================================ */

type TerrainProps = { color: string; muted: string };

/* ── Fair-weather terrains (cyclist, runner, hiker) ────────── */
const RoadTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Line x1={0} y1={22} x2={GROUND_W} y2={22} stroke={color} strokeWidth={1.4} />
    {[40, 100, 160, 220, 280, 340].map((x) => (
      <Line key={x} x1={x} y1={18} x2={x + 20} y2={18} stroke={muted} strokeWidth={1} strokeDasharray="4 4" />
    ))}
    <Ellipse cx={70} cy={25} rx={3} ry={1.2} fill={muted} opacity={0.4} />
    <Ellipse cx={250} cy={25} rx={2.5} ry={1} fill={muted} opacity={0.4} />
  </Svg>
);

const TrackTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Path d={`M0 22 Q100 18 200 22 Q300 26 ${GROUND_W} 20`} stroke={color} strokeWidth={1.4} fill="none" />
    {[30, 110, 190, 260, 340].map((x) => (
      <G key={x}>
        <Line x1={x} y1={20} x2={x + 3} y2={15} stroke={muted} strokeWidth={1} />
        <Line x1={x + 3} y1={15} x2={x + 6} y2={20} stroke={muted} strokeWidth={1} />
      </G>
    ))}
    <Ellipse cx={160} cy={24} rx={2} ry={1} fill={muted} opacity={0.5} />
    <Ellipse cx={310} cy={24} rx={2.5} ry={1.2} fill={muted} opacity={0.5} />
  </Svg>
);

const TrailTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Path
      d={`M0 22 Q50 6 100 18 Q150 28 200 14 Q250 4 300 16 Q350 26 ${GROUND_W} 20`}
      stroke={color} strokeWidth={1.4} fill="none"
    />
    {[60, 180, 320].map((x) => (
      <Ellipse key={x} cx={x} cy={24} rx={4} ry={2} fill={muted} opacity={0.4} />
    ))}
    {[30, 130, 230, 350].map((x) => (
      <G key={x}>
        <Line x1={x} y1={20} x2={x + 2} y2={14} stroke={muted} strokeWidth={1} />
        <Line x1={x + 2} y1={14} x2={x + 4} y2={20} stroke={muted} strokeWidth={1} />
        <Line x1={x + 4} y1={20} x2={x + 6} y2={16} stroke={muted} strokeWidth={1} />
      </G>
    ))}
  </Svg>
);

/* ── Rainy terrain — puddles & splashes ───────────────────── */
const RainTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Line x1={0} y1={22} x2={GROUND_W} y2={22} stroke={color} strokeWidth={1.4} />
    {/* Puddles */}
    {[60, 150, 240, 330].map((x) => (
      <Ellipse key={x} cx={x} cy={24} rx={14} ry={3} fill="#6BA4D9" opacity={0.15} />
    ))}
    {/* Splash ripples */}
    {[90, 180, 300].map((x) => (
      <G key={x}>
        <Ellipse cx={x} cy={23} rx={4} ry={1} stroke={muted} strokeWidth={0.8} fill="none" opacity={0.4} />
        <Ellipse cx={x} cy={23} rx={7} ry={1.5} stroke={muted} strokeWidth={0.5} fill="none" opacity={0.25} />
      </G>
    ))}
  </Svg>
);

const DrizzleTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Line x1={0} y1={22} x2={GROUND_W} y2={22} stroke={color} strokeWidth={1.4} />
    {[40, 100, 160, 220, 280, 340].map((x) => (
      <Line key={x} x1={x} y1={18} x2={x + 20} y2={18} stroke={muted} strokeWidth={1} strokeDasharray="4 4" opacity={0.75} />
    ))}
    {[70, 180, 300].map((x) => (
      <Ellipse key={x} cx={x} cy={24} rx={9} ry={2} fill="#6BA4D9" opacity={0.1} />
    ))}
    {[125, 245, 360].map((x) => (
      <Ellipse key={`r${x}`} cx={x} cy={23} rx={4} ry={1} stroke={muted} strokeWidth={0.6} fill="none" opacity={0.22} />
    ))}
  </Svg>
);

/* ── Snowy terrain — snow mounds ──────────────────────────── */
const SnowTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Path
      d={`M0 22 Q30 18 60 22 Q90 26 120 20 Q150 16 180 22 Q210 26 240 20 Q270 16 300 22 Q330 26 360 20 Q380 18 ${GROUND_W} 22`}
      stroke={color} strokeWidth={1.4} fill="none"
    />
    {/* Snow bumps / drifts */}
    {[50, 140, 230, 320].map((x) => (
      <Ellipse key={x} cx={x} cy={24} rx={10} ry={3} fill={muted} opacity={0.2} />
    ))}
  </Svg>
);

/* ── Cozy terrain — sidewalk with a house in bg ──────────── */
const CozyTerrain = ({ color, muted }: TerrainProps) => (
  <Svg width={GROUND_W} height={28} viewBox={`0 0 ${GROUND_W} 28`}>
    <Line x1={0} y1={22} x2={GROUND_W} y2={22} stroke={color} strokeWidth={1.4} />
    {/* Small houses in background */}
    {[80, 220, 340].map((x) => (
      <G key={x}>
        <Rect x={x} y={8} width={18} height={14} stroke={muted} strokeWidth={1} fill="none" opacity={0.35} />
        <Path d={`M${x - 2} 8 L${x + 9} 0 L${x + 20} 8`} stroke={muted} strokeWidth={1} fill="none" opacity={0.35} />
        <Rect x={x + 6} y={14} width={5} height={8} stroke={muted} strokeWidth={0.8} fill="none" opacity={0.3} />
        {/* Window */}
        <Rect x={x + 2} y={10} width={3} height={3} stroke={muted} strokeWidth={0.6} fill="none" opacity={0.3} />
        <Rect x={x + 12} y={10} width={3} height={3} stroke={muted} strokeWidth={0.6} fill="none" opacity={0.3} />
      </G>
    ))}
    {/* Little warm glow from a window */}
    <Circle cx={91} cy={11.5} r={1.5} fill="#FFD93D" opacity={0.2} />
    <Circle cx={231} cy={11.5} r={1.5} fill="#FFD93D" opacity={0.2} />
  </Svg>
);

const TERRAIN_FOR_CHARACTER: Record<CharacterType, React.FC<TerrainProps>> = {
  cyclist: RoadTerrain,
  runner: TrackTerrain,
  hiker: TrailTerrain,
  umbrella: RainTerrain,
  cozy: CozyTerrain,
  snowman: SnowTerrain,
  car: DrizzleTerrain,
};

/* ================================================================
 *  Character renderer lookup
 * ================================================================ */

const CHARACTER_COMPONENTS: Record<CharacterType, React.FC<{ color: string; pose: 0 | 1 }>> = {
  cyclist: CyclistPose,
  runner: RunnerPose,
  hiker: HikerPose,
  umbrella: UmbrellaPose,
  cozy: CozyPose,
  snowman: SnowmanPose,
  car: CarPose,
};

const SleepingStickmanInBed = ({ color, muted }: { color: string; muted: string }) => (
  <Svg width={136} height={52} viewBox="0 0 136 52">
    <Rect x={31} y={24} width={70} height={13} rx={3} stroke={color} strokeWidth={1.6} fill="none" />
    <Line x1={31} y1={24} x2={31} y2={13} stroke={color} strokeWidth={1.6} />
    <Line x1={101} y1={24} x2={101} y2={39} stroke={color} strokeWidth={1.6} />
    <Line x1={43} y1={23} x2={56} y2={23} stroke={muted} strokeWidth={1.7} opacity={0.95} />
    <Rect x={43} y={15} width={14} height={8} rx={2} stroke={muted} strokeWidth={1.6} fill={muted} opacity={0.24} />

    <Circle cx={53} cy={20} r={4.2} stroke={color} strokeWidth={1.3} fill="none" />
    <Line x1={56} y1={21} x2={66} y2={22} stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    <Line x1={66} y1={22} x2={75} y2={23} stroke={color} strokeWidth={1.3} strokeLinecap="round" />
    <Line x1={60} y1={21} x2={62} y2={25} stroke={color} strokeWidth={1.1} strokeLinecap="round" />
    <Line x1={71} y1={22} x2={73} y2={25} stroke={color} strokeWidth={1.1} strokeLinecap="round" />

    <Path d="M58 24 Q70 18 89 25" stroke={muted} strokeWidth={1.6} fill="none" opacity={0.98} />
    <Path d="M57 27 Q70 22 90 28" stroke={muted} strokeWidth={1.4} fill="none" opacity={0.85} />
  </Svg>
);

/* ================================================================
 *  SkyBanner — separate weather sky strip
 * ================================================================ */

type SkyBannerProps = {
  weather?: WeatherCondition;
};

export const SkyBanner: React.FC<SkyBannerProps> = ({ weather = 'clear' }) => {
  const theme = useTheme();
  const SkySvg = isNightTime() ? NightSky : (SKY_MAP[weather] ?? SKY_MAP.clear);
  const [skyWidth, setSkyWidth] = React.useState(GROUND_W);

  return (
    <View
      onLayout={(e) => setSkyWidth(e.nativeEvent.layout.width)}
      style={{
        height: SKY_BANNER_HEIGHT,
        overflow: 'hidden' as const,
        borderRadius: theme.radius.md,
      }}
    >
      <SkySvg width={skyWidth} height={SKY_BANNER_HEIGHT} />
    </View>
  );
};

/* ================================================================
 *  ActivityBanner — ground + walking character (no sky)
 * ================================================================ */

type ActivityBannerProps = {
  weather?: WeatherCondition;
  /** Bump this value to restart the animation from scratch */
  restartKey?: number;
  sleepMode?: boolean;
};

export const ActivityBanner: React.FC<ActivityBannerProps> = ({ weather = 'clear', restartKey = 0, sleepMode = false }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const lineColor = theme.colors.textMuted;
  const mutedColor = theme.colors.border;

  const characters = WEATHER_CHARACTERS[weather] ?? WEATHER_CHARACTERS.clear;
  const charCount = Math.min(characters.length, MAX_CHARACTERS);

  // Use refs for mutable loop state to avoid effect restarts
  const charIndexRef = useRef(0);
  const [renderTick, setRenderTick] = useState(0); // force re-render for character swap
  const [pose, setPose] = useState<0 | 1>(0);
  const character = characters[charIndexRef.current % charCount];

  const posX = useRef(new Animated.Value(-60)).current;
  const groundX = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const sleepZ1Opacity = useRef(new Animated.Value(0)).current;
  const sleepZ2Opacity = useRef(new Animated.Value(0)).current;
  const sleepZ3Opacity = useRef(new Animated.Value(0)).current;

  // Toggle leg pose for walk cycle
  useEffect(() => {
    if (sleepMode) {
      setPose(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setPose((p) => (p === 0 ? 1 : 0));
    }, 300);
    return () => clearInterval(interval);
  }, [sleepMode]);

  useEffect(() => {
    if (!sleepMode) {
      sleepZ1Opacity.setValue(0);
      sleepZ2Opacity.setValue(0);
      sleepZ3Opacity.setValue(0);
      return undefined;
    }

    sleepZ1Opacity.setValue(0);
    sleepZ2Opacity.setValue(0);
    sleepZ3Opacity.setValue(0);

    const zLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sleepZ1Opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(120),
        Animated.timing(sleepZ2Opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(120),
        Animated.timing(sleepZ3Opacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(1000),
        Animated.parallel([
          Animated.timing(sleepZ1Opacity, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(sleepZ2Opacity, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(sleepZ3Opacity, {
            toValue: 0,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(220),
      ]),
    );

    zLoop.start();
    return () => zLoop.stop();
  }, [sleepMode, sleepZ1Opacity, sleepZ2Opacity, sleepZ3Opacity]);

  // Single persistent animation loop — never torn down unless weather/restartKey change
  useEffect(() => {
    let cancelled = false;
    charIndexRef.current = 0;
    setRenderTick(0);

    if (sleepMode) {
      posX.stopAnimation();
      groundX.stopAnimation();
      bob.stopAnimation();
      posX.setValue(-60);
      groundX.setValue(0);
      bob.setValue(0);
      return () => {
        cancelled = true;
      };
    }

    const runCycle = () => {
      if (cancelled) return;
      posX.setValue(-60);
      groundX.setValue(0);
      bob.setValue(0);

      const walkAnim = Animated.timing(posX, {
        toValue: 400,
        duration: CROSS_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      const groundAnim = Animated.timing(groundX, {
        toValue: -GROUND_W,
        duration: CROSS_DURATION,
        easing: Easing.linear,
        useNativeDriver: true,
      });
      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(bob, {
            toValue: -1.5,
            duration: 280,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(bob, {
            toValue: 0,
            duration: 280,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );

      bobLoop.start();
      Animated.parallel([walkAnim, groundAnim]).start(({ finished }) => {
        bobLoop.stop();
        if (!finished || cancelled) return;
        // Advance to the next character — no state change, just ref + render tick
        charIndexRef.current = (charIndexRef.current + 1) % charCount;
        setRenderTick((t) => t + 1);
        // Schedule next cycle after a short pause
        setTimeout(() => {
          if (!cancelled) runCycle();
        }, PAUSE_BETWEEN);
      });
    };

    const t = setTimeout(runCycle, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
      posX.stopAnimation();
      groundX.stopAnimation();
      bob.stopAnimation();
    };
  }, [weather, restartKey, charCount, sleepMode, posX, groundX, bob]);

  const TerrainSvg = TERRAIN_FOR_CHARACTER[character];
  const CharacterSvg = CHARACTER_COMPONENTS[character];

  return (
    <View style={styles.banner}>
      {sleepMode ? (
        <View style={styles.sleepScene}>
          <View style={styles.sleepSceneBox}>
            <SleepingStickmanInBed color={lineColor} muted={mutedColor} />
            <Animated.Text
              style={[
                styles.sleepZ,
                styles.sleepZ1,
                {
                  opacity: sleepZ1Opacity,
                },
              ]}
            >
              z
            </Animated.Text>
            <Animated.Text
              style={[
                styles.sleepZ,
                styles.sleepZ2,
                {
                  opacity: sleepZ2Opacity,
                },
              ]}
            >
              z
            </Animated.Text>
            <Animated.Text
              style={[
                styles.sleepZ,
                styles.sleepZ3,
                {
                  opacity: sleepZ3Opacity,
                },
              ]}
            >
              z
            </Animated.Text>
          </View>
        </View>
      ) : (
        <>
          {/* Scrolling terrain */}
          <Animated.View style={[styles.groundTrack, { transform: [{ translateX: groundX }] }]}>
            <TerrainSvg color={lineColor} muted={mutedColor} />
            <TerrainSvg color={lineColor} muted={mutedColor} />
            <TerrainSvg color={lineColor} muted={mutedColor} />
          </Animated.View>

          {/* Walking character */}
          <Animated.View style={[styles.figure, { transform: [{ translateX: posX }, { translateY: bob }] }]}>
            <CharacterSvg color={lineColor} pose={pose} />
          </Animated.View>
        </>
      )}
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    banner: {
      height: GROUND_BANNER_HEIGHT,
      overflow: 'hidden',
    },
    groundTrack: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      flexDirection: 'row',
    },
    figure: {
      position: 'absolute',
      bottom: 10,
    },
    sleepScene: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sleepSceneBox: {
      width: 136,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sleepZ: {
      position: 'absolute',
      color: theme.colors.textMuted,
      fontFamily: theme.fonts.semibold,
      fontSize: 14,
      letterSpacing: 0.8,
    },
    sleepZ1: {
      top: 2,
      left: 62,
      transform: [{ rotate: '-8deg' }],
    },
    sleepZ2: {
      top: -6,
      left: 74,
      transform: [{ rotate: '-14deg' }],
    },
    sleepZ3: {
      top: -2,
      left: 87,
      transform: [{ rotate: '-20deg' }],
    },
  });
