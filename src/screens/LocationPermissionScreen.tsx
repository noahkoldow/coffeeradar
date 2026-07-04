import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAppState } from '../state/AppState';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/types';
import { requestLocationPermission } from '../services/location';
import { logEvent } from '../services/analytics';

const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * 3;
const bitsLogo = require('../../assets/logo.png');

type Props = StackScreenProps<RootStackParamList, 'LocationPermission'>;

export const LocationPermissionScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { state, actions } = useAppState();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [radiusKm, setRadiusKm] = useState(state.prefs.radiusKm);

  const onRequest = async () => {
    setLoading(true);
    const granted = await requestLocationPermission();
    actions.setPermissions({
      ...state.permissions,
      locationGranted: granted,
    });
    actions.setPrefs({
      ...state.prefs,
      radiusKm,
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
        <Image source={bitsLogo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Allow location 📍</Text>
        <Text style={styles.subtitle}>
          We use your location to make sure you can arrive on time and to find nearby things that fit you.
        </Text>
        <View style={styles.radiusCard}>
          <Text style={styles.radiusLabel}>Search radius — {radiusKm} km</Text>
          <Text style={styles.radiusHint}>Pick how far we should look for good nearby options.</Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={30}
            step={1}
            value={radiusKm}
            onValueChange={setRadiusKm}
            minimumTrackTintColor={theme.colors.accent}
            maximumTrackTintColor={theme.colors.border}
            thumbTintColor={theme.colors.accent}
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1 km</Text>
            <Text style={styles.sliderLabel}>30 km</Text>
          </View>
        </View>
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
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
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
  radiusCard: {
    marginTop: theme.spacing.xl,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  radiusLabel: {
    fontFamily: theme.fonts.semibold,
    color: theme.colors.text,
    fontSize: 15,
  },
  radiusHint: {
    fontFamily: theme.fonts.body,
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  slider: {
    width: '100%',
    height: 40,
    marginTop: theme.spacing.sm,
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
