"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserLoadUrlHandler = registerClassicBrowserLoadUrlHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserLoadUrl]', ...args),
    warn: (...args) => console.warn('[IPCClassicBrowserLoadUrl]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserLoadUrl]', ...args),
};
// interface ClassicBrowserLoadUrlParams { // Obsolete for handler arguments
//   windowId: string;
//   url: string;
// }
function registerClassicBrowserLoadUrlHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_LOAD_URL, async (_event, windowId, url) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_LOAD_URL} for windowId: ${windowId}, URL: ${url}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId. Must be a non-empty string.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        if (!url || typeof url !== 'string') {
            logger.error('Invalid URL. Must be a non-empty string.');
            throw new Error('Invalid URL. Must be a non-empty string.');
        }
        // Basic URL validation (very simple, can be enhanced)
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
            logger.error('Invalid URL scheme. Must be http, https, or about.');
            throw new Error('Invalid URL scheme. Must be http, https, or about.');
        }
        try {
            await classicBrowserService.loadUrl(windowId, url);
            // No explicit return needed for Promise<void> if successful
        }
        catch (err) {
            logger.error(`Error in ${ipcChannels_1.CLASSIC_BROWSER_LOAD_URL} handler for ${windowId}:`, err.message || err);
            // Let the error propagate (it will be caught by the renderer's invoke call)
            throw err;
        }
    });
}
//# sourceMappingURL=classicBrowserLoadUrl.js.map