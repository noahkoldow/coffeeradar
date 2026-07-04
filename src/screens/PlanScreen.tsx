import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { MapThumbnail } from '../components/MapThumbnail';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { clamp, formatDuration, formatTime } from '../utils/time';
import { logEvent } from '../services/analytics';
import { createPlanEvent, deletePlanEvent, updatePlanEventEnd } from '../services/calendar';
import { useAppState } from '../state/AppState';
import { getCurrentLocation } from '../services/location';
import { haversineKm } from '../services/travel';
import { ensureActivityChatThread, makeActivityChatThreadId } from '../services/activityChat';
import { getConfirmedSocialProofCount } from '../utils/social';

export const PlanScreen: React.FC<StackScreenProps<RootStackParamList, 'Plan'>> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { commitment, suggestion } = route.params;
  const { state, actions } = useAppState();
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
  const [movementKm, setMovementKm] = useState(0);
  const cancelledRef = useRef(false);
  const finishingRef = useRef(false);
  const movementStartRef = useRef<{ lat: number; lng: number } | null>(null);
  const ctaPressed = !!manualStartAt;
  const hasFixedPlace = !!suggestion.place?.name?.trim() || !!suggestion.event?.venue?.trim();
  const hasFixedTime = !!commitment.startAt || !!suggestion.event?.startAt || !!suggestion.meta?.planStartAt;
  const isSocialActivity = (commitment.type === 'GO_OUT' || commitment.type === 'EVENT') && hasFixedPlace && hasFixedTime;
  const socialProofCount = getConfirmedSocialProofCount(suggestion);
  const chatThreadId = useMemo(
    () => (isSocialActivity ? makeActivityChatThreadId(suggestion.id, state.location.areaLabel) : null),
    [isSocialActivity, suggestion.id, state.location.areaLabel],
  );
  const chatExpiresAt = useMemo(() => new Date(new Date(commitment.startAt).getTime() + 24 * 60 * 60 * 1000).toISOString(), [commitment.startAt]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logEvent('plan_page_opened');
  }, []);

  const headline = manualStartAt ? 'In progress' : 'Ready when you are';

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
    if (!manualStartAt) return 0;
    // Step-based progress weighted by each step's duration in minutes,
    // with continuous time-based progress within the active step.
    if (suggestion.steps?.length && routineTotalSeconds > 0) {
      // Minutes already completed by finished steps
      let completedSeconds = 0;
      for (let i = 0; i < activeStepIndex && i < suggestion.steps.length; i++) {
        completedSeconds += suggestion.steps[i].minutes * 60;
      }
      // Continuous progress within the currently active step based on elapsed time
      const activeStep = suggestion.steps[activeStepIndex];
      if (activeStep) {
        // How much time has elapsed within this step specifically?
        // We know the total elapsed time from manualStartAt, minus the time of previous steps.
        const totalElapsed = (now.getTime() - manualStartAt.getTime()) / 1000;
        const elapsedInStep = Math.max(0, totalElapsed - completedSeconds);
        const stepDuration = activeStep.minutes * 60;
        const stepProgress = clamp(elapsedInStep / stepDuration, 0, 1);
        completedSeconds += stepProgress * stepDuration;
      }
      return clamp(completedSeconds / routineTotalSeconds, 0, 1);
    }
    // Time-based fallback for activities without steps
    if (routineTotalSeconds <= 0) return 0;
    const elapsed = (now.getTime() - manualStartAt.getTime()) / 1000;
    return clamp(elapsed / routineTotalSeconds, 0, 1);
  }, [manualStartAt, routineTotalSeconds, now, routineFinished, suggestion.steps, activeStepIndex]);

  const progressColor = useMemo(() => {
    const start = { r: 248, g: 113, b: 113 };
    const end = { r: 34, g: 197, b: 94 };
    const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
    const r = lerp(start.r, end.r, routineProgress);
    const g = lerp(start.g, end.g, routineProgress);
    const b = lerp(start.b, end.b, routineProgress);
    return `rgb(${r},${g},${b})`;
  }, [routineProgress]);

  useEffect(() => {
    if (!manualStartAt || !isSocialActivity) return undefined;
    let active = true;

    const sampleMovement = async () => {
      const current = await getCurrentLocation().catch(() => null);
      if (!active || !current?.lat || !current.lng) return;
      if (!movementStartRef.current) {
        if (state.location.lat != null && state.location.lng != null) {
          movementStartRef.current = { lat: state.location.lat, lng: state.location.lng };
        } else {
          movementStartRef.current = { lat: current.lat, lng: current.lng };
        }
      }
      setMovementKm(haversineKm(movementStartRef.current.lat, movementStartRef.current.lng, current.lat, current.lng));
    };

    void sampleMovement();
    const interval = setInterval(() => {
      void sampleMovement();
    }, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [manualStartAt, isSocialActivity, state.location.lat, state.location.lng]);

  const beginActivity = useCallback(async () => {
    if (manualStartAt) return;
    await logEvent('activity_started', { type: commitment.type, suggestion_id: suggestion.id });
    setManualStartAt(new Date());
    setRoutineFinished(false);
    setFinishAt(null);
    setGuideChecks(guideSteps.map(() => false));
    movementStartRef.current = state.location.lat != null && state.location.lng != null
      ? { lat: state.location.lat, lng: state.location.lng }
      : null;
    if (chatThreadId) {
      await ensureActivityChatThread({
        threadId: chatThreadId,
        suggestionId: suggestion.id,
        title: suggestion.title,
        expiresAt: chatExpiresAt,
        regionLabel: state.location.areaLabel,
      });
    }
  }, [manualStartAt, commitment.type, suggestion.id, suggestion.title, guideSteps, chatThreadId, chatExpiresAt, state.location.lat, state.location.lng, state.location.areaLabel]);

  const openChat = useCallback(() => {
    if (!chatThreadId) return;
    navigation.navigate('ActivityChat', {
      threadId: chatThreadId,
      title: suggestion.title,
      expiresAt: chatExpiresAt,
      suggestionId: suggestion.id,
      regionLabel: state.location.areaLabel,
    });
  }, [navigation, chatThreadId, chatExpiresAt, suggestion.id, suggestion.title, state.location.areaLabel]);

  const websiteUrl = useMemo(() => {
    const placeSite = suggestion.place?.websiteUrl?.trim();
    if (placeSite) return placeSite;
    const eventSite = suggestion.event?.ticketUrl?.trim() || commitment.ticketUrl?.trim();
    if (eventSite) return eventSite;
    return null;
  }, [suggestion.place?.websiteUrl, suggestion.event?.ticketUrl, commitment.ticketUrl]);

  const openWebsite = useCallback(async () => {
    if (!websiteUrl) return;
    await logEvent('cta_website_clicked', { type: commitment.type, suggestion_id: suggestion.id });
    await Linking.openURL(websiteUrl);
  }, [websiteUrl, commitment.type, suggestion.id]);

  const onPrimary = async () => {
    if (manualStartAt) return;
    await logEvent('cta_primary_clicked', { action: 'start' });
    await beginActivity();
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
      const eventId = await createPlanEvent({
        title,
        startDate: new Date(commitment.startAt),
        endDate: new Date(commitment.endAt),
        notes,
      });
      await logEvent('calendar_event_created_success');
      setCalendarFailed(false);

      // If we have a matching scheduled activity, update it with the calendar event id
      try {
        const match = state.scheduledActivities.find((s) => s.suggestionId === suggestion.id && s.startAt === commitment.startAt);
        if (match) {
          // Replace with updated calendar id and clear write-failed flag
          const updated = { ...match, calendarEventId: eventId, calendarWriteFailed: false };
          actions.removeScheduledActivity(match.id);
          actions.addScheduledActivity(updated);
        }
      } catch (err) {
        // best-effort
      }
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
        'Catch the next bus/train — leave on time.',
        `Spend ${formatDuration(suggestion.durationMin)} there.`,
      ];
    }
    return [
      'Open tickets and confirm details.',
      'Catch the next bus/train — leave on time.',
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
        'Open directions and plan your route.',
        leaveBy ? `Leave by ${leaveBy} to catch public transport.` : 'Head to the nearest stop now.',
        `Spend ${formatDuration(suggestion.durationMin)} there.`,
      ];
      return steps;
    }
    const startAt = formatTime(new Date(suggestion.event?.startAt || commitment.startAt));
    return [
      'Open tickets and confirm details.',
      leaveBy ? `Leave by ${leaveBy} to catch public transport.` : 'Head to the nearest stop now.',
      `Arrive by ${startAt}.`,
    ];
  }, [commitment.type, suggestion.steps, suggestion.durationMin, suggestion.event?.startAt, commitment.startAt, leaveBy, instructionList]);

  useEffect(() => {
    setGuideChecks(guideSteps.map(() => false));
  }, [guideSteps]);

  // ── Swipe-to-cancel (same as the Cancel plan button) ──────────
  const { width: screenWidth } = useWindowDimensions();
  const swipeX = useRef(new Animated.Value(0)).current;
  const SWIPE_THRESHOLD = screenWidth * 0.3;

  const cancelPlan = useCallback(async () => {
    cancelledRef.current = true;
    await logEvent('plan_cancelled');
    if (commitment.calendarEventId) {
      try {
        await deletePlanEvent(commitment.calendarEventId);
      } catch (error) {
        console.warn('Calendar delete failed', error);
      }
    }
    // Also remove related scheduled activity if present
    try {
      const match = state.scheduledActivities.find((s) => s.calendarEventId === commitment.calendarEventId || (s.suggestionId === suggestion.id && s.startAt === commitment.startAt));
      if (match) actions.removeScheduledActivity(match.id);
    } catch (err) {
      // ignore
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [commitment.calendarEventId, navigation]);

  const confirmCancel = useCallback(() => {
    Alert.alert('Cancel plan?', 'This will remove the plan from your flow.', [
      { text: 'Keep plan', style: 'cancel' },
      { text: 'Cancel', style: 'destructive', onPress: cancelPlan },
    ]);
  }, [cancelPlan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 15 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_, gesture) => {
          swipeX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > SWIPE_THRESHOLD) {
            // Animate off-screen then trigger cancel
            Animated.timing(swipeX, {
              toValue: gesture.dx > 0 ? screenWidth : -screenWidth,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              swipeX.setValue(0);
              confirmCancel();
            });
          } else {
            Animated.spring(swipeX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 140,
              friction: 12,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [screenWidth, SWIPE_THRESHOLD, confirmCancel, swipeX],
  );

  const autoChecks = useMemo(() => {
    return guideSteps.map(() => false);
  }, [guideSteps]);

  /** Index of the step currently being worked on (for highlighting) */
  const activeGuideIndex = useMemo(() => {
    if (commitment.type !== 'AT_HOME' || !manualStartAt) return -1;
    if (routineFinished) return -1;
    if (suggestion.steps?.length) return activeStepIndex;
    return 0;
  }, [commitment.type, manualStartAt, routineFinished, suggestion.steps, activeStepIndex]);

  const canFinish = manualStartAt !== null && guideChecks.every(Boolean);

  const navigateToCompletion = useCallback((durationMin: number) => {
    if (cancelledRef.current || finishingRef.current === false) return;
    navigation.replace('Completion', {
      title: suggestion.title,
      durationMin,
      emojis: suggestion.emojis,
      tags: suggestion.tags,
      suggestionType: suggestion.type,
      suggestionId: suggestion.id,
      habitId: suggestion.habitId,
      description: suggestion.description,
      movementKm,
    });
  }, [navigation, suggestion, movementKm]);

  useEffect(() => {
    if (commitment.type !== 'AT_HOME') return;
    if (!routineFinished || activityLogged || !manualStartAt) return;
    if (finishingRef.current) return; // finishing in progress via button press
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
      movementKm,
      chatThreadId: chatThreadId ?? undefined,
    });
    if (suggestion.habitId) {
      actions.completeHabit(suggestion.habitId);
    }
    setActivityLogged(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitment.type, routineFinished, activityLogged, manualStartAt]);

  const finishActivity = useCallback(() => {
    // Guard against double-fire (prevents cascading state updates)
    if (finishingRef.current) return;
    finishingRef.current = true;

    // Compute duration
    const endTime = finishAt ?? new Date();
    let dur = suggestion.durationMin;
    if (commitment.type === 'AT_HOME' && manualStartAt) {
      dur = Math.max(1, Math.round((endTime.getTime() - manualStartAt.getTime()) / 60000));
    }

    // Shorten calendar event if we finished early so it doesn't block the next activity
    if (commitment.calendarEventId && !commitment.calendarWriteFailed) {
      const originalEnd = new Date(commitment.endAt);
      if (endTime.getTime() < originalEnd.getTime()) {
        updatePlanEventEnd(commitment.calendarEventId, endTime)
          .then(() => {
            // Update local scheduled activity end time if present
            try {
              const match = state.scheduledActivities.find((s) => s.calendarEventId === commitment.calendarEventId || (s.suggestionId === suggestion.id && s.startAt === commitment.startAt));
              if (match) {
                const updated = { ...match, endAt: endTime.toISOString() };
                actions.removeScheduledActivity(match.id);
                actions.addScheduledActivity(updated);
              }
            } catch (err) {
              // ignore
            }
          })
          .catch((err) => console.warn('Failed to shorten calendar event', err));
      }
    }

    if (!activityLogged && commitment.type !== 'AT_HOME') {
      // Log the activity first (AT_HOME already logged by the effect above)
      actions.recordActivity({
        id: `act_${Date.now()}`,
        suggestionId: suggestion.id,
        title: suggestion.title,
        durationMin: dur,
        timestamp: new Date().toISOString(),
        source: suggestion.source,
        isHabit: !!suggestion.habitId,
        habitId: suggestion.habitId,
        tags: suggestion.tags,
        suggestionType: suggestion.type,
        movementKm,
        chatThreadId: chatThreadId ?? undefined,
      });
      if (suggestion.habitId) {
        actions.completeHabit(suggestion.habitId);
      }
      setActivityLogged(true);
    }

    navigateToCompletion(dur);
  }, [activityLogged, actions, suggestion, navigateToCompletion, commitment, manualStartAt, finishAt]);

  /** Whether the AT_HOME activity is on its very last step (or has no steps) */
  const isLastStep = useMemo(() => {
    if (commitment.type !== 'AT_HOME') return false;
    if (!manualStartAt) return false;
    const hasSteps = (suggestion.steps?.length ?? 0) > 0;
    if (!hasSteps) return true;
    const lastStepIndex = Math.max(0, (suggestion.steps?.length ?? 1) - 1);
    return activeStepIndex >= lastStepIndex;
  }, [commitment.type, manualStartAt, suggestion.steps, activeStepIndex]);

  const challengeLabel = useMemo(() => /challenge|quest|mission|sprint|try this/i.test([suggestion.title, suggestion.cta, suggestion.hook, suggestion.description].join(' ')), [suggestion]);
  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.swipeWrap, { transform: [{ translateX: swipeX }] }]}
      >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
      <View style={styles.header}>
        <View style={styles.topRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.subheadline}>{suggestion.title}</Text>
          </View>
          <View style={styles.badgeColumn}>
            {challengeLabel && (
              <View style={styles.challengeBadge}>
                <Text style={styles.challengeBadgeText}>Challenge</Text>
              </View>
            )}
            {isSocialActivity && (
              <View style={styles.socialStack}>
                <View style={styles.socialBadge}>
                  <Text style={styles.socialBadgeText}>
                    {socialProofCount > 0 ? `${socialProofCount} going` : 'Social'}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {manualStartAt ? (
          <View style={styles.timerPanel}>
            <Text style={styles.timerLabel}>Timer</Text>
            <Text style={styles.timerValue}>{formatDuration(Math.max(1, Math.round((now.getTime() - manualStartAt.getTime()) / 60000)))}</Text>
            <Text style={styles.timerMeta}>{commitment.type === 'GO_OUT' ? `${movementKm.toFixed(1)} km tracked` : `${Math.round(routineProgress * 100)}% complete`}</Text>
          </View>
        ) : (
          <PrimaryButton label="Start" onPress={beginActivity} glow />
        )}
      </View>

      {manualStartAt && (
        <View style={styles.actionRow}>
          <PrimaryButton
            label="Finish activity"
            onPress={finishActivity}
            disabled={!canFinish}
            glow={canFinish}
            bgColor={canFinish ? theme.colors.success : undefined}
            textColor={canFinish ? theme.colors.successText : undefined}
          />
          {chatThreadId && (
            <Pressable style={styles.chatButton} onPress={openChat}>
              <Text style={styles.chatButtonText}>Chat</Text>
            </Pressable>
          )}
        </View>
      )}

      {websiteUrl && (
        <Pressable onPress={openWebsite}>
          <Text style={styles.websiteLink}>Open website</Text>
        </Pressable>
      )}

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
          {guideSteps.map((step, index) => {
            const isChecked = guideChecks[index];
            const isActive = index === activeGuideIndex;
            const hasLink = /ticket|direction|route|website|map/i.test(step) && !!websiteUrl;
            return (
            <Pressable
              key={`guide_${index}`}
              onPress={() => {
                setGuideChecks((prev) => {
                  const next = [...prev];
                  next[index] = !next[index];
                  return next;
                });
              }}
              style={[styles.guideRow, isActive && styles.guideRowActive]}
            >
              <Text style={[styles.guideCheck, isChecked && styles.guideCheckOn, isActive && !isChecked && styles.guideCheckActive]}>
                {isChecked ? '✓' : isActive ? '▶' : '○'}
              </Text>
              <Text style={[styles.guideText, isChecked && styles.guideTextOn, isActive && !isChecked && styles.guideTextActive]}>
                {step}
              </Text>
              {hasLink && websiteUrl && (
                <Pressable onPress={openWebsite}>
                  <Text style={styles.guideLink}>Open link</Text>
                </Pressable>
              )}
            </Pressable>
            );
          })}
        </View>

        {commitment.type === 'GO_OUT' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{suggestion.place?.name}</Text>
            {leaveBy && <Text style={styles.metaText}>Leave by {leaveBy}</Text>}
            <Text style={styles.metaText}>{formatDuration(suggestion.durationMin)} activity</Text>
            {movementKm > 0 && <Text style={styles.metaText}>{movementKm.toFixed(1)} km tracked</Text>}
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
            {movementKm > 0 && <Text style={styles.metaText}>{movementKm.toFixed(1)} km tracked</Text>}
            <View style={styles.instructions}>
              {instructionList.slice(0, 3).map((item, index) => (
                <Text key={`event_${index}`} style={styles.instructionText}>- {item}</Text>
              ))}
            </View>
            <MapThumbnail lat={suggestion.place?.lat} lng={suggestion.place?.lng} height={160} />
          </View>
        )}
      </View>

      <Pressable onPress={confirmCancel}>
        <Text style={styles.cancel}>Cancel plan</Text>
        <Text style={styles.cancelHint}>or swipe to cancel</Text>
      </Pressable>
      </ScrollView>
      </Animated.View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  swipeWrap: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  header: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  badgeColumn: {
    alignItems: 'flex-end',
    gap: 8,
  },
  challengeBadge: {
    backgroundColor: theme.colors.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  challengeBadgeText: {
    fontFamily: theme.fonts.semibold,
    color: '#fff',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  socialStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  socialBadge: {
    backgroundColor: theme.colors.info,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  socialBadgeText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.infoText,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  timerPanel: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
  },
  timerLabel: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  timerValue: {
    fontFamily: theme.fonts.heading,
    color: theme.colors.text,
    fontSize: 34,
  },
  timerMeta: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  chatButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chatButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  guideLink: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
    fontSize: 12,
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
  websiteLink: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
    textAlign: 'center',
  },
  contextBlock: {
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
  guideRowActive: {
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    marginHorizontal: -theme.spacing.sm,
  },
  guideCheck: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    fontSize: 14,
    width: 20,
  },
  guideCheckOn: {
    color: theme.colors.success,
  },
  guideCheckActive: {
    color: theme.colors.accent,
  },
  guideText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    flexShrink: 1,
  },
  guideTextOn: {
    color: theme.colors.text,
    textDecorationLine: 'line-through',
  },
  guideTextActive: {
    color: theme.colors.text,
    fontFamily: theme.fonts.semibold,
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
    marginBottom: theme.spacing.xs,
  },
  cancelHint: {
    textAlign: 'center',
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
    opacity: 0.6,
    marginBottom: theme.spacing.md,
  },
});
