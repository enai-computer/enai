import { BaseService } from './base/BaseService';
import { WeatherData, WeatherApiResponse, WeatherIconType } from '../shared/types';

interface WeatherServiceDeps {
  // No dependencies needed for this service
}

export class WeatherService extends BaseService<WeatherServiceDeps> {
  private static readonly MARINA_LAT = 37.8037;
  private static readonly MARINA_LON = -122.4368;
  private static readonly CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly API_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
  
  private weatherCache: WeatherData | null = null;
  
  constructor() {
    super('WeatherService', {});
  }
  
  async getWeather(): Promise<WeatherData> {
    return this.execute('getWeather', async () => {
      // Check cache first
      if (this.weatherCache && this.isCacheValid()) {
        this.logDebug('Returning cached weather data');
        return this.weatherCache;
      }
      
      // Check if API key is available
      const apiKey = process.env.OPENWEATHER_API_KEY;
      if (!apiKey || apiKey === 'your_openweather_api_key_here') {
        this.logDebug('No API key available, returning default weather');
        return this.getDefaultWeather();
      }
      
      try {
        // Fetch fresh weather data
        const weather = await this.fetchWeatherFromApi(apiKey);
        this.weatherCache = weather;
        return weather;
      } catch (error) {
        this.logError('Failed to fetch weather', error);
        // Return cached data if available, otherwise default
        return this.weatherCache || this.getDefaultWeather();
      }
    });
  }
  
  private async fetchWeatherFromApi(apiKey: string): Promise<WeatherData> {
    const url = new URL(WeatherService.API_BASE_URL);
    url.searchParams.append('lat', WeatherService.MARINA_LAT.toString());
    url.searchParams.append('lon', WeatherService.MARINA_LON.toString());
    url.searchParams.append('appid', apiKey);
    url.searchParams.append('units', 'imperial'); // Get temperature in Fahrenheit
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as WeatherApiResponse;
    
    // Convert API response to our weather data format
    const temperature = Math.round(data.main.temp);
    const weatherCondition = data.weather[0];
    const icon = this.mapConditionToIcon(weatherCondition.id, weatherCondition.icon);
    const description = this.mapIconToDescription(icon);
    
    return {
      temperature,
      icon,
      description,
      timestamp: new Date().toISOString()
    };
  }
  
  private mapConditionToIcon(conditionId: number, iconCode: string): WeatherIconType {
    const isNight = iconCode.endsWith('n');
    
    // Map OpenWeatherMap condition codes to our icon types
    // Based on https://openweathermap.org/weather-conditions
    
    // Group 2xx: Thunderstorm
    if (conditionId >= 200 && conditionId < 300) {
      if (conditionId === 202 || conditionId === 212 || conditionId === 221 || conditionId === 232) {
        return 'heavy_thunderstorm';
      }
      if (conditionId >= 230 && conditionId < 240) {
        return 'thunderstorm_rain';
      }
      return 'thunderstorm';
    }
    
    // Group 3xx: Drizzle
    if (conditionId >= 300 && conditionId < 400) {
      if (conditionId >= 310 && conditionId < 320) {
        return 'heavy_drizzle';
      }
      return 'drizzle';
    }
    
    // Group 5xx: Rain
    if (conditionId >= 500 && conditionId < 600) {
      if (conditionId === 500 || conditionId === 520) {
        return 'light_rain';
      }
      if (conditionId === 501 || conditionId === 521) {
        return 'moderate_rain';
      }
      if (conditionId === 502 || conditionId === 503 || conditionId === 504 || conditionId === 522) {
        return 'heavy_rain';
      }
      if (conditionId === 511) {
        return 'freezing_rain';
      }
      if (conditionId >= 520 && conditionId < 530) {
        return conditionId === 522 ? 'heavy_showers_rain' : 'showers_rain';
      }
      return 'moderate_rain';
    }
    
    // Group 6xx: Snow
    if (conditionId >= 600 && conditionId < 700) {
      if (conditionId === 600 || conditionId === 620) {
        return 'light_snow';
      }
      if (conditionId === 601 || conditionId === 621) {
        return 'moderate_snow';
      }
      if (conditionId === 602 || conditionId === 622) {
        return 'heavy_snow';
      }
      if (conditionId === 611 || conditionId === 613) {
        return 'sleet';
      }
      if (conditionId === 615 || conditionId === 616) {
        return 'snow_rain_mix';
      }
      return 'moderate_snow';
    }
    
    // Group 7xx: Atmosphere
    if (conditionId >= 700 && conditionId < 800) {
      if (conditionId === 701) return 'mist';
      if (conditionId === 711) return 'smoke';
      if (conditionId === 721) return 'haze';
      if (conditionId === 731 || conditionId === 761) return 'sand';
      if (conditionId === 741) return 'fog';
      if (conditionId === 751) return 'sand';
      if (conditionId === 762) return 'dust';
      if (conditionId === 771) return 'heavy_rain'; // Squalls
      if (conditionId === 781) return 'tornado';
      return 'fog'; // Default atmospheric condition
    }
    
    // Group 800: Clear
    if (conditionId === 800) {
      return isNight ? 'clear_night' : 'sunny';
    }
    
    // Group 80x: Clouds
    if (conditionId >= 801 && conditionId < 900) {
      if (conditionId === 801) {
        return isNight ? 'partly_cloudy_night' : 'partly_cloudy_day';
      }
      if (conditionId === 802) {
        return 'cloudy';
      }
      if (conditionId === 803) {
        return isNight ? 'mostly_cloudy_night' : 'mostly_cloudy_day';
      }
      if (conditionId === 804) {
        return 'overcast';
      }
    }
    
    // Default fallback
    return 'cloudy';
  }
  
  private mapIconToDescription(icon: WeatherIconType): string {
    const descriptions: Record<WeatherIconType, string> = {
      'sunny': 'sunny',
      'clear_night': 'clear',
      'partly_cloudy_day': 'partly cloudy',
      'partly_cloudy_night': 'partly cloudy',
      'cloudy': 'cloudy',
      'mostly_cloudy_day': 'mostly cloudy',
      'mostly_cloudy_night': 'mostly cloudy',
      'overcast': 'overcast',
      'light_rain': 'light rain',
      'moderate_rain': 'rainy',
      'heavy_rain': 'heavy rain',
      'freezing_rain': 'freezing rain',
      'showers_rain': 'rain showers',
      'heavy_showers_rain': 'heavy showers',
      'drizzle': 'drizzling',
      'heavy_drizzle': 'heavy drizzle',
      'thunderstorm': 'thunderstorms',
      'thunderstorm_rain': 'thunderstorms',
      'heavy_thunderstorm': 'severe thunderstorms',
      'light_snow': 'light snow',
      'moderate_snow': 'snowy',
      'heavy_snow': 'heavy snow',
      'blizzard': 'blizzard conditions',
      'snow_showers': 'snow showers',
      'flurries': 'snow flurries',
      'sleet': 'sleet',
      'snow_rain_mix': 'wintry mix',
      'mist': 'misty',
      'fog': 'foggy',
      'haze': 'hazy',
      'smoke': 'smoky',
      'dust': 'dusty',
      'sand': 'sandy',
      'tornado': 'tornado warning',
      'hurricane': 'hurricane conditions'
    };
    
    return descriptions[icon] || 'cloudy';
  }
  
  private isCacheValid(): boolean {
    if (!this.weatherCache) return false;
    const now = Date.now();
    const cacheTime = new Date(this.weatherCache.timestamp).getTime();
    return (now - cacheTime) < WeatherService.CACHE_DURATION_MS;
  }
  
  private getDefaultWeather(): WeatherData {
    return {
      temperature: 68,
      icon: 'fog',
      description: 'foggy',
      timestamp: new Date().toISOString()
    };
  }
}