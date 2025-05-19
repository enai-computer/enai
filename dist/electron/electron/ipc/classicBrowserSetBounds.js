"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserSetBoundsHandler = registerClassicBrowserSetBoundsHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserSetBounds]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserSetBounds]', ...args),
};
// interface ClassicBrowserSetBoundsParams { // Obsolete for handler arguments
//   windowId: string;
//   bounds: Electron.Rectangle;
// }
function registerClassicBrowserSetBoundsHandler(classicBrowserService) {
    electron_1.ipcMain.on(ipcChannels_1.CLASSIC_BROWSER_SET_BOUNDS, (_event, windowId, bounds) => {
        // logger.debug(`Handling ${CLASSIC_BROWSER_SET_BOUNDS} for windowId: ${windowId}, bounds: ${JSON.stringify(bounds)}`); // Can be too noisy
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            return; // For ipcMain.on, just return on error, don't throw unless it implies main process crash
        }
        if (!bounds || typeof bounds !== 'object' || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
            logger.error('Invalid bounds provided.');
            return;
        }
        try {
            classicBrowserService.setBounds(windowId, bounds);
        }
        catch (err) {
            logger.error(`Error in ${ipcChannels_1.CLASSIC_BROWSER_SET_BOUNDS} handler:`, err.message || err);
        }
    });
}
//# sourceMappingURL=classicBrowserSetBounds.js.map