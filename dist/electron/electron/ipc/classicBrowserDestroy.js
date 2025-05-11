"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserDestroyHandler = registerClassicBrowserDestroyHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserDestroy]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserDestroy]', ...args),
};
function registerClassicBrowserDestroyHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_DESTROY, async (_event, { windowId }) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_DESTROY} for windowId: ${windowId}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided for DestroyView.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        try {
            classicBrowserService.destroyBrowserView(windowId);
            logger.debug(`ClassicBrowserDestroyHandler: destroy call for ${windowId} completed.`);
        }
        catch (err) {
            logger.error(`Failed to destroy ClassicBrowser view for windowId ${windowId}:`, err);
            throw new Error(err.message || 'Failed to destroy ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserDestroy.js.map