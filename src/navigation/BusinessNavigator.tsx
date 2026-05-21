import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BusinessDashboardScreen from '../screens/BusinessDashboardScreen';
import BusinessOnboardingScreen from '../screens/BusinessOnboardingScreen';
import BusinessAccountCreationScreen from '../screens/BusinessAccountCreationScreen';
import CampaignListScreen from '../screens/CampaignListScreen';
import CampaignDetailsScreen from '../screens/CampaignDetailsScreen';
import CampaignCreationScreen from '../screens/CampaignCreationScreen';
import CampaignPreviewScreen from '../screens/CampaignPreviewScreen';
import AudienceInsightsScreen from '../screens/AudienceInsightsScreen';
import BillingScreen from '../screens/BillingScreen';
import BusinessSettingsScreen from '../screens/BusinessSettingsScreen';
import ApprovalQueueScreen from '../screens/ApprovalQueueScreen';
import BusinessProfileEditorScreen from '../screens/BusinessProfileEditorScreen';

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
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animationEnabled: true,
      }}
    >
      <Stack.Screen
        name="BusinessDashboard"
        component={BusinessDashboardScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="BusinessOnboarding"
        component={BusinessOnboardingScreen}
        options={{
          cardStyle: { backgroundColor: '#fff' },
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="BusinessAccountCreation"
        component={BusinessAccountCreationScreen}
        options={{
          cardStyle: { backgroundColor: '#fff' },
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="CampaignList"
        component={CampaignListScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="CampaignDetails"
        component={CampaignDetailsScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="CampaignCreate"
        component={CampaignCreationScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="CampaignPreview"
        component={CampaignPreviewScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="AudienceInsights"
        component={AudienceInsightsScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="Billing"
        component={BillingScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="BusinessSettings"
        component={BusinessSettingsScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="ApprovalQueue"
        component={ApprovalQueueScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
      <Stack.Screen
        name="BusinessProfileEditor"
        component={BusinessProfileEditorScreen}
        options={{ cardStyle: { backgroundColor: '#fff' } }}
      />
    </Stack.Navigator>
  );
};
