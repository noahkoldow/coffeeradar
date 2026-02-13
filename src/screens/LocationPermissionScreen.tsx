import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { requestLocationPermission } from '../services/location';
import { logEvent } from '../services/analytics';

type Props = StackScreenProps<RootStackParamList, 'LocationPermission'>;

export const LocationPermissionScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const onRequest = async () => {
    setLoading(true);
    const granted = await requestLocationPermission();
    actions.setPermissions({
      ...state.permissions,
      locationGranted: granted,
    });
    await logEvent(granted ? 'permissions_granted_location' : 'permissions_denied_location');
    setLoading(false);
    navigation.navigate('Preferences');
  };

  return (
    <LinearGradient
      colors={[theme.colors.background, theme.colors.backgroundAlt]}
      style={[styles.container, { paddingTop: insets.top + theme.spacing.sm }]}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Allow location</Text>
        <Text style={styles.subtitle}>
          We use your location to make sure you can arrive on time.
        </Text>
      </View>
      <PrimaryButton
        label={loading ? 'Requesting...' : 'Allow location'}
        onPress={onRequest}
        style={styles.button}
      />
      <Text style={styles.skip} onPress={() => navigation.navigate('Preferences')}>
        Not now
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
