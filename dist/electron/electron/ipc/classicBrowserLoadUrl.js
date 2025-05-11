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
function registerClassicBrowserLoadUrlHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_LOAD_URL, async (_event, { windowId, url }) => {
        logger.debug(`Handling ${ipcChannels_1.CLASSIC_BROWSER_LOAD_URL} for windowId: ${windowId}, URL: ${url}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        if (!url || typeof url !== 'string') {
            logger.error(`Invalid URL provided: ${url}`);
            throw new Error('Invalid URL. Must be a non-empty string.');
        }
        // Basic URL validation (very simple, can be expanded)
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            logger.warn(`URL "${url}" does not start with http:// or https://. Attempting to load anyway.`);
            // Depending on strictness, you might throw an error here or let the service attempt it.
            // For now, we allow it, and the BrowserView will likely handle it or fail.
        }
        try {
            await classicBrowserService.loadUrl(windowId, url);
            logger.debug(`ClassicBrowserLoadUrlHandler: loadUrl call for ${windowId} with URL ${url} completed.`);
        }
        catch (err) {
            logger.error(`Failed to load URL in ClassicBrowser for windowId ${windowId}, URL ${url}:`, err);
            throw new Error(err.message || 'Failed to load URL in ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserLoadUrl.js.map