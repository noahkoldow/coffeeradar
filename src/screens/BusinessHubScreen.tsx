import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeProvider';
import { useAppState } from '../state/AppState';
import { getBusinessProfile, createBusinessProfile } from '../services/business';
import { BusinessOnboarding } from './BusinessOnboardingScreen';
import { BusinessDashboardScreen } from './BusinessDashboardScreen';
import { BusinessAccountCreationScreen } from './BusinessAccountCreationScreen';

type Props = StackScreenProps<RootStackParamList, 'BusinessHub'>;

/**
 * Business Hub acts as a router:
 * - If user has no business profile → show onboarding
 * - If user has a business profile → show dashboard
 */
export const BusinessHubScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const { state, actions } = useAppState();
  const [loading, setLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const checkBusinessProfile = async () => {
      if (!state.userId) {
        setLoading(false);
        return;
      }

      try {
        const profile = await getBusinessProfile(state.userId);
        setHasProfile(!!profile);
        if (profile) {
          actions.setBusinessProfile(profile);
        }
      } catch (error) {
        console.error('Error checking business profile:', error);
      } finally {
        setLoading(false);
      }
    };

    checkBusinessProfile();
  }, [state.userId, actions]);

  if (loading) {
    return (
      <View style={[StyleSheet.create({ container: { flex: 1, justifyContent: 'center', alignItems: 'center' } }).container, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }
  // If user has a business profile, show dashboard
  if (hasProfile && state.businessProfile) {
    return <BusinessDashboardScreen navigation={navigation} route={{ key: 'BusinessDashboard', name: 'BusinessHub', params: undefined }} />;
  }

  // If onboarding finished, show account creation
  if (showCreate) {
    return (
      <BusinessAccountCreationScreen
        onBack={() => setShowCreate(false)}
        onComplete={async (profile) => {
          if (!state.userId) return;
          setCreating(true);
          try {
            const created = await createBusinessProfile(state.userId, profile as any);
            setHasProfile(true);
            actions.setBusinessProfile(created as any);
          } catch (err) {
            console.error('Failed to create business profile:', err);
          } finally {
            setCreating(false);
          }
        }}
      />
    );
  }

  // Otherwise show onboarding
  return (
    <BusinessOnboarding
      onComplete={() => setShowCreate(true)}
      onSkip={() => setShowCreate(true)}
      // navigation/route props intentionally not passed; onboarding is a simple UI component
    />
  );
};
