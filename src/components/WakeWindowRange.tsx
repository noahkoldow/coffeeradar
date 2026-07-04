import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, PanResponder } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  start: string; // HH:MM
  end: string; // HH:MM
  onChange: (start: string, end: string) => void;
  step?: number;
}

const toMinutes = (t: string) => {
  const m = t?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 7 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const roundToStep = (value: number, step: number) => Math.round(value / step) * step;

const DAY_MINUTES = 24 * 60;
const DISPLAY_MINUTES = 28 * 60;

const toClock = (m: number) => {
  const safeMinutes = ((Math.round(m) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hh = Math.floor(safeMinutes / 60);
  const mm = safeMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const WakeWindowRange: React.FC<Props> = ({ start, end, onChange, step = 15 }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const total = DISPLAY_MINUTES;
  const maxValue = total;
  const minGap = 60;
  const [width, setWidth] = useState(0);
  const dragStartRef = useRef({ startM: 7 * 60, endM: 23 * 60 });
  const isDraggingRef = useRef(false);

  const parsedStartM = clamp(toMinutes(start), 0, 23 * 60 + 59);
  const parsedEndM = clamp(toMinutes(end), 0, 23 * 60 + 59);
  const initialEndM = parsedEndM <= parsedStartM ? parsedEndM + DAY_MINUTES : parsedEndM;
  const [draft, setDraft] = useState({ startM: parsedStartM, endM: initialEndM });
  const draftRef = useRef(draft);

  const setDraftRange = (next: { startM: number; endM: number }) => {
    draftRef.current = next;
    setDraft(next);
  };

  useEffect(() => {
    if (isDraggingRef.current) return;
    setDraftRange({ startM: parsedStartM, endM: initialEndM });
  }, [initialEndM, parsedStartM]);

  const startM = draft.startM;
  const endM = draft.endM;

  const handleLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const minutesFromDrag = (baseMinutes: number, dx: number) => {
    if (!width) return baseMinutes;
    return baseMinutes + (dx / width) * total;
  };

  const clampStartForEnd = (nextStart: number, endMinutes: number) => {
    const rounded = clamp(roundToStep(nextStart, step), 0, maxValue);
    return clamp(rounded, 0, endMinutes - minGap);
  };

  const clampEndForStart = (nextEnd: number, startMinutes: number) => {
    const rounded = clamp(roundToStep(nextEnd, step), 0, maxValue);
    return clamp(rounded, startMinutes + minGap, maxValue);
  };

  const commitRange = (startMinutes: number, endMinutes: number) => {
    const nextStart = clamp(roundToStep(startMinutes, step), 0, maxValue);
    const nextEnd = clamp(roundToStep(endMinutes, step), 0, maxValue);
    const storedEnd = nextEnd <= nextStart ? nextEnd + DAY_MINUTES : nextEnd;
    const next = { startM: nextStart, endM: storedEnd };
    isDraggingRef.current = false;
    setDraftRange(next);
    onChange(toClock(nextStart), toClock(nextEnd));
  };

  const startResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      isDraggingRef.current = true;
      dragStartRef.current = draftRef.current;
    },
    onPanResponderMove: (_, gestureState) => {
      const next = clampStartForEnd(
        minutesFromDrag(dragStartRef.current.startM, gestureState.dx),
        dragStartRef.current.endM,
      );
      setDraftRange({ startM: next, endM: dragStartRef.current.endM });
    },
    onPanResponderRelease: () => {
      commitRange(draftRef.current.startM, draftRef.current.endM);
    },
    onPanResponderTerminate: () => {
      commitRange(draftRef.current.startM, draftRef.current.endM);
    },
    onPanResponderTerminationRequest: () => false,
  }), [minGap, onChange, step, width]);

  const endResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      isDraggingRef.current = true;
      dragStartRef.current = draftRef.current;
    },
    onPanResponderMove: (_, gestureState) => {
      const next = clampEndForStart(
        minutesFromDrag(dragStartRef.current.endM, gestureState.dx),
        dragStartRef.current.startM,
      );
      setDraftRange({ startM: dragStartRef.current.startM, endM: next });
    },
    onPanResponderRelease: () => {
      commitRange(draftRef.current.startM, draftRef.current.endM);
    },
    onPanResponderTerminate: () => {
      commitRange(draftRef.current.startM, draftRef.current.endM);
    },
    onPanResponderTerminationRequest: () => false,
  }), [maxValue, minGap, onChange, step, width]);

  const displayStartM = startM;
  const displayEndM = endM;
  const left = width ? (displayStartM / total) * width : 0;
  const right = width ? (displayEndM / total) * width : 0;
  const fillWidth = Math.max(8, right - left);
  const sleepLabel = `${toClock(roundToStep(endM >= DAY_MINUTES ? endM - DAY_MINUTES : endM, step))}${endM >= DAY_MINUTES ? ' next day' : ''}`;

  return (
    <View onLayout={handleLayout} style={styles.container}>
      <View style={styles.labelsRow}>
        <Text style={styles.label}>Wake: {toClock(roundToStep(startM, step))}</Text>
        <Text style={styles.label}>Sleep: {sleepLabel}</Text>
      </View>

      <View style={styles.trackWrap}>
        <View style={styles.track} />
        {width > 0 && <View style={[styles.fill, { left, width: fillWidth }]} />}

        {width > 0 && (
          <>
            <View
              {...startResponder.panHandlers}
              accessibilityLabel="Wake window start"
              accessibilityRole="adjustable"
              hitSlop={14}
              style={[styles.thumb, styles.startThumb, { left: left - 14 }]}
            />
            <View
              {...endResponder.panHandlers}
              accessibilityLabel="Wake window end"
              accessibilityRole="adjustable"
              hitSlop={14}
              style={[styles.thumb, styles.endThumb, { left: right - 14 }]}
            />
          </>
        )}
      </View>

      <View style={styles.rangeLabels}>
        <Text style={styles.rangeLabel}>00:00</Text>
        <Text style={styles.rangeLabel}>12:00</Text>
        <Text style={styles.rangeLabel}>24:00</Text>
        <Text style={styles.rangeLabel}>04:00 next day</Text>
      </View>
      <Text style={styles.helperText}>
        Set a sleep time after midnight, up to 04:00 the next day.
      </Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: theme.spacing.xs,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  label: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  trackWrap: {
    height: 52,
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.border,
    opacity: 1,
  },
  fill: {
    position: 'absolute',
    top: 23,
    height: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.accent,
    opacity: 0.28,
  },
  thumb: {
    position: 'absolute',
    top: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.accent,
    borderWidth: 3,
    borderColor: theme.colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  startThumb: {
    zIndex: 2,
  },
  endThumb: {
    zIndex: 3,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -theme.spacing.xs,
  },
  rangeLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
    opacity: 0.7,
  },
  helperText: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    opacity: 0.8,
  },
});

export default WakeWindowRange;
