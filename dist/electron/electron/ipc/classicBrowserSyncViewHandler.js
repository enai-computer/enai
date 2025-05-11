"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserSyncViewHandler = registerClassicBrowserSyncViewHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserSyncView]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserSyncView]', ...args),
};
function registerClassicBrowserSyncViewHandler(classicBrowserService) {
    electron_1.ipcMain.handle(ipcChannels_1.CLASSIC_BROWSER_SYNC_VIEW, async (_event, { windowId, bounds, isVisible }) => {
        // This log can be very noisy, consider reducing its level or frequency if needed.
        // logger.debug(`Handling ${CLASSIC_BROWSER_SYNC_VIEW} for windowId: ${windowId}, Bounds: ${JSON.stringify(bounds)}, Visible: ${isVisible}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided for SyncView.');
            throw new Error('Invalid windowId. Must be a non-empty string.');
        }
        try {
            if (bounds) {
                if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number' ||
                    typeof bounds.width !== 'number' || typeof bounds.height !== 'number' ||
                    bounds.width < 0 || bounds.height < 0) { // Allow 0 width/height for hidden views potentially
                    logger.error('Invalid bounds provided for SyncView:', bounds);
                    throw new Error('Invalid bounds for ClassicBrowserSyncView.');
                }
                // Ensure bounds are integers, as setBounds expects them.
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
            // logger.debug(`ClassicBrowserSyncViewHandler: sync call for ${windowId} processed.`);
        }
        catch (err) {
            logger.error(`Failed to sync ClassicBrowser view for windowId ${windowId}:`, err);
            throw new Error(err.message || 'Failed to sync ClassicBrowser view state.');
        }
    });
}
//# sourceMappingURL=classicBrowserSyncViewHandler.js.map