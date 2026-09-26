import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useI18n } from '../i18n/I18nProvider';
import { useAppState } from '../state/AppState';
import { getCoreAiNotice, loadCoreAiConsent, requestCoreAiConsent, setCoreAiConsent, useCoreAiConsent, useCoreAiRevocationPending } from '../services/aiConsent';

type Props = StackScreenProps<RootStackParamList, 'AIPrivacy'>;

export const AIPrivacyScreen: React.FC<Props> = ({ navigation }) => {
  const { state } = useAppState();
  // Reset pending confirmation and errors when the account changes.
  return <AIPrivacyContent key={state.userId ?? 'signed-out'} userId={state.userId} navigation={navigation} />;
};

const AIPrivacyContent: React.FC<{ userId: string | null; navigation: Props['navigation'] }> = ({ userId, navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { t, language } = useI18n();
  const isGerman = language === 'de';
  const insets = useSafeAreaInsets();
  const consent = useCoreAiConsent();
  const revocationPending = useCoreAiRevocationPending();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<'enable' | 'disable' | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const mounted = useRef(true);
  const saving = useRef(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoadState('loading');
    void loadCoreAiConsent().then(
      () => { if (active) setLoadState('ready'); },
      () => { if (active) setLoadState('error'); },
    );
    return () => { active = false; };
  }, [userId, loadAttempt]);

  const changeConsent = async (allowed: boolean) => {
    if (saving.current || !userId) return;
    saving.current = true;
    setBusy(true);
    setSaveError(null);
    setConfirmDisable(false);
    try {
      if (allowed) await requestCoreAiConsent(isGerman);
      else await setCoreAiConsent(false);
    } catch {
      if (mounted.current) setSaveError(allowed ? 'enable' : 'disable');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const warning = isGerman
    ? 'KI ist die Grundlage für die Kernfunktionen von Bits. Wenn du KI ausschaltest, stehen personalisierte KI-Vorschläge, automatische KI-Planung und der KI-Fotoimport nicht mehr zur Verfügung. Die App funktioniert dann nicht wie vorgesehen. Funktionen ohne KI bleiben verfügbar. Du kannst KI hier jederzeit wieder aktivieren.'
    : 'AI powers the core features of Bits. Turning it off disables personalized AI suggestions, automatic AI planning and AI photo import. The app will not function as intended. Features that do not rely on AI remain available. You can enable AI again here at any time.';

  return (
    <LinearGradient colors={[theme.colors.background, theme.colors.backgroundAlt]} style={styles.container}>
      <ScrollView
        ref={scroll}
        onContentSizeChange={() => { if (confirmDisable) scroll.current?.scrollToEnd({ animated: true }); }}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + theme.spacing.sm, paddingBottom: insets.bottom + theme.spacing.lg }]}
      >
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.back}>{t('common_back')}</Text>
        </Pressable>
        <Text style={styles.title}>{isGerman ? 'KI-Datenschutz' : 'AI privacy'}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Wie Bits KI verwendet' : 'How Bits uses AI'}</Text>
          <Text style={styles.body}>{getCoreAiNotice(isGerman)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isGerman ? 'Deine KI-Einstellung' : 'Your AI choice'}</Text>
          {!userId ? (
            <Text style={styles.body}>{isGerman ? 'Melde dich an, um deine KI-Datenschutzeinstellungen zu verwalten.' : 'Sign in to manage your AI privacy choices.'}</Text>
          ) : (
            <>
              <Text style={styles.body} accessibilityLiveRegion="polite">
                {busy ? (isGerman ? 'Wird gespeichert…' : 'Saving…')
                  : loadState === 'loading' ? (isGerman ? 'KI-Einstellung wird geladen…' : 'Loading AI choice…')
                    : loadState === 'error' ? (isGerman ? 'Die KI-Einstellung konnte nicht geladen werden.' : 'Unable to load your AI choice.')
                      : consent === 'enabled' ? (isGerman ? 'KI ist aktiviert' : 'AI is enabled')
                        : consent === 'disabled' ? (isGerman ? 'KI ist ausgeschaltet' : 'AI is off')
                          : (isGerman ? 'KI-Einwilligung erforderlich' : 'AI consent required')}
              </Text>
              {loadState === 'error' && (
                <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setLoadAttempt(attempt => attempt + 1)}>
                  <Text style={styles.secondaryText}>{isGerman ? 'Erneut versuchen' : 'Try again'}</Text>
                </Pressable>
              )}
              {(saveError || (revocationPending && !busy)) && (
                <Text style={styles.body} accessibilityRole="alert">
                  {revocationPending || saveError === 'disable'
                    ? (isGerman ? 'Der Widerruf konnte nicht gespeichert werden. Tippe auf „Widerruf erneut speichern“, damit KI auch nach einem Neustart ausgeschaltet bleibt.' : 'We could not save your revocation. Tap “Retry saving revocation” to keep AI off after restarting the app.')
                    : (isGerman ? 'Die Auswahl konnte nicht gespeichert werden. Bitte erneut versuchen.' : 'Unable to save your choice. Please try again.')}
                </Text>
              )}
              {loadState === 'ready' && (
                <>
                  {consent !== 'enabled' && !confirmDisable && (
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={[styles.primaryButton, busy && styles.disabled]} onPress={() => { void changeConsent(true); }}>
                      <Text style={styles.primaryText}>{isGerman ? 'KI erlauben' : 'Allow AI'}</Text>
                    </Pressable>
                  )}
                  {revocationPending || saveError === 'disable' ? (
                    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondaryButton} onPress={() => { void changeConsent(false); }}>
                      <Text style={styles.secondaryText}>{isGerman ? 'Widerruf erneut speichern' : 'Retry saving revocation'}</Text>
                    </Pressable>
                  ) : consent !== 'disabled' && !confirmDisable && (
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} style={[styles.secondaryButton, busy && styles.disabled]} onPress={() => setConfirmDisable(true)}>
                      <Text style={styles.secondaryText}>{isGerman ? 'KI ausschalten' : 'Turn off AI'}</Text>
                    </Pressable>
                  )}
                </>
              )}
            </>
          )}
        </View>

        {confirmDisable && (
          <View style={[styles.section, styles.warning]} accessibilityRole="alert">
            <Text style={styles.sectionTitle}>{isGerman ? 'KI ausschalten?' : 'Turn off AI?'}</Text>
            <Text style={styles.body}>{warning}</Text>
            <Text style={styles.body}>{isGerman ? 'Der Widerruf gilt für zukünftige KI-Anfragen.' : 'Your withdrawal applies to future AI requests.'}</Text>
            <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setConfirmDisable(false)}>
              <Text style={styles.secondaryText}>{t('common_cancel')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={[styles.primaryButton, styles.destructiveButton]} onPress={() => { void changeConsent(false); }}>
              <Text style={styles.primaryText}>{isGerman ? 'KI ausschalten' : 'Turn off AI'}</Text>
            </Pressable>
          </View>
        )}
        {consent === 'disabled' && userId && (
          <View style={[styles.section, styles.warning]}>
            <Text style={styles.sectionTitle}>{isGerman ? 'Bits ist ohne KI eingeschränkt' : 'Bits is limited without AI'}</Text>
            <Text style={styles.body}>{warning}</Text>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md },
  backButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  back: { fontFamily: theme.fonts.semibold, color: theme.colors.textMuted },
  title: { fontFamily: theme.fonts.heading, fontSize: 28, color: theme.colors.text },
  section: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card, padding: theme.spacing.md, gap: theme.spacing.sm,
  },
  sectionTitle: { fontFamily: theme.fonts.semibold, fontSize: 16, color: theme.colors.text },
  body: { fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 22, color: theme.colors.textMuted },
  warning: { borderColor: theme.colors.danger },
  destructiveButton: { backgroundColor: theme.colors.danger },
  primaryButton: {
    minHeight: 48, padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontFamily: theme.fonts.semibold, color: theme.colors.accentText, fontSize: 15, textAlign: 'center' },
  secondaryButton: {
    minHeight: 48, padding: theme.spacing.sm, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { fontFamily: theme.fonts.semibold, color: theme.colors.text, fontSize: 15, textAlign: 'center' },
  disabled: { opacity: 0.6 },
});
