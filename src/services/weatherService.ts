import { getStoredSession } from './authService';
import { setCourseTz, courseHourKey } from '../utils/courseTime';

export interface CurrentWeather {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  precipitation: number;
  surface_pressure: number;
  wind_speed_10m: number;
  weather_code: number;
  is_day: number;
}

export interface HourlyWeather {
  time: string[];
  temperature_2m: number[];
  relative_humidity_2m?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  wind_speed_10m?: number[];
  weather_code: number[];
  is_day?: number[];
  et0_fao_evapotranspiration?: number[];
  evapotranspiration?: (number | null)[];
  soil_temperature_6cm?: (number | null)[];
}

export interface DailyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  sunrise: string[];
  sunset: string[];
  uv_index_max: number[];
  precipitation_probability_max: number[];
  precipitation_sum: number[];
  et0_fao_evapotranspiration: number[];
}

export interface WeatherApiResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: CurrentWeather;
  hourly?: HourlyWeather;
  daily?: DailyWeather;
}

export interface HourlyForecastItem {
  hourText: string;
  tempText: string;
  weatherCode: number;
}

export interface CourseLocationInfo {
  courseName: string;
  latitude: number;
  longitude: number;
}

/**
 * Returns dynamic course location and coordinates matching Android course resolution.
 */
export function getActiveCourseInfo(): CourseLocationInfo {
  const session = getStoredSession();
  const configuredEnvBase = (import.meta.env.VITE_API_BASE_URL as string)?.trim() || '';
  const apiBase = (configuredEnvBase || session?.apiBaseUrl || '').toLowerCase();

  if (apiBase.includes('kharghar')) {
    return {
      courseName: 'Kharghar Golf Course',
      latitude: 19.0356,
      longitude: 73.0699
    };
  }
  if (apiBase.includes('dirab')) {
    return {
      courseName: 'Dirab Golf Course',
      latitude: 24.502,
      longitude: 46.619
    };
  }
  if (
    apiBase.includes('pune') ||
    apiBase.includes('pgc') ||
    (apiBase.includes('webapi') && !apiBase.includes('racv'))
  ) {
    return {
      courseName: 'Pune Golf Club',
      latitude: 18.5204,
      longitude: 73.8567
    };
  }
  // Default to RACV Healesville Country Club
  return {
    courseName: 'RACV Healesville Country Club',
    latitude: -37.65029588,
    longitude: 145.5023043
  };
}

const OPEN_METEO_API_KEY = (import.meta.env.VITE_OPEN_METEO_API_KEY as string) || '';

/**
 * Fetches dynamic weather forecast from the Open-Meteo Customer API.
 * Uses native fetch without custom headers to avoid CORS preflight rejection,
 * with automatic fallback to the internal /api/weather proxy.
 */
export async function fetchWeatherForecast(lat?: number, lng?: number): Promise<WeatherApiResponse> {
  const course = getActiveCourseInfo();
  const latitude = lat ?? course.latitude;
  const longitude = lng ?? course.longitude;

  const queryParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,surface_pressure,wind_speed_10m,weather_code,is_day',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code,is_day,et0_fao_evapotranspiration,evapotranspiration,soil_temperature_6cm',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,et0_fao_evapotranspiration',
    timezone: 'auto',
    forecast_days: '6',
    apikey: OPEN_METEO_API_KEY
  });

  const directUrl = `https://customer-api.open-meteo.com/v1/forecast?${queryParams.toString()}`;
  const proxyUrl = `/api/weather?latitude=${latitude}&longitude=${longitude}`;

  // 1. First attempt: Direct Open-Meteo API using standard native fetch (clean headers, no preflight issues)
  try {
    const res = await fetch(directUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
    if (res.ok) {
      const data: WeatherApiResponse = await res.json();
      setCourseTz(data?.timezone);
      return data;
    }
  } catch (directErr) {
    console.warn('Direct Open-Meteo fetch encountered network issue, trying local proxy fallback...', directErr);
  }

  // 2. Fallback attempt: Local /api/weather proxy (bypasses browser adblockers or strict network firewalls)
  try {
    const proxyRes = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
    if (proxyRes.ok) {
      const data: WeatherApiResponse = await proxyRes.json();
      setCourseTz(data?.timezone);
      return data;
    }
    throw new Error(`Weather proxy returned HTTP ${proxyRes.status}`);
  } catch (proxyErr: any) {
    throw new Error(proxyErr?.message || 'Failed to fetch weather data.');
  }
}

/**
 * Extracts upcoming 5 hourly slots starting from the current course hour, matching Android AISummaryScreen logic.
 * Open-Meteo hourly.time values are course-local wall-clock strings ("2026-10-14T22:00", no offset), so they are
 * compared and displayed as strings against the course clock — never parsed with new Date(), which would read
 * them in the browser's timezone.
 */
export function extractNext5Hours(hourly?: HourlyWeather): HourlyForecastItem[] {
  if (!hourly || !hourly.time || hourly.time.length === 0) return [];

  const nowKey = courseHourKey(); // 'YYYY-MM-DDTHH' at the course
  let startIndex = hourly.time.findIndex(t => t.slice(0, 13) >= nowKey);
  if (startIndex === -1) startIndex = 0;

  const items: HourlyForecastItem[] = [];
  const total = hourly.time.length;

  for (let i = 0; i < 5 && (startIndex + i) < total; i++) {
    const idx = startIndex + i;
    const isoTime = hourly.time[idx];
    const hourText = isoTime.includes('T') ? isoTime.split('T')[1].slice(0, 5) : isoTime;
    const temp = Math.round(hourly.temperature_2m[idx] ?? 30);
    const code = hourly.weather_code[idx] ?? 0;

    items.push({
      hourText,
      tempText: `${temp}°C`,
      weatherCode: code
    });
  }

  return items;
}
