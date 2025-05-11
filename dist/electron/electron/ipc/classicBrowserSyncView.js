"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBrowserBoundsHandler = registerBrowserBoundsHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCBrowserBounds]', ...args),
    error: (...args) => console.error('[IPCBrowserBounds]', ...args),
};
function registerBrowserBoundsHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.BROWSER_BOUNDS, async (_event, { windowId, bounds, isVisible }) => {
        // logger.debug(`Handling ${BROWSER_BOUNDS} for windowId: ${windowId}, Bounds: ${JSON.stringify(bounds)}, Visible: ${isVisible}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided for SetBounds.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        try {
            if (bounds) {
                if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number' ||
                    typeof bounds.width !== 'number' || typeof bounds.height !== 'number' ||
                    bounds.width < 0 || bounds.height < 0) {
                    logger.error('Invalid bounds provided for SetBounds:', bounds);
                    throw new Error('Invalid bounds for BrowserBounds.');
                }
                const intBounds = {
                    x: Math.round(bounds.x),
                    y: Math.round(bounds.y),
                    width: Math.round(bounds.width),
                    height: Math.round(bounds.height),
                };
                classicBrowserService.setBounds(windowId, intBounds);
            }
            if (typeof isVisible === 'boolean') {
                classicBrowserService.setVisibility(windowId, isVisible);
            }
            // logger.debug(`BrowserBoundsHandler: call for ${windowId} processed.`);
        }
        catch (err) {
            logger.error(`Failed to set bounds/visibility for ClassicBrowser view for windowId ${windowId}:`, err);
            throw new Error(err.message || 'Failed to set bounds/visibility for ClassicBrowser view.');
        }
    });
}
//# sourceMappingURL=classicBrowserSyncView.js.map