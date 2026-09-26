// @ts-nocheck
// Generated from DeckScreen by create-layout-fixture.cjs. Only data/callbacks are fixtures.
import React, { useRef, useState } from 'react';
import { Alert, Animated, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useI18n } from './contexts';
import { translations } from '../../src/i18n/translations';
import { SessionMapPanel } from '../../src/components/SessionMapPanel';
import { SessionMapButton } from '../../src/components/SessionMapButton';
import { SwipeDeck } from '../../src/components/SwipeDeck';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import ChargeBar from '../../src/components/ChargeBar';
const DeckLoader = () => <Text>Loading activities</Text>;
const VideoAdModal = () => null;
export function DeckLayout({ entries, activities }) {
  const theme = useTheme(), { language } = useI18n();
  const styles = createStyles(theme);
  const query = new URLSearchParams(window.location.search);
  const isGerman = language === 'de';
  const t = key => translations[language][key] || key;
  const noop = () => {};
  const navigation = { navigate: noop, reset: noop };
  const route = { params: {} };
  const insets = { top: window.innerHeight > 700 ? 47 : 20, bottom: window.innerHeight > 700 ? 34 : 0 };
  const { height: screenHeight } = useWindowDimensions();
  const compactLayout = screenHeight - insets.top - insets.bottom < 740;
  const [sessionMapOpen, setSessionMapOpen] = useState(query.get('mode') === 'map');
  const [selectedMapActivityId, setSelectedMapActivityId] = useState(null);
  const [unread, setUnread] = useState(entries.length);
  const [loading, setLoading] = useState(query.get('mode') === 'loading');
  const [showLoadingBackButton, setShowLoadingBackButton] = useState(false);
  const state = { swipeBank: { current: query.get('credits') === '0' ? 0 : 20, max: 20 }, location: { lat: 52.52, lng: 13.405 } };
  const sessionMap = { entries }, sessionMapOptions = activities;
  const selectedMapEntry = entries.find(entry => entry.suggestion.id === selectedMapActivityId);
  const mapOverviewVisible = sessionMapOpen && !selectedMapEntry;
  const sample = entries[0]?.suggestion ?? { id: 'fallback', title: 'Take a little break', description: 'Step away for a moment and enjoy some fresh air.', type: 'AT_HOME', durationMin: 15, confidence: 1, emojis: ['ðŸŒ¿'] };
  const current = sessionMapOpen ? selectedMapEntry?.suggestion ?? null : query.get('mode') === 'empty' ? null : sample;
  const next = null, deck = [sample], index = 0;
  const controlsDisabled = state.swipeBank.current <= 0;
  const confirming = false, canUndoSlide = false, isAdmin = false, isPastBedTime = false;
  const planDate = 'today', DESIRED_SIZE = 5, nextNewSetPlaysAd = false;
  const isAdCard = () => false, handleNewSet = noop;
  const deckColors = { bg: theme.colors.accent, text: theme.colors.accentText };
  const deckRef = useRef(null), swipeLockRef = useRef(false), commitButtonRef = useRef(null);
  const uiAppear = useRef(new Animated.Value(1)).current, bedtimePulse = 1;
  const handleUndoSlide = noop, goBack = noop, handleSwipeLeft = () => { window.__layoutSwipes = (window.__layoutSwipes || 0) + 1; }, handleCommit = noop, handleSaveQuick = noop, updateRippleLayout = noop;
  const heartAnimIds = new Set();
  const resetSessionMap = noop, videoAd = null, closeVideoAd = noop;
  const hasMapCoordinates = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng);
  const selectSessionMapActivity = setSelectedMapActivityId;
  const sessionMapControl = <View style={styles.sessionMapControl}><SessionMapButton unreadCount={unread} active={sessionMapOpen} disabled={confirming} deckColors={deckColors} onPress={() => { setSessionMapOpen(value => !value); setSelectedMapActivityId(null); setUnread(0); }} /></View>;

  if (loading && !sessionMapOpen) {
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
                  resetSessionMap();
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }}
                variant="muted"
              />
            </View>
          )}
        </View>
        <View style={{ paddingBottom: insets.bottom + theme.spacing.md }}>{sessionMapControl}</View>
        <VideoAdModal ad={videoAd} onClose={closeVideoAd} />
      </LinearGradient>
    );
  }

  const bedtimeBadgeColor = deckColors.bg;

  if (!current && !sessionMapOpen) {
    const activityCount = deck.reduce((count, card) => count + (isAdCard(card) ? 0 : card.mapDiscovery?.activities.length ?? 1), 0);
    const ranOutEarly = activityCount < DESIRED_SIZE;

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
            <PrimaryButton label={nextNewSetPlaysAd ? `${t('smart_new_set')}  (â–¶)` : t('smart_new_set')} onPress={handleNewSet} />
            <Pressable onPress={() => navigation.navigate('Settings', { fromRefine: true })}>
              <Text style={styles.refineLink}>
                {ranOutEarly ? 'âš™ï¸  Expand your interests' : 'Refine what to do'}
              </Text>
            </Pressable>
            <Pressable onPress={() => {
              resetSessionMap();
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }}>
              <Text style={styles.backLink}>{t('deck_back_home')}</Text>
            </Pressable>
          </View>
        </Pressable>
        <View style={{ paddingBottom: insets.bottom + theme.spacing.md }}>{sessionMapControl}</View>
        <VideoAdModal ad={videoAd} onClose={closeVideoAd} deckColors={deckColors} />
      </LinearGradient>
    );
  }


return (<LinearGradient colors={[theme.colors.background, theme.colors.background]} style={[styles.container, {
      paddingTop: insets.top + theme.spacing.sm, paddingBottom: Math.max(insets.bottom, 8),
    }]}>
      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <Animated.View
        style={[{
          opacity: sessionMapOpen ? 1 : uiAppear,
          transform: [
            {
              translateY: sessionMapOpen ? 0 : uiAppear.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        }, styles.mainContent]}
      >
      <View style={[styles.header, compactLayout && styles.compactHeader]}>
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
              <Text style={[styles.pageBedtimeBadgeText, { color: bedtimeBadgeColor }]}>ðŸ›ï¸ Past bedtime ðŸ’¤</Text>
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
                disabled={sessionMapOpen || !canUndoSlide || confirming}
                style={({ pressed }) => [
                  styles.counterUndoButton,
                  (sessionMapOpen || !canUndoSlide || confirming) && styles.counterUndoButtonDisabled,
                  pressed && canUndoSlide && !confirming && styles.counterUndoPressed,
                ]}
                hitSlop={8}
              >
                <Image
                  source={require('../../assets/backarrow.png')}
                  style={[
                    styles.counterUndoIcon,
                    (sessionMapOpen || !canUndoSlide || confirming) && styles.counterUndoIconDisabled,
                  ]}
                />
              </Pressable>
              <Text style={styles.cardCounter}>{sessionMapOpen
                ? `${sessionMap.entries.length} ${isGerman ? 'Ideen' : 'ideas'}`
                : `${index + 1} / ${deck.length}`}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.deckWrap, compactLayout && {
        paddingTop: sessionMapOpen ? 30 : 0,
        paddingBottom: 8,
        minHeight: 420 + (sessionMapOpen ? 30 : 0) + 8,
      }]}>
        {mapOverviewVisible ? <SessionMapPanel
          entries={sessionMap.entries} activities={sessionMapOptions}
          origin={hasMapCoordinates(state.location.lat, state.location.lng)
            ? { latitude: state.location.lat!, longitude: state.location.lng! } : null}
          onSelect={selectSessionMapActivity} deckColors={deckColors}
        /> : <SwipeDeck
          ref={deckRef}
          current={current}
          next={next}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleCommit}
          disabled={confirming || (!sessionMapOpen && controlsDisabled)}
          deckColors={deckColors}
          showSourceDebug={isAdmin}
          rightSwipeEnabled={!controlsDisabled}
        />}
        {sessionMapOpen && (
          <Pressable accessibilityRole="button" onPress={() => {
            if (confirming || swipeLockRef.current) return;
            if (selectedMapEntry) setSelectedMapActivityId(null);
            else setSessionMapOpen(false);
          }}
            disabled={confirming} style={styles.mapBackButton}>
            <Text style={styles.mapBackText}>{selectedMapEntry
              ? (isGerman ? 'â† ZurÃ¼ck zur Karte' : 'â† Back to map')
              : (isGerman ? 'â† Weiter swipen' : 'â† Back to swiping')}</Text>
          </Pressable>
        )}
      </View>

      {sessionMapControl}
      <View style={[styles.controls, compactLayout && styles.compactControls]}>
        <Pressable
          onPress={() => deckRef.current?.swipeLeft()}
          style={({ pressed }) => [
            styles.controlButton,
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlButtonDisabled,
            pressed && styles.controlPressed,
          ]}
          disabled={confirming || mapOverviewVisible || (!sessionMapOpen && controlsDisabled)}
        >
          <Text style={[!isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled, styles.controlText]}>X</Text>
        </Pressable>
        <Pressable
          onPress={handleSaveQuick}
          style={({ pressed }) => [
            styles.controlButton,
            mapOverviewVisible && styles.controlButtonDisabled,
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlButtonDisabled,
            pressed && styles.controlPressed,
          ]}
          disabled={controlsDisabled || mapOverviewVisible}
        >
          <Text style={[
            !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled,
            heartAnimIds.has(current?.id ?? '') && { color: theme.colors.danger },
            styles.controlText,
          ]}>
            {selectedMapEntry?.saved || heartAnimIds.has(current?.id ?? '') ? 'â¤ï¸' : 'â™¡'}
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
            disabled={controlsDisabled || mapOverviewVisible}
          >
            <Text style={[
              styles.controlText,
              styles.controlTextPrimary,
              mapOverviewVisible && styles.mapChooseText,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextPrimaryDisabled,
              !isAdmin && (state.swipeBank?.current ?? 0) <= 0 && planDate !== 'tomorrow' && styles.controlTextDisabled,
            ]}>
              {mapOverviewVisible ? (isGerman ? 'Idee auswÃ¤hlen' : 'Choose an idea') : planDate === 'tomorrow' ? 'Add to calendar' : 'Do it'}
            </Text>
          </Pressable>
        </View>
      </View>

      </Animated.View>
      </ScrollView>
</LinearGradient>);
}
const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  mainContent: {
    flexGrow: 1,
  },
  mainScroll: { flex: 1 },
  mainScrollContent: { flexGrow: 1 },
  compactHeader: { marginTop: 0, marginBottom: 8 },
  compactControls: { marginBottom: 0 },
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
    minHeight: 420 + theme.spacing.xl + theme.spacing.md,
    justifyContent: 'flex-start',
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  mapBackButton: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.card,
    zIndex: 4,
  },
  mapChooseText: { fontSize: 12 },
  mapBackText: { color: theme.colors.text, fontFamily: theme.fonts.semibold, fontSize: 12 },
  sessionMapControl: { alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
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
