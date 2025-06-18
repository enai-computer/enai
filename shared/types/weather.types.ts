// Weather icon types based on Google Weather's icon system
// https://developers.google.com/maps/documentation/weather/weather-condition-icons

export type WeatherIconType = 
  // Clear conditions
  | 'sunny'                    // Clear sky day
  | 'clear_night'              // Clear sky night
  
  // Partially cloudy
  | 'partly_cloudy_day'        // Few clouds day
  | 'partly_cloudy_night'      // Few clouds night
  
  // Cloudy conditions
  | 'cloudy'                   // Scattered clouds
  | 'mostly_cloudy_day'        // Broken clouds day
  | 'mostly_cloudy_night'      // Broken clouds night
  | 'overcast'                 // Overcast clouds
  
  // Rain conditions
  | 'light_rain'               // Light rain
  | 'moderate_rain'            // Moderate rain  
  | 'heavy_rain'               // Heavy intensity rain
  | 'freezing_rain'            // Freezing rain
  | 'showers_rain'             // Shower rain
  | 'heavy_showers_rain'       // Heavy shower rain
  
  // Drizzle
  | 'drizzle'                  // Light drizzle
  | 'heavy_drizzle'            // Heavy drizzle
  
  // Thunderstorm
  | 'thunderstorm'             // Thunderstorm
  | 'thunderstorm_rain'        // Thunderstorm with rain
  | 'heavy_thunderstorm'       // Heavy thunderstorm
  
  // Snow conditions
  | 'light_snow'               // Light snow
  | 'moderate_snow'            // Snow
  | 'heavy_snow'               // Heavy snow
  | 'blizzard'                 // Blizzard conditions
  | 'snow_showers'             // Snow showers
  | 'flurries'                 // Snow flurries
  
  // Mixed precipitation
  | 'sleet'                    // Sleet
  | 'snow_rain_mix'            // Mixed snow and rain
  
  // Atmospheric conditions
  | 'mist'                     // Mist
  | 'fog'                      // Fog
  | 'haze'                     // Haze
  | 'smoke'                    // Smoke
  | 'dust'                     // Dust
  | 'sand'                     // Sand/dust whirls
  
  // Extreme conditions
  | 'tornado'                  // Tornado
  | 'hurricane';               // Hurricane/tropical storm

export interface WeatherData {
  temperature: number;         // Temperature in Fahrenheit
  icon: WeatherIconType;       // Icon type for display
  description: string;         // Human-readable description (e.g., "foggy", "partly cloudy")
  timestamp: number;           // Cache timestamp
}

export interface WeatherApiResponse {
  main: {
    temp: number;              // Temperature in Kelvin
    feels_like: number;
    humidity: number;
  };
  weather: Array<{
    id: number;                // Weather condition ID
    main: string;              // Group (Rain, Snow, Clear, etc.)
    description: string;       // Description
    icon: string;              // OpenWeatherMap icon code
  }>;
  sys: {
    sunrise: number;
    sunset: number;
  };
}