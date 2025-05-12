"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatStreamStartHandler = registerChatStreamStartHandler;
exports.registerChatStreamStopHandler = registerChatStreamStopHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger"); // Adjust path if needed
/**
 * Registers the handler for starting a chat stream.
 * Uses ipcMain.on as it's an event trigger, not request/response.
 * @param chatServiceInstance An instance of ChatService.
 */
function registerChatStreamStartHandler(chatServiceInstance) {
    electron_1.ipcMain.on(ipcChannels_1.CHAT_STREAM_START, (event, payload) => {
        const { sessionId, question, notebookId } = payload;
        const webContentsId = event.sender.id;
        logger_1.logger.info(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_START}] Received for sender ${webContentsId}, notebook: ${notebookId}, session: ${sessionId}, question: "${question.substring(0, 50)}..."`);
        // 1. Basic Input Validation
        if (!notebookId || typeof notebookId !== 'string' || !sessionId || typeof sessionId !== 'string' || !question || typeof question !== 'string') {
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_STREAM_START}] Invalid notebookId, sessionId, or question received for sender ${webContentsId}:`, payload);
            // Optionally send an error back if desired, though it's one-way
            // event.sender.send(ON_CHAT_STREAM_ERROR, 'Invalid session ID or question.');
            return; // Stop processing
        }
        try {
            // 2. Delegate to Service to start the streaming process
            // Pass the original event so the service knows which window to send chunks back to
            chatServiceInstance.startStreamingResponse(notebookId, sessionId, question, event);
            // No direct return value needed for ipcMain.on
        }
        catch (serviceError) {
            // 3. Handle immediate errors from starting the service call (rare)
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_STREAM_START}] Failed to initiate stream for sender ${webContentsId}, notebook: ${notebookId}, session ${sessionId}:`, serviceError);
            // Attempt to send an error back to the specific sender
            try {
                if (!event.sender.isDestroyed()) {
                    event.sender.send(ipcChannels_1.ON_CHAT_STREAM_ERROR, `Failed to start stream: ${serviceError instanceof Error ? serviceError.message : 'Unknown error'}`);
                }
            }
            catch (sendError) {
                logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_STREAM_START}] Error sending error signal back to destroyed sender ${webContentsId}:`, sendError);
            }
        }
    });
}
/**
 * Registers the handler for stopping a chat stream.
 * Uses ipcMain.on.
 * @param chatServiceInstance An instance of ChatService.
 */
function registerChatStreamStopHandler(chatServiceInstance) {
    electron_1.ipcMain.on(ipcChannels_1.CHAT_STREAM_STOP, (event) => {
        const webContentsId = event.sender.id;
        logger_1.logger.info(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_STOP}] Received stop request from sender ${webContentsId}`);
        try {
            // Delegate to Service to stop the stream associated with the sender window
            chatServiceInstance.stopStream(webContentsId);
            // No return value needed
        }
        catch (serviceError) {
            // Handle potential errors from the stopStream method itself (e.g., internal state issues)
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_STREAM_STOP}] Failed to stop stream for sender ${webContentsId}:`, serviceError);
            // It's less critical to notify the UI about errors stopping a stream, but could be added if needed.
        }
    });
}
//# sourceMappingURL=chatStreamHandler.js.map