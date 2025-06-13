import { ipcMain, IpcMainEvent } from 'electron';
import { CLASSIC_BROWSER_SET_BACKGROUND_COLOR } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserSetBackgroundColor]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserSetBackgroundColor]', ...args),
};

export function registerClassicBrowserSetBackgroundColorHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.on(CLASSIC_BROWSER_SET_BACKGROUND_COLOR, (
    _event: IpcMainEvent, 
    windowId: string, 
    color: string
  ) => {
    logger.debug(`Handling ${CLASSIC_BROWSER_SET_BACKGROUND_COLOR} for windowId: ${windowId}, color: ${color}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      return;
    }
    if (!color || typeof color !== 'string') {
      logger.error('Invalid color provided.');
      return;
    }

    try {
      classicBrowserService.setBackgroundColor(windowId, color);
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_SET_BACKGROUND_COLOR} handler:`, err.message || err);
    }
  });
}