import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { BrandCollabLockup } from '../components/BrandCollabLockup';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { requestCalendarPermission } from '../services/calendar';
import { logEvent } from '../services/analytics';
import { useI18n } from '../i18n/I18nProvider';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;

type Props = StackScreenProps<RootStackParamList, 'CalendarPermission'>;

export const CalendarPermissionScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const isGerman = language === 'de';

  const onRequest = async () => {
    setLoading(true);
    const granted = await requestCalendarPermission();
    actions.setPermissions({
      ...state.permissions,
      calendarGranted: granted,
    });
    await logEvent(granted ? 'permissions_granted_calendar' : 'permissions_denied_calendar');
    setLoading(false);
    if (granted) {
      navigation.navigate('CalendarSelect');
    } else {
      navigation.navigate('LocationPermission');
    }
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
        <Text style={styles.title}>{isGerman ? 'Kalender verbinden 📅' : 'Connect your calendar 📅'}</Text>
        <Text style={styles.subtitle}>
          {isGerman
            ? 'CoffeeRadar liest deinen Kalender, um echte freie Zeit zu finden und passende Vorschlage fur deinen Tag zu machen. Dein Kalender bleibt privat und wird nur fur Personalisierung genutzt.'
            : 'CoffeeRadar reads your schedule to spot real free time and suggest things that fit your day. Your calendar stays yours — used only to personalize your ideas, never sold or shown to other people.'}
        </Text>
      </View>
      <PrimaryButton
        label={loading ? '...' : (isGerman ? 'Kalender erlauben' : 'Allow calendar')}
        onPress={onRequest}
        style={styles.button}
      />
      <Text style={styles.skip} onPress={() => navigation.navigate('LocationPermission')}>
        {isGerman ? 'Jetzt nicht' : 'Not now'}
      </Text>
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
  },
  logo: {
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontFamily: theme.fonts.heading,
    fontSize: 32,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 16,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.md,
    maxWidth: 300,
  },
  button: {
    marginBottom: theme.spacing.sm,
  },
  skip: {
    textAlign: 'center',
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xl,
  },
});
