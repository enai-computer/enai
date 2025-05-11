"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserNavigateHandler = registerClassicBrowserNavigateHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserNavigate]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserNavigate]', ...args),
    warn: (...args) => console.warn('[IPCClassicBrowserNavigate]', ...args),
};
function registerClassicBrowserNavigateHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_NAVIGATE, async (_event, { windowId, action }) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_NAVIGATE} for windowId: ${windowId}, Action: ${action}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        const validActions = ['back', 'forward', 'reload', 'stop'];
        if (!action || !validActions.includes(action)) {
            logger.error(`Invalid navigation action provided: ${action}`);
            throw new Error(`Invalid navigation action. Must be one of: ${validActions.join(', ')}.`);
        }
        try {
            // Service method is synchronous
            classicBrowserService.navigate(windowId, action);
            // Navigation actions themselves don't typically return values; state updates come via events.
            logger.debug(`ClassicBrowserNavigateHandler: navigate call for ${windowId} with action ${action} completed.`);
        }
        catch (err) {
            logger.error(`Failed to navigate in ClassicBrowser for windowId ${windowId}, action ${action}:`, err);
            throw new Error(err.message || 'Failed to execute navigation action in ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserNavigateHandler.js.map