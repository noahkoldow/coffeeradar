/**
 * Weather service using Open-Meteo (free, no API key required).
 * Used to shift suggestions toward indoor/outdoor based on current conditions.
 */

import { addDebugMessage } from './debug';

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'snow' | 'unknown';

export type WeatherInfo = {
  temperatureC: number;
  condition: WeatherCondition;
  /** 0 = perfect outdoor weather, 1 = stay inside */
  indoorBias: number;
  label: string;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
let cached: { ts: number; lat: number; lng: number; data: WeatherInfo } | null = null;

const WMO_CONDITIONS: Record<number, { condition: WeatherCondition; label: string }> = {
  0: { condition: 'clear', label: 'Clear sky' },
  1: { condition: 'clear', label: 'Mostly clear' },
  2: { condition: 'cloudy', label: 'Partly cloudy' },
  3: { condition: 'cloudy', label: 'Overcast' },
  45: { condition: 'cloudy', label: 'Foggy' },
  48: { condition: 'cloudy', label: 'Icy fog' },
  51: { condition: 'rain', label: 'Light drizzle' },
  53: { condition: 'rain', label: 'Drizzle' },
  55: { condition: 'rain', label: 'Heavy drizzle' },
  56: { condition: 'rain', label: 'Freezing drizzle' },
  57: { condition: 'rain', label: 'Heavy freezing drizzle' },
  61: { condition: 'rain', label: 'Light rain' },
  63: { condition: 'rain', label: 'Rain' },
  65: { condition: 'rain', label: 'Heavy rain' },
  66: { condition: 'rain', label: 'Freezing rain' },
  67: { condition: 'rain', label: 'Heavy freezing rain' },
  71: { condition: 'snow', label: 'Light snow' },
  73: { condition: 'snow', label: 'Snow' },
  75: { condition: 'snow', label: 'Heavy snow' },
  77: { condition: 'snow', label: 'Snow grains' },
  80: { condition: 'rain', label: 'Light showers' },
  81: { condition: 'rain', label: 'Showers' },
  82: { condition: 'rain', label: 'Heavy showers' },
  85: { condition: 'snow', label: 'Snow showers' },
  86: { condition: 'snow', label: 'Heavy snow showers' },
  95: { condition: 'rain', label: 'Thunderstorm' },
  96: { condition: 'rain', label: 'Thunderstorm with hail' },
  99: { condition: 'rain', label: 'Severe thunderstorm' },
};

const computeIndoorBias = (condition: WeatherCondition, temperatureC: number): number => {
  let bias = 0;

  // Weather condition factor
  if (condition === 'rain') bias += 0.6;
  else if (condition === 'snow') bias += 0.7;
  else if (condition === 'cloudy') bias += 0.15;
  // clear = 0

  // Temperature factor — too cold or too hot pushes indoor
  if (temperatureC < 0) bias += 0.3;
  else if (temperatureC < 5) bias += 0.2;
  else if (temperatureC < 10) bias += 0.1;
  else if (temperatureC > 35) bias += 0.25;
  else if (temperatureC > 30) bias += 0.1;

  return Math.min(1, Math.max(0, bias));
};

export const fetchWeather = async (lat: number, lng: number): Promise<WeatherInfo> => {
  // Check cache (same area within 15 min)
  if (
    cached &&
    Date.now() - cached.ts < CACHE_TTL_MS &&
    Math.abs(cached.lat - lat) < 0.05 &&
    Math.abs(cached.lng - lng) < 0.05
  ) {
    return cached.data;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weather_code&timezone=auto`;

    const response = await fetch(url);
    if (!response.ok) {
      addDebugMessage('weather', `Open-Meteo error: ${response.status}`);
      return { temperatureC: 20, condition: 'unknown', indoorBias: 0.3, label: 'Unknown' };
    }

    const data = await response.json();
    const current = data?.current;
    if (!current) {
      addDebugMessage('weather', 'No current data in response.');
      return { temperatureC: 20, condition: 'unknown', indoorBias: 0.3, label: 'Unknown' };
    }

    const temperatureC = current.temperature_2m ?? 20;
    const weatherCode: number = current.weather_code ?? 0;
    const wmo = WMO_CONDITIONS[weatherCode] ?? { condition: 'unknown' as WeatherCondition, label: 'Unknown' };
    const indoorBias = computeIndoorBias(wmo.condition, temperatureC);

    const result: WeatherInfo = {
      temperatureC,
      condition: wmo.condition,
      indoorBias,
      label: `${wmo.label}, ${Math.round(temperatureC)}°C`,
    };

    cached = { ts: Date.now(), lat, lng, data: result };
    addDebugMessage('weather', `${result.label} (indoor bias: ${indoorBias.toFixed(2)})`);
    return result;
  } catch (error) {
    addDebugMessage('weather', 'Failed to fetch weather.');
    return { temperatureC: 20, condition: 'unknown', indoorBias: 0.3, label: 'Unknown' };
  }
};
