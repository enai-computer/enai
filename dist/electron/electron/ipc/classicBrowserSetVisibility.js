"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClassicBrowserSetVisibilityHandler = registerClassicBrowserSetVisibilityHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger = {
    debug: (...args) => console.log('[IPCClassicBrowserSetVisibility]', ...args),
    error: (...args) => console.error('[IPCClassicBrowserSetVisibility]', ...args),
};
// Define expected parameters if not already in shared types
// interface ClassicBrowserSetVisibilityParams { // This interface might be obsolete or need changing
//   windowId: string;
//   shouldBeDrawn: boolean;
//   isFocused: boolean;
// }
function registerClassicBrowserSetVisibilityHandler(classicBrowserService) {
    electron_1.ipcMain.on(ipcChannels_1.CLASSIC_BROWSER_SET_VISIBILITY, (_event, windowId, shouldBeDrawn, isFocused) => {
        // logger.debug(`Handling ${CLASSIC_BROWSER_SET_VISIBILITY} for windowId: ${windowId}, shouldBeDrawn: ${shouldBeDrawn}, isFocused: ${isFocused}`);
        if (!windowId || typeof windowId !== 'string') {
            logger.error('Invalid windowId provided.');
            return;
        }
        if (typeof shouldBeDrawn !== 'boolean' || typeof isFocused !== 'boolean') {
            logger.error('Invalid boolean parameters for visibility/focus.');
            return;
        }
        try {
            classicBrowserService.setVisibility(windowId, shouldBeDrawn, isFocused);
        }
        catch (err) {
            logger.error(`Error in ${ipcChannels_1.CLASSIC_BROWSER_SET_VISIBILITY} handler:`, err.message || err);
        }
    });
}
//# sourceMappingURL=classicBrowserSetVisibility.js.map