import * as Location from 'expo-location';
import { LocationState } from '../types';

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
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude } = result.coords;
  let areaLabel: string | null = null;
  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude,
      longitude,
    });
    areaLabel = place.district || place.subregion || place.city || place.region || null;
  } catch {
    areaLabel = null;
  }
  return {
    lat: latitude,
    lng: longitude,
    areaLabel,
  };
};
