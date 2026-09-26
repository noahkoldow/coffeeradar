import type { DeckSuggestion } from '../types';

export type MapCoordinate = { latitude: number; longitude: number };

export type MapActivityOption = {
  suggestion: DeckSuggestion;
  coordinate: MapCoordinate;
  travelMin: number;
  travelMode: 'walk' | 'transit' | 'car';
  emoji: string;
};

export type ActivityMapProps = {
  activities: readonly MapActivityOption[];
  origin: MapCoordinate;
  onSelect: (id: string) => void;
  preview?: boolean;
  accent?: string;
  accentText?: string;
};

export const isMapCoordinate = (point: MapCoordinate): boolean => Number.isFinite(point.latitude)
  && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;

export const travelMinutes = (minutes: number): string => Number.isFinite(minutes)
  ? String(Math.max(1, Math.round(minutes))) : '—';

export const travelIcon = (mode: MapActivityOption['travelMode']): string => mode === 'walk' ? '🚶' : mode === 'car' ? '🚗' : '🚌';

export const travelModeLabel = (mode: MapActivityOption['travelMode'], german: boolean): string => {
  if (mode === 'walk') return german ? 'zu Fuß' : 'on foot';
  if (mode === 'car') return german ? 'mit dem Auto' : 'by car';
  return german ? 'mit Bus/Bahn' : 'by transit';
};

const longitudeOffset = (longitude: number, reference: number): number => (
  ((longitude - reference + 540) % 360) - 180
);

/** Keep nearby points together even when a neighbourhood crosses the date line. */
export const mapViewport = (origin: MapCoordinate, activities: readonly MapActivityOption[], aspect = 1.8) => {
  const safeOrigin = isMapCoordinate(origin) ? origin : { latitude: 0, longitude: 0 };
  const points = [safeOrigin, ...activities.map(activity => activity.coordinate).filter(isMapCoordinate)];
  const latitudes = points.map(point => point.latitude);
  const longitudes = points.map(point => longitudeOffset(point.longitude, safeOrigin.longitude));
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const latitude = (south + north) / 2;
  const longitude = ((safeOrigin.longitude + (west + east) / 2 + 540) % 360) - 180;
  const cosine = Math.max(0.05, Math.cos(latitude * Math.PI / 180));
  const ratio = Math.max(0.5, Math.min(4, aspect));
  // Leave room for the emoji and time labels around the outermost coordinates.
  const latitudeDelta = Math.min(170, Math.max(0.004, (north - south) * 1.9, (east - west) * cosine * 1.9 / ratio));
  const longitudeDelta = Math.min(350, latitudeDelta * ratio / cosine);
  return { latitude, longitude, latitudeDelta, longitudeDelta };
};

export const mapPosition = (point: MapCoordinate, viewport: ReturnType<typeof mapViewport>) => ({
  x: 50 + longitudeOffset(point.longitude, viewport.longitude) / viewport.longitudeDelta * 100,
  y: 50 - (point.latitude - viewport.latitude) / viewport.latitudeDelta * 100,
});
