import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const weatherCodeDescriptions: Record<number, string> = {
  0: 'Clear sky ☀️',
  1: 'Mainly clear 🌤️',
  2: 'Partly cloudy ⛅',
  3: 'Overcast ☁️',
  45: 'Foggy 🌫️',
  48: 'Depositing rime fog 🌫️',
  51: 'Light drizzle 🌧️',
  53: 'Moderate drizzle 🌧️',
  55: 'Dense drizzle 🌧️',
  61: 'Slight rain 🌧️',
  63: 'Moderate rain 🌧️',
  65: 'Heavy rain 🌧️',
  71: 'Slight snowfall ❄️',
  73: 'Moderate snowfall ❄️',
  75: 'Heavy snowfall ❄️',
  80: 'Slight rain showers 🌦️',
  81: 'Moderate rain showers 🌦️',
  82: 'Violent rain showers 🌧️',
  95: 'Thunderstorm 🌩️',
  96: 'Thunderstorm with light hail ⛈️',
  99: 'Thunderstorm with heavy hail ⛈️',
};

/**
 * Weather tool utilizing Open-Meteo's free geocoding and weather API (no API key required).
 */
export const weatherTool = tool(
  async (args: Record<string, any>) => {
    const location =
      (args?.location || args?.city || args?.place || Object.values(args || {}).filter((v) => typeof v === 'string').join(' ')).trim();

    if (!location) {
      return 'No location specified. Please provide a city or region name to fetch weather for.';
    }

    try {
      // 1. Geocode location name into latitude & longitude
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        return `Unable to geocode location "${location}". Status: ${geoRes.status}`;
      }

      const geoData = (await geoRes.json()) as {
        results?: Array<{
          name: string;
          latitude: number;
          longitude: number;
          country?: string;
          administrative1?: string;
          admin1?: string;
        }>;
      };

      if (!geoData.results || geoData.results.length === 0) {
        return `Location "${location}" could not be found. Please check the city or region name.`;
      }

      const place = geoData.results[0];
      const placeName = [place.name, place.admin1, place.country].filter(Boolean).join(', ');

      // 2. Query current weather forecast
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`;
      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) {
        return `Failed to fetch weather for ${placeName}. Status: ${weatherRes.status}`;
      }

      const weatherData = (await weatherRes.json()) as {
        current_weather?: {
          temperature: number;
          windspeed: number;
          winddirection: number;
          weathercode: number;
          is_day: number;
          time: string;
        };
      };

      const current = weatherData.current_weather;
      if (!current) {
        return `Weather data currently unavailable for ${placeName}.`;
      }

      const condition = weatherCodeDescriptions[current.weathercode] || `Weather code: ${current.weathercode}`;

      return (
        `🌤️ Current Weather for ${placeName}:\n` +
        `- Condition: ${condition}\n` +
        `- Temperature: ${current.temperature}°C\n` +
        `- Wind Speed: ${current.windspeed} km/h\n` +
        `- Daytime: ${current.is_day === 1 ? 'Day ☀️' : 'Night 🌙'}`
      );
    } catch (err: any) {
      console.error('[Weather Tool Error]:', err);
      return `Error retrieving weather for "${location}": ${err?.message || 'Unknown error'}`;
    }
  },
  {
    name: 'get_weather',
    description:
      'Fetch real-time weather forecasts, current temperature, and conditions for any city or location globally.',
    schema: z.object({
      location: z
        .string()
        .optional()
        .describe('The city, region, or location name to fetch weather for (e.g. "Mumbai", "London", "Sydney").'),
      city: z.any().optional(),
      place: z.any().optional(),
      top_n: z.any().optional(),
      recency_days: z.any().optional(),
      limit: z.any().optional(),
      max_results: z.any().optional(),
      cursor: z.any().optional(),
      id: z.any().optional(),
    }),
  }
);
