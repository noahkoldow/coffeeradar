export type BadgeDefinition = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  levels: number[];
  color: string;
};

export const badgeDefinitions: BadgeDefinition[] = [
  {
    id: 'focus',
    title: 'Focus',
    description: 'Earned by doing focused and learning activities.',
    tags: ['focus', 'learning'],
    levels: [1, 3, 6, 10, 15],
    color: '#2563EB',
  },
  {
    id: 'fitness',
    title: 'Fitness',
    description: 'Earned by doing movement and fitness activities.',
    tags: ['fitness'],
    levels: [1, 3, 6, 10, 15],
    color: '#16A34A',
  },
  {
    id: 'nature',
    title: 'Nature',
    description: 'Earned by getting outside and exploring nature.',
    tags: ['nature', 'explore'],
    levels: [1, 3, 6, 10, 15],
    color: '#0EA5A4',
  },
  {
    id: 'wellness',
    title: 'Wellness',
    description: 'Earned by doing calming and reset activities.',
    tags: ['wellness'],
    levels: [1, 3, 6, 10, 15],
    color: '#9333EA',
  },
  {
    id: 'social',
    title: 'Social',
    description: 'Earned by doing social or community activities.',
    tags: ['social'],
    levels: [1, 3, 6, 10, 15],
    color: '#F97316',
  },
  {
    id: 'art',
    title: 'Art',
    description: 'Earned by doing creative and art activities.',
    tags: ['art'],
    levels: [1, 3, 6, 10, 15],
    color: '#DB2777',
  },
  {
    id: 'food',
    title: 'Food',
    description: 'Earned by doing food and coffee activities.',
    tags: ['food', 'coffee'],
    levels: [1, 3, 6, 10, 15],
    color: '#B45309',
  },
  {
    id: 'habits',
    title: 'Habits',
    description: 'Earned by building streaks and completing habits consistently.',
    tags: ['__habit__'],
    levels: [3, 7, 14, 30, 60],
    color: '#059669',
  },
];
