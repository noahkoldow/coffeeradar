import { Commitment, DeckSuggestion, Habit } from '../types';

export type RootStackParamList = {
  Auth: undefined;
  Welcome: undefined;
  CalendarPermission: undefined;
  CalendarSelect: undefined;
  LocationPermission: undefined;
  Preferences: undefined;
  OnboardingComplete: undefined;
  Home: undefined;
  CommunityIdeaForm: undefined;
  CommunityIdeaSuccess: {
    submissionId: string;
    title: string;
    hook: string;
    description: string;
    durationMin: number;
    tags?: string[];
    emojis?: string[];
    previewImageUri?: string | null;
  };
  Bank: undefined;
  Deck: { durationOverride?: number | null; filter?: string; planDate?: 'today' | 'tomorrow' } | undefined;
  Plan: {
    commitment: Commitment;
    suggestion: DeckSuggestion;
  };
  ActivityChat: {
    threadId: string;
    title: string;
    expiresAt: string;
    suggestionId: string;
    regionLabel?: string | null;
  };
  Settings: undefined;
  Profile: undefined;
  BusinessHub: undefined;
  ApprovalQueue: undefined;
  BusinessCampaignForm: { campaignId?: string } | undefined;
  BusinessCampaignsList: undefined;
  BusinessAnalytics: undefined;
  BusinessAudience: undefined;
  BusinessSettings: undefined;
  HabitForm: { habit?: Habit } | undefined;
  Habits: { flippedHabitId?: string } | undefined;
  SmartCalendar: undefined;
  Library: undefined;
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
    movementKm?: number;
  };
};
