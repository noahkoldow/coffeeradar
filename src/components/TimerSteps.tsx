import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Step } from '../types';
import { useTheme } from '../theme/ThemeProvider';

const formatSeconds = (value: number): string => {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

type Props = {
  steps: Step[];
  startSignal?: number;
  advanceSignal?: number;
  onStepChange?: (index: number) => void;
  onFinish?: () => void;
};

export const TimerSteps: React.FC<Props> = ({ steps, startSignal, advanceSignal, onStepChange, onFinish }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remaining, setRemaining] = useState(steps[0]?.minutes ? steps[0].minutes * 60 : 0);
  const lastAdvanceRef = useRef(0);

  const currentStep = steps[currentIndex];
  const totalSteps = steps.length;

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev > 1) return prev - 1;
        return 0;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    if (remaining > 0) return;

    if (currentIndex < totalSteps - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setRemaining(steps[nextIndex].minutes * 60);
    } else {
      setIsRunning(false);
      if (onFinish) onFinish();
    }
  }, [remaining, isRunning, currentIndex, totalSteps, steps, onFinish]);

  useEffect(() => {
    if (startSignal && !isRunning) setIsRunning(true);
  }, [startSignal, isRunning]);

  useEffect(() => {
    if (advanceSignal === undefined) return;
    if (!isRunning) return;
    if (advanceSignal === lastAdvanceRef.current) return;
    lastAdvanceRef.current = advanceSignal;
    if (!totalSteps) return;
    if (currentIndex < totalSteps - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      setRemaining(steps[nextIndex].minutes * 60);
    } else {
      setRemaining(0);
      setIsRunning(false);
      if (onFinish) onFinish();
    }
  }, [advanceSignal, isRunning, currentIndex, totalSteps, steps, onFinish]);

  useEffect(() => {
    if (onStepChange) onStepChange(currentIndex);
  }, [currentIndex, onStepChange]);

  return (
    <View style={styles.container}>
      <Text style={styles.currentLabel}>{currentStep?.label || 'Routine'}</Text>
      <Text style={styles.timer}>{formatSeconds(remaining)}</Text>
      <View style={styles.stepsList}>
        {steps.map((step, index) => (
          <Text
            key={`${step.label}_${index}`}
            style={[styles.stepItem, index === currentIndex && styles.stepActive]}
          >
            {index + 1}. {step.label} ({step.minutes}m)
          </Text>
        ))}
      </View>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  currentLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  timer: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
  },
  stepsList: {
    marginTop: theme.spacing.md,
  },
  stepItem: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  stepActive: {
    color: theme.colors.text,
  },
});
