import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeProvider';
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import { BusinessOnboarding } from '../screens/BusinessOnboardingScreen';
import { BusinessAccountCreationScreen } from '../screens/BusinessAccountCreationScreen';
import { CampaignListScreen } from '../screens/CampaignListScreen';
import { CampaignDetailsScreen } from '../screens/CampaignDetailsScreen';
import { CampaignCreationScreen } from '../screens/CampaignCreationScreen';
import { CampaignPreviewScreen } from '../screens/CampaignPreviewScreen';
import { AudienceInsightsScreen } from '../screens/AudienceInsightsScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { BusinessSettingsScreen } from '../screens/BusinessSettingsScreen';
import { ApprovalQueueScreen } from '../screens/ApprovalQueueScreen';
import { BusinessProfileEditorScreen } from '../screens/BusinessProfileEditorScreen';

export type BusinessStackParamList = {
  BusinessOnboarding: undefined;
  BusinessAccountCreation: undefined;
  BusinessDashboard: undefined;
  CampaignList: undefined;
  CampaignCreate: undefined;
  CampaignPreview: { campaignId: string };
  CampaignDetails: { campaignId: string };
  AudienceInsights: { campaignId: string };
  Billing: undefined;
  BusinessSettings: undefined;
  ApprovalQueue: undefined;
  BusinessProfileEditor: undefined;
};

const Stack = createNativeStackNavigator<BusinessStackParamList>();

export const BusinessNavigator: React.FC = () => {
  const theme = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'default',
      }}
    >
      <Stack.Screen
        name="BusinessDashboard"
        component={BusinessDashboardScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="BusinessOnboarding"
        options={{
          contentStyle: { backgroundColor: theme.colors.background },
          gestureEnabled: false,
        }}
      >
        {({ navigation }) => (
          <BusinessOnboarding
            onComplete={() => navigation.replace('BusinessAccountCreation')}
            onSkip={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="BusinessAccountCreation"
        options={{
          contentStyle: { backgroundColor: theme.colors.background },
          gestureEnabled: false,
        }}
      >
        {({ navigation }) => (
          <BusinessAccountCreationScreen
            onComplete={() => navigation.replace('BusinessDashboard')}
            onBack={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="CampaignList"
        component={CampaignListScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="CampaignDetails"
        component={CampaignDetailsScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="CampaignCreate"
        component={CampaignCreationScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="CampaignPreview"
        component={CampaignPreviewScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="AudienceInsights"
        component={AudienceInsightsScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="Billing"
        component={BillingScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="BusinessSettings"
        component={BusinessSettingsScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="ApprovalQueue"
        component={ApprovalQueueScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
      <Stack.Screen
        name="BusinessProfileEditor"
        component={BusinessProfileEditorScreen as any}
        options={{ contentStyle: { backgroundColor: theme.colors.background } }}
      />
    </Stack.Navigator>
  );
};
