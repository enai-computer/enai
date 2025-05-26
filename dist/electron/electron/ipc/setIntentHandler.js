"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSetIntentHandler = registerSetIntentHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
/**
 * Registers the IPC handler for the SET_INTENT channel.
 * This handler is responsible for receiving the user's intent from the renderer process
 * and passing it to the IntentService for processing.
 * @param serviceInstance - The actual instance of IntentService.
 */
function registerSetIntentHandler(serviceInstance) {
    electron_1.ipcMain.handle(ipcChannels_1.SET_INTENT, async (event, payload) => {
        logger_1.logger.info(`[IPC Handler][${ipcChannels_1.SET_INTENT}] Received intent: "${payload.intentText.substring(0, 100)}..." in context: ${payload.context}`);
        if (!serviceInstance) { // Check the passed instance
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.SET_INTENT}] IntentService instance is not available.`);
            event.sender.send(ipcChannels_1.ON_INTENT_RESULT, { type: 'error', message: 'Intent processing service not available.' });
            throw new Error('IntentService not available. Cannot process intent.');
        }
        try {
            await serviceInstance.handleIntent(payload, event.sender); // Use the passed serviceInstance directly
            return;
        }
        catch (error) {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.SET_INTENT}] Error calling IntentService.handleIntent:`, error);
            event.sender.send(ipcChannels_1.ON_INTENT_RESULT, {
                type: 'error',
                message: error.message || 'An unexpected error occurred while processing your request.'
            });
            throw error;
        }
    });
}
//# sourceMappingURL=setIntentHandler.js.map