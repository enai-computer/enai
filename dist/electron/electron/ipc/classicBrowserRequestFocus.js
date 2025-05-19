"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserRequestFocusHandler = registerClassicBrowserRequestFocusHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger"); // Corrected logger path
function registerClassicBrowserRequestFocusHandler(classicBrowserService) {
    electron_1.ipcMain.on(ipcChannels_1.CLASSIC_BROWSER_REQUEST_FOCUS, (_event, windowId) => {
        logger_1.logger.debug(`[IPCClassicBrowserRequestFocus] Received request to focus windowId: ${windowId}`);
        if (!windowId || typeof windowId !== 'string') {
            logger_1.logger.error('[IPCClassicBrowserRequestFocus] Invalid windowId provided.');
            return;
        }
        try {
            const view = classicBrowserService.getView(windowId); // Assuming a method to get the view
            if (view && view.webContents) {
                view.webContents.focus();
                logger_1.logger.debug(`[IPCClassicBrowserRequestFocus] Called webContents.focus() for windowId: ${windowId}`);
            }
            else {
                logger_1.logger.warn(`[IPCClassicBrowserRequestFocus] No view or webContents found for windowId: ${windowId}`);
            }
        }
        catch (err) {
            logger_1.logger.error(`[IPCClassicBrowserRequestFocus] Error:`, err.message || err);
        }
    });
}
//# sourceMappingURL=classicBrowserRequestFocus.js.map