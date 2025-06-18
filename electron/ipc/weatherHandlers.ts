import { IpcMain } from 'electron';
import { WEATHER_GET } from '../../shared/ipcChannels';
import { WeatherService } from '../../services/WeatherService';
import { logger } from '../../utils/logger';

export function registerWeatherHandlers(
  ipcMain: IpcMain,
  weatherService: WeatherService
) {
  ipcMain.handle(WEATHER_GET, async () => {
    try {
      logger.debug('[WeatherHandler] Getting weather data');
      const weather = await weatherService.getWeather();
      return weather;
    } catch (error) {
      logger.error('[WeatherHandler] Error getting weather:', error);
      throw error;
    }
  });
}