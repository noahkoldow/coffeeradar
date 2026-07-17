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

export const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const isAdmin = isBusinessAdmin(state.userEmail);
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
  const [clockTick, setClockTick] = useState(Date.now());
  const [interestTags, setInterestTags] = useState<string[]>(state.prefs.interestTags || []);
  const [customInterests, setCustomInterests] = useState<string[]>(state.prefs.customInterests ?? []);
  const [interestInput, setInterestInput] = useState('');
  const [selfDescription, setSelfDescription] = useState(state.prefs.selfDescription ?? '');
  const [lifestyle, setLifestyle] = useState(state.prefs.lifestyle ?? 'mixed');
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

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>

        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Local time</Text>
          <Text style={styles.rowText}>{formatTime(new Date(clockTick))}</Text>
          <Text style={styles.rowText}>Timezone: {state.location.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</Text>
          <Text style={styles.rowText}>Wake window: {formatClockTime(wakeStartTime)} - {formatClockTime(wakeEndTime)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <Text style={styles.rowText}>
            Calendar: {state.permissions.calendarGranted ? 'Granted' : 'Not granted'}
          </Text>
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
              <Text style={styles.actionText}>Grant calendar</Text>
            </Pressable>
          )}
          <Text style={styles.rowText}>
            Location: {state.permissions.locationGranted ? 'Granted' : 'Not granted'}
          </Text>
          {!state.permissions.locationGranted && (
            <Pressable
              style={styles.actionButton}
              onPress={async () => {
                const granted = await requestLocationPermission();
                actions.setPermissions({ ...state.permissions, locationGranted: granted });
              }}
            >
              <Text style={styles.actionText}>Grant location</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business Account</Text>
          <ToggleRow
            label="Business-only mode"
            value={state.isBusinessOnly}
            onValueChange={(value) => {
              if (value) {
                Alert.alert(
                  'Enable business-only mode?',
                  'Consumer screens will be hidden until you turn this off again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Enable',
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
            When enabled, consumer screens, Home, and AI queuing are hidden until you disable it.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mode</Text>
          <ToggleRow
            label="Dark theme"
            value={state.prefs.themeMode === 'dark'}
            onValueChange={(value) => actions.setPrefs({ ...state.prefs, themeMode: value ? 'dark' : 'light' })}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>

          <Text style={styles.preferenceLabel}>Choose a few that fit you</Text>
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

          <Text style={styles.preferenceLabel}>Add your own interests</Text>
          <View style={styles.inlineRow}>
            <TextInput
              style={styles.textInput}
              value={interestInput}
              onChangeText={setInterestInput}
              placeholder="e.g. pottery, climbing, stand-up comedy"
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

          <Text style={styles.preferenceLabel}>Your lifestyle</Text>
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

          <Text style={styles.preferenceLabel}>Tell us about your daily life</Text>
          <TextInput
            style={styles.textArea}
            value={selfDescription}
            onChangeText={setSelfDescription}
            onBlur={() => updatePrefs({ selfDescription: selfDescription.trim() })}
            placeholder="What do your days look like? What energizes you? What do you usually avoid?"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={420}
          />

          <Text style={styles.rowText}>Discovery radius ({state.prefs.radiusKm} km)</Text>
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

          <Text style={styles.rowText}>Wake window</Text>
          <Text style={styles.helperText}>Keeps suggestions away from sleep time unless you are clearly awake irregularly.</Text>
          <View style={styles.wakeWindowContainer}>
            <WakeWindowRange
              start={wakeStartTime}
              end={wakeEndTime}
              onChange={(s, e) => updateWakeWindow(s, e)}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Calendars</Text>
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
                  <Text style={styles.calendarStatus}>{enabled ? 'On' : 'Off'}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.rowText}>Grant calendar access to manage calendars.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
            <Pressable onPress={() => Linking.openURL('https://firebase.google.com/support/privacy')}>
              <Text style={styles.link}>Data privacy</Text>
            </Pressable>
          <Pressable
            onPress={() => {
              Alert.alert('Delete my data', 'This clears your local data and user record.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await deleteUserData();
                    await actions.resetData();
                  },
                },
              ]);
            }}
          >
            <Text style={styles.delete}>Delete my data</Text>
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
                  const results = await fetchGeminiSuggestions(state.location, state.prefs, availability, null, undefined, state.userId);
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
