import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithApple,
  isAppleSignInAvailable,
} from '../services/auth';
import { firebaseEnabled } from '../services/firebase';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const bitsLogo = require('../../assets/logo.png');

type Mode = 'signup' | 'login';

export const AuthScreen: React.FC = () => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  const handleSubmit = async () => {
    if (!firebaseEnabled) {
      Alert.alert('Firebase not configured', 'Add your Firebase config in src/services/firebase.ts.');
      return;
    }
    if (!email || !password) {
      Alert.alert('Missing details', 'Enter email and password.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error: any) {
      Alert.alert(mode === 'signup' ? 'Sign up failed' : 'Log in failed', error?.message ?? 'Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (!error?.message?.includes('cancelled')) {
        Alert.alert('Google sign-in failed', error?.message ?? 'Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApple = async () => {
    setLoading(true);
    try {
      await signInWithApple();
    } catch (error: any) {
      if ((error as any)?.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple sign-in failed', error?.message ?? 'Try again.');
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
        <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>Create an account to personalize what you do next.</Text>

        {/* ── Email / password ── */}
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggle, mode === 'signup' && styles.toggleActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
              Create account
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggle, mode === 'login' && styles.toggleActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
              Log in
            </Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <PrimaryButton
            label={loading ? 'Working...' : mode === 'signup' ? 'Create account' : 'Log in'}
            onPress={handleSubmit}
            disabled={loading}
          />
        </View>

        {/* ── Divider ── */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
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
              <Text style={[styles.socialLabel, styles.appleLabel]}>Continue with Apple</Text>
            </Pressable>
          )}

          <Pressable
            style={[styles.socialButton, styles.googleButton]}
            onPress={handleGoogle}
            disabled={loading}
          >
            <Text style={styles.googleIcon}>G</Text>
            <Text style={[styles.socialLabel, styles.googleLabel]}>Continue with Google</Text>
          </Pressable>
        </View>

        {!firebaseEnabled && (
          <Text style={styles.notice}>Firebase config missing. Add it to enable accounts.</Text>
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
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
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
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
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
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.fonts.body,
    color: theme.colors.text,
    backgroundColor: theme.colors.card,
  },
  notice: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
  },
});
