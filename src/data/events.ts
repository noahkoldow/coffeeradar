import { Suggestion } from '../types';

const now = new Date();
const inMinutes = (minutes: number): string => new Date(now.getTime() + minutes * 60 * 1000).toISOString();

export const curatedEvents: Suggestion[] = [
  {
    id: 'ev_curated_1',
    type: 'EVENT',
    title: 'Sunset jazz set',
    cta: 'Catch live jazz tonight',
    description: 'A short live set with seats available.',
    durationMin: 120,
    event: {
      startAt: inMinutes(90),
      venue: 'Harbor Hall',
      ticketUrl: 'https://www.ticketmaster.com/search?q=sunset+jazz+set',
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
    cta: 'Watch an indie film tonight',
    description: 'Small cinema with a short feature.',
    durationMin: 110,
    event: {
      startAt: inMinutes(120),
      venue: 'City Screen',
      ticketUrl: 'https://www.ticketmaster.com/search?q=indie+film+screening',
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
    cta: 'Drop into a gallery opening',
    description: 'Drop in for a quick exhibit loop.',
    durationMin: 90,
    event: {
      startAt: inMinutes(150),
      venue: 'Gallery West',
      ticketUrl: 'https://www.ticketmaster.com/search?q=late+gallery+opening',
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
