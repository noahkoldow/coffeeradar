import React, { useEffect, useMemo, useRef } from 'react';
import {
  ScrollView,
  Text,
  View,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface TimePickerScrollProps {
  value: string; // HH:MM format
  onChange: (time: string) => void;
}

const ITEM_HEIGHT = 50;
const VISIBLE_ITEMS = 3;
const SNAP_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const SCROLL_PADDING = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;
const hours = Array.from({ length: 24 }, (_, i) => i);
const minutes = Array.from({ length: 60 }, (_, i) => i);

const normalizeTime = (value: string): { hour: number; minute: number } => {
  const match = value?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { hour: 7, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

export const TimePickerScroll: React.FC<TimePickerScrollProps> = ({
  value,
  onChange,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const hourRef = useRef<ScrollView>(null);
  const minuteRef = useRef<ScrollView>(null);

  const { hour: currentHour, minute: currentMinute } = normalizeTime(value);

  useEffect(() => {
    hourRef.current?.scrollTo({ y: currentHour * ITEM_HEIGHT, animated: false });
    minuteRef.current?.scrollTo({ y: currentMinute * ITEM_HEIGHT, animated: false });
  }, [currentHour, currentMinute]);

  const updateTime = (nextHour: number, nextMinute: number) => {
    onChange(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')}`);
  };

  const handleHourScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const selectedHour = Math.round(offsetY / ITEM_HEIGHT);
    const newHour = Math.min(Math.max(selectedHour, 0), 23);
    updateTime(newHour, currentMinute);
  };

  const handleMinuteScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const selectedMinute = Math.round(offsetY / ITEM_HEIGHT);
    const newMinute = Math.min(Math.max(selectedMinute, 0), 59);
    updateTime(currentHour, newMinute);
  };

  return (
    <View style={styles.container}>
      <View style={styles.pickerRow}>
        {/* Hours */}
        <View style={styles.columnWrapper}>
          <View style={styles.selectionBand} />
          <View style={styles.fadeTop} />
          <View style={styles.fadeBottom} />
          <ScrollView
            ref={hourRef}
            scrollEventThrottle={16}
            onMomentumScrollEnd={handleHourScroll}
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
          >
            <View style={{ height: SCROLL_PADDING }} />
            {hours.map((hour) => (
              <View key={`hour-${hour}`} style={[styles.item, { height: ITEM_HEIGHT }]}>
                <Text
                  style={[
                    styles.itemText,
                    hour === currentHour && styles.itemTextActive,
                  ]}
                >
                  {String(hour).padStart(2, '0')}
                </Text>
              </View>
            ))}
            <View style={{ height: SCROLL_PADDING }} />
          </ScrollView>
        </View>

        <View style={styles.separatorWrapper} pointerEvents="none">
          <Text style={styles.separator}>:</Text>
        </View>

        {/* Minutes */}
        <View style={styles.columnWrapper}>
          <View style={styles.selectionBand} />
          <View style={styles.fadeTop} />
          <View style={styles.fadeBottom} />
          <ScrollView
            ref={minuteRef}
            scrollEventThrottle={16}
            onMomentumScrollEnd={handleMinuteScroll}
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            snapToInterval={ITEM_HEIGHT}
            decelerationRate="fast"
          >
            <View style={{ height: SCROLL_PADDING }} />
            {minutes.map((minute) => (
              <View key={`minute-${minute}`} style={[styles.item, { height: ITEM_HEIGHT }]}>
                <Text
                  style={[
                    styles.itemText,
                    minute === currentMinute && styles.itemTextActive,
                  ]}
                >
                  {String(minute).padStart(2, '0')}
                </Text>
              </View>
            ))}
            <View style={{ height: SCROLL_PADDING }} />
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      width: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      marginVertical: theme.spacing.md,
    },
    pickerRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      height: SNAP_HEIGHT,
      backgroundColor: theme.colors.card,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: 'hidden',
    },
    columnWrapper: {
      width: 72,
      height: SNAP_HEIGHT,
      position: 'relative',
    },
    scroll: {
      flex: 1,
    },
    item: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemText: {
      fontFamily: theme.fonts.body,
      fontSize: 22,
      color: theme.colors.textMuted,
      opacity: 0.45,
    },
    itemTextActive: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.accent,
      fontWeight: '600',
      opacity: 1,
    },
    selectionBand: {
      position: 'absolute',
      top: '50%',
      left: 0,
      right: 0,
      height: ITEM_HEIGHT,
      marginTop: -ITEM_HEIGHT / 2,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
      opacity: 0.35,
      zIndex: 1,
      pointerEvents: 'none',
    },
    fadeTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: ITEM_HEIGHT,
      backgroundColor: theme.colors.card,
      opacity: 0.62,
      zIndex: 1,
      pointerEvents: 'none',
    },
    fadeBottom: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: ITEM_HEIGHT,
      backgroundColor: theme.colors.card,
      opacity: 0.62,
      zIndex: 1,
      pointerEvents: 'none',
    },
    separatorWrapper: {
      height: SNAP_HEIGHT,
      width: 36,
      justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: theme.spacing.sm,
      zIndex: 2,
    },
    separator: {
      fontFamily: theme.fonts.heading,
      fontSize: 28,
      color: theme.colors.accentDark,
      backgroundColor: theme.colors.accentSoft,
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
      textAlign: 'center',
      textAlignVertical: 'center',
      fontWeight: '600',
    },
  });
