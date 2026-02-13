import { Suggestion } from '../types';

const now = new Date();
const inMinutes = (minutes: number): string => new Date(now.getTime() + minutes * 60 * 1000).toISOString();

export const curatedEvents: Suggestion[] = [
  {
    id: 'ev_curated_1',
    type: 'EVENT',
    title: 'Sunset jazz set',
    description: 'A short live set with seats available.',
    durationMin: 120,
    event: {
      startAt: inMinutes(90),
      venue: 'Harbor Hall',
      ticketUrl: 'https://example.com/tickets/jazz',
      priceRange: '$25-$40',
    },
    place: {
      name: 'Harbor Hall',
      lat: -33.8618,
      lng: 151.2093,
      address: 'Harbor Street',
    },
    confidence: 0.6,
  },
  {
    id: 'ev_curated_2',
    type: 'EVENT',
    title: 'Indie film screening',
    description: 'Small cinema with a short feature.',
    durationMin: 110,
    event: {
      startAt: inMinutes(120),
      venue: 'City Screen',
      ticketUrl: 'https://example.com/tickets/film',
      priceRange: '$18-$25',
    },
    place: {
      name: 'City Screen',
      lat: -33.8769,
      lng: 151.2068,
      address: 'Market Lane',
    },
    confidence: 0.55,
  },
  {
    id: 'ev_curated_3',
    type: 'EVENT',
    title: 'Late gallery opening',
    description: 'Drop in for a quick exhibit loop.',
    durationMin: 90,
    event: {
      startAt: inMinutes(150),
      venue: 'Gallery West',
      ticketUrl: 'https://example.com/tickets/gallery',
      priceRange: '$15-$20',
    },
    place: {
      name: 'Gallery West',
      lat: -33.868,
      lng: 151.198,
      address: 'Pier Road',
    },
    confidence: 0.5,
  },
];
