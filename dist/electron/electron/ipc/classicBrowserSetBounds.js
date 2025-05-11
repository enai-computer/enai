"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserSetBoundsHandler = registerClassicBrowserSetBoundsHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserSetBounds]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserSetBounds]', ...args),
};
function registerClassicBrowserSetBoundsHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_SET_BOUNDS, async (_event, { windowId, bounds }) => {
        // logger.debug(`Handling ${CLASSIC_BROWSER_SET_BOUNDS} for windowId: ${windowId}, bounds: ${JSON.stringify(bounds)}`); // Can be too noisy
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
            logger.error('Invalid bounds provided.', bounds);
            throw new Error('Invalid bounds object. Must include x, y, width, height as numbers.');
        }
        try {
            classicBrowserService.setBounds(windowId, bounds);
            // logger.debug(`Successfully set bounds for ${windowId}`);
        }
        catch (err) {
            logger.error(`Failed to set bounds for classic browser windowId ${windowId}:`, err);
            throw new Error(err.message || 'Failed to set bounds for ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserSetBounds.js.map