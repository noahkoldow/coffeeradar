import { Commitment, DeckSuggestion, Habit } from '../types';

export type RootStackParamList = {
  Auth: undefined;
  Welcome: undefined;
  CalendarPermission: undefined;
  CalendarSelect: undefined;
  LocationPermission: undefined;
  Preferences: undefined;
  Home: undefined;
  Deck: { durationOverride?: number | null; filter?: string } | undefined;
  Plan: {
    commitment: Commitment;
    suggestion: DeckSuggestion;
  };
  Settings: undefined;
  Profile: undefined;
  HabitForm: { habit?: Habit } | undefined;
  Habits: { flippedHabitId?: string } | undefined;
  BadgeDetail: { badgeId: string };
  Completion: {
    title: string;
    durationMin: number;
    emojis?: string[];
    tags?: string[];
    suggestionType: 'AT_HOME' | 'GO_OUT' | 'EVENT';
    /** Pass suggestion id so completion screen can offer "add as habit" */
    suggestionId?: string;
    /** If this activity already came from a habit */
    habitId?: string;
    /** Description for habit creation */
    description?: string;
  };
};
