import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { useTheme } from '../theme/ThemeProvider';
import { signInWithEmail, signUpWithEmail } from '../services/auth';
import { firebaseEnabled } from '../services/firebase';

type Mode = 'signup' | 'login';

export const AuthScreen: React.FC = () => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Welcome</Text>
        <Text style={styles.subtitle}>Create an account to personalize what you do next.</Text>

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
          />
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
