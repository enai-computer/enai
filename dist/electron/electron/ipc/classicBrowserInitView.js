"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserCreateHandler = registerClassicBrowserCreateHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
// Optional: Define a logger utility or use console
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserCreate]', ...args),
    warn: (...args) => console.warn('[IPCClassicBrowserCreate]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserCreate]', ...args),
};
// interface ClassicBrowserCreateParams { // This interface is now obsolete for the handler arguments
//   windowId: string;
//   bounds: Electron.Rectangle;
//   initialUrl?: string;
// }
function registerClassicBrowserCreateHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_CREATE, async (_event, windowId, bounds, initialUrl) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_CREATE} for windowId: ${windowId} with bounds: ${JSON.stringify(bounds)}, initialUrl: ${initialUrl}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId for ClassicBrowserCreate. Must be a non-empty string.');
            throw new Error('Invalid windowId for ClassicBrowserCreate. Must be a non-empty string.');
        }
        // Add more validation for bounds and initialUrl if necessary
        if (!bounds || typeof bounds !== 'object' || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') {
            logger.error('Invalid bounds provided for ClassicBrowserCreate.');
            throw new Error('Invalid bounds provided for ClassicBrowserCreate.');
        }
        try {
            classicBrowserService.createBrowserView(windowId, bounds, initialUrl);
            return { success: true };
        }
        catch (err) {
            logger.error(`Error in ${ipcChannels_1.CLASSIC_BROWSER_CREATE} handler:`, err.message || err);
            throw new Error(err.message || `Failed to create classic browser view for ${windowId}`);
        }
    });
}
//# sourceMappingURL=classicBrowserInitView.js.map