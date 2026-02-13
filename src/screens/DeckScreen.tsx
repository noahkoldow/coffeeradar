import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PrimaryButton } from '../components/PrimaryButton';
import { SwipeDeck, SwipeDeckHandle } from '../components/SwipeDeck';
import { EmojiConfetti } from '../components/EmojiConfetti';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { Availability, Commitment, DeckSuggestion } from '../types';
import { buildDeck } from '../services/suggestions';
import { addMinutes, formatDuration, toISO } from '../utils/time';
import { createPlanEvent } from '../services/calendar';
import { logEvent } from '../services/analytics';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

export const DeckScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [deck, setDeck] = useState<DeckSuggestion[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confettiEmojis, setConfettiEmojis] = useState<string[]>([]);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [rippleConfig, setRippleConfig] = useState<{ left: number; top: number; size: number } | null>(null);
  const [laterVisible, setLaterVisible] = useState(false);
  const deckRef = useRef<SwipeDeckHandle>(null);
  const commitButtonRef = useRef<View>(null);
  const ripple = useRef(new Animated.Value(0)).current;
  const swipeLockRef = useRef(false);
  const historyRef = useRef(state.history);
  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  };

  const availability: Availability = state.availability && !route.params?.durationOverride
    ? state.availability
    : (() => {
        const now = new Date();
        const durationMin = route.params?.durationOverride ?? 120;
        return {
          start: toISO(now),
          end: toISO(addMinutes(now, durationMin)),
          durationMin,
          nextEventTitle: null,
        };
      })();

  const generateDeck = useCallback(async () => {
    setLoading(true);
    try {
      const result = await buildDeck(
        availability,
        state.location,
        state.prefs,
        historyRef.current,
        state.habits,
      );
      setDeck(result.deck);
      setFallbackUsed(result.usedFallback);
      setIndex(0);
      await logEvent('deck_shown', { freeWindowDuration: availability.durationMin });
    } catch (error) {
      console.warn('Deck error', error);
      setDeck([]);
    } finally {
      setLoading(false);
    }
  }, [availability, state.location, state.prefs, state.habits]);

  useEffect(() => {
    generateDeck();
  }, [generateDeck]);

  useEffect(() => {
    historyRef.current = state.history;
  }, [state.history]);

  useEffect(() => {
    swipeLockRef.current = false;
  }, [index]);

  const updateRippleLayout = useCallback(() => {
    if (!commitButtonRef.current) return;
    commitButtonRef.current.measureInWindow((x, y, width, height) => {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const distances = [
        Math.hypot(centerX - 0, centerY - 0),
        Math.hypot(centerX - screenWidth, centerY - 0),
        Math.hypot(centerX - 0, centerY - screenHeight),
        Math.hypot(centerX - screenWidth, centerY - screenHeight),
      ];
      const maxDist = Math.max(...distances);
      const size = maxDist * 2;
      setRippleConfig({
        left: centerX - size / 2,
        top: centerY - size / 2,
        size,
      });
    });
  }, [screenHeight, screenWidth]);

  useEffect(() => {
    updateRippleLayout();
  }, [updateRippleLayout, screenHeight, screenWidth]);

  const triggerRipple = useCallback(() => {
    if (!rippleConfig) return;
    ripple.stopAnimation();
    ripple.setValue(0);
    Animated.timing(ripple, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [ripple, rippleConfig]);

  const current = deck[index] ?? null;
  const next = deck[index + 1] ?? null;

  const handleSwipeLeft = async () => {
    if (!current) return;
    if (swipeLockRef.current) return;
    swipeLockRef.current = true;
    const updated = {
      ...state.history,
      lastRejectedIds: [current.id, ...state.history.lastRejectedIds].slice(0, 20),
    };
    actions.setHistory(updated);
    await logEvent('swipe_left', { suggestion_id: current.id, type: current.type });
    setIndex((prev) => prev + 1);
  };

  const buildNotes = (suggestion: DeckSuggestion, leaveBy?: string | null) => {
    if (suggestion.type === 'AT_HOME') {
      return `${suggestion.description}\n\nSteps:\n${(suggestion.steps || [])
        .map((step) => `- ${step.label} (${step.minutes}m)`).join('\n')}`;
    }
    if (suggestion.type === 'GO_OUT') {
      return `${suggestion.description}\n${suggestion.place?.address ?? ''}\nLeave by: ${
        leaveBy ? new Date(leaveBy).toLocaleTimeString() : 'soon'
      }`;
    }
    if (suggestion.type === 'EVENT' && suggestion.event) {
      return `${suggestion.event.venue}\nTickets: ${suggestion.event.ticketUrl}`;
    }
    return suggestion.description;
  };

  const commitSuggestion = async (mode: 'now' | 'later', startOverride?: Date) => {
    if (!current) return;
    if (confirming || swipeLockRef.current) return;
    swipeLockRef.current = true;
    setConfettiEmojis(current.emojis && current.emojis.length ? current.emojis : ['✨', '🎉', '⭐']);
    setConfirming(true);
    triggerRipple();
    await logEvent(mode === 'later' ? 'schedule_later_commit' : 'swipe_right_commit', {
      suggestion_id: current.id,
      type: current.type,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const now = new Date();
    let startDate = startOverride ?? addMinutes(now, 2);
    let endDate = addMinutes(startDate, current.durationMin);
    let title = current.title;
    let leaveBy = current.meta?.leaveBy;

    if (current.type === 'AT_HOME') {
      title = `Plan: ${current.title}`;
      if (startOverride) {
        startDate = startOverride;
        endDate = addMinutes(startDate, current.durationMin);
      }
    }

    if (current.type === 'GO_OUT') {
      title = `Plan: ${current.place?.name ?? current.title}`;
      if (startOverride) {
        startDate = startOverride;
        endDate = addMinutes(startDate, current.durationMin);
        leaveBy = startOverride.toISOString();
      } else {
        startDate = addMinutes(now, 5);
        endDate = addMinutes(startDate, current.durationMin);
      }
    }

    if (current.type === 'EVENT' && current.event) {
      title = `Event: ${current.title}`;
      startDate = new Date(current.event.startAt);
      endDate = addMinutes(startDate, current.durationMin || 120);
    }

    const notes = buildNotes(current, leaveBy);
    let calendarEventId: string | undefined;
    let calendarWriteFailed = !state.permissions.calendarGranted;

    try {
      if (state.permissions.calendarGranted) {
        calendarEventId = await createPlanEvent({
          title,
          startDate,
          endDate,
          notes,
        });
        await logEvent('calendar_event_created_success');
        calendarWriteFailed = false;
      }
    } catch (error) {
      calendarWriteFailed = true;
      await logEvent('calendar_event_created_fail');
    }

    const commitment: Commitment = {
      suggestionId: current.id,
      type: current.type,
      title: current.title,
      startAt: startDate.toISOString(),
      endAt: endDate.toISOString(),
      leaveBy,
      ticketUrl: current.event?.ticketUrl,
      calendarEventId,
      calendarWriteFailed,
    };

    actions.setHistory({
      ...state.history,
      lastAcceptedIds: [current.id, ...state.history.lastAcceptedIds].slice(0, 10),
    });

    setTimeout(() => {
      setConfirming(false);
      navigation.replace('Plan', { commitment, suggestion: current });
    }, 600);
  };

  const handleCommit = async () => {
    await commitSuggestion('now');
  };

  const laterOptions = [
    { id: '30', label: 'In 30m', offsetMin: 30 },
    { id: '60', label: 'In 1h', offsetMin: 60 },
    { id: '120', label: 'In 2h', offsetMin: 120 },
    { id: 'tonight', label: 'Tonight', offsetMin: null },
  ];

  const resolveLaterStart = (offsetMin: number | null): Date => {
    const now = new Date();
    if (offsetMin !== null) {
      return addMinutes(now, offsetMin);
    }
    const tonight = new Date(now);
    tonight.setHours(19, 0, 0, 0);
    if (tonight.getTime() <= now.getTime()) {
      return addMinutes(now, 120);
    }
    return tonight;
  };

  const scheduleLater = async (offsetMin: number | null) => {
    setLaterVisible(false);
    await commitSuggestion('later', resolveLaterStart(offsetMin));
  };

  if (loading) {
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
        <Text style={styles.loading}>Building your deck...</Text>
      </LinearGradient>
    );
  }

  if (!current) {
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.title}>Nothing clicked.</Text>
          <Text style={styles.subtitle}>Want a new set?</Text>
          <View style={styles.actions}>
            <PrimaryButton label="New set" onPress={generateDeck} />
            <Pressable onPress={() => navigation.navigate('Settings')}>
              <Text style={styles.refineLink}>Refine what to do</Text>
            </Pressable>
            <Pressable onPress={goBack}>
              <Text style={styles.backLink}>Back</Text>
            </Pressable>
          </View>
        </View>
      </LinearGradient>
    );
  }

  const freeLabel = `You have ${formatDuration(availability.durationMin)} free`;
  const area = state.location.areaLabel ? `near ${state.location.areaLabel}` : 'near you';

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            Alert.alert('Exit without choosing?', 'You can keep swiping or exit now.', [
              { text: 'Continue', style: 'cancel' },
              { text: 'Exit', style: 'destructive', onPress: goBack },
            ]);
          }}
        >
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.headerText}>{freeLabel} {area}</Text>
        {fallbackUsed && (
          <Text style={styles.fallbackNote}>
            Out of personalized picks — here are some quick ideas worth trying.
          </Text>
        )}
      </View>

      <View style={styles.deckWrap}>
        <SwipeDeck
          ref={deckRef}
          current={current}
          next={next}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleCommit}
          disabled={confirming}
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => deckRef.current?.swipeLeft()}
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          disabled={confirming}
        >
          <Text style={styles.controlText}>Nope</Text>
        </Pressable>
        <View ref={commitButtonRef} onLayout={updateRippleLayout} collapsable={false} style={styles.controlSlot}>
          <Pressable
            onPress={() => deckRef.current?.swipeRight()}
            style={({ pressed }) => [styles.controlButton, styles.controlPrimary, pressed && styles.controlPressed]}
            disabled={confirming}
          >
            <Text style={[styles.controlText, styles.controlTextPrimary]}>Do it</Text>
          </Pressable>
        </View>
      </View>

      {current.type !== 'EVENT' && (
        <Pressable
          onPress={() => setLaterVisible(true)}
          style={({ pressed }) => [styles.laterButton, pressed && styles.laterPressed]}
          disabled={confirming}
        >
          <Text style={styles.laterText}>Schedule for later</Text>
        </Pressable>
      )}

      {confirming && (
        <View style={styles.confirmation}>
          <Text style={styles.confirmationText}>This is the plan.</Text>
        </View>
      )}
      {confirming && rippleConfig && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ripple,
            {
              left: rippleConfig.left,
              top: rippleConfig.top,
              width: rippleConfig.size,
              height: rippleConfig.size,
              borderRadius: rippleConfig.size / 2,
              transform: [{ scale: ripple }],
            },
          ]}
        />
      )}
      <EmojiConfetti visible={confirming} emojis={confettiEmojis} />

      <Modal
        transparent
        visible={laterVisible}
        animationType="fade"
        onRequestClose={() => setLaterVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setLaterVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Schedule for later</Text>
            <Text style={styles.modalSubtitle}>Pick a time. We will add it to your calendar.</Text>
            <View style={styles.modalOptions}>
              {laterOptions.map((option) => (
                <Pressable
                  key={option.id}
                  style={styles.modalOption}
                  onPress={() => scheduleLater(option.offsetMin)}
                >
                  <Text style={styles.modalOptionText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setLaterVisible(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  header: {
    marginTop: theme.spacing.lg,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  headerText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
  },
  fallbackNote: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  deckWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  laterButton: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  laterPressed: {
    opacity: 0.7,
  },
  laterText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  controlButton: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  controlSlot: {
    flex: 1,
  },
  controlPrimary: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  controlPressed: {
    transform: [{ scale: 0.98 }],
  },
  controlText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  controlTextPrimary: {
    color: theme.colors.accentText,
  },
  confirmation: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: theme.colors.text,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    zIndex: 3,
  },
  confirmationText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.background,
    fontSize: 16,
  },
  ripple: {
    position: 'absolute',
    backgroundColor: theme.colors.accent,
    zIndex: 2,
  },
  loading: {
    marginTop: theme.spacing.xxl,
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  actions: {
    gap: theme.spacing.md,
  },
  backLink: {
    textAlign: 'center',
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  refineLink: {
    textAlign: 'center',
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
  },
  modalSubtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  modalOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  modalOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.colors.backgroundAlt,
    borderRadius: theme.radius.sm,
  },
  modalOptionText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  modalCancel: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    textAlign: 'right',
  },
});
