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
const VALID_ACTIONS = ['back', 'forward', 'reload', 'stop'];
function registerClassicBrowserNavigateHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_NAVIGATE, async (_event, windowId, action) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_NAVIGATE} for windowId: ${windowId}, Action: ${action}`);
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
        }
        catch (err) {
            logger.error(`Error in ${ipcChannels_1.CLASSIC_BROWSER_NAVIGATE} handler for ${windowId}, action ${action}:`, err.message || err);
            throw err; // Propagate error
        }
    });
}
//# sourceMappingURL=classicBrowserNavigate.js.map