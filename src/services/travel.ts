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

export type TravelMode = 'walk' | 'transit';

/**
 * Choose travel mode based on distance.
 * ≤1.5 km → walk; otherwise public transport.
 */
export const chooseTravelMode = (distanceKm: number): TravelMode => {
  return distanceKm <= 1.5 ? 'walk' : 'transit';
};

/**
 * Estimate travel time in minutes.
 *
 * Walk: ~4.5 km/h
 * Transit: accounts for ~5 min average wait for the next service,
 *          ~25 km/h average door-to-door speed including transfers,
 *          plus ~3 min walking to/from stops.
 */
export const estimateEtaMinutes = (distanceKm: number, mode: TravelMode): number => {
  if (mode === 'walk') {
    const walkSpeedKmh = 4.5;
    const minutes = (distanceKm / walkSpeedKmh) * 60;
    return Math.round(clamp(minutes, 1, 240));
  }

  // Public transport model
  const walkToStopMin = 3;           // walk to nearest stop
  const avgWaitMin = 5;              // average wait for next service
  const transitSpeedKmh = 25;        // average door-to-door including stops
  const walkFromStopMin = 3;         // walk from stop to destination
  const transitMin = (distanceKm / transitSpeedKmh) * 60;

  const totalMin = walkToStopMin + avgWaitMin + transitMin + walkFromStopMin;
  return Math.round(clamp(totalMin, 5, 240));
};

/**
 * Estimate when to leave to arrive by a target time using public transport.
 * Returns the recommended departure Date.
 */
export const estimateDeparture = (arrivalTarget: Date, distanceKm: number): Date => {
  const mode = chooseTravelMode(distanceKm);
  const etaMin = estimateEtaMinutes(distanceKm, mode);
  // Add 2 min buffer so the user is not cutting it exactly
  return new Date(arrivalTarget.getTime() - (etaMin + 2) * 60000);
};

/**
 * Produce a human-readable travel description for the card / plan.
 */
export const travelDescription = (distanceKm: number, etaMin: number, mode: TravelMode): string => {
  if (mode === 'walk') {
    return `${distanceKm.toFixed(1)} km · ${etaMin} min walk`;
  }
  return `${distanceKm.toFixed(1)} km · ~${etaMin} min by public transport`;
};
