"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserSetVisibilityHandler = registerClassicBrowserSetVisibilityHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserSetVisibility]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserSetVisibility]', ...args),
};
function registerClassicBrowserSetVisibilityHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_SET_VISIBILITY, async (_event, { windowId, isVisible }) => {
        // logger.debug(`Handling ${CLASSIC_BROWSER_SET_VISIBILITY} for windowId: ${windowId}, isVisible: ${isVisible}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        if (typeof isVisible !== 'boolean') {
            logger.error('Invalid isVisible value provided.');
            throw new Error('Invalid isVisible value. Must be a boolean.');
        }
        try {
            classicBrowserService.setVisibility(windowId, isVisible);
            // logger.debug(`Successfully set visibility for ${windowId} to ${isVisible}`);
        }
        catch (err) {
            logger.error(`Failed to set visibility for classic browser windowId ${windowId}:`, err);
            throw new Error(err.message || 'Failed to set visibility for ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserSetVisibility.js.map