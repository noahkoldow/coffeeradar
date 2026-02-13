import { Commitment, DeckSuggestion } from '../types';

export type RootStackParamList = {
  Auth: undefined;
  Welcome: undefined;
  CalendarPermission: undefined;
  CalendarSelect: undefined;
  LocationPermission: undefined;
  Preferences: undefined;
  Home: undefined;
  Deck: { durationOverride?: number | null } | undefined;
  Plan: {
    commitment: Commitment;
    suggestion: DeckSuggestion;
  };
  Settings: undefined;
  Profile: undefined;
  HabitForm: undefined;
  Habits: undefined;
  BadgeDetail: { badgeId: string };
};
