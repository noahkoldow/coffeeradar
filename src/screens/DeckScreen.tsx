import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PrimaryButton } from '../components/PrimaryButton';
import { SwipeDeck, SwipeDeckHandle } from '../components/SwipeDeck';
import { EmojiConfetti } from '../components/EmojiConfetti';
import { DeckLoader } from '../components/DeckLoader';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import ChargeBar from '../components/ChargeBar';
import { RootStackParamList } from '../navigation/types';
import { Availability, Commitment, DeckSuggestion, HistoryState, SavedSuggestion, ScheduledActivity, Suggestion } from '../types';
import { buildDeck, buildFilteredFallbacks } from '../services/suggestions';
import { recordActivityShown, recordActivityCompleted, shouldSuggestHabitConversion } from '../services/activityRepetitionService';
import { recordAccept, recordInterested, recordReject, recordTypeAccept, recordTypeReject, decayAffinities } from '../services/affinity';
import { addMinutes, formatDuration, formatTime, getTimeWindowContext, toISO } from '../utils/time';
import { chooseTravelMode, estimateEtaMinutes, haversineKm } from '../services/travel';
import { createPlanEvent, getAvailabilityForDate, getUpcomingEvents } from '../services/calendar';
import { logEvent } from '../services/analytics';
import { isAdminUser, isBusinessAdmin, syncBusinessMetric } from '../services/user';
import { AD_RULES, buildAdKeywords } from '../services/ads/adConfig';
import { isAdPlaceholderMode, isAdsAvailable } from '../services/ads/mobileAds';
import { consumeVideoAd, preloadVideoAd } from '../services/ads/videoAd';
import { useAdsCompliance } from '../services/ads/consent';
import { VideoAdModal } from '../components/ads/VideoAdModal';
import { selectChallengeCandidates } from '../utils/challengeMode';
import { applyIgnoredEventsToAvailability } from '../utils/availabilityIgnore';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'Deck'>;

export const DeckScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t } = useI18n();
  const { state, actions } = useAppState();
  const adsCompliance = useAdsCompliance();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [isAdmin, setIsAdmin] = useState(() => isBusinessAdmin(state.userEmail));
  const [deck, setDeck] = useState<DeckSuggestion[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [lastSlideIndex, setLastSlideIndex] = useState<number | null>(null);
  const [canUndoSlide, setCanUndoSlide] = useState(false);
  const [confettiEmojis, setConfettiEmojis] = useState<string[]>([]);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [gridUsed, setGridUsed] = useState(false);
  const [outOfSwipesGridVisible, setOutOfSwipesGridVisible] = useState(false);
  const [outOfSwipesGridUnlocked, setOutOfSwipesGridUnlocked] = useState(true);
  const [declinedGridCardIds, setDeclinedGridCardIds] = useState<Set<string>>(new Set());
  const [inspectedGridCard, setInspectedGridCard] = useState<DeckSuggestion | null>(null);
  const [showLoadingBackButton, setShowLoadingBackButton] = useState(false);
  const [timerNow, setTimerNow] = useState<number>(Date.now());
  const planDate = route.params?.planDate ?? 'today';
  const activityMode = useMemo<'all' | 'productive' | 'tomorrow' | 'at_home' | 'challenge_me'>(() => {
    if (planDate === 'tomorrow') return 'tomorrow';
    if (route.params?.filter === 'productive') return 'productive';
    if (route.params?.filter === 'challenge_me') return 'challenge_me';
    if (route.params?.filter === 'at_home') return 'at_home';
    return 'all';
  }, [planDate, route.params?.filter]);

  const INTERVAL_MIN = 30;
  const outOfSwipesBase = !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && deck.length > 0 && !confirming && planDate !== 'tomorrow';
  const controlsDisabled = confirming || (!isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow');
  const overlayVisible = outOfSwipesBase || outOfSwipesGridVisible;

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: false,
    });
  }, [navigation]);

  useEffect(() => {
    let active = true;
    setIsAdmin(isBusinessAdmin(state.userEmail));
    isAdminUser()
      .then((value) => {
        if (active) setIsAdmin(value);
      })
      .catch(() => {
        if (active) setIsAdmin(isBusinessAdmin(state.userEmail));
      });

    return () => {
      active = false;
    };
  }, [state.userEmail, state.userId]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingBackButton(false);
      return undefined;
    }

    setShowLoadingBackButton(false);
    const timeout = setTimeout(() => setShowLoadingBackButton(true), 10_000);
    return () => clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    if (!overlayVisible) return;
    setTimerNow(Date.now());
    const t = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [overlayVisible]);

  const formatMs = (ms: number) => {
    if (ms <= 0) return '00:00';
    const s = Math.ceil(ms / 1000);
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const nextCreditInfo = (() => {
    const last = state.swipeBankLastUpdated ?? Date.now();
    const current = state.swipeBank?.current ?? 0;
    const max = state.swipeBank?.max ?? 20;
    if (current >= max) return { show: false, label: 'Full', countdown: '00:00' };
    const elapsedMin = Math.floor((timerNow - last) / 60000);
    const sinceInterval = elapsedMin % INTERVAL_MIN;
    const minsToNext = INTERVAL_MIN - sinceInterval;
    const nextAt = last + (Math.floor(elapsedMin / INTERVAL_MIN) + 1) * INTERVAL_MIN * 60000;
    const msToNext = Math.max(0, nextAt - timerNow);
    return { show: true, label: '+1', countdown: formatMs(msToNext) };
  })();

  useEffect(() => {
    if ((state.swipeBank?.current ?? 0) > 0) setGridUsed(false);
  }, [state.swipeBank?.current]);

  useEffect(() => {
    if (outOfSwipesBase && outOfSwipesGridUnlocked && !outOfSwipesGridVisible) {
      setOutOfSwipesGridVisible(true);
      setOutOfSwipesGridUnlocked(false);
      return;
    }
    if (!outOfSwipesBase && outOfSwipesGridVisible) {
      setOutOfSwipesGridVisible(false);
    }
  }, [outOfSwipesBase, outOfSwipesGridUnlocked, outOfSwipesGridVisible]);

  useEffect(() => {
    if (deck.length >= DESIRED_SIZE && index >= deck.length && !outOfSwipesGridUnlocked) {
      setOutOfSwipesGridUnlocked(true);
    }
  }, [deck.length, index, outOfSwipesGridUnlocked]);

  const [rippleConfig, setRippleConfig] = useState<{ left: number; top: number; size: number } | null>(null);
  const [laterVisible, setLaterVisible] = useState(false);
  const [customHour, setCustomHour] = useState('');
  const [customMinute, setCustomMinute] = useState('');
  const [clashInfo, setClashInfo] = useState<{ title: string; start: string; end: string } | null>(null);
  const [pendingScheduleStart, setPendingScheduleStart] = useState<Date | null>(null);
  const [schedulePreview, setSchedulePreview] = useState<{
    title: string;
    beforeTitle?: string | null;
    afterTitle?: string | null;
    slotStart: Date;
    slotEnd: Date;
  } | null>(null);
  const [tomorrowAvailability, setTomorrowAvailability] = useState<Availability | null>(null);
  const [tomorrowCalendarEvents, setTomorrowCalendarEvents] = useState<Array<{ title: string; startDate: Date; endDate: Date }>>([]);
  const [savedPopupVisible, setSavedPopupVisible] = useState(false);
  const [heartAnimIds, setHeartAnimIds] = useState<Set<string>>(new Set());
  const [bedtimeNow, setBedtimeNow] = useState<number>(Date.now());
  const bedtimePulse = useRef(new Animated.Value(0)).current;
  const bedtimePulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const deckRef = useRef<SwipeDeckHandle>(null);
  const inspectDeckRef = useRef<SwipeDeckHandle>(null);
  const commitButtonRef = useRef<View>(null);
  const ripple = useRef(new Animated.Value(0)).current;
  const swipeLockRef = useRef(false);
  const historyRef = useRef(state.history);
  const loadingRef = useRef(true); // mirrors `loading` for use in effects
  const didLoadDeck = useRef(false); // true once we successfully showed a deck
  const commitWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiAppear = useRef(new Animated.Value(0)).current;
  const schedulePreviewAnim = useRef(new Animated.Value(0)).current;
  const savedPopupAnim = useRef(new Animated.Value(0)).current;
  const prevIndexRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => setBedtimeNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const isPastBedTime = useMemo(() => {
    const ctx = getTimeWindowContext(
      new Date(bedtimeNow),
      null,
      state.prefs.wakeStartTime ?? '07:00',
      state.prefs.wakeEndTime ?? '23:00',
    );
    return !ctx.isWithinWakeWindow;
  }, [bedtimeNow, state.prefs.wakeEndTime, state.prefs.wakeStartTime]);

  useEffect(() => {
    bedtimePulseLoop.current?.stop();
    bedtimePulse.setValue(1);
    if (!isPastBedTime) {
      return;
    }

    bedtimePulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(bedtimePulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bedtimePulse, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bedtimePulse, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    bedtimePulseLoop.current.start();

    return () => bedtimePulseLoop.current?.stop();
  }, [bedtimePulse, isPastBedTime]);

  useEffect(() => {
    const prevIndex = prevIndexRef.current;
    if (index > prevIndex) {
      setLastSlideIndex(prevIndex);
      setCanUndoSlide(true);
    }
    prevIndexRef.current = index;
  }, [index]);

  useEffect(() => {
    setLastSlideIndex(null);
    setCanUndoSlide(false);
    prevIndexRef.current = 0;
  }, [deck]);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  };
  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    }
  };

  const buildTomorrowFallbackAvailability = useCallback((): Availability => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const end = new Date(tomorrow);
    end.setHours(21, 0, 0, 0);
    return {
      start: toISO(tomorrow),
      end: toISO(end),
      durationMin: Math.max(0, Math.round((end.getTime() - tomorrow.getTime()) / 60000)),
      nextEventTitle: null,
      contextEventTitles: [],
    };
  }, []);

  useEffect(() => {
    if (planDate !== 'tomorrow') {
      setTomorrowAvailability(null);
      setTomorrowCalendarEvents([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayStart = new Date(tomorrow);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(tomorrow);
        dayEnd.setHours(23, 59, 59, 999);

        const availabilityForTomorrow = state.permissions.calendarGranted
          ? await getAvailabilityForDate(tomorrow, state.disabledCalendars)
          : buildTomorrowFallbackAvailability();
        const sanitizedTomorrowAvailability = applyIgnoredEventsToAvailability(
          availabilityForTomorrow,
          state.ignoredExternalEventKeys,
        );

        const dayEvents = state.permissions.calendarGranted
          ? await getUpcomingEvents(dayStart, dayEnd, state.disabledCalendars)
          : [];

        const mergedTitles = [
          ...(sanitizedTomorrowAvailability.contextEventTitles ?? []),
          ...dayEvents.map((event) => event.title),
        ]
          .filter((title, idx, arr) => !!title && arr.indexOf(title) === idx)
          .filter((title) => {
            const normalized = title.trim().toLowerCase();
            if (!normalized) return false;
            if (normalized.startsWith('[all-day]')) {
              const cleanTitle = normalized.replace('[all-day]', '').trim();
              return !state.ignoredExternalEventKeys.includes(`title:${cleanTitle}`);
            }
            return !state.ignoredExternalEventKeys.includes(`title:${normalized}`);
          })
          .slice(0, 12);

        if (!cancelled) {
          setTomorrowAvailability({
            ...sanitizedTomorrowAvailability,
            contextEventTitles: mergedTitles,
          });
          setTomorrowCalendarEvents(dayEvents);
        }
      } catch (error) {
        console.warn('[DeckScreen] tomorrow availability failed', error);
        if (!cancelled) {
          setTomorrowAvailability(buildTomorrowFallbackAvailability());
          setTomorrowCalendarEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [planDate, state.permissions.calendarGranted, state.disabledCalendars, state.ignoredExternalEventKeys, buildTomorrowFallbackAvailability]);

  const availability: Availability = useMemo(() => {
    const ignoredKeys = state.ignoredExternalEventKeys;
    if (planDate === 'tomorrow') {
      if (tomorrowAvailability) {
        const scheduledTitles = state.scheduledActivities
          .filter((item) => {
            const start = new Date(item.startAt);
            const tomorrow = new Date(tomorrowAvailability.start);
            return start.getFullYear() === tomorrow.getFullYear()
              && start.getMonth() === tomorrow.getMonth()
              && start.getDate() === tomorrow.getDate();
          })
          .map((item) => item.title);
        const contextEventTitles = [
          ...(tomorrowAvailability.contextEventTitles ?? []),
          ...scheduledTitles,
        ].filter((title, idx, arr) => !!title && arr.indexOf(title) === idx).slice(0, 12);
        return {
          ...applyIgnoredEventsToAvailability(tomorrowAvailability, ignoredKeys),
          contextEventTitles,
        };
      }
      return applyIgnoredEventsToAvailability(buildTomorrowFallbackAvailability(), ignoredKeys);
    }
    if (state.availability && !route.params?.durationOverride) {
      // The user explicitly tapped "Do something now" — if calendar says 0 min
      // (busy right now), give them at least 15 min so the deck isn't empty.
      const dur = Math.max(state.availability.durationMin, 15);
      if (dur !== state.availability.durationMin) {
        const now = new Date();
        return applyIgnoredEventsToAvailability({
          ...state.availability,
          start: toISO(now),
          end: toISO(addMinutes(now, dur)),
          durationMin: dur,
        }, ignoredKeys);
      }
      return applyIgnoredEventsToAvailability(state.availability, ignoredKeys);
    }
    const now = new Date();
    const durationMin = route.params?.durationOverride ?? 120;
    return applyIgnoredEventsToAvailability({
      start: toISO(now),
      end: toISO(addMinutes(now, durationMin)),
      durationMin,
      nextEventTitle: null,
    }, ignoredKeys);
    // Only recompute when the actual data changes, not every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate, tomorrowAvailability, state.scheduledActivities, state.availability?.durationMin, state.availability?.start, state.ignoredExternalEventKeys, route.params?.durationOverride, buildTomorrowFallbackAvailability]);

  type DayEvent = { title: string; start: number; end: number };

  const tomorrowContextEvents = useMemo<DayEvent[]>(() => {
    if (planDate !== 'tomorrow') return [];
    const windowStart = new Date(availability.start).getTime();
    const windowEnd = new Date(availability.end).getTime();

    const fromCalendar: DayEvent[] = tomorrowCalendarEvents.map((event) => ({
      title: event.title,
      start: Math.max(windowStart, event.startDate.getTime()),
      end: Math.min(windowEnd, event.endDate.getTime()),
    }));

    const fromScheduled: DayEvent[] = state.scheduledActivities.map((item) => ({
      title: item.title,
      start: Math.max(windowStart, new Date(item.startAt).getTime()),
      end: Math.min(windowEnd, new Date(item.endAt).getTime()),
    }));

    return [...fromCalendar, ...fromScheduled]
      .filter((event) => event.end > event.start)
      .sort((a, b) => a.start - b.start);
  }, [planDate, availability.start, availability.end, tomorrowCalendarEvents, state.scheduledActivities]);

  const findBestTomorrowFit = useCallback((durationMin: number): {
    slotStart: Date;
    slotEnd: Date;
    slackMin: number;
    before?: DayEvent;
    after?: DayEvent;
  } | null => {
    if (planDate !== 'tomorrow') return null;

    const windowStart = new Date(availability.start).getTime();
    const windowEnd = new Date(availability.end).getTime();
    const requiredMs = Math.max(durationMin, 10) * 60 * 1000;
    const events = tomorrowContextEvents;

    let cursor = windowStart;
    let previous: DayEvent | undefined;
    type FitCandidate = {
      slotStart: Date;
      slotEnd: Date;
      slackMin: number;
      before?: DayEvent;
      after?: DayEvent;
      score: number;
    };

    let best: FitCandidate | null = null;

    const buildCandidate = (gapStart: number, gapEnd: number, before?: DayEvent, after?: DayEvent): FitCandidate | null => {
      const gapMs = gapEnd - gapStart;
      if (gapMs < requiredMs) return null;
      const slotStartMs = gapStart;
      const slotEndMs = slotStartMs + requiredMs;
      const slackMin = Math.round((gapMs - requiredMs) / 60000);
      const offsetMin = Math.round((slotStartMs - windowStart) / 60000);
      const score = slackMin * 1.5 + offsetMin * 0.08;

      return {
        slotStart: new Date(slotStartMs),
        slotEnd: new Date(slotEndMs),
        slackMin,
        before,
        after,
        score,
      };
    };

    for (const event of events) {
      if (event.start > cursor) {
        const candidate = buildCandidate(cursor, event.start, previous, event);
        if (candidate && (!best || candidate.score < best.score)) {
          best = candidate;
        }
      }
      if (event.end > cursor) {
        cursor = event.end;
        previous = event;
      }
    }

    if (cursor < windowEnd) {
      const candidate = buildCandidate(cursor, windowEnd, previous, undefined);
      if (candidate && (!best || candidate.score < best.score)) {
        best = candidate;
      }
    }

    if (!best) return null;
    const bestFit = best;
    return {
      slotStart: bestFit.slotStart,
      slotEnd: bestFit.slotEnd,
      slackMin: bestFit.slackMin,
      before: bestFit.before,
      after: bestFit.after,
    };
  }, [planDate, availability.start, availability.end, tomorrowContextEvents]);

  const rankTomorrowCards = useCallback((cards: DeckSuggestion[]): DeckSuggestion[] => {
    if (planDate !== 'tomorrow') return cards;

    return cards
      .map((card) => {
        const fit = findBestTomorrowFit(card.durationMin);
        if (!fit) {
          return { card, rank: Number.POSITIVE_INFINITY };
        }
        const rank = fit.slackMin + (fit.slotStart.getTime() - new Date(availability.start).getTime()) / 60000 * 0.08;
        return {
          rank,
          card: {
            ...card,
            meta: {
              ...(card.meta ?? {}),
              planStartAt: fit.slotStart.toISOString(),
              planEndAt: fit.slotEnd.toISOString(),
              planBeforeTitle: fit.before?.title,
              planBeforeEndsAt: fit.before ? new Date(fit.before.end).toISOString() : undefined,
              planAfterTitle: fit.after?.title,
              planAfterStartsAt: fit.after ? new Date(fit.after.start).toISOString() : undefined,
            },
          },
        };
      })
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.card);
  }, [planDate, findBestTomorrowFit, availability.start]);

  /** Record all card IDs from a deck using smart repetition tracking */
  const recordShown = useCallback((cards: DeckSuggestion[]) => {
    if (!cards.length) return;
    const now = new Date();
    let current = historyRef.current;
    
    // Update history with lastShownDates (new system) and maintain lastShownIds for fallback compatibility
    const newIds = cards.map((c) => c.id);
    const existing = current.lastShownIds ?? [];
    const merged = [...newIds, ...existing];
    
    // Record each card's shown timestamp for smart repetition filtering
    for (const card of cards) {
      current = recordActivityShown(card.id, current, now);
    }
    
    // Maintain lastShownIds for backwards compatibility with fallback logic
    const updated: HistoryState = {
      ...current,
      lastShownIds: [...new Set(merged)].slice(0, 500),
    };
    actions.setHistory(updated);
    historyRef.current = updated;

    const businessShown = cards.filter((card) => card.source === 'business').slice(0, 3);
    for (const item of businessShown) {
      logEvent('business_impression', {
        suggestion_id: item.id,
        business_id: item.businessId ?? null,
        title: item.title,
      });
      void syncBusinessMetric(item.businessId, 'impressions', 1);
    }
  }, [actions]);

  /** Filter a deck based on the route filter param */
  const filterDeck = useCallback((cards: DeckSuggestion[]): DeckSuggestion[] => {
    const f = route.params?.filter;
    if (!f) return cards;
    if (f === 'go_out') return cards.filter((c) => c.type === 'GO_OUT' || c.type === 'EVENT');
    if (f === 'at_home') return cards.filter((c) => c.type === 'AT_HOME');
    if (f === 'productive') {
      const prodTags = new Set(['productivity', 'learning', 'creative', 'focus', 'planning', 'work', 'study', 'reading']);
      return cards.filter((c) => c.tags?.some((t) => prodTags.has(t)));
    }
    if (f === 'challenge_me') {
      const challengeCards = selectChallengeCandidates(
        cards,
        {
          interestTags: state.prefs.interestTags,
          customInterests: state.prefs.customInterests,
        },
        { minStrict: 3, minReturn: 3 },
      );
      return challengeCards;
    }
    return cards;
  }, [route.params?.filter]);

  const DESIRED_SIZE = 5;

  /* ── Ads (free users only) ─────────────────────────────────
   * Native ad slides are injected into every 2nd deck at a random slot 2–5.
   * A full-screen video ad plays on every 2nd "new set" request. */
  const adsFreeUser = !state.isPremium
    && !isAdmin
    && planDate !== 'tomorrow'
    && ((isAdsAvailable && adsCompliance.initialized && adsCompliance.canRequestAds) || isAdPlaceholderMode);
  const adKeywords = useMemo(
    () => buildAdKeywords(state.prefs, state.location, activityMode),
    [state.prefs, state.location, activityMode],
  );
  const deckPresentCountRef = useRef(0);
  const [newSetCount, setNewSetCount] = useState(0);
  const nextNewSetPlaysAd = adsFreeUser && (newSetCount + 1) % AD_RULES.videoEveryNthNewSet === 0;
  const [videoAd, setVideoAd] = useState<any>(null);
  const videoAdResolveRef = useRef<(() => void) | null>(null);

  const isAdCard = (card: DeckSuggestion | null | undefined): boolean => card?.source === 'ad';

  /** Insert a native ad slide into decks per the cadence rules. */
  const injectAdsIntoDeck = useCallback((cards: DeckSuggestion[]): DeckSuggestion[] => {
    if (!adsFreeUser || cards.length === 0) return cards;
    deckPresentCountRef.current += 1;
    // Every Nth deck starting with the first (1st, 3rd, 5th … for N = 2).
    const isAdDeck = (deckPresentCountRef.current - 1) % AD_RULES.nativeEveryNthDeck === 0;
    if (!isAdDeck) return cards;

    const withAd = [...cards];
    const maxSlot = Math.min(AD_RULES.nativeSlotMax, withAd.length + 1);
    const minSlot = Math.min(AD_RULES.nativeSlotMin, maxSlot);
    const slot = Math.floor(Math.random() * (maxSlot - minSlot + 1)) + minSlot; // 1-based
    const insertIndex = Math.max(0, slot - 1);
    const adCard: DeckSuggestion = {
      id: `ad_native_${Date.now()}`,
      type: 'AT_HOME',
      source: 'ad',
      title: 'Sponsored',
      description: '',
      durationMin: 0,
      confidence: 0,
      adKeywords,
    };
    withAd.splice(insertIndex, 0, adCard);
    logEvent('ad_slide_inserted', { slot, deck_number: deckPresentCountRef.current });
    return withAd;
  }, [adsFreeUser, adKeywords]);

  // Preload the first video ad for free users so it is ready on demand.
  useEffect(() => {
    if (adsFreeUser) preloadVideoAd(adKeywords);
  }, [adsFreeUser, adKeywords]);

  /** Build deck with filter applied — keeps rebuilding until we have 5 or exhaust retries.
   *  When a filter is active, pads remaining slots from a filter-aware fallback pool
   *  so the user always gets a full 5-card deck when possible. */
  const buildFilteredDeck = useCallback(async (): Promise<{ deck: DeckSuggestion[]; usedFallback: boolean }> => {
    const collected: DeckSuggestion[] = [];
    let usedFallback = false;
    const maxAttempts = route.params?.filter ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts && collected.length < DESIRED_SIZE; attempt++) {
      const result = await buildDeck(
        availability,
        state.location,
        state.prefs,
        historyRef.current,
        state.habits,
        state.smartTodos,
        undefined,
        state.tagAffinities,
        state.locationProfile,
        route.params?.filter,
        state.savedSuggestions,
        state.sessionActivityIntent,
        state.userId,
        planDate === 'tomorrow' ? new Date(availability.start) : undefined,
      );

      usedFallback = usedFallback || result.usedFallback;
      const filtered = filterDeck(result.deck);
      for (const card of filtered) {
        if (collected.length >= DESIRED_SIZE) break;
        if (!collected.find((c) => c.id === card.id)) {
          collected.push(card);
        }
      }
    }

    // Pad remaining slots from a dedicated filter-aware fallback pool
    if (collected.length < DESIRED_SIZE && route.params?.filter) {
      const collectedIds = new Set(collected.map((c) => c.id));
      const seenIds = new Set([
        ...(historyRef.current.lastShownIds ?? []),
        ...historyRef.current.lastRejectedIds,
        ...historyRef.current.lastAcceptedIds,
      ]);
      const extras = buildFilteredFallbacks(
        route.params.filter,
        availability,
        state.location,
        new Set([...collectedIds, ...seenIds]),
      );
      for (const card of extras) {
        if (collected.length >= DESIRED_SIZE) break;
        collected.push(card);
        usedFallback = true;
      }
      // Last resort: allow previously-seen cards
      if (collected.length < DESIRED_SIZE) {
        const nowIds = new Set(collected.map((c) => c.id));
        const lastResort = buildFilteredFallbacks(
          route.params.filter,
          availability,
          state.location,
          nowIds,
        );
        for (const card of lastResort) {
          if (collected.length >= DESIRED_SIZE) break;
          collected.push(card);
          usedFallback = true;
        }
      }
    }
    const trimmed = collected.slice(0, DESIRED_SIZE);
    const ranked = rankTomorrowCards(trimmed);
    return { deck: ranked, usedFallback };
  }, [availability, state.location, state.prefs, state.habits, filterDeck, route.params?.filter, planDate, rankTomorrowCards]);

  /** Apply a deck result to local state */
  const applyDeck = useCallback((result: { deck: DeckSuggestion[]; usedFallback: boolean }, preloaded: boolean) => {
    const filtered = filterDeck(result.deck);
    console.log('[DeckScreen] applyDeck:', result.deck.length, 'cards →', filtered.length, 'after filter, preloaded:', preloaded);
    setDeck(injectAdsIntoDeck(filtered.slice(0, DESIRED_SIZE)));
    setFallbackUsed(result.usedFallback);
    setIndex(0);
    setLoading(false);
    loadingRef.current = false;
    didLoadDeck.current = true;
    recordShown(filtered);
    logEvent('deck_shown', { freeWindowDuration: availability.durationMin, preloaded, filter: route.params?.filter ?? 'all' });
  }, [availability.durationMin, recordShown, filterDeck, route.params?.filter, injectAdsIntoDeck]);

  /**
   * Single effect that handles all deck-loading scenarios:
   * 1. Preloaded deck already available → use it immediately
   * 2. Preload still running → wait (show loader); the effect re-runs when it finishes
   * 3. Preload finished but empty/failed → build fresh
   * 4. No preload at all → build fresh
   */
  useEffect(() => {
    // Already loaded a deck — nothing to do
    if (didLoadDeck.current) return;

    // 1. Try consuming a ready preloaded deck (only when no filter or enough filtered cards)
    if (planDate !== 'tomorrow' && state.preloadedDeck && state.preloadedDeck.deck.length > 0) {
      const result = actions.consumeDeck();
      if (result && result.deck.length > 0) {
        const filtered = filterDeck(result.deck);
        if (!route.params?.filter || filtered.length >= DESIRED_SIZE) {
          applyDeck(result, true);
          return;
        }
        // Not enough filtered cards from preload — fall through to build fresh
      }
    }

    // 2. Preload is still running — stay on loading screen, effect will
    //    re-fire when deckLoading or preloadedDeck changes.
    if (planDate !== 'tomorrow' && state.deckLoading && !route.params?.filter) {
      console.log('[DeckScreen] preload in progress, waiting...');
      return;
    }

    // 3 & 4. No preload running, nothing ready — build fresh with filter-aware retry
    console.log('[DeckScreen] building fresh deck...');
    let cancelled = false;

    (async () => {
      try {
        const result = await buildFilteredDeck();
        if (!cancelled) {
          setDeck(injectAdsIntoDeck(result.deck));
          setFallbackUsed(result.usedFallback);
          setIndex(0);
          setLoading(false);
          loadingRef.current = false;
          didLoadDeck.current = true;
          recordShown(result.deck);
          logEvent('deck_shown', { freeWindowDuration: availability.durationMin, preloaded: false, filter: route.params?.filter ?? 'all' });
        }
      } catch (error) {
        console.warn('[DeckScreen] buildDeck error', error);
        if (!cancelled) {
          setDeck([]);
          setLoading(false);
          loadingRef.current = false;
          didLoadDeck.current = true;
        }
      }
    })();

    return () => { cancelled = true; };
  }, [planDate, state.preloadedDeck, state.deckLoading, availability, state.location, state.prefs, state.habits, actions, applyDeck, buildFilteredDeck, filterDeck, recordShown, route.params?.filter]);

  // Always-fresh rebuild for "New set" button
  const rebuildDeck = useCallback(async () => {
    // First try the preloaded deck (it had full API time in the background)
    const preloaded = planDate !== 'tomorrow' ? actions.consumeDeck() : null;
    if (preloaded && preloaded.deck.length > 0) {
      const filtered = filterDeck(preloaded.deck);
      if (filtered.length >= DESIRED_SIZE) {
        applyDeck(preloaded, true);
        return;
      }
    }

    // Build fresh with filter-aware retry logic
    setLoading(true);
    loadingRef.current = true;
    try {
      const result = await buildFilteredDeck();
      setDeck(injectAdsIntoDeck(result.deck));
      setFallbackUsed(result.usedFallback);
      setIndex(0);
      recordShown(result.deck);
    } catch (error) {
      console.warn('Deck error', error);
      setDeck([]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [planDate, filterDeck, buildFilteredDeck, recordShown, actions, applyDeck, injectAdsIntoDeck]);

  /** "New set" entry point — plays a video ad on every 2nd request for free
   *  users, while the fresh deck builds/queues in the background. */
  const handleNewSet = useCallback(async () => {
    const willPlayAd = adsFreeUser && (newSetCount + 1) % AD_RULES.videoEveryNthNewSet === 0;
    setNewSetCount((c) => c + 1);
    // Kick off the deck build immediately so it is ready right after the ad.
    const buildPromise = rebuildDeck();
    if (willPlayAd) {
      const ad = consumeVideoAd(adKeywords);
      if (ad) {
        logEvent('ad_video_shown', { new_set_number: newSetCount + 1 });
        await new Promise<void>((resolve) => {
          videoAdResolveRef.current = resolve;
          setVideoAd(ad);
        });
      } else {
        // Nothing ready — warm one up for next time and continue.
        preloadVideoAd(adKeywords);
      }
    }
    await buildPromise;
  }, [adsFreeUser, newSetCount, rebuildDeck, adKeywords]);

  const closeVideoAd = useCallback(() => {
    setVideoAd(null);
    videoAdResolveRef.current?.();
    videoAdResolveRef.current = null;
  }, []);

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

  useEffect(() => {
    if (loading) return;
    uiAppear.setValue(0);
    Animated.timing(uiAppear, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [loading, index, uiAppear]);

  useEffect(() => () => {
    if (commitWatchdogRef.current) {
      clearTimeout(commitWatchdogRef.current);
      commitWatchdogRef.current = null;
    }
  }, []);

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

  const playSchedulePreview = useCallback(async (picked: DeckSuggestion, slotStart: Date, slotEnd: Date) => {
    if (planDate !== 'tomorrow') return;
    setSchedulePreview({
      title: picked.title,
      beforeTitle: picked.meta?.planBeforeTitle,
      afterTitle: picked.meta?.planAfterTitle,
      slotStart,
      slotEnd,
    });
    schedulePreviewAnim.setValue(0);
    Animated.timing(schedulePreviewAnim, {
      toValue: 1,
      duration: 320,
      useNativeDriver: true,
    }).start();
    await new Promise((resolve) => setTimeout(resolve, 420));
  }, [planDate, schedulePreviewAnim]);

  const current = deck[index] ?? null;
  const next = deck[index + 1] ?? null;

  const openGridCard = useCallback((card: DeckSuggestion) => {
    if (gridUsed) {
      Alert.alert(t('deck_already_used_title'), t('deck_already_used_body'));
      return;
    }
    if (declinedGridCardIds.has(card.id)) {
      return;
    }
    setInspectedGridCard(card);
  }, [declinedGridCardIds, gridUsed, t]);

  const acceptInspectedCard = useCallback((card: DeckSuggestion) => {
    if (gridUsed) {
      Alert.alert(t('deck_already_used_title'), t('deck_already_used_body'));
      return;
    }

    const now = new Date();
    const startDate = new Date(now);
    const endDate = addMinutes(startDate, card.durationMin);
    const commitment: Commitment = {
      suggestionId: card.id,
      type: card.type,
      title: card.title,
      startAt: startDate.toISOString(),
      endAt: endDate.toISOString(),
    };

    setGridUsed(true);
    setInspectedGridCard(null);

    if (navigation.canGoBack()) {
      navigation.navigate('Plan', { commitment, suggestion: card, fromDoSomethingNow: planDate !== 'tomorrow', activityMode });
    } else {
      navigation.replace('Plan', { commitment, suggestion: card, fromDoSomethingNow: planDate !== 'tomorrow', activityMode });
    }
  }, [activityMode, gridUsed, navigation, planDate, t]);

  const declineInspectedCard = useCallback(() => {
    if (inspectedGridCard) {
      setDeclinedGridCardIds((prev) => {
        const nextIds = new Set(prev);
        nextIds.add(inspectedGridCard.id);
        return nextIds;
      });
    }
    setInspectedGridCard(null);
  }, [inspectedGridCard]);

  const saveInspectedSuggestion = useCallback((card: DeckSuggestion) => {
    if (isAdCard(card)) return;
    setHeartAnimIds((prev) => new Set([...prev, card.id]));
    actions.saveSuggestion({
      id: `saved_${card.id}_${Date.now()}`,
      savedAt: new Date().toISOString(),
      source: 'interest_signal',
      suggestion: card,
    });
    if (card.tags?.length) {
      let aff = decayAffinities(state.tagAffinities, new Date().toISOString());
      aff = recordInterested(aff, card.tags);
      aff = recordTypeAccept(aff, card.type);
      actions.setTagAffinities(aff);
    }
    logEvent('save_for_later', { suggestion_id: card.id, type: card.type, source: 'interest_signal' });
    setSavedPopupVisible(true);
    savedPopupAnim.setValue(0);
    Animated.sequence([
      Animated.spring(savedPopupAnim, { toValue: 1, tension: 100, friction: 9, useNativeDriver: true }),
      Animated.timing(savedPopupAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => setSavedPopupVisible(false));
  }, [actions, savedPopupAnim, state.tagAffinities]);

  const saveCurrentSuggestion = (source: SavedSuggestion['source'], moveToNext = false) => {
    if (!current) return;
    actions.saveSuggestion({
      id: `saved_${current.id}_${Date.now()}`,
      savedAt: new Date().toISOString(),
      source,
      suggestion: current,
    });
    if (current.tags?.length) {
      let aff = decayAffinities(state.tagAffinities, new Date().toISOString());
      aff = recordInterested(aff, current.tags);
      aff = recordTypeAccept(aff, current.type);
      actions.setTagAffinities(aff);
    }
    logEvent('save_for_later', { suggestion_id: current.id, type: current.type, source });
    if (moveToNext) {
      setIndex((prev) => prev + 1);
    }
  };

  const handleSwipeLeft = () => {
    if (!current) return;
    if (swipeLockRef.current) return;
    // Ad slides carry no cost and record no signals — just advance.
    if (isAdCard(current)) {
      swipeLockRef.current = true;
      setIndex((prev) => prev + 1);
      return;
    }
    swipeLockRef.current = true;
    // consume swipe from bank (unless Plan Ahead mode or admin)
    if (planDate !== 'tomorrow' && !isAdmin && !actions.spendSwipe()) {
      swipeLockRef.current = false;
      Alert.alert(t('deck_no_swipes_title'), t('deck_no_swipes_body'));
      return;
    }

    // Advance index immediately — zero lag for the next card
    setIndex((prev) => prev + 1);

    // Fire-and-forget: history, affinity, analytics in the background
    const swiped = current;
    const updated = {
      ...state.history,
      lastRejectedIds: [swiped.id, ...state.history.lastRejectedIds].slice(0, 200),
    };
    actions.setHistory(updated);
    if (swiped.tags?.length) {
      let aff = decayAffinities(state.tagAffinities, new Date().toISOString());
      aff = recordReject(aff, swiped.tags);
      aff = recordTypeReject(aff, swiped.type);
      actions.setTagAffinities(aff);
    }
    logEvent('swipe_left', { suggestion_id: swiped.id, type: swiped.type });
  };

  const handleUndoSlide = () => {
    if (!canUndoSlide || lastSlideIndex === null || confirming || swipeLockRef.current) return;
    const maxIndex = Math.max(deck.length - 1, 0);
    const targetIndex = Math.max(0, Math.min(lastSlideIndex, maxIndex));
    setIndex(targetIndex);
    setCanUndoSlide(false);
    setLastSlideIndex(null);
  };

  // Quick-save the current suggestion to the library and advance the deck
  const handleSaveQuick = () => {
    if (!current) return;
    if (swipeLockRef.current) return;
    // Ad slides cannot be saved — just advance.
    if (isAdCard(current)) {
      swipeLockRef.current = true;
      setIndex((prev) => prev + 1);
      return;
    }
    swipeLockRef.current = true;

    // Show heart animation
    setHeartAnimIds((prev) => new Set([...prev, current.id]));
    
    // Use existing save flow which records affinities and analytics
    saveCurrentSuggestion('interest_signal', false);
    
    // Show saved popup
    setSavedPopupVisible(true);
    savedPopupAnim.setValue(0);
    Animated.sequence([
      Animated.spring(savedPopupAnim, { toValue: 1, tension: 100, friction: 9, useNativeDriver: true }),
      Animated.timing(savedPopupAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setSavedPopupVisible(false);
      setIndex((prev) => prev + 1);
      swipeLockRef.current = false;
    });
    
  };

  const buildNotes = (suggestion: DeckSuggestion, leaveBy?: string | null) => {
    if (suggestion.type === 'AT_HOME') {
      return `${suggestion.description}\n\nSteps:\n${(suggestion.steps || [])
        .map((step) => `- ${step.label} (${step.minutes}m)`).join('\n')}`;
    }
    if (suggestion.type === 'GO_OUT') {
      return `${suggestion.description}\n${suggestion.place?.address ?? ''}\nLeave by: ${
        leaveBy ? formatTime(new Date(leaveBy)) : 'soon'
      } (public transport)`;
    }
    if (suggestion.type === 'EVENT' && suggestion.event) {
      return `${suggestion.event.venue}\nTickets: ${suggestion.event.ticketUrl}`;
    }
    return suggestion.description;
  };

  const commitSuggestion = async (mode: 'now' | 'later', startOverride?: Date) => {
    if (!current) return;
    if (confirming || swipeLockRef.current) return;
    const picked = current;
    swipeLockRef.current = true;
    // consume swipe from bank (skipped for admin)
    if (!isAdmin && !actions.spendSwipe()) {
      swipeLockRef.current = false;
      Alert.alert(t('deck_no_swipes_title'), t('deck_no_swipes_body'));
      return;
    }
    setConfettiEmojis(picked.emojis && picked.emojis.length ? picked.emojis : ['✨', '🎉', '⭐']);
    setConfirming(true);
    if (commitWatchdogRef.current) clearTimeout(commitWatchdogRef.current);
    commitWatchdogRef.current = setTimeout(() => {
      setConfirming(false);
      swipeLockRef.current = false;
      Alert.alert(t('deck_slow_title'), t('deck_slow_body'));
    }, 8000);
    triggerRipple();
    try {
      await withTimeout(logEvent(mode === 'later' ? 'schedule_later_commit' : 'swipe_right_commit', {
        suggestion_id: picked.id,
        type: picked.type,
      }), 1500, undefined);
      if (picked.source === 'business') {
        await withTimeout(logEvent('business_click', {
          suggestion_id: picked.id,
          business_id: picked.businessId ?? null,
          action: mode === 'later' ? 'schedule_later' : 'commit',
        }), 1200, undefined);
        void syncBusinessMetric(picked.businessId, 'clicks', 1);
      }
      await withTimeout(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 1200, undefined);

      const now = new Date();
      let startDate = startOverride ?? addMinutes(now, 2);
      let endDate = addMinutes(startDate, picked.durationMin);
      let title = picked.title;
      let leaveBy = picked.meta?.leaveBy;

      if (picked.type === 'AT_HOME') {
        title = `Plan: ${picked.title}`;
        if (startOverride) {
          startDate = startOverride;
          endDate = addMinutes(startDate, picked.durationMin);
        }
      }

      if (picked.type === 'GO_OUT') {
        title = `Plan: ${picked.place?.name ?? picked.title}`;
        if (startOverride) {
          startDate = startOverride;
          endDate = addMinutes(startDate, picked.durationMin);
          leaveBy = startOverride.toISOString();
        } else {
          // Calculate PT-aware departure: walk to stop + wait + ride
          let etaMin = picked.meta?.etaMin ?? 15;
          if (state.location.lat && state.location.lng && picked.place?.lat && picked.place?.lng) {
            const dist = haversineKm(state.location.lat, state.location.lng, picked.place.lat, picked.place.lng);
            const mode = chooseTravelMode(dist);
            etaMin = estimateEtaMinutes(dist, mode);
          }
          // Leave in 3 minutes (time to get ready), arrive after transit ETA
          const leaveAt = addMinutes(now, 3);
          startDate = addMinutes(leaveAt, etaMin);
          endDate = addMinutes(startDate, picked.durationMin);
          leaveBy = leaveAt.toISOString();
        }
      }

      if (picked.type === 'EVENT' && picked.event) {
        title = `Event: ${picked.title}`;
        startDate = new Date(picked.event.startAt);
        endDate = addMinutes(startDate, picked.durationMin || 120);
      }

      if (planDate === 'tomorrow' && mode === 'later') {
        await playSchedulePreview(picked, startDate, endDate);
      }

      const notes = buildNotes(picked, leaveBy);
      let calendarEventId: string | undefined;
      let calendarWriteFailed = !state.permissions.calendarGranted;

      try {
        if (state.permissions.calendarGranted) {
          calendarEventId = await withTimeout(createPlanEvent({
            title,
            startDate,
            endDate,
            notes,
          }), 3500, '');
          if (!calendarEventId) throw new Error('Calendar write timeout');
          await withTimeout(logEvent('calendar_event_created_success'), 1500, undefined);
          calendarWriteFailed = false;
        }
      } catch (error) {
        calendarWriteFailed = true;
        await withTimeout(logEvent('calendar_event_created_fail'), 1500, undefined);
      }

      const commitment: Commitment = {
        suggestionId: picked.id,
        type: picked.type,
        title: picked.title,
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        leaveBy,
        ticketUrl: picked.event?.ticketUrl,
        calendarEventId,
        calendarWriteFailed,
      };

      const updatedActivityHistory = recordActivityCompleted(picked.id, state.history);
      const updatedHistory = {
        ...updatedActivityHistory,
        lastAcceptedIds: [picked.id, ...updatedActivityHistory.lastAcceptedIds].slice(0, 200),
      };
      actions.setHistory(updatedHistory);

      if (picked.tags?.length) {
        let aff = decayAffinities(state.tagAffinities, new Date().toISOString());
        aff = recordAccept(aff, picked.tags);
        aff = recordTypeAccept(aff, picked.type);
        actions.setTagAffinities(aff);
      }

      void logEvent('suggestion_reward', {
        suggestion_id: picked.id,
        type: picked.type,
        source: picked.source ?? 'unknown',
        reward: mode === 'later' ? 'commit_later' : 'commit_now',
      }).catch(() => undefined);

      // Check if activity should be suggested as a habit (3+ completions)
      const completionCount = (updatedHistory.completedActivityIds?.[picked.id] ?? 0);
      if (shouldSuggestHabitConversion(picked.id, completionCount)) {
        // Activity has been completed 3+ times - ready to become a habit
        // TODO: Show "Make this a habit?" dialog or card
        // For now, log it for debugging
        console.log(`[Habit Conversion] Activity "${picked.title}" ready to convert (${completionCount} completions)`);
      }

      // Record tag affinity: strong boost for accepted tags
      if (picked.tags?.length) {
        let aff = decayAffinities(state.tagAffinities, new Date().toISOString());
        aff = recordAccept(aff, picked.tags);
        aff = recordTypeAccept(aff, picked.type);
        actions.setTagAffinities(aff);
      }

      if (commitWatchdogRef.current) {
        clearTimeout(commitWatchdogRef.current);
        commitWatchdogRef.current = null;
      }
      setConfirming(false);
      setSchedulePreview(null);
      swipeLockRef.current = false;
      if (mode === 'later') {
        // Save as scheduled activity — user will start it from the dashboard
        const scheduled: ScheduledActivity = {
          id: `sched_${Date.now()}`,
          suggestionId: picked.id,
          title: picked.title,
          description: picked.description,
          durationMin: picked.durationMin,
          startAt: startDate.toISOString(),
          endAt: endDate.toISOString(),
          type: picked.type,
          activityMode,
          tags: picked.tags,
          calendarEventId,
          suggestion: picked,
          commitment,
        };
        actions.addScheduledActivity(scheduled);
        // Skip to next card instead of leaving to Plan
        setIndex((prev) => prev + 1);
      } else {
        if (navigation.canGoBack()) {
          navigation.navigate('Plan', { commitment, suggestion: picked, fromDoSomethingNow: planDate !== 'tomorrow', activityMode });
        } else {
          navigation.replace('Plan', { commitment, suggestion: picked, fromDoSomethingNow: planDate !== 'tomorrow', activityMode });
        }
      }
    } catch (error) {
      console.warn('[DeckScreen] commitSuggestion failed', error);
      if (commitWatchdogRef.current) {
        clearTimeout(commitWatchdogRef.current);
        commitWatchdogRef.current = null;
      }
      setConfirming(false);
      setSchedulePreview(null);
      swipeLockRef.current = false;
      Alert.alert(t('deck_could_not_open_plan_title'), t('deck_could_not_open_plan_body'));
    }
  };

  const handleCommit = async () => {
    // Ad slides have no commit action — advance past them.
    if (isAdCard(current)) {
      setIndex((prev) => prev + 1);
      return;
    }
    if (planDate === 'tomorrow') {
      if (!current) return;
      const suggested = current.meta?.planStartAt ? new Date(current.meta.planStartAt) : null;
      const computed = findBestTomorrowFit(current.durationMin);
      const slot = computed?.slotStart ?? (suggested && !Number.isNaN(suggested.getTime()) ? suggested : null);
      if (!slot) {
        Alert.alert(t('deck_tomorrow_full_title'), t('deck_tomorrow_full_body'));
        return;
      }
      await commitSuggestion('later', slot);
      return;
    }
    await commitSuggestion('now');
  };

  const laterOptions = [
    { id: '30', label: 'In 30m', offsetMin: 30 },
    { id: '60', label: 'In 1h', offsetMin: 60 },
    { id: '120', label: 'In 2h', offsetMin: 120 },
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

  const checkClashAndSchedule = async (startDate: Date) => {
    if (!current) return;
    const endDate = addMinutes(startDate, current.durationMin);

    // Also check against already-scheduled activities
    const localClash = state.scheduledActivities.find((sa) => {
      const saStart = new Date(sa.startAt).getTime();
      const saEnd = new Date(sa.endAt).getTime();
      return startDate.getTime() < saEnd && endDate.getTime() > saStart;
    });
    if (localClash) {
      setClashInfo({
        title: localClash.title,
        start: formatTime(new Date(localClash.startAt)),
        end: formatTime(new Date(localClash.endAt)),
      });
      setPendingScheduleStart(startDate);
      return;
    }

    // Check calendar events
    if (state.permissions.calendarGranted) {
      try {
        const events = await getUpcomingEvents(startDate, endDate, state.disabledCalendars);
        if (events.length > 0) {
          const clash = events[0];
          setClashInfo({
            title: clash.title,
            start: formatTime(clash.startDate),
            end: formatTime(clash.endDate),
          });
          setPendingScheduleStart(startDate);
          return;
        }
      } catch { /* proceed without clash check */ }
    }

    // No clash — proceed
    await doScheduleLater(startDate);
  };

  const doScheduleLater = async (startDate: Date) => {
    setClashInfo(null);
    setPendingScheduleStart(null);
    setLaterVisible(false);
    await commitSuggestion('later', startDate);
  };

  const resolveCustomTime = (): Date | null => {
    const h = parseInt(customHour, 10);
    const m = parseInt(customMinute || '0', 10);
    if (isNaN(h) || h < 0 || h > 23) return null;
    if (isNaN(m) || m < 0 || m > 59) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    // If the chosen time is earlier than now, move to tomorrow
    if (d.getTime() <= Date.now()) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  };

  const scheduleLater = async (offsetMin: number | null) => {
    const startDate = resolveLaterStart(offsetMin);
    await checkClashAndSchedule(startDate);
  };

  if (loading) {
    const deckTypeMap = {
      'today': 'do_now' as const,
      'tomorrow': 'plan_tomorrow' as const,
    };
    const deckType = route.params?.filter === 'productive' ? 'productive' 
      : route.params?.filter === 'challenge_me' ? 'challenge_me'
      : route.params?.filter === 'at_home' ? 'homebody'
      : deckTypeMap[planDate] ?? 'do_now';
    
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={styles.container}>
        <View style={styles.loadingContent}>
          <DeckLoader deckType={deckType} />
          {showLoadingBackButton && (
            <View style={styles.loadingBackButtonWrap}>
              <PrimaryButton
                label={t('deck_back_home')}
                onPress={() => {
                  setLoading(false);
                  setShowLoadingBackButton(false);
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }}
                variant="muted"
              />
            </View>
          )}
        </View>
        <VideoAdModal ad={videoAd} onClose={closeVideoAd} />
      </LinearGradient>
    );
  }

  // Map deck type to display colors (from HomeScreen)
  const getDeckColors = () => {
    const filter = route.params?.filter;
    if (filter === 'productive') {
      return theme.isDark
        ? { bg: '#2A4A5E', text: '#D8F0FF' }
        : { bg: '#A8D8EA', text: '#1A3A4A' };
    }
    if (filter === 'challenge_me') {
      return theme.isDark
        ? { bg: '#4D2E66', text: '#F0E3FF' }
        : { bg: '#D7B9F1', text: '#3E2257' };
    }
    if (filter === 'at_home') {
      return theme.isDark
        ? { bg: '#54374A', text: '#F5DDED' }
        : { bg: '#E2B6CF', text: '#3A1A2E' };
    }
    if (planDate === 'tomorrow') {
      return theme.isDark
        ? { bg: '#2E4F45', text: '#D9F6EA' }
        : { bg: '#B5EAD7', text: '#1A4A3A' };
    }
    return { bg: theme.colors.accent, text: theme.colors.accentText };
  };
  const deckColors = getDeckColors();
  const bedtimeBadgeColor = deckColors.bg;

  if (!current) {
    const ranOutEarly = deck.length < DESIRED_SIZE;
    
    // Auto-trigger rebuild on Plan Tomorrow if empty
    if (planDate === 'tomorrow' && !loading) {
      return (
        <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={styles.container}>
          <DeckLoader />
        </LinearGradient>
      );
    }
    
    // Allow a first tap anywhere on the empty area to queue a fresh deck
    return (
      <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={styles.container}>
        <Pressable style={styles.emptyState} onPress={handleNewSet}>
          <Text style={styles.title}>{t('smart_nothing_clicked')}</Text>
          <Text style={styles.subtitle}>
            {ranOutEarly
              ? 'We ran out of matching activities. Try expanding your interests for more variety!'
              : t('smart_want_new_set')}
          </Text>
          <View style={styles.actions}>
            <PrimaryButton label={nextNewSetPlaysAd ? `${t('smart_new_set')}  (▶)` : t('smart_new_set')} onPress={handleNewSet} />
            <Pressable onPress={() => navigation.navigate('Settings', { fromRefine: true })}>
              <Text style={styles.refineLink}>
                {ranOutEarly ? '⚙️  Expand your interests' : 'Refine what to do'}
              </Text>
            </Pressable>
            <Pressable onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}>
              <Text style={styles.backLink}>{t('deck_back_home')}</Text>
            </Pressable>
          </View>
        </Pressable>
        <VideoAdModal ad={videoAd} onClose={closeVideoAd} deckColors={deckColors} />
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.background]} style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}>
      <Animated.View
        style={[{
          opacity: uiAppear,
          transform: [
            {
              translateY: uiAppear.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        }, styles.mainContent]}
      >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => {
              Alert.alert(t('deck_exit_title'), t('deck_exit_body'), [
                { text: t('common_continue'), style: 'cancel' },
                { text: t('deck_exit'), style: 'destructive', onPress: goBack },
              ]);
            }}
            hitSlop={8}
          >
            <Text style={styles.back}>{t('common_back')}</Text>
          </Pressable>
        </View>

        <View style={styles.headerCenter} pointerEvents="box-none">
          <View style={[styles.headerTypeTag, { backgroundColor: deckColors.bg }]}>
            <Text style={[styles.headerTypeTagText, { color: deckColors.text }]}>
              {planDate === 'tomorrow'
                ? t('home_action_plan_ahead')
                : route.params?.filter === 'productive'
                  ? t('home_action_productive')
                  : route.params?.filter === 'challenge_me'
                    ? t('home_action_challenge')
                    : route.params?.filter === 'at_home'
                      ? t('home_action_homebody')
                      : t('home_action_now')}
            </Text>
          </View>
          {isPastBedTime && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pageBedtimeBadge,
                {
                  borderColor: bedtimeBadgeColor,
                  opacity: bedtimePulse,
                },
              ]}
            >
              <Text style={[styles.pageBedtimeBadgeText, { color: bedtimeBadgeColor }]}>🛏️ Past bedtime 💤</Text>
            </Animated.View>
          )}
        </View>

        <View style={styles.headerRight}>
          <ChargeBar
            current={state.swipeBank?.current ?? 0}
            max={state.swipeBank?.max ?? 20}
            onPress={() => navigation.navigate('Bank')}
            disabled={(state.swipeBank?.current ?? 0) <= 0}
          />
          <View style={styles.headerRightMeta}>
            <View style={styles.counterStack}>
              <Pressable
                onPress={handleUndoSlide}
                disabled={!canUndoSlide || confirming}
                style={({ pressed }) => [
                  styles.counterUndoButton,
                  (!canUndoSlide || confirming) && styles.counterUndoButtonDisabled,
                  pressed && canUndoSlide && !confirming && styles.counterUndoPressed,
                ]}
                hitSlop={8}
              >
                <Image
                  source={require('../../assets/backarrow.png')}
                  style={[
                    styles.counterUndoIcon,
                    (!canUndoSlide || confirming) && styles.counterUndoIconDisabled,
                  ]}
                />
              </Pressable>
              <Text style={styles.cardCounter}>{index + 1} / {deck.length}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.deckWrap}>
        <SwipeDeck
          ref={deckRef}
          current={current}
          next={next}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleCommit}
          disabled={controlsDisabled}
          deckColors={deckColors}
          showSourceDebug={isAdmin}
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={handleSwipeLeft}
          style={({ pressed }) => [
            styles.controlButton,
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlButtonDisabled,
            pressed && styles.controlPressed,
          ]}
          disabled={controlsDisabled}
        >
          <Text style={[!isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled, styles.controlText]}>X</Text>
        </Pressable>
        <Pressable
          onPress={handleSaveQuick}
          style={({ pressed }) => [
            styles.controlButton,
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlButtonDisabled,
            pressed && styles.controlPressed,
          ]}
          disabled={controlsDisabled}
        >
          <Text style={[
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled,
            heartAnimIds.has(current?.id ?? '') && { color: theme.colors.danger },
            styles.controlText,
          ]}>
            {heartAnimIds.has(current?.id ?? '') ? '❤️' : '♡'}
          </Text>
        </Pressable>
        <View ref={commitButtonRef} onLayout={updateRippleLayout} collapsable={false} style={styles.controlSlot}>
          <Pressable
            onPress={() => deckRef.current?.swipeRight()}
            style={({ pressed }) => [
              styles.controlButton,
              styles.controlPrimary,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlButtonDisabled,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlPrimaryDisabled,
              pressed && styles.controlPressed,
            ]}
            disabled={controlsDisabled}
          >
            <Text style={[
              styles.controlText,
              styles.controlTextPrimary,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextPrimaryDisabled,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled,
            ]}>
              {planDate === 'tomorrow' ? 'Add to calendar' : 'Do it'}
            </Text>
          </Pressable>
        </View>
      </View>

      </Animated.View>

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

      {/* Empty swipes card picker - 2x2 grid */}
      {outOfSwipesGridVisible && (
        <View style={styles.emptySwipesOverlay}>
          <View style={styles.emptySwipesContent}>
            <Text style={styles.emptySwipesTitle}>Out of swipes</Text>
            <Text style={styles.emptySwipesSubtitle}>Tap a card to inspect it, then decide whether to use it</Text>
            <View style={styles.cardsGrid}>
              {deck.slice(index, index + 4).map((card) => {
                const isDeclined = declinedGridCardIds.has(card.id);
                return (
                  <Pressable
                    key={card.id}
                    style={({ pressed }) => [
                      styles.gridCard,
                      isDeclined && styles.gridCardDisabled,
                      pressed && !isDeclined && { opacity: 0.9, transform: [{ scale: 0.97 }] },
                    ]}
                    disabled={isDeclined}
                    onPress={() => openGridCard(card)}
                  >
                    <View style={styles.gridCardContainer}>
                      <View style={styles.cardBonusBadge}>
                        <Text style={styles.cardBonusText}>+{Math.floor(card.durationMin / 30)}</Text>
                      </View>
                      <Text style={[styles.gridCardEmoji, { fontSize: 40 }]}>{card.emojis?.[0] ?? (card.tags?.[0] ? '✨' : '⭐')}</Text>
                      <Text style={styles.gridCardTitle} numberOfLines={2}>{card.title}</Text>
                      <Text style={styles.gridCardDuration}>{card.durationMin}m</Text>
                      {isDeclined && <Text style={styles.gridCardDeclinedLabel}>Declined</Text>}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.emptySwipesHint}>Credits reset in a few minutes — gain bonus credits in the meantime</Text>
            <Pressable
              style={({ pressed }) => [
                styles.homeButtonContainer,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => {
                setGridUsed(false);
                navigation.navigate('Home');
              }}
            >
              <Text style={styles.homeButtonText}>Home</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Modal
        visible={!!inspectedGridCard}
        transparent
        animationType="fade"
        onRequestClose={declineInspectedCard}
      >
        <View style={styles.inspectOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={declineInspectedCard} />
          <View style={styles.inspectSheet}>
            <Text style={styles.inspectTitle}>Inspect this activity</Text>
            <Text style={styles.inspectSubtitle}>Swipe the card or use the controls below to decide.</Text>
            {inspectedGridCard && (
              <>
                <View style={styles.inspectDeckWrap}>
                  <SwipeDeck
                    ref={inspectDeckRef}
                    current={inspectedGridCard}
                    next={null}
                    onSwipeLeft={declineInspectedCard}
                    onSwipeRight={() => acceptInspectedCard(inspectedGridCard)}
                    deckColors={deckColors}
                    showSourceDebug={isAdmin}
                  />
                </View>
                <View style={styles.inspectControls}>
                  <Pressable
                    onPress={() => inspectDeckRef.current?.swipeLeft()}
                    style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
                  >
                    <Text style={styles.controlText}>X</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => saveInspectedSuggestion(inspectedGridCard)}
                    style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
                  >
                    <Text style={[
                      styles.controlText,
                      heartAnimIds.has(inspectedGridCard.id) && { color: theme.colors.danger },
                    ]}>
                      {heartAnimIds.has(inspectedGridCard.id) ? '❤️' : '♡'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => inspectDeckRef.current?.swipeRight()}
                    style={({ pressed }) => [styles.controlButton, styles.controlPrimary, pressed && styles.controlPressed]}
                  >
                    <Text style={[styles.controlText, styles.controlTextPrimary]}>Do it</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {savedPopupVisible && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.savedPopup,
            {
              opacity: savedPopupAnim,
              transform: [
                { translateY: savedPopupAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                { scale: savedPopupAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
        >
          <View style={styles.savedPopupBubble}>
            <Text style={styles.savedPopupText}>❤️ Saved to do later</Text>
          </View>
        </Animated.View>
      )}

      <Modal transparent visible={!!schedulePreview} animationType="fade" onRequestClose={() => setSchedulePreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setSchedulePreview(null)}>
          <Pressable style={styles.previewCard} onPress={() => undefined}>
            <Text style={styles.previewTitle}>Fitting into tomorrow</Text>
            <Text style={styles.previewSubtitle}>This activity slides into the open gap between the surrounding events.</Text>
            {schedulePreview && (
              <View style={styles.previewRail}>
                <View style={styles.previewRailRow}>
                  <View style={[styles.previewBlock, styles.previewBlockMuted]}>
                    <Text style={styles.previewBlockLabel} numberOfLines={1}>{schedulePreview.beforeTitle ?? 'Before'}</Text>
                  </View>
                  <Animated.View
                    style={[
                      styles.previewBlock,
                      styles.previewBlockAccent,
                      {
                        transform: [
                          {
                            translateY: schedulePreviewAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [18, 0],
                            }),
                          },
                          {
                            scale: schedulePreviewAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.92, 1],
                            }),
                          },
                        ],
                        opacity: schedulePreviewAnim,
                      },
                    ]}
                  >
                    <Text style={[styles.previewBlockLabel, styles.previewBlockLabelAccent]} numberOfLines={1}>{schedulePreview.title}</Text>
                    <Text style={[styles.previewBlockSub, styles.previewBlockLabelAccent]} numberOfLines={1}>{`${formatTime(schedulePreview.slotStart)} - ${formatTime(schedulePreview.slotEnd)}`}</Text>
                  </Animated.View>
                  <View style={[styles.previewBlock, styles.previewBlockMuted]}>
                    <Text style={styles.previewBlockLabel} numberOfLines={1}>{schedulePreview.afterTitle ?? t('deck_after')}</Text>
                  </View>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        transparent
        visible={laterVisible}
        animationType="fade"
        onRequestClose={() => { setLaterVisible(false); setClashInfo(null); }}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => { setLaterVisible(false); setClashInfo(null); }}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>{t('deck_save_later_title')}</Text>
            <Text style={styles.modalSubtitle}>{t('deck_save_later_subtitle')}</Text>
            <Pressable
              style={[styles.modalOption, { marginTop: 6, backgroundColor: theme.colors.accent }]}
              onPress={() => {
                saveCurrentSuggestion('saved_later', true);
                setLaterVisible(false);
                setClashInfo(null);
              }}
            >
              <Text style={[styles.modalOptionText, { color: theme.colors.accentText }]}>{t('deck_just_save')}</Text>
            </Pressable>
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
              <Text style={[styles.modalSubtitle, { marginTop: 12 }]}>Or pick a custom time:</Text>
            <View style={styles.timePickerRow}>
              <TextInput
                style={styles.timeInput}
                placeholder="HH"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                maxLength={2}
                value={customHour}
                onChangeText={setCustomHour}
              />
              <Text style={styles.timeSeparator}>:</Text>
              <TextInput
                style={styles.timeInput}
                placeholder="MM"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="number-pad"
                maxLength={2}
                value={customMinute}
                onChangeText={setCustomMinute}
              />
              <Pressable
                style={[styles.modalOption, { marginLeft: 8 }]}
                onPress={() => {
                  const d = resolveCustomTime();
                  if (!d) {
                    Alert.alert(t('deck_invalid_time_title'), t('deck_invalid_time_body'));
                    return;
                  }
                  checkClashAndSchedule(d);
                }}
              >
                <Text style={styles.modalOptionText}>{t('deck_set')}</Text>
              </Pressable>
            </View>
            {clashInfo && (
              <View style={styles.clashCard}>
                <Text style={styles.clashTitle}>{`⚠️ ${t('deck_schedule_clash')}`}</Text>
                <Text style={styles.clashText}>
                  This overlaps with "{clashInfo.title}" ({clashInfo.start} – {clashInfo.end}).
                </Text>
                <View style={styles.clashActions}>
                  <Pressable
                    style={styles.modalOption}
                    onPress={() => { setClashInfo(null); setPendingScheduleStart(null); }}
                  >
                    <Text style={styles.modalOptionText}>{t('deck_reschedule')}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modalOption, { backgroundColor: theme.colors.accent }]}
                    onPress={() => {
                      if (pendingScheduleStart) doScheduleLater(pendingScheduleStart);
                    }}
                  >
                    <Text style={[styles.modalOptionText, { color: theme.colors.accentText }]}>{t('deck_schedule_anyway')}</Text>
                  </Pressable>
                </View>
              </View>
            )}
            <Pressable onPress={() => { setLaterVisible(false); setClashInfo(null); }}>
              <Text style={styles.modalCancel}>{t('deck_cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <VideoAdModal ad={videoAd} onClose={closeVideoAd} deckColors={deckColors} />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  mainContent: {
    flex: 1,
  },
  header: {
    position: 'relative',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    minHeight: 44,
  },
  headerLeft: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    zIndex: 2,
  },
  headerCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
    gap: theme.spacing.sm,
    zIndex: 1,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
    zIndex: 2,
  },
  headerRightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  headerTypeTag: {
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  headerTypeTagText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  headerText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    flex: 1,
    paddingRight: theme.spacing.sm,
  },
  fallbackNote: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 13,
  },
  cardCounter: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    color: theme.colors.textMuted,
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'right',
    alignSelf: 'center',
  },
  counterStack: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  counterUndoButton: {
    minHeight: 24,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    marginTop: -2,
  },
  counterUndoButtonDisabled: {
    opacity: 0.35,
  },
  counterUndoPressed: {
    transform: [{ scale: 0.94 }],
  },
  counterUndoIcon: {
    width: 14,
    height: 14,
    resizeMode: 'contain',
    tintColor: theme.isDark ? theme.colors.text : undefined,
    opacity: 0.75,
  },
  counterUndoIconDisabled: {
    opacity: 0.3,
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: theme.spacing.md,
    marginTop: theme.spacing.xs,
  },
  deckWrap: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  topOverlayRow: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    minHeight: 32,
    zIndex: 60,
    elevation: 60,
  },
  topOverlayBank: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 61,
  },
  pageBedtimeBadge: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    zIndex: 50,
  },
  pageBedtimeBadgeText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
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
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 12, 18, 0.55)',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  previewCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  previewTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
  },
  previewSubtitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  previewRail: {
    marginTop: theme.spacing.xs,
  },
  previewRailRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  previewBlock: {
    flex: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    minHeight: 72,
    justifyContent: 'flex-start',
  },
  previewBlockMuted: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  previewBlockAccent: {
    backgroundColor: theme.colors.accent,
  },
  previewBlockLabel: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 13,
  },
  previewBlockLabelAccent: {
    color: theme.colors.accentText,
  },
  previewBlockSub: {
    marginTop: 2,
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
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
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  timeInput: {
    width: 48,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.backgroundAlt,
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
    color: theme.colors.text,
    textAlign: 'center',
  },
  timeSeparator: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
    marginHorizontal: 4,
  },
  clashCard: {
    marginTop: theme.spacing.sm,
    backgroundColor: 'rgba(220,38,38,0.08)',
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  clashTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
  },
  clashText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    fontSize: 13,
  },
  clashActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  savedPopup: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  savedPopupBubble: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 8,
  },
  savedPopupText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentText,
    fontSize: 14,
  },
  emptySwipesOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
    padding: theme.spacing.lg,
  },
  emptySwipesContent: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    alignItems: 'center',
    maxWidth: 320,
  },
  emptySwipesTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 18,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  emptySwipesSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    justifyContent: 'center',
  },
  gridCard: {
    width: '45%',
    aspectRatio: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
      borderWidth: 2,
      borderColor: theme.colors.accentSoft,
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  gridCardDisabled: {
    opacity: 0.45,
  },
  gridCardDeclinedLabel: {
    marginTop: 4,
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  gridCardEmoji: {
    fontSize: 32,
  },
  gridCardTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 13,
    color: theme.colors.text,
    textAlign: 'center',
  },
  gridCardDuration: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  emptySwipesHint: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  loadingContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  loadingBackButtonWrap: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
  },
  inspectOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  inspectSheet: {
    maxHeight: '92%',
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    overflow: 'hidden',
  },
  inspectTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 20,
    color: theme.colors.text,
    textAlign: 'center',
  },
  inspectSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  inspectScroll: {
    flex: 1,
    marginTop: theme.spacing.md,
  },
  inspectScrollContent: {
    paddingBottom: theme.spacing.md,
  },
  inspectCardWrap: {
    width: '100%',
  },
  inspectActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  inspectActionButton: {
    flex: 1,
  },
  inspectDeckWrap: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  inspectControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  homeButtonContainer: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
  },
  homeButtonText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.accentText,
  },
  bonusCorner: {
    position: 'absolute',
    top: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.success,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    zIndex: 10,
  },
  bonusCornerText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    color: theme.colors.accentText,
  },
  cardBonusBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: theme.colors.success,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  cardBonusText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 10,
    color: theme.colors.accentText,
  },
  controlButtonDisabled: {
    opacity: 0.4,
  },
  controlPrimaryDisabled: {
    backgroundColor: theme.colors.textMuted,
  },
  controlTextDisabled: {
    color: theme.colors.textMuted,
    opacity: 0.6,
  },
  controlTextPrimaryDisabled: {
    color: theme.colors.textMuted,
  },
  gridCardContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  creditCircle: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.success,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  creditText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.accentText,
  },
  smallCountdown: {
    fontFamily: theme.fonts.body,
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  bonusText: {
    fontFamily: theme.fonts.semibold,
    fontSize: 11,
    color: theme.colors.success,
    textAlign: 'center',
  },
});
