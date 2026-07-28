import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase'; // Assuming 'app' is the initialized Firebase app

// Initialize Cloud Functions client if Firebase app is available
const functionsInstance = app ? getFunctions(app) : null;

interface FetchExternalDataRequest {
  location: string;
  geminiPrompt: string;
  searchQuery?: string;
}

interface FetchExternalDataResponse {
  message: string;
  results: {
    Gemini?: { status: string; data?: any; error?: string };
    Ticketmaster?: { status: string; data?: any; error?: string };
    SeatGeek?: { status: string; data?: any; error?: string };
    GooglePlaces?: { status: string; data?: any; error?: string };
  };
}

/**
 * Calls the `fetchExternalData` Firebase Cloud Function to securely
 * fetch data from multiple third-party APIs.
 *
 * @param {FetchExternalDataRequest} params - The request parameters for the Cloud Function.
 * @returns {Promise<FetchExternalDataResponse>} - The aggregated results from the APIs.
 * @throws {Error} If Firebase Functions is not initialized or the call fails.
 */
export async function callFetchExternalDataFunction(
  params: FetchExternalDataRequest
): Promise<FetchExternalDataResponse> {
  if (!functionsInstance) {
    throw new Error('Firebase Functions is not initialized. Ensure Firebase is configured correctly.');
  }

  try {
    const fetchExternalDataCallable = httpsCallable<FetchExternalDataRequest, FetchExternalDataResponse>(
      functionsInstance,
      'fetchExternalData'
    );
    const result = await fetchExternalDataCallable(params);
    return result.data;
  } catch (error: any) {
    console.error('Error calling fetchExternalData Cloud Function:', error);
    throw new Error(`Cloud Function call failed: ${error.message}`);
  }
}

/**
 * Example of fetching data directly from the Open-Meteo API (no API key required).
 *
 * @param {number} latitude - The latitude for the weather forecast.
 * @param {number} longitude - The longitude for the weather forecast.
 * @returns {Promise<any>} - The weather data.
 * @throws {Error} If the API call fails.
 */
export async function fetchOpenMeteoWeather(latitude: number, longitude: number): Promise<any> {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Open-Meteo API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error('Error fetching Open-Meteo weather:', error);
    throw new Error(`Failed to fetch weather data: ${error.message}`);
  }
}
