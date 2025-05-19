import { ipcMain, IpcMainEvent } from 'electron';
import { CLASSIC_BROWSER_SET_VISIBILITY } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserSetVisibility]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserSetVisibility]', ...args),
};

// Define expected parameters if not already in shared types
// interface ClassicBrowserSetVisibilityParams { // This interface might be obsolete or need changing
//   windowId: string;
//   shouldBeDrawn: boolean;
//   isFocused: boolean;
// }

export function registerClassicBrowserSetVisibilityHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.on(CLASSIC_BROWSER_SET_VISIBILITY, (
    _event: IpcMainEvent, 
    windowId: string, 
    shouldBeDrawn: boolean, 
    isFocused: boolean
  ) => {
    // logger.debug(`Handling ${CLASSIC_BROWSER_SET_VISIBILITY} for windowId: ${windowId}, shouldBeDrawn: ${shouldBeDrawn}, isFocused: ${isFocused}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      return;
    }
    if (typeof shouldBeDrawn !== 'boolean' || typeof isFocused !== 'boolean') {
        logger.error('Invalid boolean parameters for visibility/focus.');
        return;
    }

    try {
      classicBrowserService.setVisibility(windowId, shouldBeDrawn, isFocused);
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_SET_VISIBILITY} handler:`, err.message || err);
    }
  });
} 