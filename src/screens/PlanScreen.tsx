import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Countdown } from '../components/Countdown';
import { PrimaryButton } from '../components/PrimaryButton';
import { MapThumbnail } from '../components/MapThumbnail';
import { TimerSteps } from '../components/TimerSteps';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { clamp, formatCountdown, formatDuration, formatTime } from '../utils/time';
import { logEvent } from '../services/analytics';
import { createPlanEvent, deletePlanEvent } from '../services/calendar';
import { useAppState } from '../state/AppState';

export const PlanScreen: React.FC<StackScreenProps<RootStackParamList, 'Plan'>> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { commitment, suggestion } = route.params;
  const { actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(new Date());
  const [startSignal, setStartSignal] = useState(0);
  const [advanceSignal, setAdvanceSignal] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [routineFinished, setRoutineFinished] = useState(false);
  const [finishAt, setFinishAt] = useState<Date | null>(null);
  const [calendarFailed, setCalendarFailed] = useState(!!commitment.calendarWriteFailed);
  const [activityLogged, setActivityLogged] = useState(false);
  const [manualStartAt, setManualStartAt] = useState<Date | null>(null);
  const [guideChecks, setGuideChecks] = useState<boolean[]>([]);
  const [ctaPressed, setCtaPressed] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logEvent('plan_page_opened');
  }, []);

  const target = useMemo(() => {
    if (commitment.type === 'GO_OUT' && commitment.leaveBy) return new Date(commitment.leaveBy);
    return new Date(commitment.startAt);
  }, [commitment]);

  const isRoutineStarted = commitment.type === 'AT_HOME' && manualStartAt !== null;
  const countdownLabel = isRoutineStarted ? '00:00' : formatCountdown(target, now);
  const headline = isRoutineStarted
    ? 'In progress'
    : commitment.type === 'GO_OUT'
      ? 'Leave in'
      : commitment.type === 'EVENT'
        ? 'Starts in'
        : 'Starting in';

  const routineTotalSeconds = useMemo(() => {
    if (commitment.type !== 'AT_HOME') return 0;
    if (suggestion.steps?.length) {
      return suggestion.steps.reduce((sum, step) => sum + step.minutes * 60, 0);
    }
    return suggestion.durationMin * 60;
  }, [commitment.type, suggestion.steps, suggestion.durationMin]);

  useEffect(() => {
    setActiveStepIndex(0);
    setRoutineFinished(false);
    setAdvanceSignal(0);
    setFinishAt(null);
  }, [suggestion.id]);

  const routineProgress = useMemo(() => {
    if (routineFinished) return 1;
    if (!manualStartAt || routineTotalSeconds <= 0) return 0;
    const elapsed = (now.getTime() - manualStartAt.getTime()) / 1000;
    return clamp(elapsed / routineTotalSeconds, 0, 1);
  }, [manualStartAt, routineTotalSeconds, now, routineFinished]);

  const progressColor = useMemo(() => {
    const start = { r: 248, g: 113, b: 113 };
    const end = { r: 34, g: 197, b: 94 };
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const r = lerp(start.r, end.r, routineProgress);
    const g = lerp(start.g, end.g, routineProgress);
    const b = lerp(start.b, end.b, routineProgress);
    return `rgb(${r},${g},${b})`;
  }, [routineProgress]);

  const openMaps = async () => {
    if (!suggestion.place?.lat || !suggestion.place?.lng) return;
    const destination = `${suggestion.place.lat},${suggestion.place.lng}`;
    const url = Platform.select({
      ios: `maps:0,0?q=${destination}`,
      android: `geo:0,0?q=${destination}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${destination}`,
    });
    if (url) await Linking.openURL(url);
  };

  const onPrimary = async () => {
    const typeMap = {
      AT_HOME: 'start',
      GO_OUT: 'directions',
      EVENT: 'tickets',
    } as const;
    await logEvent('cta_primary_clicked', { action: typeMap[commitment.type] });

    if (!activityLogged && commitment.type !== 'AT_HOME') {
      actions.recordActivity({
        id: `act_${Date.now()}`,
        suggestionId: suggestion.id,
        title: suggestion.title,
        durationMin: suggestion.durationMin,
        timestamp: new Date().toISOString(),
        source: suggestion.source,
        isHabit: !!suggestion.habitId,
        habitId: suggestion.habitId,
        tags: suggestion.tags,
        suggestionType: suggestion.type,
      });
      if (suggestion.habitId) {
        actions.completeHabit(suggestion.habitId);
      }
      setActivityLogged(true);
    }

    if (commitment.type === 'AT_HOME') {
      if (!manualStartAt) {
        setManualStartAt(new Date());
        setRoutineFinished(false);
        setFinishAt(null);
        setStartSignal((prev) => prev + 1);
        setCtaPressed(true);
        return;
      }
      setCtaPressed(true);
      const hasSteps = (suggestion.steps?.length ?? 0) > 0;
      if (hasSteps) {
        const lastStepIndex = Math.max(0, (suggestion.steps?.length ?? 1) - 1);
        if (activeStepIndex >= lastStepIndex) {
          setRoutineFinished(true);
          setFinishAt(new Date());
        }
        setAdvanceSignal((prev) => prev + 1);
      } else {
        setRoutineFinished(true);
        setFinishAt(new Date());
      }
      return;
    }
    if (commitment.type === 'GO_OUT') {
      setCtaPressed(true);
      await openMaps();
      return;
    }
    if (commitment.type === 'EVENT' && commitment.ticketUrl) {
      setCtaPressed(true);
      await Linking.openURL(commitment.ticketUrl);
    }
  };

  const retryCalendar = async () => {
    try {
      let title = commitment.title;
      let notes = suggestion.description;
      if (suggestion.type === 'AT_HOME') {
        title = `Plan: ${suggestion.title}`;
        notes = `${suggestion.description}\n\nSteps:\n${(suggestion.steps || []).map((step) => `- ${step.label} (${step.minutes}m)`).join('\n')}`;
      }
      if (suggestion.type === 'GO_OUT') {
        title = `Plan: ${suggestion.place?.name ?? suggestion.title}`;
        notes = `${suggestion.description}\n${suggestion.place?.address ?? ''}`;
      }
      if (suggestion.type === 'EVENT' && suggestion.event) {
        title = `Event: ${suggestion.title}`;
        notes = `${suggestion.event.venue}\nTickets: ${suggestion.event.ticketUrl}`;
      }
      await createPlanEvent({
        title,
        startDate: new Date(commitment.startAt),
        endDate: new Date(commitment.endAt),
        notes,
      });
      await logEvent('calendar_event_created_success');
      setCalendarFailed(false);
    } catch (error) {
      await logEvent('calendar_event_created_fail');
      setCalendarFailed(true);
    }
  };

  const leaveBy = useMemo(() => {
    if (!commitment.leaveBy) return null;
    const leaveAt = new Date(commitment.leaveBy);
    if (leaveAt.getTime() - now.getTime() <= 5 * 60 * 1000) return 'Leave now';
    return formatTime(leaveAt);
  }, [commitment.leaveBy, now]);

  const instructionList = useMemo(() => {
    if (suggestion.instructions?.length) return suggestion.instructions;
    if (commitment.type === 'AT_HOME') {
      return (suggestion.steps || []).map((step) => step.label);
    }
    if (commitment.type === 'GO_OUT') {
      return [
        `Head to ${suggestion.place?.name ?? 'your spot'}.`,
        'Leave with a 10 minute buffer.',
        `Spend ${formatDuration(suggestion.durationMin)} there.`,
      ];
    }
    return [
      'Open tickets and confirm details.',
      'Leave with a 10 minute buffer.',
      'Arrive a bit early.',
    ];
  }, [suggestion, commitment.type]);

  const guideSteps = useMemo(() => {
    if (commitment.type === 'AT_HOME') {
      if (suggestion.steps?.length) {
        return suggestion.steps.map((step) => `${step.label} (${step.minutes}m)`);
      }
      return instructionList;
    }
    if (commitment.type === 'GO_OUT') {
      const steps = [
        'Open directions and confirm route.',
        leaveBy ? `Leave by ${leaveBy}.` : 'Leave with a 10 minute buffer.',
        `Spend ${formatDuration(suggestion.durationMin)} there.`,
      ];
      return steps;
    }
    const startAt = formatTime(new Date(suggestion.event?.startAt || commitment.startAt));
    return [
      'Open tickets and confirm details.',
      leaveBy ? `Leave by ${leaveBy}.` : 'Leave with a 10 minute buffer.',
      `Arrive by ${startAt}.`,
    ];
  }, [commitment.type, suggestion.steps, suggestion.durationMin, suggestion.event?.startAt, commitment.startAt, leaveBy, instructionList]);

  useEffect(() => {
    setGuideChecks(guideSteps.map(() => false));
  }, [guideSteps]);

  const autoChecks = useMemo(() => {
    if (commitment.type === 'AT_HOME' && manualStartAt && suggestion.steps?.length) {
      const elapsed = (now.getTime() - manualStartAt.getTime()) / 1000;
      let runningTotal = 0;
      return suggestion.steps.map((step) => {
        runningTotal += step.minutes * 60;
        return elapsed >= runningTotal;
      });
    }
    if (commitment.type === 'AT_HOME' && manualStartAt && guideSteps.length) {
      return guideSteps.map((_, index) => index === 0);
    }
    if (ctaPressed && guideSteps.length) {
      return guideSteps.map((_, index) => index === 0);
    }
    return guideSteps.map(() => false);
  }, [commitment.type, manualStartAt, suggestion.steps, now, guideSteps, ctaPressed]);

  useEffect(() => {
    if (commitment.type !== 'AT_HOME') return;
    if (!routineFinished || activityLogged || !manualStartAt) return;
    const endTime = finishAt ?? new Date();
    const elapsedMin = Math.max(1, Math.round((endTime.getTime() - manualStartAt.getTime()) / 60000));
    actions.recordActivity({
      id: `act_${Date.now()}`,
      suggestionId: suggestion.id,
      title: suggestion.title,
      durationMin: elapsedMin,
      timestamp: new Date().toISOString(),
      source: suggestion.source,
      isHabit: !!suggestion.habitId,
      habitId: suggestion.habitId,
      tags: suggestion.tags,
      suggestionType: suggestion.type,
    });
    if (suggestion.habitId) {
      actions.completeHabit(suggestion.habitId);
    }
    setActivityLogged(true);
  }, [commitment.type, routineFinished, activityLogged, manualStartAt, finishAt, actions, suggestion]);

  const primaryLabel = useMemo(() => {
    if (commitment.type === 'AT_HOME') {
      if (!manualStartAt) return 'Start';
      const hasSteps = (suggestion.steps?.length ?? 0) > 0;
      if (!hasSteps) return 'Finish';
      const lastStepIndex = Math.max(0, (suggestion.steps?.length ?? 1) - 1);
      return activeStepIndex >= lastStepIndex ? 'Finish' : 'Next step';
    }
    if (commitment.type === 'GO_OUT') return 'Get directions';
    return 'Buy tickets';
  }, [commitment.type, manualStartAt, suggestion.steps, activeStepIndex]);

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.header}>
        <Text style={styles.headline}>{headline}</Text>
        {isRoutineStarted ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(routineProgress * 100)}%`, backgroundColor: progressColor }]} />
            </View>
            <Text style={styles.progressLabel}>
              {Math.round(routineProgress * 100)}% complete
            </Text>
          </View>
        ) : (
          <Countdown label={countdownLabel} />
        )}
        <Text style={styles.subheadline}>{suggestion.title}</Text>
      </View>

      <PrimaryButton
        label={primaryLabel}
        onPress={onPrimary}
        glow
        disabled={commitment.type === 'AT_HOME' && routineFinished}
      />

      <Text style={styles.calendarStatus}>
        {calendarFailed ? 'Could not add to calendar' : 'Added to calendar'}
      </Text>
      {calendarFailed && (
        <Pressable onPress={retryCalendar}>
          <Text style={styles.retry}>Retry calendar</Text>
        </Pressable>
      )}

      <View style={styles.contextBlock}>
        <View style={styles.guideBlock}>
          <Text style={styles.sectionTitle}>Next steps</Text>
          {guideSteps.map((step, index) => (
            <Pressable
              key={`guide_${index}`}
              onPress={() => {
                setGuideChecks((prev) => {
                  const next = [...prev];
                  next[index] = !next[index];
                  return next;
                });
              }}
              style={styles.guideRow}
            >
              <Text style={[styles.guideCheck, (guideChecks[index] || autoChecks[index]) && styles.guideCheckOn]}>
                {(guideChecks[index] || autoChecks[index]) ? '✓' : '○'}
              </Text>
              <Text style={[styles.guideText, (guideChecks[index] || autoChecks[index]) && styles.guideTextOn]}>
                {step}
              </Text>
            </Pressable>
          ))}
        </View>

        {commitment.type === 'AT_HOME' && (
          <TimerSteps
            steps={suggestion.steps || []}
            startSignal={startSignal}
            advanceSignal={advanceSignal}
            onStepChange={(index) => setActiveStepIndex(index)}
            onFinish={() => {
              setRoutineFinished(true);
              setFinishAt(new Date());
            }}
          />
        )}

        {commitment.type === 'GO_OUT' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{suggestion.place?.name}</Text>
            {leaveBy && <Text style={styles.metaText}>Leave by {leaveBy}</Text>}
            <Text style={styles.metaText}>{formatDuration(suggestion.durationMin)} activity</Text>
            {suggestion.place?.address && <Text style={styles.metaText}>{suggestion.place.address}</Text>}
            <View style={styles.instructions}>
              {instructionList.slice(0, 3).map((item, index) => (
                <Text key={`go_${index}`} style={styles.instructionText}>- {item}</Text>
              ))}
            </View>
            <MapThumbnail lat={suggestion.place?.lat} lng={suggestion.place?.lng} height={160} />
          </View>
        )}

        {commitment.type === 'EVENT' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{suggestion.event?.venue}</Text>
            <Text style={styles.metaText}>Starts at {formatTime(new Date(suggestion.event?.startAt || commitment.startAt))}</Text>
            {leaveBy && <Text style={styles.metaText}>Leave by {leaveBy}</Text>}
            <Text style={styles.metaText}>{suggestion.event?.priceRange || 'Tickets required'}</Text>
            {suggestion.place?.address && <Text style={styles.metaText}>{suggestion.place.address}</Text>}
            <View style={styles.instructions}>
              {instructionList.slice(0, 3).map((item, index) => (
                <Text key={`event_${index}`} style={styles.instructionText}>- {item}</Text>
              ))}
            </View>
            <MapThumbnail lat={suggestion.place?.lat} lng={suggestion.place?.lng} height={160} />
          </View>
        )}
      </View>

      <Pressable
        onPress={() => {
          Alert.alert('Cancel plan?', 'This will remove the plan from your flow.', [
            { text: 'Keep plan', style: 'cancel' },
            {
              text: 'Cancel',
              style: 'destructive',
              onPress: async () => {
                await logEvent('plan_cancelled');
                if (commitment.calendarEventId) {
                  try {
                    await deletePlanEvent(commitment.calendarEventId);
                  } catch (error) {
                    console.warn('Calendar delete failed', error);
                  }
                }
                navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              },
            },
          ]);
        }}
      >
        <Text style={styles.cancel}>Cancel plan</Text>
      </Pressable>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  header: {
    marginTop: theme.spacing.lg,
  },
  headline: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  subheadline: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    marginTop: theme.spacing.sm,
    color: theme.colors.text,
  },
  progressWrap: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  progressTrack: {
    height: 14,
    borderRadius: 999,
    backgroundColor: theme.colors.backgroundAlt,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressLabel: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  calendarStatus: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  retry: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  contextBlock: {
    flex: 1,
    marginTop: theme.spacing.sm,
  },
  guideBlock: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  guideCheck: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
    width: 20,
  },
  guideCheckOn: {
    color: theme.colors.accentDark,
  },
  guideText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    flexShrink: 1,
  },
  guideTextOn: {
    color: theme.colors.text,
  },
  instructions: {
    marginTop: theme.spacing.sm,
    gap: 4,
  },
  instructionText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
  },
  metaText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  cancel: {
    textAlign: 'center',
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
});
