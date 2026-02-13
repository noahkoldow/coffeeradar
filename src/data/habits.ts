import { HabitFrequency, HabitTimeOfDay, HabitType } from '../types';

export type HabitTemplate = {
  name: string;
  type: HabitType;
  lengthMin: number;
  description: string;
  frequency: HabitFrequency;
  timeOfDay: HabitTimeOfDay;
  tags: string[];
};

export const recommendedHabits: HabitTemplate[] = [
  {
    name: 'Morning reset walk',
    type: 'GO_OUT',
    lengthMin: 25,
    description: 'Take a short walk and reset before the day stacks up.',
    frequency: 'daily',
    timeOfDay: 'morning',
    tags: ['nature', 'fitness', 'explore'],
  },
  {
    name: 'Lunch break stretch',
    type: 'AT_HOME',
    lengthMin: 15,
    description: 'Light stretches and breathing to reset your posture.',
    frequency: 'daily',
    timeOfDay: 'afternoon',
    tags: ['wellness', 'fitness'],
  },
  {
    name: 'Evening tidy sprint',
    type: 'AT_HOME',
    lengthMin: 20,
    description: 'One quick tidy to reset your space for tomorrow.',
    frequency: 'daily',
    timeOfDay: 'evening',
    tags: ['focus', 'learning'],
  },
  {
    name: 'Weekly creative hour',
    type: 'AT_HOME',
    lengthMin: 45,
    description: 'Spend time sketching, writing, or making something.',
    frequency: 'weekly',
    timeOfDay: 'any',
    tags: ['art', 'learning'],
  },
  {
    name: 'Cafe check-in',
    type: 'GO_OUT',
    lengthMin: 30,
    description: 'Grab a coffee and decompress in a new spot.',
    frequency: 'weekly',
    timeOfDay: 'any',
    tags: ['coffee', 'social', 'explore'],
  },
  {
    name: 'Monthly culture night',
    type: 'GO_OUT',
    lengthMin: 90,
    description: 'Pick a gallery, movie, or music night once a month.',
    frequency: 'monthly',
    timeOfDay: 'evening',
    tags: ['art', 'music', 'movies'],
  },
];
