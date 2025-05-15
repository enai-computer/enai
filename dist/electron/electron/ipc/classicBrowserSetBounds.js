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
    electron_1.ipcMain.on(ipcChannels_1.CLASSIC_BROWSER_SET_BOUNDS, (_event, { windowId, bounds }) => {
        // logger.debug(`Handling ${CLASSIC_BROWSER_SET_BOUNDS} for windowId: ${windowId}, bounds: ${JSON.stringify(bounds)}`); // Can be too noisy
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            // throw new Error('Invalid windowId. Must be a non-empty string.'); // Cannot throw back to renderer with ipcMain.on
            return; // Exit if invalid
        }
        if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
            logger.error('Invalid bounds provided.', bounds);
            // throw new Error('Invalid bounds object. Must include x, y, width, height as numbers.');
            return; // Exit if invalid
        }
        try {
            classicBrowserService.setBounds(windowId, bounds);
            // logger.debug(`Successfully set bounds for ${windowId}`);
        }
        catch (err) {
            logger.error(`Failed to set bounds for classic browser windowId ${windowId}:`, err);
            // throw new Error(err.message || 'Failed to set bounds for ClassicBrowser view.'); // Error is logged, cannot throw back
        }
    });
}
//# sourceMappingURL=classicBrowserSetBounds.js.map