"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStartChatStreamHandler = registerStartChatStreamHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
/**
 * Registers the IPC handler for starting a chat stream.
 * Listens on the CHAT_STREAM_START channel.
 * @param chatServiceInstance An instance of the ChatService.
 */
function registerStartChatStreamHandler(chatServiceInstance) {
    logger_1.logger.info('[IPC Handler] Registering handler for', ipcChannels_1.CHAT_STREAM_START);
    // Use ipcMain.on because preload uses ipcRenderer.send (one-way)
    // The ChatService will handle sending responses back via event.sender.send
    electron_1.ipcMain.on(ipcChannels_1.CHAT_STREAM_START, (event, args // Expect args as the second parameter
    ) => {
        const { sessionId, question } = args ?? {}; // Destructure safely
        if (!sessionId || typeof sessionId !== 'string') {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_START}] Invalid or missing sessionId received.`);
            // Optionally send an error back if the channel supported it, 
            // but since it's .on, we just log.
            return;
        }
        if (!question || typeof question !== 'string') {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_START}] Invalid or missing question received for session ${sessionId}.`);
            return;
        }
        logger_1.logger.debug(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_START}] Received request for session: ${sessionId}`);
        try {
            // Delegate to the passed ChatService instance
            chatServiceInstance.startStreamingResponse(sessionId, question, event);
        }
        catch (error) {
            logger_1.logger.error(`[IPC Handler][${ipcChannels_1.CHAT_STREAM_START}] Error calling chatService.startStreamingResponse for session ${sessionId}:`, error);
            // Handle potential synchronous errors from ChatService setup (though it should be robust)
            // If possible, send an error back via the event sender for the specific channel
            if (!event.sender.isDestroyed()) {
                // Using ON_CHAT_STREAM_ERROR to signal failure
                event.sender.send(ipcChannels_1.ON_CHAT_STREAM_ERROR, 'Failed to initiate chat stream.');
            }
        }
    });
}
//# sourceMappingURL=startChatStream.js.map