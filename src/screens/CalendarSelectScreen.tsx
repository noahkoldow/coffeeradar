import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { getCalendars } from '../services/calendar';
import { PrimaryButton } from '../components/PrimaryButton';
import { BrandCollabLockup } from '../components/BrandCollabLockup';
import { useI18n } from '../i18n/I18nProvider';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;

type Props = StackScreenProps<RootStackParamList, 'CalendarSelect'>;

export const CalendarSelectScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [calendars, setCalendars] = useState<{ id: string; title: string }[]>([]);
  const isGerman = language === 'de';

  useEffect(() => {
    const loadCalendars = async () => {
      if (!state.permissions.calendarGranted) return;
      const items = await getCalendars();
      setCalendars(items.map((item) => ({ id: item.id, title: item.title })));
    };
    loadCalendars();
  }, [state.permissions.calendarGranted]);

  const isEnabled = (id: string) => !state.disabledCalendars.includes(id);

  const toggleCalendar = (id: string) => {
    const currentlyEnabled = isEnabled(id);
    const updated = currentlyEnabled
      ? [...state.disabledCalendars, id]
      : state.disabledCalendars.filter((item) => item !== id);
    // Keep at least one calendar enabled.
    if (calendars.length && updated.length >= calendars.length) return;
    actions.setDisabledCalendars(updated);
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
        <Text style={styles.title}>{isGerman ? 'Kalender auswahlen' : 'Pick calendars to use'}</Text>
        <Text style={styles.subtitle}>
          {isGerman
            ? 'Wir lesen nur Event-Namen und Zeiten, um Vorschlage fur deinen Tag zu personalisieren und sicher an unsere KI zu geben. Nie verkauft, nie mit anderen geteilt.'
            : 'We read event names and times only to personalize your suggestions — sent securely to our AI to tailor ideas to your day. Never sold, never shared with other people.'}
        </Text>

        {!state.permissions.calendarGranted ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{isGerman ? 'Kalenderberechtigung nicht erteilt. Du kannst diesen Schritt uberspringen.' : 'Calendar permission not granted. You can skip this step.'}</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {calendars.map((cal) => {
              const enabled = isEnabled(cal.id);
              return (
                <Pressable
                  key={cal.id}
                  style={[styles.row, enabled && styles.rowOn]}
                  onPress={() => toggleCalendar(cal.id)}
                >
                  <Text style={styles.rowTitle}>{cal.title}</Text>
                  <Text style={[styles.rowStatus, enabled && styles.rowStatusOn]}>
                    {enabled ? (isGerman ? 'An' : 'On') : (isGerman ? 'Aus' : 'Off')}
                  </Text>
                </Pressable>
              );
            })}
            {!calendars.length && (
              <Text style={styles.emptyText}>{isGerman ? 'Keine Kalender gefunden.' : 'No calendars found.'}</Text>
            )}
          </View>
        )}
      </View>

      <PrimaryButton
        label={isGerman ? 'Weiter' : 'Continue'}
        onPress={() => navigation.navigate('LocationPermission')}
        style={styles.button}
      />
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
    justifyContent: 'space-between',
  },
  content: {
    marginTop: theme.spacing.xxl,
    gap: theme.spacing.lg,
  },
  logo: {
    alignSelf: 'flex-start',
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 30,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 16,
    color: theme.colors.textMuted,
    maxWidth: 300,
  },
  noticeBox: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  noticeText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  list: {
    gap: theme.spacing.sm,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowOn: {
    backgroundColor: theme.colors.backgroundAlt,
  },
  rowTitle: {
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
  },
  rowStatus: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  rowStatusOn: {
    color: theme.colors.accentDark,
  },
  emptyText: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  button: {
    marginBottom: theme.spacing.xl,
  },
});
