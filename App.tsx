import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { enableScreens } from 'react-native-screens';
import { AppStateProvider, useAppState } from './src/state/AppState';
import { RootStackParamList } from './src/navigation/types';
import { AuthScreen } from './src/screens/AuthScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { CalendarPermissionScreen } from './src/screens/CalendarPermissionScreen';
import { CalendarSelectScreen } from './src/screens/CalendarSelectScreen';
import { LocationPermissionScreen } from './src/screens/LocationPermissionScreen';
import { PreferencesScreen } from './src/screens/PreferencesScreen';
import { OnboardingCompleteScreen } from './src/screens/OnboardingCompleteScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { CommunityIdeaFormScreen } from './src/screens/CommunityIdeaFormScreen';
import { CommunityIdeaSuccessScreen } from './src/screens/CommunityIdeaSuccessScreen';
import { DeckScreen } from './src/screens/DeckScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ActivityChatScreen } from './src/screens/ActivityChatScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { BusinessHubScreen } from './src/screens/BusinessHubScreen';
import { ApprovalQueueScreen } from './src/screens/ApprovalQueueScreen';
import { HabitFormScreen } from './src/screens/HabitFormScreen';
import { HabitsScreen } from './src/screens/HabitsScreen';
import { SmartCalendarScreen } from './src/screens/SmartCalendarScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { BadgeDetailScreen } from './src/screens/BadgeDetailScreen';
import { CompletionScreen } from './src/screens/CompletionScreen';
import { BankScreen } from './src/screens/BankScreen';
import { PremiumScreen } from './src/screens/PremiumScreen';
import { BusinessCampaignFormScreen } from './src/screens/BusinessCampaignFormScreen';
import { BusinessCampaignsListScreen } from './src/screens/BusinessCampaignsListScreen';
import { BusinessAnalyticsScreen } from './src/screens/BusinessAnalyticsScreen';
import { BusinessAudienceScreen } from './src/screens/BusinessAudienceScreen';
import { BusinessSettingsScreen } from './src/screens/BusinessSettingsScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { lightTheme } from './src/theme';
import { logEvent } from './src/services/analytics';
import { firebaseEnabled } from './src/services/firebase';

const Stack = createStackNavigator<RootStackParamList>();

if (Platform.OS === 'web') {
  enableScreens(false);
}

const AppNavigator = () => {
  const { state } = useAppState();
  const theme = useTheme();
  const requiresAuth = firebaseEnabled;

  useEffect(() => {
    if (!state.loading) logEvent('app_open');
  }, [state.loading]);

  if (state.loading || !state.authChecked) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (requiresAuth && !state.userId) {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Auth" component={AuthScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  const appBackground = lightTheme.colors.background;
  const navigatorKey = state.isBusinessOnly ? 'business-only' : 'main';
  const navigationTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: appBackground,
      card: appBackground,
    },
  };

  const businessScreenOptions = state.isBusinessOnly ? { gestureEnabled: false } : undefined;
  const smartCalendarScreenOptions = { gestureEnabled: false };

  const businessOnlyNavigator = (
    <Stack.Navigator
      key={navigatorKey}
      initialRouteName="BusinessHub"
      screenOptions={{ headerShown: false, cardStyle: { backgroundColor: appBackground } }}
    >
      <Stack.Screen name="BusinessHub" component={BusinessHubScreen} options={businessScreenOptions} />
      <Stack.Screen name="ApprovalQueue" component={ApprovalQueueScreen} options={businessScreenOptions} />
      <Stack.Screen name="BusinessCampaignForm" component={BusinessCampaignFormScreen} options={businessScreenOptions} />
      <Stack.Screen name="BusinessCampaignsList" component={BusinessCampaignsListScreen} options={businessScreenOptions} />
      <Stack.Screen name="BusinessAnalytics" component={BusinessAnalyticsScreen} options={businessScreenOptions} />
      <Stack.Screen name="BusinessAudience" component={BusinessAudienceScreen} options={businessScreenOptions} />
      <Stack.Screen name="BusinessSettings" component={BusinessSettingsScreen} options={businessScreenOptions} />
      <Stack.Screen name="SmartCalendar" component={SmartCalendarScreen} options={smartCalendarScreenOptions} />
    </Stack.Navigator>
  );

  return (
    <NavigationContainer theme={navigationTheme}>
      {state.isBusinessOnly ? (
        businessOnlyNavigator
      ) : (
        <Stack.Navigator
          key={navigatorKey}
          initialRouteName={state.onboardingComplete ? 'Home' : 'Welcome'}
          screenOptions={{ headerShown: false, cardStyle: { backgroundColor: appBackground } }}
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="CalendarPermission" component={CalendarPermissionScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="CalendarSelect" component={CalendarSelectScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="LocationPermission" component={LocationPermissionScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="OnboardingComplete" component={OnboardingCompleteScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="Home" component={HomeScreen} options={{ gestureEnabled: false }} />
          <Stack.Screen name="CommunityIdeaForm" component={CommunityIdeaFormScreen} />
          <Stack.Screen name="CommunityIdeaSuccess" component={CommunityIdeaSuccessScreen} />
          <Stack.Screen name="Bank" component={BankScreen} />
          <Stack.Screen name="Premium" component={PremiumScreen} />
          <Stack.Screen name="Deck" component={DeckScreen} />
          <Stack.Screen name="Plan" component={PlanScreen} />
          <Stack.Screen name="ActivityChat" component={ActivityChatScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="BusinessHub" component={BusinessHubScreen} options={businessScreenOptions} />
          <Stack.Screen name="ApprovalQueue" component={ApprovalQueueScreen} options={businessScreenOptions} />
          <Stack.Screen name="BusinessCampaignForm" component={BusinessCampaignFormScreen} options={businessScreenOptions} />
          <Stack.Screen name="BusinessCampaignsList" component={BusinessCampaignsListScreen} options={businessScreenOptions} />
          <Stack.Screen name="BusinessAnalytics" component={BusinessAnalyticsScreen} options={businessScreenOptions} />
          <Stack.Screen name="BusinessAudience" component={BusinessAudienceScreen} options={businessScreenOptions} />
          <Stack.Screen name="BusinessSettings" component={BusinessSettingsScreen} options={businessScreenOptions} />
          <Stack.Screen name="HabitForm" component={HabitFormScreen} />
          <Stack.Screen name="Habits" component={HabitsScreen} />
          <Stack.Screen name="SmartCalendar" component={SmartCalendarScreen} options={smartCalendarScreenOptions} />
          <Stack.Screen name="Library" component={LibraryScreen} />
          <Stack.Screen name="BadgeDetail" component={BadgeDetailScreen} />
          <Stack.Screen name="Completion" component={CompletionScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
};

export default function App() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={[styles.loading, { backgroundColor: lightTheme.colors.background }]}>
        <ActivityIndicator color={lightTheme.colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppStateProvider>
          <ThemeProvider>
            <ThemedAppShell />
          </ThemeProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const ThemedAppShell = () => {
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ThemedStatusBar />
      <AppNavigator />
    </View>
  );
};

const ThemedStatusBar = () => {
  const theme = useTheme();
  const isDark = theme.isDark;
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
