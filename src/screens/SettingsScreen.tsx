import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { RootStackParamList } from '../navigation/types';
import { ToggleRow } from '../components/ToggleRow';
import { Chip } from '../components/Chip';
import WakeWindowRange from '../components/WakeWindowRange';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { getCalendars, requestCalendarPermission } from '../services/calendar';
import { requestLocationPermission } from '../services/location';
import { deleteUserData } from '../services/user';
import { addDebugMessage, clearDebugMessages, DebugMessage, subscribeDebugMessages } from '../services/debug';
import { fetchTicketmasterSuggestions } from '../services/ticketmaster';
import { fetchSeatGeekSuggestions } from '../services/seatgeek';
import { fetchGooglePlacesSuggestions } from '../services/googlePlaces';
import { fetchOsmSuggestions } from '../services/osmPlaces';
import { fetchGeminiSuggestions } from '../services/geminiSuggestions';
import { Availability } from '../types';
import { formatClockTime, formatTime, normalizeClockTime } from '../utils/time';
import { isBusinessAdmin } from '../services/user';
import { resetAdsConsent, showAdsPrivacyOptions, useAdsCompliance } from '../services/ads/consent';
import { getPrivacyPolicyUrl, getTermsOfServiceUrl } from '../legal/legalLinks';
import { useI18n } from '../i18n/I18nProvider';
import { AppLanguage, languageLabels } from '../i18n/translations';

const APP_PRIVACY_POLICY_URL = getPrivacyPolicyUrl();
const APP_TERMS_URL = getTermsOfServiceUrl();

const interestGroups = [
  {
    title: 'Active',
    options: [
      { id: 'fitness', label: '🏋️ Fitness' },
      { id: 'cycling', label: '🚴 Cycling' },
      { id: 'running', label: '🏃 Running' },
      { id: 'swimming', label: '🏊 Swimming' },
      { id: 'hiking', label: '🥾 Hiking' },
      { id: 'wellness', label: '🧘 Wellness' },
    ],
  },
  {
    title: 'Explore',
    options: [
      { id: 'nature', label: '🌿 Nature' },
      { id: 'beaches', label: '🏖️ Beaches' },
      { id: 'parks', label: '🌳 Parks' },
      { id: 'explore', label: '🧭 Explore' },
    ],
  },
  {
    title: 'Food & Drink',
    options: [
      { id: 'coffee', label: '☕ Coffee & Cafés' },
      { id: 'food', label: '🍽️ Dining' },
      { id: 'street_food', label: '🌮 Street Food' },
    ],
  },
  {
    title: 'Culture & Learning',
    options: [
      { id: 'art', label: '🎨 Art' },
      { id: 'music', label: '🎵 Music' },
      { id: 'movies', label: '🎬 Movies' },
      { id: 'learning', label: '📚 Learning' },
    ],
  },
  {
    title: 'Productivity & Social',
    options: [
      { id: 'focus', label: '🎯 Focus' },
      { id: 'social', label: '🫢 Social' },
    ],
  },
];

type Props = StackScreenProps<RootStackParamList, 'Settings'>;

export const SettingsScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const { t, language } = useI18n();
  const isGerman = language === 'de';
  const adsCompliance = useAdsCompliance();
  const showRefineIntent = !!route.params?.fromRefine;
  const isAdmin = isBusinessAdmin(state.userEmail);
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
  const [clockTick, setClockTick] = useState(Date.now());
  const [interestTags, setInterestTags] = useState<string[]>(state.prefs.interestTags || []);
  const [customInterests, setCustomInterests] = useState<string[]>(state.prefs.customInterests ?? []);
  const [interestInput, setInterestInput] = useState('');
  const [selfDescription, setSelfDescription] = useState(state.prefs.selfDescription ?? '');
  const [lifestyle, setLifestyle] = useState(state.prefs.lifestyle ?? 'mixed');
  const [sessionActivityIntent, setSessionActivityIntent] = useState(state.sessionActivityIntent ?? '');
  const [wakeStartTime, setWakeStartTime] = useState(normalizeClockTime(state.prefs.wakeStartTime ?? '07:00', '07:00'));
  const [wakeEndTime, setWakeEndTime] = useState(normalizeClockTime(state.prefs.wakeEndTime ?? '23:00', '23:00'));
  const insets = useSafeAreaInsets();

  const updatePrefs = (patch: Partial<typeof state.prefs>) => {
    actions.setPrefs({ ...state.prefs, ...patch });
  };

  useEffect(() => {
    const loadCalendars = async () => {
      if (!state.permissions.calendarGranted) return;
      const items = await getCalendars();
      setCalendars(items.map((item) => ({ id: item.id, title: item.title })));
    };
    loadCalendars();
  }, [state.permissions.calendarGranted]);

  useEffect(() => {
    const unsubscribe = subscribeDebugMessages(setDebugMessages);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClockTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setWakeStartTime(normalizeClockTime(state.prefs.wakeStartTime ?? '07:00', '07:00'));
    setWakeEndTime(normalizeClockTime(state.prefs.wakeEndTime ?? '23:00', '23:00'));
  }, [state.prefs.wakeStartTime, state.prefs.wakeEndTime]);

  useEffect(() => {
    setInterestTags(state.prefs.interestTags || []);
    setCustomInterests(state.prefs.customInterests ?? []);
    setSelfDescription(state.prefs.selfDescription ?? '');
    setLifestyle(state.prefs.lifestyle ?? 'mixed');
  }, [state.prefs.interestTags, state.prefs.customInterests, state.prefs.selfDescription, state.prefs.lifestyle]);

  useEffect(() => {
    setSessionActivityIntent(state.sessionActivityIntent ?? '');
  }, [state.sessionActivityIntent]);

  const buildAvailability = (): Availability => {
    if (state.availability) return state.availability;
    const now = new Date();
    const end = new Date(now.getTime() + 120 * 60 * 1000);
    return {
      start: now.toISOString(),
      end: end.toISOString(),
      durationMin: 120,
      nextEventTitle: null,
    };
  };

  const updateWakeWindow = (startValue: string, endValue: string) => {
    const nextStart = normalizeClockTime(startValue, '07:00');
    const nextEnd = normalizeClockTime(endValue, '23:00');
    setWakeStartTime(nextStart);
    setWakeEndTime(nextEnd);
    actions.setPrefs({
      ...state.prefs,
      wakeStartTime: nextStart,
      wakeEndTime: nextEnd,
    });
  };

  const toggleInterest = (tag: string) => {
    const nextInterestTags = interestTags.includes(tag)
      ? interestTags.filter((item) => item !== tag)
      : [...interestTags, tag];
    setInterestTags(nextInterestTags);
    updatePrefs({ interestTags: nextInterestTags });
  };

  const normalizeInterest = (value: string): string => value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const addCustomInterest = () => {
    const normalized = normalizeInterest(interestInput);
    if (!normalized) return;

    const nextCustomInterests = customInterests.includes(normalized)
      ? customInterests
      : [...customInterests, normalized];
    const nextInterestTags = interestTags.includes(normalized)
      ? interestTags
      : [...interestTags, normalized];

    setCustomInterests(nextCustomInterests);
    setInterestTags(nextInterestTags);
    setInterestInput('');
    updatePrefs({ customInterests: nextCustomInterests, interestTags: nextInterestTags });
  };

  const removeCustomInterest = (item: string) => {
    const nextCustomInterests = customInterests.filter((x) => x !== item);
    const nextInterestTags = interestTags.filter((x) => x !== item);
    setCustomInterests(nextCustomInterests);
    setInterestTags(nextInterestTags);
    updatePrefs({ customInterests: nextCustomInterests, interestTags: nextInterestTags });
  };

  const saveSessionIntent = () => {
    actions.setSessionActivityIntent(sessionActivityIntent.trim());
  };

  const requireLocation = () => {
    if (state.location.lat && state.location.lng) return true;
    addDebugMessage('devops', 'Location missing. Enable location.');
    return false;
  };

  const runTest = async (label: string, runner: () => Promise<number | null>) => {
    try {
      const count = await runner();
      const safeCount = typeof count === 'number' && Number.isFinite(count) ? count : null;
      if (safeCount !== null) {
        addDebugMessage(label, `OK: ${safeCount} results`);
        if (safeCount === 0) {
          addDebugMessage(label, '0 results. Try increasing radius or enable serendipity.');
        }
      } else {
        addDebugMessage(label, 'No response from API.');
      }
    } catch (error) {
      addDebugMessage(label, 'Test failed.');
    }
  };

  const openUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(isGerman ? 'Link kann nicht geoffnet werden' : 'Unable to open link', isGerman ? 'Dieser Link wird auf diesem Gerat nicht unterstutzt.' : 'This link is not supported on this device.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert(isGerman ? 'Link kann nicht geoffnet werden' : 'Unable to open link', isGerman ? 'Bitte versuche es spater erneut.' : 'Please try again later.');
    }
  };

  const handleManageAdsPrivacy = async () => {
    const next = await showAdsPrivacyOptions();
    Alert.alert(
      isGerman ? 'Werbe-Datenschutz aktualisiert' : 'Ad privacy updated',
      `${isGerman ? 'Einwilligungsstatus' : 'Consent status'}: ${next.consentStatus}\n${isGerman ? 'Werbemodus' : 'Ad mode'}: ${next.requestNonPersonalizedAdsOnly ? (isGerman ? 'Nicht personalisiert' : 'Non-personalized') : (isGerman ? 'Personalisiert' : 'Personalized')}`,
    );
  };

  const handleResetAdsConsent = () => {
    Alert.alert(
      isGerman ? 'Werbeeinwilligung zurucksetzen' : 'Reset ad consent',
      isGerman ? 'Dadurch werden deine Werbeeinwilligungen geloscht und bei Bedarf erneut abgefragt.' : 'This will clear your ad-consent choices and ask again where required.',
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: isGerman ? 'Zurucksetzen' : 'Reset',
          style: 'destructive',
          onPress: async () => {
            const next = await resetAdsConsent();
            Alert.alert(isGerman ? 'Werbeeinwilligung zuruckgesetzt' : 'Ad consent reset', `${isGerman ? 'Einwilligungsstatus' : 'Consent status'}: ${next.consentStatus}`);
          },
        },
      ],
    );
  };

  const openPrivacyPolicy = () => {
    if (APP_PRIVACY_POLICY_URL) {
      void openUrl(APP_PRIVACY_POLICY_URL);
      return;
    }
    navigation.navigate('PrivacyPolicy');
  };

  const openTermsOfService = () => {
    if (APP_TERMS_URL) {
      void openUrl(APP_TERMS_URL);
      return;
    }
    navigation.navigate('TermsOfService');
  };

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{t('common_back')}</Text>
        </Pressable>

        <Text style={styles.title}>{t('settings_title')}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings_language_title')}</Text>
          <Text style={styles.rowText}>{t('settings_language_label')}</Text>
          <View style={styles.chipsWrap}>
            {(['en', 'de'] as AppLanguage[]).map((lang) => (
              <Chip
                key={lang}
                label={languageLabels[lang]}
                selected={(state.prefs.language ?? 'en') === lang}
                onPress={() => actions.setPrefs({ ...state.prefs, language: lang })}
              />
            ))}
          </View>
        </View>

        {showRefineIntent && (
          <View style={styles.sessionIntentShell}>
            <LinearGradient
              colors={[theme.colors.accent, theme.isDark ? theme.colors.card : '#FFFFFF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sessionIntentBorder}
            >
              <View style={styles.sessionIntentCard}>
                <Text style={styles.sessionIntentTitle}>Anything specific you want to add for now?</Text>
                <Text style={styles.sessionIntentSubtitle}>
                  {isGerman ? 'Fuge eine temporare Richtung hinzu, worauf wir uns bei Vorschlagen konzentrieren sollen.' : 'Add a temporary direction on what we should curate for you.'}
                </Text>
                <TextInput
                  style={styles.sessionIntentInput}
                  value={sessionActivityIntent}
                  onChangeText={setSessionActivityIntent}
                  placeholder={isGerman ? 'z. B. Ich mochte eine Radtour machen' : 'e.g. I\'d like to do a bike ride'}
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  maxLength={180}
                />
                <View style={styles.sessionIntentActions}>
                  <Pressable style={styles.sessionIntentButton} onPress={saveSessionIntent}>
                    <Text style={styles.sessionIntentButtonText}>{isGerman ? 'Fur diese Session nutzen' : 'Use for this session'}</Text>
                  </Pressable>
                  <Text style={styles.sessionIntentHint}>
                    {isGerman ? 'Aktives Ziel' : 'Active goal'}: {state.sessionActivityIntent?.trim() || (isGerman ? 'keins' : 'none')}
                  </Text>
                </View>
              </View>
            </LinearGradient>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Lokale Zeit' : 'Local time'}</Text>
          <Text style={styles.rowText}>{formatTime(new Date(clockTick))}</Text>
          <Text style={styles.rowText}>{isGerman ? 'Zeitzone' : 'Timezone'}: {state.location.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</Text>
          <Text style={styles.rowText}>{isGerman ? 'Wachzeitfenster' : 'Wake window'}: {formatClockTime(wakeStartTime)} - {formatClockTime(wakeEndTime)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings_permissions_title')}</Text>
          <Text style={styles.rowText}>{t('settings_permission_calendar', { value: state.permissions.calendarGranted ? t('settings_granted') : t('settings_not_granted') })}</Text>
          {!state.permissions.calendarGranted && (
            <Pressable
              style={styles.actionButton}
              onPress={async () => {
                const granted = await requestCalendarPermission();
                actions.setPermissions({ ...state.permissions, calendarGranted: granted });
                if (granted) {
                  const items = await getCalendars();
                  setCalendars(items.map((item) => ({ id: item.id, title: item.title })));
                }
              }}
            >
              <Text style={styles.actionText}>{t('settings_grant_calendar')}</Text>
            </Pressable>
          )}
          <Text style={styles.rowText}>{t('settings_permission_location', { value: state.permissions.locationGranted ? t('settings_granted') : t('settings_not_granted') })}</Text>
          {!state.permissions.locationGranted && (
            <Pressable
              style={styles.actionButton}
              onPress={async () => {
                const granted = await requestLocationPermission();
                actions.setPermissions({ ...state.permissions, locationGranted: granted });
              }}
            >
              <Text style={styles.actionText}>{t('settings_grant_location')}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Business-Konto' : 'Business Account'}</Text>
          <ToggleRow
            label={isGerman ? 'Nur-Business-Modus' : 'Business-only mode'}
            value={state.isBusinessOnly}
            onValueChange={(value) => {
              if (value) {
                Alert.alert(
                  isGerman ? 'Nur-Business-Modus aktivieren?' : 'Enable business-only mode?',
                  isGerman ? 'Consumer-Screens werden ausgeblendet, bis du den Modus wieder deaktivierst.' : 'Consumer screens will be hidden until you turn this off again.',
                  [
                    { text: t('common_cancel'), style: 'cancel' },
                    {
                      text: t('common_enable'),
                      onPress: () => {
                        actions.setIsBusinessOnly(true);
                        navigation.reset({ index: 0, routes: [{ name: 'BusinessHub' }] });
                      },
                    },
                  ],
                );
                return;
              }
              actions.setIsBusinessOnly(false);
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }}
          />
          <Text style={styles.rowText}>
            {isGerman
              ? 'Wenn aktiv, sind Consumer-Screens, Home und KI-Queueing ausgeblendet, bis du den Modus deaktivierst.'
              : 'When enabled, consumer screens, Home, and AI queuing are hidden until you disable it.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings_mode_title')}</Text>
          <ToggleRow
            label={t('settings_dark_theme')}
            value={state.prefs.themeMode === 'dark'}
            onValueChange={(value) => actions.setPrefs({ ...state.prefs, themeMode: value ? 'dark' : 'light' })}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Prferenzen' : 'Preferences'}</Text>

          <Text style={styles.preferenceLabel}>{isGerman ? 'Wahle ein paar, die zu dir passen' : 'Choose a few that fit you'}</Text>
          {interestGroups.map((group) => (
            <View key={group.title}>
              <Text style={styles.groupLabel}>{group.title}</Text>
              <View style={styles.chipsWrap}>
                {group.options.map((interest) => (
                  <Chip
                    key={interest.id}
                    label={interest.label}
                    selected={interestTags.includes(interest.id)}
                    onPress={() => toggleInterest(interest.id)}
                  />
                ))}
              </View>
            </View>
          ))}

          <Text style={styles.preferenceLabel}>{isGerman ? 'Eigene Interessen hinzufugen' : 'Add your own interests'}</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={styles.textInput}
              value={interestInput}
              onChangeText={setInterestInput}
              placeholder={isGerman ? 'z. B. Topfern, Klettern, Stand-up-Comedy' : 'e.g. pottery, climbing, stand-up comedy'}
              placeholderTextColor={theme.colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={addCustomInterest}
            />
            <Pressable onPress={addCustomInterest} style={styles.addPill}>
              <Text style={styles.addPillText}>Add</Text>
            </Pressable>
          </View>
          {customInterests.length > 0 && (
            <View style={styles.chipsWrap}>
              {customInterests.map((item) => (
                <Chip
                  key={item}
                  label={`#${item.replace(/_/g, ' ')}`}
                  selected
                  onPress={() => removeCustomInterest(item)}
                />
              ))}
            </View>
          )}

          <Text style={styles.preferenceLabel}>{isGerman ? 'Dein Lebensstil' : 'Your lifestyle'}</Text>
          <View style={styles.chipsWrap}>
            {[
              { id: 'active', label: 'Active' },
              { id: 'moderate', label: 'Moderate' },
              { id: 'chill', label: 'Chill' },
              { id: 'mixed', label: 'Mixed' },
            ].map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={lifestyle === item.id}
                onPress={() => {
                  setLifestyle(item.id as 'active' | 'moderate' | 'chill' | 'mixed');
                  updatePrefs({ lifestyle: item.id as 'active' | 'moderate' | 'chill' | 'mixed' });
                }}
              />
            ))}
          </View>

          <Text style={styles.preferenceLabel}>{isGerman ? 'Erzahl uns von deinem Alltag' : 'Tell us about your daily life'}</Text>
          <TextInput
            style={styles.textArea}
            value={selfDescription}
            onChangeText={setSelfDescription}
            onBlur={() => updatePrefs({ selfDescription: selfDescription.trim() })}
            placeholder={isGerman ? 'Wie sehen deine Tage aus? Was gibt dir Energie? Was vermeidest du eher?' : 'What do your days look like? What energizes you? What do you usually avoid?'}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={420}
          />

          <Text style={styles.rowText}>{isGerman ? 'Entdeckungsradius' : 'Discovery radius'} ({state.prefs.radiusKm} km)</Text>
          <Slider
            style={styles.slider}
            step={1}
            value={state.prefs.radiusKm}
            minimumValue={1}
            maximumValue={25}
            onSlidingComplete={(val) => updatePrefs({ radiusKm: val })}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.border}
            thumbTintColor={theme.colors.accent}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1 km</Text>
            <Text style={styles.sliderLabel}>25 km</Text>
          </View>

          <Text style={styles.rowText}>{isGerman ? 'Wachzeitfenster' : 'Wake window'}</Text>
          <Text style={styles.helperText}>{isGerman ? 'Halt Vorschlage von Schlafenszeiten fern, ausser du bist erkennbar unregelmassig wach.' : 'Keeps suggestions away from sleep time unless you are clearly awake irregularly.'}</Text>
          <View style={styles.wakeWindowContainer}>
            <WakeWindowRange
              start={wakeStartTime}
              end={wakeEndTime}
              onChange={(s, e) => updateWakeWindow(s, e)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Kalender' : 'Calendars'}</Text>
          {state.permissions.calendarGranted ? (
            calendars.map((cal) => {
              const enabled = !state.disabledCalendars.includes(cal.id);
              return (
                <Pressable
                  key={cal.id}
                  style={styles.calendarRow}
                  onPress={() => {
                    const updated = enabled
                      ? [...state.disabledCalendars, cal.id]
                      : state.disabledCalendars.filter((id) => id !== cal.id);
                    // Keep at least one calendar enabled.
                    if (calendars.length && updated.length >= calendars.length) return;
                    actions.setDisabledCalendars(updated);
                  }}
                >
                  <Text style={styles.calendarTitle}>{cal.title}</Text>
                  <Text style={styles.calendarStatus}>{enabled ? (isGerman ? 'An' : 'On') : (isGerman ? 'Aus' : 'Off')}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.rowText}>{isGerman ? 'Erlaube Kalenderzugriff, um Kalender zu verwalten.' : 'Grant calendar access to manage calendars.'}</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings_privacy_title')}</Text>
          <Pressable onPress={openPrivacyPolicy}>
            <Text style={styles.link}>{t('settings_privacy_policy')}</Text>
          </Pressable>
          <Pressable onPress={openTermsOfService}>
            <Text style={styles.link}>{t('settings_terms')}</Text>
          </Pressable>
          <Text style={styles.helperText}>
            {isGerman ? 'Werbeeinwilligung' : 'Ad consent status'}: {adsCompliance.consentStatus} | {isGerman ? 'Modus' : 'Mode'}: {adsCompliance.requestNonPersonalizedAdsOnly ? (isGerman ? 'Nicht personalisierte Werbung' : 'Non-personalized ads') : (isGerman ? 'Personalisierte Werbung' : 'Personalized ads')}
          </Text>
          <Pressable onPress={handleManageAdsPrivacy}>
            <Text style={styles.link}>{isGerman ? 'Werbe-Datenschutz verwalten' : 'Manage ad privacy choices'}</Text>
          </Pressable>
          <Pressable onPress={handleResetAdsConsent}>
            <Text style={styles.link}>{isGerman ? 'Werbeeinwilligung zurucksetzen' : 'Reset ad consent'}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Alert.alert(isGerman ? 'Meine Daten loschen' : 'Delete my data', isGerman ? 'Das loscht kontobezogene personliche Daten und behalt nur anonymisierte Aggregat-Analysen.' : 'This deletes account-linked personal data and keeps only anonymized aggregate analytics.', [
                { text: t('common_cancel'), style: 'cancel' },
                {
                  text: t('common_delete'),
                  style: 'destructive',
                  onPress: async () => {
                    await deleteUserData();
                    await actions.resetData();
                  },
                },
              ]);
            }}
          >
            <Text style={styles.delete}>{isGerman ? 'Meine Daten loschen' : 'Delete my data'}</Text>
          </Pressable>
        </View>

        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DevOps</Text>
            <View style={styles.debugActions}>
              <Pressable
                style={styles.debugButton}
                onPress={() => runTest('ticketmaster_test', async () => {
                  const availability = buildAvailability();
                  const results = await fetchTicketmasterSuggestions(state.location, state.prefs, availability);
                  return results.length;
                })}
              >
                <Text style={styles.debugButtonText}>Test Ticketmaster</Text>
              </Pressable>
              <Pressable
                style={styles.debugButton}
                onPress={() => runTest('seatgeek_test', async () => {
                  if (!requireLocation()) return null;
                  const availability = buildAvailability();
                  const results = await fetchSeatGeekSuggestions(state.location, state.prefs, availability);
                  return results.length;
                })}
              >
                <Text style={styles.debugButtonText}>Test SeatGeek</Text>
              </Pressable>
              <Pressable
                style={styles.debugButton}
                onPress={() => runTest('google_places_test', async () => {
                  if (!requireLocation()) return null;
                  const availability = buildAvailability();
                  const results = await fetchGooglePlacesSuggestions(state.location, state.prefs, availability);
                  return results.length;
                })}
              >
                <Text style={styles.debugButtonText}>Test Google Places</Text>
              </Pressable>
              <Pressable
                style={styles.debugButton}
                onPress={() => runTest('osm_test', async () => {
                  if (!requireLocation()) return null;
                  const availability = buildAvailability();
                  const results = await fetchOsmSuggestions(state.location, state.prefs, availability);
                  return results.length;
                })}
              >
                <Text style={styles.debugButtonText}>Test OSM</Text>
              </Pressable>
              <Pressable
                style={styles.debugButton}
                onPress={() => runTest('gemini_test', async () => {
                  const availability = buildAvailability();
                  const results = await fetchGeminiSuggestions(state.location, state.prefs, availability, null, { sessionActivityIntent: state.sessionActivityIntent }, state.userId);
                  return results.length;
                })}
              >
                <Text style={styles.debugButtonText}>Test Gemini</Text>
              </Pressable>
            </View>
            {debugMessages.length === 0 ? (
              <Text style={styles.rowText}>No API errors logged.</Text>
            ) : (
              debugMessages.slice(0, 8).map((msg) => (
                <View key={msg.id} style={styles.debugRow}>
                  <Text style={styles.debugSource}>{msg.source}</Text>
                  <Text style={styles.debugText}>{msg.message}</Text>
                  <Text style={styles.debugTime}>{formatTime(new Date(msg.ts))}</Text>
                </View>
              ))
            )}
            {debugMessages.length > 0 && (
              <Pressable onPress={clearDebugMessages}>
                <Text style={styles.link}>Clear logs</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    padding: theme.spacing.lg,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    marginTop: theme.spacing.sm,
    color: theme.colors.text,
  },
  sessionIntentShell: {
    marginTop: theme.spacing.lg,
  },
  sessionIntentBorder: {
    borderRadius: theme.radius.lg,
    padding: 1,
  },
  sessionIntentCard: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  sessionIntentTitle: {
    fontFamily: theme.fonts.heading,
    fontSize: 22,
    color: theme.colors.text,
  },
  sessionIntentSubtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    lineHeight: 20,
  },
  sessionIntentInput: {
    marginTop: theme.spacing.xs,
    minHeight: 104,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.surface,
  },
  sessionIntentActions: {
    gap: theme.spacing.sm,
  },
  sessionIntentButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  },
  sessionIntentButtonText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.semibold,
  },
  sessionIntentHint: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  section: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  rowText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.accentSoft,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.sm,
  },
  actionText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  slider: {
    width: '100%',
    height: 40,
    marginTop: theme.spacing.xs,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  helperText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  wakeWindowContainer: {
    marginVertical: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  preferenceLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 14,
    marginTop: theme.spacing.sm,
    color: theme.colors.textMuted,
  },
  groupLabel: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.md,
    marginBottom: 2,
    opacity: 0.7,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.card,
  },
  textArea: {
    marginTop: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 110,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    backgroundColor: theme.colors.card,
  },
  addPill: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
  },
  addPillText: {
    color: theme.colors.accentText,
    fontFamily: theme.fonts.semibold,
  },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  calendarTitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
  },
  calendarStatus: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  link: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accentDark,
  },
  delete: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
  debugRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 2,
  },
  debugActions: {
    gap: theme.spacing.sm,
  },
  debugButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  debugButtonText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  debugSource: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
  },
  debugText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  debugTime: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 11,
  },
});
