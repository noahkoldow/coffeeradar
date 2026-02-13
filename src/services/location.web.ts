import { LocationState } from '../types';

export const requestLocationPermission = async (): Promise<boolean> => {
  return false;
};

export const getLocationPermissionStatus = async (): Promise<boolean> => {
  return false;
};

export const getCurrentLocation = async (): Promise<LocationState> => {
  return {
    lat: null,
    lng: null,
    areaLabel: null,
  };
};
