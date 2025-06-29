import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_NAVIGATE } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/browser/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserNavigate]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserNavigate]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserNavigate]', ...args),
};

const VALID_ACTIONS = ['back', 'forward', 'reload', 'stop'];

export function registerClassicBrowserNavigateHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_NAVIGATE, async (
    _event: IpcMainInvokeEvent, 
    windowId: string, 
    action: 'back' | 'forward' | 'reload' | 'stop'
  ): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_NAVIGATE} for windowId: ${windowId}, Action: ${action}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId. Must be a non-empty string.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }
    if (!action || !VALID_ACTIONS.includes(action)) {
      logger.error(`Invalid action: ${action}. Must be one of ${VALID_ACTIONS.join(', ')}.`);
      throw new Error(`Invalid action: ${action}. Must be one of ${VALID_ACTIONS.join(', ')}.`);
    }

    try {
      // The service method is synchronous and doesn't return a promise itself.
      classicBrowserService.navigate(windowId, action);
      // No explicit return needed for Promise<void> if successful
    } catch (err: any) {
      logger.error(`Error in ${CLASSIC_BROWSER_NAVIGATE} handler for ${windowId}, action ${action}:`, err.message || err);
      throw err; // Propagate error
    }
  });
} 