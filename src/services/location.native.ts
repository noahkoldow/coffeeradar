import * as Location from 'expo-location';
import { LocationState } from '../types';
import { resolveLocationTimeZone } from './weather';

export const requestLocationPermission = async (): Promise<boolean> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
};

export const getLocationPermissionStatus = async (): Promise<boolean> => {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === 'granted';
};

export const getCurrentLocation = async (): Promise<LocationState> => {
  const result = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const { latitude, longitude } = result.coords;
  let areaLabel: string | null = null;
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    // Use the most specific defined place name (suburb / neighbourhood / street),
    // always followed by the broader city. Deliberately skip `subregion`,
    // which returns administrative areas like "Randwick City Council".
    // Keep the street name but strip the house number (e.g. "15 Anzac Pde" -> "Anzac Pde").
    const stripHouseNumber = (value?: string | null): string | null => {
      if (!value) return null;
      const cleaned = value
        .replace(/^\s*\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s+/, '') // leading "15 " / "15-17 "
        .replace(/\s+\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?\s*$/, '') // trailing " 15"
        .trim();
      return cleaned || null;
    };
    const streetName = stripHouseNumber(place.street) || stripHouseNumber(place.name);
    const specific = place.district || streetName || place.city || place.region || null;
    const city = place.city || place.region || null;
    const parts = [specific, city && city !== specific ? city : null].filter(
      (part): part is string => !!part,
    );
    const unique = Array.from(new Set(parts));
    areaLabel = unique.length ? unique.join(', ') : (place.region || null);
  } catch {
    areaLabel = null;
  }
  const timeZone = await resolveLocationTimeZone(latitude, longitude).catch(() => null);
  return {
    lat: latitude,
    lng: longitude,
    areaLabel,
    timeZone,
  };
};
