import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { CLASSIC_BROWSER_NAVIGATE } from '../../shared/ipcChannels';
import { ClassicBrowserService } from '../../services/ClassicBrowserService';

const logger = {
  debug: (...args: any[]) => console.log('[IPCClassicBrowserNavigate]', ...args),
  error: (...args: any[]) => console.error('[IPCClassicBrowserNavigate]', ...args),
  warn: (...args: any[]) => console.warn('[IPCClassicBrowserNavigate]', ...args),
};

export type ClassicBrowserNavigationAction = 'back' | 'forward' | 'reload' | 'stop';

interface ClassicBrowserNavigateParams {
  windowId: string;
  action: ClassicBrowserNavigationAction;
}

export function registerClassicBrowserNavigateHandler(classicBrowserService: ClassicBrowserService) {
  ipcMain.handle(CLASSIC_BROWSER_NAVIGATE, async (_event: IpcMainInvokeEvent, { windowId, action }: ClassicBrowserNavigateParams): Promise<void> => {
    logger.debug(`Handling ${CLASSIC_BROWSER_NAVIGATE} for windowId: ${windowId}, Action: ${action}`);

    if (!windowId || typeof windowId !== 'string') {
      logger.error('Invalid windowId provided.');
      throw new Error('Invalid windowId. Must be a non-empty string.');
    }

    const validActions: ClassicBrowserNavigationAction[] = ['back', 'forward', 'reload', 'stop'];
    if (!action || !validActions.includes(action)) {
      logger.error(`Invalid navigation action provided: ${action}`);
      throw new Error(`Invalid navigation action. Must be one of: ${validActions.join(', ')}.`);
    }

    try {
      // Service method is synchronous
      classicBrowserService.navigate(windowId, action);
      // Navigation actions themselves don't typically return values; state updates come via events.
      logger.debug(`ClassicBrowserNavigateHandler: navigate call for ${windowId} with action ${action} completed.`);
    } catch (err: any) {
      logger.error(`Failed to navigate in ClassicBrowser for windowId ${windowId}, action ${action}:`, err);
      throw new Error(err.message || 'Failed to execute navigation action in ClassicBrowser view.');
    }
  });
} 