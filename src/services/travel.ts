import { clamp } from '../utils/time';

const EARTH_RADIUS_KM = 6371;

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

export const estimateEtaMinutes = (distanceKm: number, mode: 'walk' | 'drive'): number => {
  const speedKmh = mode === 'walk' ? 4.5 : 22;
  const minutes = (distanceKm / speedKmh) * 60;
  return Math.round(clamp(minutes, 1, 240));
};

export const chooseTravelMode = (distanceKm: number): 'walk' | 'drive' => {
  return distanceKm <= 2 ? 'walk' : 'drive';
};
