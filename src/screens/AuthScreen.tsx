import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { PrimaryButton } from '../components/PrimaryButton';
import { BrandCollabLockup } from '../components/BrandCollabLockup';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  isAppleSignInAvailable,
} from '../services/auth';
import { persistOnboardingComplete } from '../services/user';
import { firebaseEnabled } from '../services/firebase';
import { getPrivacyPolicyUrl, getTermsOfServiceUrl } from '../legal/legalLinks';
import { useI18n } from '../i18n/I18nProvider';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;

type Mode = 'signup' | 'login';
type Props = StackScreenProps<RootStackParamList, 'Auth'>;

export const AuthScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { language } = useI18n();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const privacyPolicyUrl = getPrivacyPolicyUrl();
  const termsOfServiceUrl = getTermsOfServiceUrl();
  const isGerman = language === 'de';
  const copy = isGerman
    ? {
        firebaseTitle: 'Firebase nicht konfiguriert',
        firebaseBody: 'Fuge deine Firebase-Konfiguration in src/services/firebase.ts ein.',
        missingTitle: 'Details fehlen',
        missingBody: 'Gib E-Mail und Passwort ein.',
        signupFailed: 'Registrierung fehlgeschlagen',
        loginFailed: 'Anmeldung fehlgeschlagen',
        tryAgain: 'Bitte versuche es erneut.',
        googleFailed: 'Google-Anmeldung fehlgeschlagen',
        appleFailed: 'Apple-Anmeldung fehlgeschlagen',
        title: 'Willkommen',
        subtitle: 'Erstelle ein Konto, um deine nachsten Aktivitaten zu personalisieren.',
        createAccount: 'Konto erstellen',
        login: 'Anmelden',
        email: 'E-Mail',
        password: 'Passwort',
        terms: 'Nutzungsbedingungen',
        privacy: 'Datenschutz',
        or: 'oder',
        continueApple: 'Mit Apple fortfahren',
        continueGoogle: 'Mit Google fortfahren',
        firebaseNotice: 'Firebase-Konfiguration fehlt. Fuge sie hinzu, um Konten zu aktivieren.',
      }
    : {
        firebaseTitle: 'Firebase not configured',
        firebaseBody: 'Add your Firebase config in src/services/firebase.ts.',
        missingTitle: 'Missing details',
        missingBody: 'Enter email and password.',
        signupFailed: 'Sign up failed',
        loginFailed: 'Log in failed',
        tryAgain: 'Try again.',
        googleFailed: 'Google sign-in failed',
        appleFailed: 'Apple sign-in failed',
        title: 'Welcome',
        subtitle: 'Create an account to personalize what you do next.',
        createAccount: 'Create account',
        login: 'Log in',
        email: 'Email',
        password: 'Password',
        terms: 'Terms',
        privacy: 'Privacy',
        or: 'or',
        continueApple: 'Continue with Apple',
        continueGoogle: 'Continue with Google',
        firebaseNotice: 'Firebase config missing. Add it to enable accounts.',
      };

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const openLegalLink = async (url: string | null, fallbackRoute: 'PrivacyPolicy' | 'TermsOfService') => {
    if (!url) {
      navigation.navigate(fallbackRoute);
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        navigation.navigate(fallbackRoute);
        return;
      }
      await Linking.openURL(url);
    } catch {
      navigation.navigate(fallbackRoute);
    }
  };

  const openPrivacyPolicy = () => {
    void openLegalLink(privacyPolicyUrl, 'PrivacyPolicy');
  };

  const openTermsOfService = () => {
    void openLegalLink(termsOfServiceUrl, 'TermsOfService');
  };

  const handleSubmit = async () => {
    if (!firebaseEnabled) {
      Alert.alert(copy.firebaseTitle, copy.firebaseBody);
      return;
    }
    if (!email || !password) {
      Alert.alert(copy.missingTitle, copy.missingBody);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password);
        // New accounts must complete onboarding to set preferences and permissions.
        await persistOnboardingComplete(false);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error: any) {
      Alert.alert(mode === 'signup' ? copy.signupFailed : copy.loginFailed, error?.message ?? copy.tryAgain);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const { isNewUser } = await signInWithGoogle();
      await persistOnboardingComplete(!isNewUser);
    } catch (error: any) {
      if (!error?.message?.includes('cancelled')) {
        Alert.alert(copy.googleFailed, error?.message ?? copy.tryAgain);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApple = async () => {
    setLoading(true);
    try {
      const { isNewUser } = await signInWithApple();
      await persistOnboardingComplete(!isNewUser);
    } catch (error: any) {
      if ((error as any)?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert(copy.appleFailed, error?.message ?? copy.tryAgain);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <BrandCollabLockup height={LOGO_HEIGHT} bitsWidth={LOGO_WIDTH} style={styles.logo} />
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>

        {/* ── Email / password ── */}
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggle, mode === 'signup' && styles.toggleActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
              {copy.createAccount}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggle, mode === 'login' && styles.toggleActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
              {copy.login}
            </Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={copy.email}
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder={copy.password}
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <PrimaryButton
            label={loading ? '...' : mode === 'signup' ? copy.createAccount : copy.login}
            onPress={handleSubmit}
            disabled={loading}
          />

          <View style={styles.complianceWrap}>
            <View style={styles.legalLinksRow}>
              <Pressable onPress={openTermsOfService}>
                <Text style={styles.legalLink}>{copy.terms}</Text>
              </Pressable>
              <Text style={styles.legalDot}>•</Text>
              <Pressable onPress={openPrivacyPolicy}>
                <Text style={styles.legalLink}>{copy.privacy}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* ── Divider ── */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{copy.or}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Social login buttons ── */}
        <View style={styles.socialSection}>
          {appleAvailable && (
            <Pressable
              style={[styles.socialButton, styles.appleButton]}
              onPress={handleApple}
              disabled={loading}
            >
              <Text style={styles.appleIcon}>{'\uF8FF'}</Text>
              <Text style={[styles.socialLabel, styles.appleLabel]}>{copy.continueApple}</Text>
            </Pressable>
          )}

          <LinearGradient
            colors={['#4285F44D', '#EA43354D', '#FBBC054D', '#34A8534D']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.googleBorder}
          >
            <Pressable
              style={[styles.socialButton, styles.googleButton]}
              onPress={handleGoogle}
              disabled={loading}
            >
              <Text style={styles.googleIcon}>G</Text>
              <Text style={[styles.socialLabel, styles.googleLabel]}>{copy.continueGoogle}</Text>
            </Pressable>
          </LinearGradient>
        </View>

        {!firebaseEnabled && (
          <Text style={styles.notice}>{copy.firebaseNotice}</Text>
        )}
      </View>
    </LinearGradient>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) => StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.xl,
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
    fontSize: 34,
    color: theme.colors.text,
  },
  subtitle: {
    fontFamily: theme.fonts.body,
    fontSize: 16,
    color: theme.colors.textMuted,
    maxWidth: 300,
  },
  /* ── Social buttons ── */
  socialSection: {
    gap: theme.spacing.sm,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    gap: 10,
  },
  appleButton: {
    backgroundColor: '#000000',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
  },
  googleBorder: {
    padding: 1,
    borderRadius: theme.radius.md,
  },
  socialLabel: {
    fontFamily: theme.fonts.semibold,
    fontSize: 16,
  },
  appleLabel: {
    color: '#FFFFFF',
  },
  appleIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#4285F4',
  },
  googleLabel: {
    color: theme.colors.text,
  },
  /* ── Divider ── */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  dividerText: {
    fontFamily: theme.fonts.body,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  /* ── Toggle + form ── */
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    padding: 4,
    borderRadius: theme.radius.md,
  },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toggleActive: {
    backgroundColor: theme.colors.accent,
  },
  toggleText: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.textMuted,
  },
  toggleTextActive: {
    color: theme.colors.accentText,
  },
  form: {
    gap: theme.spacing.md,
  },
  complianceWrap: {
    gap: theme.spacing.xs,
  },
  legalLinksRow: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  legalLink: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.accent,
  },
  legalDot: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    backgroundColor: '#FFFFFF',
  },
  notice: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
