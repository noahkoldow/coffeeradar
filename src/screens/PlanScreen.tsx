import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { MapThumbnail } from '../components/MapThumbnail';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { formatTime } from '../utils/time';
import { logEvent } from '../services/analytics';
import { deletePlanEvent, updatePlanEventTimeRange } from '../services/calendar';
import { useAppState } from '../state/AppState';
import { getCurrentLocation } from '../services/location';
import { haversineKm } from '../services/travel';
import { getConfirmedSocialProofCount } from '../utils/social';
import { buildPlanSessionKey } from '../utils/planSession';
import { useI18n } from '../i18n/I18nProvider';
import { getActivityChatRegionLabel, makeActivityChatThreadId } from '../services/activityChat';

const sameTime = (a: Date, b: Date): boolean => a.getTime() === b.getTime();

export const PlanScreen: React.FC<StackScreenProps<RootStackParamList, 'Plan'>> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, language } = useI18n();
  const { commitment, suggestion } = route.params;
  const fromDoSomethingNow = route.params?.fromDoSomethingNow === true;
  const activityMode = route.params?.activityMode ?? (suggestion.type === 'AT_HOME' ? 'at_home' : 'all');
  const isChallengeMode = activityMode === 'challenge_me';
  const isGerman = language === 'de';
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();

  const [now, setNow] = useState(new Date());
  const [manualStartAt, setManualStartAt] = useState<Date | null>(null);
  const [guideChecks, setGuideChecks] = useState<boolean[]>([]);
  const [activityLogged, setActivityLogged] = useState(false);
  const [movementKm, setMovementKm] = useState(0);
  const [showChecklistLock, setShowChecklistLock] = useState(true);
  const challengeDurationSec = useMemo(() => Math.max(60, Math.round(Math.max(1, suggestion.durationMin) * 60)), [suggestion.durationMin]);
  const [challengeRemainingSec, setChallengeRemainingSec] = useState(challengeDurationSec);
  const [challengeFailed, setChallengeFailed] = useState(false);
  const [challengeFailedAt, setChallengeFailedAt] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const finishingRef = useRef(false);
  const movementStartRef = useRef<{ lat: number; lng: number } | null>(null);
  const checklistLockOpacity = useRef(new Animated.Value(1)).current;
  const checklistLockScale = useRef(new Animated.Value(1)).current;
  const sessionHydratedRef = useRef(false);
  const sessionCreatedAtRef = useRef(new Date().toISOString());
  const lastPersistedSessionSnapshotRef = useRef<string | null>(null);
  const sessionKey = useMemo(() => buildPlanSessionKey(commitment, suggestion), [commitment, suggestion]);

  const isSocialActivity = useMemo(() => {
    const hasFixedPlace = !!suggestion.place?.name?.trim() || !!suggestion.event?.venue?.trim();
    const hasFixedTime = !!commitment.startAt || !!suggestion.event?.startAt || !!suggestion.meta?.planStartAt;
    return (commitment.type === 'GO_OUT' || commitment.type === 'EVENT') && hasFixedPlace && hasFixedTime;
  }, [commitment.startAt, commitment.type, suggestion.event?.startAt, suggestion.event?.venue, suggestion.meta?.planStartAt, suggestion.place?.name]);
  const socialProofCount = getConfirmedSocialProofCount(suggestion);
  const socialChatRegion = getActivityChatRegionLabel(state.location.areaLabel);
  const socialChatThreadId = useMemo(
    () => makeActivityChatThreadId(suggestion.id, socialChatRegion),
    [socialChatRegion, suggestion.id],
  );
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logEvent('plan_page_opened');
  }, []);

  const scheduledStartAt = useMemo(() => {
    if (fromDoSomethingNow) return null;
    const raw = suggestion.event?.startAt || commitment.startAt || suggestion.meta?.planStartAt;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [commitment.startAt, fromDoSomethingNow, suggestion.event?.startAt, suggestion.meta?.planStartAt]);

  const activityStartLabel = useMemo(() => {
    return scheduledStartAt ? formatTime(scheduledStartAt) : null;
  }, [scheduledStartAt]);

  const scheduledForLabel = useMemo(() => {
    if (!scheduledStartAt) return null;
    const nowDate = new Date();
    if (scheduledStartAt.toDateString() === nowDate.toDateString()) {
      return formatTime(scheduledStartAt);
    }
    const dateLabel = scheduledStartAt.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return `${dateLabel} at ${formatTime(scheduledStartAt)}`;
  }, [scheduledStartAt]);

  const socialChatExpiresAt = useMemo(() => {
    const base = scheduledStartAt ?? new Date();
    return new Date(Math.max(Date.now(), base.getTime()) + 24 * 60 * 60 * 1000).toISOString();
  }, [scheduledStartAt]);

  const activityLocation = useMemo(() => {
    const name = suggestion.place?.name?.trim() || suggestion.event?.venue?.trim() || null;
    const address = suggestion.place?.address?.trim() || null;
    return { name, address, lat: suggestion.place?.lat, lng: suggestion.place?.lng };
  }, [suggestion.event?.venue, suggestion.place?.address, suggestion.place?.lat, suggestion.place?.lng, suggestion.place?.name]);

  const hasActivityLocation = !!activityLocation.name || !!activityLocation.address || (activityLocation.lat != null && activityLocation.lng != null);
  const ticketmasterTicketUrl = useMemo(() => {
    if (suggestion.source !== 'ticketmaster') return null;
    const url = suggestion.event?.ticketUrl?.trim();
    return url ? url : null;
  }, [suggestion.event?.ticketUrl, suggestion.source]);

  const openActivityLocation = useCallback(async () => {
    const coords = activityLocation.lat != null && activityLocation.lng != null ? `${activityLocation.lat},${activityLocation.lng}` : null;
    const locationQuery = activityLocation.name ?? activityLocation.address ?? 'destination';
    const query = coords ? `ll=${coords}&q=${encodeURIComponent(locationQuery)}` : `q=${encodeURIComponent(locationQuery)}`;
    await Linking.openURL(`https://maps.apple.com/?${query}`);
  }, [activityLocation.address, activityLocation.lat, activityLocation.lng, activityLocation.name]);

  const openTicketmasterTickets = useCallback(async () => {
    if (!ticketmasterTicketUrl) return;
    try {
      await Linking.openURL(ticketmasterTicketUrl);
    } catch (error) {
      Alert.alert(t('plan_ticket_link_error_title'), t('plan_ticket_link_error_body'));
    }
  }, [t, ticketmasterTicketUrl]);

  const formatElapsed = useCallback((startedAt: Date) => {
    const totalSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }, [now]);

  const formatCountdown = useCallback((totalSeconds: number) => {
    const safeSeconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }, []);

  const guideSteps = useMemo(() => {
    const isTodoActivity = (suggestion.tags ?? []).includes('todo') || /(^|\s)to-?do(\s|$)/i.test(suggestion.hook ?? '');
    if (isTodoActivity) {
      return [suggestion.title];
    }

    if (commitment.type === 'AT_HOME') {
      if (suggestion.steps?.length) return suggestion.steps.map((step) => step.label);
      if (suggestion.instructions?.length) return suggestion.instructions;
      return ['Open the activity.', 'Follow the prompt.', 'Finish when done.'];
    }

    if (commitment.type === 'GO_OUT') {
      return [
        `Head to ${suggestion.place?.name ?? 'your spot'}.`,
        'Get moving now.',
        `Spend ${suggestion.durationMin} minutes there.`,
      ];
    }

    return [
      'Open tickets and confirm details.',
      'Get ready to leave on time.',
      `Arrive by ${formatTime(new Date(suggestion.event?.startAt || commitment.startAt))}.`,
    ];
  }, [commitment.startAt, commitment.type, suggestion.durationMin, suggestion.event?.startAt, suggestion.hook, suggestion.instructions, suggestion.place?.name, suggestion.steps, suggestion.tags, suggestion.title]);

  useEffect(() => {
    const session = state.inProgressPlanSession;
    if (!session || session.key !== sessionKey || sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    sessionCreatedAtRef.current = session.createdAt || new Date().toISOString();

    const restoredStartAt = session.manualStartAt ? new Date(session.manualStartAt) : null;
    setManualStartAt(restoredStartAt);
    setActivityLogged(!!session.activityLogged);
    setMovementKm(typeof session.movementKm === 'number' ? session.movementKm : 0);
    setChallengeFailed(!!session.challengeFailed);
    setChallengeFailedAt(session.challengeFailedAt ?? null);
    if (isChallengeMode && restoredStartAt) {
      const elapsed = Math.max(0, Math.floor((Date.now() - restoredStartAt.getTime()) / 1000));
      setChallengeRemainingSec(Math.max(0, challengeDurationSec - elapsed));
    }
    setGuideChecks(guideSteps.map((_, index) => !!session.guideChecks?.[index]));
    lastPersistedSessionSnapshotRef.current = JSON.stringify({
      key: session.key,
      commitment: session.commitment,
      suggestion: session.suggestion,
      manualStartAt: session.manualStartAt,
      guideChecks: guideSteps.map((_, index) => !!session.guideChecks?.[index]),
      activityLogged: !!session.activityLogged,
      movementKm: typeof session.movementKm === 'number' ? session.movementKm : 0,
      challengeFailed: !!session.challengeFailed,
      challengeFailedAt: session.challengeFailedAt ?? null,
      createdAt: session.createdAt || sessionCreatedAtRef.current,
    });

    if (restoredStartAt) {
      setShowChecklistLock(false);
      checklistLockOpacity.setValue(0);
      checklistLockScale.setValue(1);
    }
  }, [challengeDurationSec, checklistLockOpacity, checklistLockScale, guideSteps, isChallengeMode, sessionKey, state.inProgressPlanSession]);

  useEffect(() => {
    setGuideChecks((prev) => {
      if (prev.length === guideSteps.length) return prev;
      return guideSteps.map((_, index) => !!prev[index]);
    });
  }, [guideSteps]);

  useEffect(() => {
    if (!sessionHydratedRef.current && state.inProgressPlanSession?.key === sessionKey) {
      return;
    }

    if (!manualStartAt) {
      if (state.inProgressPlanSession?.key === sessionKey) {
        lastPersistedSessionSnapshotRef.current = null;
        actions.setInProgressPlanSession(null);
      }
      return;
    }

    const existingCreatedAt = state.inProgressPlanSession?.key === sessionKey
      ? state.inProgressPlanSession.createdAt
      : sessionCreatedAtRef.current;

    const nextSessionBase = {
      key: sessionKey,
      commitment,
      suggestion,
      manualStartAt: manualStartAt.toISOString(),
      guideChecks: guideSteps.map((_, index) => !!guideChecks[index]),
      activityLogged,
      movementKm,
      challengeFailed,
      challengeFailedAt,
      createdAt: existingCreatedAt,
    };

    const nextSnapshot = JSON.stringify(nextSessionBase);
    if (nextSnapshot === lastPersistedSessionSnapshotRef.current) return;
    lastPersistedSessionSnapshotRef.current = nextSnapshot;

    actions.setInProgressPlanSession({
      ...nextSessionBase,
      updatedAt: new Date().toISOString(),
    });
  }, [actions, activityLogged, challengeFailed, challengeFailedAt, commitment, guideChecks, guideSteps, manualStartAt, movementKm, sessionKey, state.inProgressPlanSession, suggestion]);

  useEffect(() => {
    if (!isChallengeMode || !manualStartAt || challengeFailed) return;
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - manualStartAt.getTime()) / 1000));
    const remaining = Math.max(0, challengeDurationSec - elapsedSeconds);
    setChallengeRemainingSec((prev) => (prev === remaining ? prev : remaining));
    if (remaining === 0) {
      const failedAt = new Date().toISOString();
      setChallengeFailed(true);
      setChallengeFailedAt(failedAt);
      void logEvent('challenge_failed_timeout', { suggestion_id: suggestion.id, activity_mode: activityMode });
    }
  }, [activityMode, challengeDurationSec, challengeFailed, isChallengeMode, manualStartAt, now, suggestion.id]);

  useEffect(() => {
    if (!manualStartAt || !isSocialActivity) return undefined;
    let active = true;

    const sampleMovement = async () => {
      const current = await getCurrentLocation().catch(() => null);
      if (!active || !current?.lat || !current.lng) return;
      if (!movementStartRef.current) {
        movementStartRef.current = state.location.lat != null && state.location.lng != null
          ? { lat: state.location.lat, lng: state.location.lng }
          : { lat: current.lat, lng: current.lng };
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
  }, [isSocialActivity, manualStartAt, state.location.lat, state.location.lng]);

  const startActivityNow = useCallback(async () => {
    if (manualStartAt) return;
    await logEvent('activity_started', { type: commitment.type, suggestion_id: suggestion.id });

    if (showChecklistLock) {
      checklistLockOpacity.setValue(1);
      checklistLockScale.setValue(1);
      Animated.parallel([
        Animated.timing(checklistLockOpacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.spring(checklistLockScale, {
          toValue: 1.15,
          useNativeDriver: true,
          tension: 180,
          friction: 14,
        }),
      ]).start(() => {
        setShowChecklistLock(false);
      });
    }

    setManualStartAt(new Date());
    setActivityLogged(false);
    setChallengeFailed(false);
    setChallengeFailedAt(null);
    setChallengeRemainingSec(challengeDurationSec);
    setGuideChecks(guideSteps.map(() => false));
    movementStartRef.current = state.location.lat != null && state.location.lng != null
      ? { lat: state.location.lat, lng: state.location.lng }
      : null;
  }, [challengeDurationSec, checklistLockOpacity, checklistLockScale, commitment.type, guideSteps, manualStartAt, showChecklistLock, state.location.lat, state.location.lng, suggestion.id]);

  const retryChallenge = useCallback(() => {
    if (!isChallengeMode) return;
    setManualStartAt(new Date());
    setActivityLogged(false);
    setChallengeFailed(false);
    setChallengeFailedAt(null);
    setChallengeRemainingSec(challengeDurationSec);
    setGuideChecks(guideSteps.map(() => false));
  }, [challengeDurationSec, guideSteps, isChallengeMode]);

  const beginActivity = useCallback(() => {
    if (manualStartAt) return;
    if (scheduledStartAt && scheduledStartAt.getTime() > Date.now()) {
      Alert.alert(
        t('plan_scheduled_later_title'),
        t('plan_scheduled_later_body', { time: scheduledForLabel ?? formatTime(scheduledStartAt) }),
        [
          { text: t('plan_keep_schedule'), style: 'cancel' },
          { text: t('plan_start_now'), onPress: () => { void startActivityNow(); } },
        ],
      );
      return;
    }
    void startActivityNow();
  }, [manualStartAt, scheduledForLabel, scheduledStartAt, startActivityNow]);

  const openActivityChat = useCallback(() => {
    navigation.navigate('ActivityChat', {
      threadId: socialChatThreadId,
      title: suggestion.title,
      expiresAt: socialChatExpiresAt,
      suggestionId: suggestion.id,
      regionLabel: socialChatRegion,
    });
  }, [navigation, socialChatExpiresAt, socialChatRegion, socialChatThreadId, suggestion.id, suggestion.title]);

  const activeGuideIndex = useMemo(() => {
    if (!manualStartAt) return -1;
    return guideChecks.findIndex((checked) => !checked);
  }, [guideChecks, manualStartAt]);

  const canFinish = manualStartAt !== null && guideChecks.every(Boolean) && !challengeFailed;
  const finishOpacity = useMemo(() => {
    if (guideSteps.length === 0) return 1;
    const checkedCount = guideChecks.filter(Boolean).length;
    const progress = checkedCount / guideSteps.length;
    return 0.2 + progress * 0.8;
  }, [guideChecks, guideSteps.length]);

  const completionTags = useMemo(() => {
    if (!isChallengeMode) return suggestion.tags;
    return Array.from(new Set([...(suggestion.tags ?? []), 'challenge']));
  }, [isChallengeMode, suggestion.tags]);

  const navigateToCompletion = useCallback((durationMin: number) => {
    if (cancelledRef.current || finishingRef.current === false) return;
    navigation.replace('Completion', {
      title: suggestion.title,
      durationMin,
      emojis: suggestion.emojis,
      tags: completionTags,
      suggestionType: suggestion.type,
      suggestionId: suggestion.id,
      habitId: suggestion.habitId,
      description: suggestion.description,
      movementKm,
    });
  }, [completionTags, navigation, movementKm, suggestion.description, suggestion.emojis, suggestion.habitId, suggestion.id, suggestion.title, suggestion.type]);

  const finishActivity = useCallback(() => {
    if (challengeFailed) {
      Alert.alert(t('plan_challenge_failed_title'), t('plan_challenge_failed_body'));
      return;
    }
    if (finishingRef.current || !manualStartAt || !canFinish) return;
    finishingRef.current = true;

    const realStartTime = manualStartAt;
    const endTime = new Date();
    const realStartIso = realStartTime.toISOString();
    const endTimeIso = endTime.toISOString();
    const durationMin = Math.max(1, Math.round((endTime.getTime() - realStartTime.getTime()) / 60000));

    const originalStart = new Date(commitment.startAt);
    const originalEnd = new Date(commitment.endAt);
    const hasRealTimeChange = !sameTime(realStartTime, originalStart) || !sameTime(endTime, originalEnd);

    const scheduledToReplace = state.scheduledActivities.find((item) => {
      if (item.calendarEventId && commitment.calendarEventId) {
        return item.calendarEventId === commitment.calendarEventId;
      }
      return item.suggestionId === commitment.suggestionId
        && item.startAt === commitment.startAt
        && item.endAt === commitment.endAt;
    });

    if (hasRealTimeChange && scheduledToReplace) {
      const updatedScheduledActivity = {
        ...scheduledToReplace,
        startAt: realStartIso,
        endAt: endTimeIso,
        durationMin,
        commitment: {
          ...scheduledToReplace.commitment,
          startAt: realStartIso,
          endAt: endTimeIso,
        },
      };
      actions.updateScheduledActivity(scheduledToReplace.id, updatedScheduledActivity);
    }

    if (hasRealTimeChange && commitment.calendarEventId && !commitment.calendarWriteFailed) {
      updatePlanEventTimeRange(commitment.calendarEventId, realStartTime, endTime)
        .catch((err) => console.warn('Failed to sync real activity time to calendar event', err));
    }

    if (!activityLogged) {
      actions.recordActivity({
        id: `act_${Date.now()}`,
        suggestionId: suggestion.id,
        title: suggestion.title,
        durationMin,
        timestamp: new Date().toISOString(),
        activityMode,
        source: suggestion.source,
        isHabit: !!suggestion.habitId,
        habitId: suggestion.habitId,
        tags: completionTags,
        suggestionType: suggestion.type,
        movementKm,
      });
      if (suggestion.habitId) actions.completeHabit(suggestion.habitId);
      setActivityLogged(true);
    }

    if (scheduledToReplace) {
      actions.removeScheduledActivity(scheduledToReplace.id);
    }

    actions.setInProgressPlanSession(null);

    navigateToCompletion(durationMin);
  }, [activityLogged, actions, activityMode, canFinish, challengeFailed, commitment.calendarEventId, commitment.calendarWriteFailed, commitment.endAt, commitment.startAt, commitment.suggestionId, completionTags, manualStartAt, movementKm, navigateToCompletion, state.scheduledActivities, suggestion.habitId, suggestion.id, suggestion.source, suggestion.title, suggestion.type]);

  const cancelPlan = useCallback(async () => {
    cancelledRef.current = true;
    await logEvent('plan_cancelled');
    actions.setInProgressPlanSession(null);
    if (commitment.calendarEventId) {
      try {
        await deletePlanEvent(commitment.calendarEventId);
      } catch (error) {
        console.warn('Calendar delete failed', error);
      }
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [actions, commitment.calendarEventId, navigation]);

  const confirmCancel = useCallback(() => {
    Alert.alert(t('plan_cancel_title'), t('plan_cancel_body'), [
      { text: t('plan_keep_plan'), style: 'cancel' },
      { text: t('plan_cancel_cta'), style: 'destructive', onPress: cancelPlan },
    ]);
  }, [cancelPlan, t]);

  const { width: screenWidth } = useWindowDimensions();
  const swipeX = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 15 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_, gesture) => swipeX.setValue(gesture.dx),
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > screenWidth * 0.3) {
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
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [confirmCancel, screenWidth, swipeX],
  );

  const challengeLabel = useMemo(() => {
    if (isChallengeMode) return true;
    return /challenge|quest|mission|sprint|try this/i.test([suggestion.title, suggestion.cta, suggestion.hook, suggestion.description].join(' '));
  }, [isChallengeMode, suggestion]);

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}>
      <Animated.View {...panResponder.panHandlers} style={[styles.swipeWrap, { transform: [{ translateX: swipeX }] }]}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.topRow}>
              <View style={styles.titleBlock}>
                <Text style={styles.subheadline}>{suggestion.title}</Text>
                {hasActivityLocation && (
                  <Pressable style={({ pressed }) => [styles.locationRowCard, pressed && styles.locationRowPressed]} onPress={openActivityLocation}>
                    <Text style={styles.locationPin}>{'📍'}</Text>
                    <Text style={styles.locationText} numberOfLines={1}>{activityLocation.name ?? activityLocation.address ?? ''}</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.badgeColumn}>
                {activityStartLabel && <View style={styles.timeBadge}><Text style={styles.timeBadgeText}>{activityStartLabel}</Text></View>}
                {challengeLabel && <View style={styles.challengeBadge}><Text style={styles.challengeBadgeText}>{t('plan_challenge_badge')}</Text></View>}
                {isSocialActivity && <View style={styles.socialBadge}><Text style={styles.socialBadgeText}>{socialProofCount > 0 ? t('plan_going_count', { count: socialProofCount }) : t('plan_social_badge')}</Text></View>}
              </View>
            </View>

            {!manualStartAt ? (
              <PrimaryButton label={t('plan_start')} onPress={beginActivity} glow style={styles.startButton} />
            ) : (
              <View style={[styles.timerPanel, challengeFailed && styles.timerPanelFailed]}>
                <Text style={[styles.timerLabel, challengeFailed && styles.timerLabelFailed]}>
                  {isChallengeMode ? t('plan_timer_challenge') : t('plan_timer_elapsed')}
                </Text>
                <Text style={[styles.timerValue, challengeFailed && styles.timerValueFailed]}>
                  {isChallengeMode ? formatCountdown(challengeRemainingSec) : formatElapsed(manualStartAt)}
                </Text>
                {isChallengeMode && challengeFailed && (
                  <Text style={styles.timerFailedText}>{t('plan_timer_up')}</Text>
                )}
              </View>
            )}

            {isSocialActivity && (
              <View style={styles.connectPanel}>
                <View style={styles.connectCopy}>
                  <Text style={styles.connectTitle}>
                    {socialProofCount > 0
                      ? (isGerman ? `${socialProofCount} gehen auch hin` : `${socialProofCount} going too`)
                      : (isGerman ? 'Soziale Aktivität' : 'Social activity')}
                  </Text>
                  <Text style={styles.connectText}>
                    {isGerman
                      ? `Chatte mit Leuten${socialChatRegion ? ` in ${socialChatRegion}` : ''}, die diese Aktivität planen.`
                      : `Chat with people${socialChatRegion ? ` in ${socialChatRegion}` : ''} planning this activity.`}
                  </Text>
                </View>
                <Pressable style={({ pressed }) => [styles.connectButton, pressed && { opacity: 0.86 }]} onPress={openActivityChat}>
                  <Text style={styles.connectButtonText}>{isGerman ? 'Chat öffnen' : 'Open chat'}</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.guideBlock}>
            <Text style={styles.sectionTitle}>{`✅ ${t('plan_checklist_title')}`}</Text>
            {!!ticketmasterTicketUrl && (
              <Pressable
                style={({ pressed }) => [
                  styles.ticketLinkRow,
                  pressed && styles.ticketLinkRowPressed,
                ]}
                onPress={openTicketmasterTickets}
              >
                <Text style={styles.ticketLinkLabel}>{t('plan_tickets')}</Text>
                <Text style={styles.ticketLinkText}>{t('plan_open_ticketmaster')}</Text>
              </Pressable>
            )}
            {guideSteps.map((step, index) => {
              const isChecked = guideChecks[index];
              const isActive = index === activeGuideIndex;
              return (
                <Pressable
                  key={`guide_${index}`}
                  onPress={() => setGuideChecks((prev) => { const next = [...prev]; next[index] = !next[index]; return next; })}
                  disabled={!manualStartAt || showChecklistLock}
                  style={[styles.guideRow, isActive && styles.guideRowActive]}
                >
                  <Text style={[styles.guideCheck, isChecked && styles.guideCheckOn, isActive && !isChecked && styles.guideCheckActive]}>{isChecked ? '☑' : '☐'}</Text>
                  <Text style={[styles.guideText, isChecked && styles.guideTextOn, isActive && !isChecked && styles.guideTextActive]}>{step}</Text>
                </Pressable>
              );
            })}

            <Pressable
              style={({ pressed }) => [
                styles.finishChecklistRow,
                { opacity: finishOpacity },
                pressed && { opacity: Math.max(0.12, finishOpacity - 0.06) },
              ]}
              onPress={finishActivity}
              disabled={!canFinish || showChecklistLock}
            >
              <Text style={styles.finishChecklistTitle}>{t('plan_finish_activity')}</Text>
              <Text style={[styles.finishChecklistMeta, canFinish && !challengeFailed && styles.finishChecklistMetaHidden]}>
                {challengeFailed ? t('plan_finish_failed') : t('plan_finish_hint')}
              </Text>
            </Pressable>

            {isChallengeMode && challengeFailed && (
              <PrimaryButton label={t('plan_retry_challenge')} onPress={retryChallenge} style={styles.retryButton} />
            )}

            {showChecklistLock && (
              <Animated.View
                pointerEvents="auto"
                style={[
                  styles.checklistLockOverlay,
                  {
                    opacity: checklistLockOpacity,
                    transform: [{ scale: checklistLockScale }],
                  },
                ]}
              >
                <Text style={styles.checklistLockIcon}>🔒</Text>
                <Text style={styles.checklistLockText}>{t('plan_unlock_checklist')}</Text>
                {!!scheduledForLabel && <Text style={styles.checklistLockSubtext}>{t('plan_scheduled_for', { time: scheduledForLabel })}</Text>}
              </Animated.View>
            )}

            {(commitment.type === 'GO_OUT' || commitment.type === 'EVENT') && (
              <Pressable style={styles.mapBlock} onPress={openActivityLocation} disabled={!activityLocation.lat && !activityLocation.lng}>
                <MapThumbnail lat={activityLocation.lat} lng={activityLocation.lng} height={160} />
              </Pressable>
            )}
          </View>

          <Pressable onPress={confirmCancel}>
            <Text style={styles.cancel}>{t('plan_cancel_cta')}</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1, padding: theme.spacing.lg, gap: theme.spacing.md },
  swipeWrap: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { gap: theme.spacing.md, paddingBottom: theme.spacing.xxl },
  header: { marginTop: theme.spacing.lg, gap: theme.spacing.md },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: theme.spacing.md },
  titleBlock: { flex: 1, gap: 8 },
  subheadline: { fontFamily: theme.fonts.heading, color: theme.colors.text, fontSize: 26, lineHeight: 30 },
  badgeColumn: { alignItems: 'flex-end', gap: 8 },
  timeBadge: { backgroundColor: theme.colors.backgroundAlt, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  timeBadgeText: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 11, letterSpacing: 0.5 },
  challengeBadge: { backgroundColor: theme.colors.danger, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  challengeBadgeText: { fontFamily: theme.fonts.semibold, color: '#fff', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  socialBadge: { backgroundColor: theme.colors.info, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  socialBadgeText: { fontFamily: theme.fonts.semibold, color: theme.colors.infoText, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  startButton: { alignSelf: 'stretch' },
  timerPanel: { backgroundColor: theme.colors.card, borderRadius: theme.radius.lg, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.border, minHeight: 64, justifyContent: 'center', alignItems: 'center' },
  timerPanelFailed: { borderColor: theme.colors.danger, backgroundColor: `${theme.colors.danger}14` },
  timerLabel: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 12, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  timerLabelFailed: { color: theme.colors.danger },
  timerValue: { fontFamily: theme.fonts.heading, color: theme.colors.text, fontSize: 28, textAlign: 'center' },
  timerValueFailed: { color: theme.colors.danger },
  timerFailedText: { fontFamily: theme.fonts.body, color: theme.colors.danger, fontSize: 12, textAlign: 'center', marginTop: 4 },
  connectPanel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, backgroundColor: theme.colors.card, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border },
  connectCopy: { flex: 1, gap: 3 },
  connectTitle: { fontFamily: theme.fonts.semibold, color: theme.colors.text, fontSize: 14 },
  connectText: { fontFamily: theme.fonts.body, color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  connectButton: { backgroundColor: theme.colors.info, borderRadius: theme.radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  connectButtonText: { fontFamily: theme.fonts.semibold, color: theme.colors.infoText, fontSize: 12 },
  locationRowCard: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: theme.colors.backgroundAlt, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  locationRowPressed: { opacity: 0.85 },
  locationPin: { fontSize: 14 },
  locationText: { flexShrink: 1, fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 13 },
  guideBlock: { backgroundColor: theme.colors.card, borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, gap: theme.spacing.sm },
  sectionTitle: { fontFamily: theme.fonts.semibold, fontSize: 18, color: theme.colors.text },
  ticketLinkRow: {
    minHeight: 40,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  ticketLinkRowPressed: { opacity: 0.82 },
  ticketLinkLabel: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 13 },
  ticketLinkText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accent,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minHeight: 40, borderRadius: theme.radius.sm, paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, marginHorizontal: -theme.spacing.sm, borderWidth: 1, borderColor: 'transparent' },
  guideRowActive: { backgroundColor: theme.colors.backgroundAlt, borderColor: theme.colors.border },
  guideCheck: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, fontSize: 14, width: 20 },
  guideCheckOn: { color: theme.colors.textMuted },
  guideCheckActive: { color: theme.colors.accent },
  guideText: { fontFamily: theme.fonts.body, color: theme.colors.textMuted, flexShrink: 1, fontSize: 14 },
  guideTextOn: { color: theme.colors.textMuted, textDecorationLine: 'line-through', fontSize: 14 },
  guideTextActive: { color: theme.colors.text, fontFamily: theme.fonts.semibold, fontSize: 14 },
  checklistLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8, 12, 24, 0.58)',
    gap: 6,
  },
  checklistLockIcon: { fontSize: 32 },
  checklistLockText: { fontFamily: theme.fonts.semibold, color: '#fff', textAlign: 'center', fontSize: 13, paddingHorizontal: theme.spacing.lg },
  checklistLockSubtext: {
    fontFamily: theme.fonts.body,
    color: '#fff',
    textAlign: 'center',
    fontSize: 12,
    paddingHorizontal: theme.spacing.lg,
    opacity: 0.9,
  },
  finishChecklistRow: { width: '100%', backgroundColor: theme.colors.accent, borderRadius: theme.radius.lg, paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.lg, borderWidth: 1, borderColor: theme.colors.accentDark, alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: theme.spacing.xs },
  finishChecklistTitle: { fontFamily: theme.fonts.semibold, color: theme.colors.accentText, textAlign: 'center' },
  finishChecklistMeta: { fontFamily: theme.fonts.body, color: theme.colors.accentText, fontSize: 12, opacity: 0.85, textAlign: 'center' },
  finishChecklistMetaHidden: { opacity: 0 },
  retryButton: { marginTop: theme.spacing.xs },
  mapBlock: { borderRadius: theme.radius.md, overflow: 'hidden', marginTop: theme.spacing.xs },
  cancel: { textAlign: 'center', fontFamily: theme.fonts.semibold, color: theme.colors.textMuted, marginBottom: theme.spacing.xs, opacity: 0.7 },
});
