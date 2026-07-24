import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'TermsOfService'>;

export const TermsOfServiceScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, language } = useI18n();
  const isGerman = language === 'de';
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>{t('common_back')}</Text>
        </Pressable>

        <Text style={styles.title}>{t('legal_terms_title')}</Text>
        <Text style={styles.updated}>{t('legal_last_updated')}</Text>

        <Section title={isGerman ? 'Nutzungsberechtigung' : 'Eligibility'}>
          {isGerman
            ? 'Du musst mindestens 13 Jahre alt sein, um diese App zu nutzen. Mit der Kontoerstellung bestatigst du diese Altersvoraussetzung.'
            : 'You must be at least 13 years old to use this app. By creating an account, you confirm you meet this age requirement.'}
        </Section>

        <Section title={isGerman ? 'Konto und Sicherheit' : 'Account and security'}>
          {isGerman
            ? 'Du bist fur die Aktivitat auf deinem Konto und die Sicherheit deiner Anmeldung verantwortlich. Zugangsdaten bitte vertraulich halten.'
            : 'You are responsible for the activity on your account and for maintaining your login security. Keep credentials private.'}
        </Section>

        <Section title={isGerman ? 'Nutzung des Dienstes' : 'Service use'}>
          {isGerman
            ? 'Bits bietet Aktivitatsvorschlage und Planungsunterstutzung. Vorschlage dienen zur Information und sind keine medizinische, rechtliche oder finanzielle Beratung.'
            : 'Bits provides activity suggestions and planning assistance. Suggestions are informational and not medical, legal, or financial advice.'}
        </Section>

        <Section title={isGerman ? 'Abos und Kaufe' : 'Subscriptions and purchases'}>
          {isGerman
            ? 'Premium-Abos konnen uber In-App-Kaufe im Apple App Store und bei Google Play angeboten werden. Abrechnung, Kundigung und Erstattungen folgen den Regeln der jeweiligen Plattform.'
            : 'Premium subscriptions may be offered through Apple App Store and Google Play in-app purchases. Billing terms, cancellations, and refunds follow the platform rules where purchased.'}
        </Section>

        <Section title={isGerman ? 'Community-Inhalte' : 'Community content'}>
          {isGerman
            ? 'Du darfst keine rechtswidrigen, missbrauchlichen oder schadlichen Inhalte hochladen. Inhalte, die gegen Regeln verstoSen, konnen moderiert, abgelehnt oder entfernt werden.'
            : 'You must not upload unlawful, abusive, or harmful content. We may moderate, reject, or remove content that violates policy.'}
        </Section>

        <Section title={isGerman ? 'Daten und Datenschutz' : 'Data and privacy'}>
          {isGerman
            ? 'Die Nutzung der App unterliegt auch der Datenschutzerklarung, einschlieSlich Datenverarbeitung, Einwilligungsoptionen und Loschrechten.'
            : 'Your use of the app is also governed by the Privacy Policy, including data processing, consent options, and deletion rights.'}
        </Section>

        <Section title={isGerman ? 'Beendigung' : 'Termination'}>
          {isGerman
            ? 'Wir konnen Konten sperren oder beenden, die gegen diese Bedingungen verstoSen oder den Dienst missbrauchen.'
            : 'We may suspend or terminate accounts that violate these terms or misuse the service.'}
        </Section>

        <Section title={isGerman ? 'Haftungsbeschrankung' : 'Limitation of liability'}>
          {isGerman
            ? 'Soweit gesetzlich zulassig wird Bits ohne Gewahrleistung bereitgestellt; die Haftung fur mittelbare Schaden ist eingeschrankt.'
            : 'To the maximum extent permitted by law, Bits is provided as-is without warranties and with limited liability for indirect damages.'}
        </Section>

        <Section title={isGerman ? 'Kontakt' : 'Contact'}>
          {isGerman ? 'Support und rechtlicher Kontakt: bitsapp.admin@gmail.com' : 'Support and legal contact: bitsapp.admin@gmail.com'}
        </Section>
      </ScrollView>
    </LinearGradient>
  );
};

const Section: React.FC<{ title: string; children: string }> = ({ title, children }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  back: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  title: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.fonts.heading,
    fontSize: 28,
    color: theme.colors.text,
  },
  updated: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  section: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  sectionTitle: {
    fontFamily: theme.fonts.semibold,
    fontSize: 15,
    color: theme.colors.text,
  },
  body: {
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: theme.colors.textMuted,
  },
});
