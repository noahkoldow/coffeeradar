import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/I18nProvider';

type Props = StackScreenProps<RootStackParamList, 'PrivacyPolicy'>;

export const PrivacyPolicyScreen: React.FC<Props> = ({ navigation }) => {
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

        <Text style={styles.title}>{t('legal_privacy_title')}</Text>
        <Text style={styles.updated}>{t('legal_last_updated')}</Text>

        <Section title={isGerman ? 'Was wir erfassen' : 'What we collect'}>
          {isGerman
            ? 'Wir erfassen Kontodaten (E-Mail und Auth-ID), Prferenzen, Aktivitatsverlauf, Werbeeinwilligungen und App-Diagnosen, die fur den Betrieb von Bits erforderlich sind.'
            : 'We collect account details (email and auth identifier), preference settings, activity history, ad consent choices, and app diagnostics needed to operate Bits.'}
        </Section>

        <Section title={isGerman ? 'Berechtigungen' : 'Permissions'}>
          {isGerman
            ? 'Kalenderberechtigung wird genutzt, um Zeitfenster zu lesen und Planvorschlage zu unterstutzen. Standortberechtigung wird genutzt, um passende Aktivitaten in der Nahe vorzuschlagen und realistische Wegezeiten zu schatzen.'
            : 'Calendar permission is used to read time windows and help schedule suggestions. Location permission is used to suggest nearby activities and estimate realistic travel context.'}
        </Section>

        <Section title={isGerman ? 'Werbung und Personalisierung' : 'Ads and personalization'}>
          {isGerman
            ? 'Wir nutzen Google AdMob. Anzeigen konnen je nach Einwilligung und Region personalisiert oder nicht personalisiert sein. Deine Werbe-Datenschutzwahl kannst du in den Einstellungen jederzeit verwalten oder zurucksetzen.'
            : 'We use Google AdMob. Ads may be non-personalized or personalized based on your consent and region. You can manage or reset ad privacy choices in Settings at any time.'}
        </Section>

        <Section title={isGerman ? 'Drittanbieter-Dienste' : 'Third-party services'}>
          {isGerman
            ? 'Wir nutzen Firebase (Authentifizierung und Speicherung), Google AdMob sowie optionale Integrationen wie Google Places, Open-Meteo, Ticketmaster, SeatGeek und Gemini, sofern aktiviert.'
            : 'We use Firebase (authentication and storage), Google AdMob, and optional integrations including Google Places, Open-Meteo, Ticketmaster, SeatGeek, and Gemini when enabled.'}
        </Section>

        <Section title={isGerman ? 'Datenweitergabe' : 'Data sharing'}>
          {isGerman
            ? 'Wir verkaufen keine personlichen Daten. Einige Kennzahlen zu Werbeleistung und Kampagnen werden fur Reporting-Zwecke in aggregierter oder Event-Form mit Business-Partnern geteilt.'
            : 'We do not sell personal data. Some ad-performance and campaign metrics are shared with business partners in aggregated or event-level form required for campaign reporting.'}
        </Section>

        <Section title={isGerman ? 'Kontoloschung' : 'Account deletion'}>
          {isGerman
            ? 'Du kannst die Loschung in den Einstellungen anfordern. Wir loschen kontobezogene personliche Daten und behalten nur anonymisierte, aggregierte Analysen ohne Personenbezug.'
            : 'You can request deletion from Settings. We delete account-linked personal data and retain only anonymized, aggregated analytics that cannot identify you.'}
        </Section>

        <Section title={isGerman ? 'Speicherdauer' : 'Retention'}>
          {isGerman
            ? 'Personliche Daten werden nur so lange gespeichert, wie es fur den Dienst, rechtliche Pflichten, Betrugsprvention und Support erforderlich ist.'
            : 'Personal data is kept only as long as needed to provide the service, legal obligations, fraud prevention, and support operations.'}
        </Section>

        <Section title={isGerman ? 'Deine Rechte' : 'Your rights'}>
          {isGerman
            ? 'Je nach Region hast du moglicherweise Rechte auf Auskunft, Berichtigung, Loschung oder Einschrankung der Verarbeitung deiner personlichen Daten.'
            : 'Depending on your region, you may have rights to access, correct, delete, or restrict processing of your personal data.'}
        </Section>

        <Section title={isGerman ? 'Kontakt' : 'Contact'}>
          {isGerman ? 'Fur Datenschutzanfragen: bitsapp.admin@gmail.com' : 'For privacy requests, contact: bitsapp.admin@gmail.com'}
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
