import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
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
import { HomeScreen } from './src/screens/HomeScreen';
import { DeckScreen } from './src/screens/DeckScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { HabitFormScreen } from './src/screens/HabitFormScreen';
import { HabitsScreen } from './src/screens/HabitsScreen';
import { BadgeDetailScreen } from './src/screens/BadgeDetailScreen';
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
  const forceOnboarding =
    typeof globalThis !== 'undefined' &&
    (globalThis as any).process?.env?.EXPO_PUBLIC_FORCE_ONBOARDING === 'true';
  const requiresAuth = firebaseEnabled;

  useEffect(() => {
    if (!state.loading) logEvent('app_open');
  }, [state.loading]);

  if (state.loading || !state.authChecked) {
    return (
      <View style={styles.loading}>
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

  const showOnboarding = !state.onboardingComplete || forceOnboarding;

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={showOnboarding ? 'Welcome' : 'Home'}
        screenOptions={{ headerShown: false }}
      >
        {showOnboarding ? (
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="CalendarPermission" component={CalendarPermissionScreen} />
            <Stack.Screen name="CalendarSelect" component={CalendarSelectScreen} />
            <Stack.Screen name="LocationPermission" component={LocationPermissionScreen} />
            <Stack.Screen name="Preferences" component={PreferencesScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Deck" component={DeckScreen} />
            <Stack.Screen name="Plan" component={PlanScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="HabitForm" component={HabitFormScreen} />
            <Stack.Screen name="Habits" component={HabitsScreen} />
            <Stack.Screen name="BadgeDetail" component={BadgeDetailScreen} />
          </>
        )}
      </Stack.Navigator>
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
      <View style={styles.loading}>
        <ActivityIndicator color={lightTheme.colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppStateProvider>
          <ThemeProvider>
            <ThemedStatusBar />
            <AppNavigator />
          </ThemeProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const ThemedStatusBar = () => {
  const theme = useTheme();
  const isDark = theme.colors.background === '#1C1A18';
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: lightTheme.colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: lightTheme.colors.background,
  },
});
