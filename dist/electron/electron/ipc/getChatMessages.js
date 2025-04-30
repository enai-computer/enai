"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGetChatMessagesHandler = registerGetChatMessagesHandler;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger"); // Adjust path if needed
/**
 * Registers the handler for fetching chat messages for a session.
 * @param chatServiceInstance An instance of ChatService.
 */
function registerGetChatMessagesHandler(chatServiceInstance) {
    // Use ipcMain.handle for request/response
    electron_1.ipcMain.handle(ipcChannels_1.CHAT_GET_MESSAGES, async (_event, payload) => {
        const { sessionId, limit, beforeTimestamp } = payload;
        logger_1.logger.info(`[IPC Handler] Received ${ipcChannels_1.CHAT_GET_MESSAGES} for session: ${sessionId}, limit: ${limit}`);
        // 1. Basic Input Validation
        if (!sessionId || typeof sessionId !== 'string') {
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_GET_MESSAGES}] Invalid sessionId received: ${sessionId}`);
            throw new Error('Invalid session ID provided.');
        }
        // Optional: Add validation for limit and beforeTimestamp if needed
        try {
            // 2. Delegate to Service
            // Assuming ChatService will have a getMessages method
            const messages = await chatServiceInstance.getMessages(sessionId, limit, beforeTimestamp);
            logger_1.logger.info(`[IPC Handler] Successfully retrieved ${messages.length} messages for session ${sessionId}`);
            // 3. Return success result
            return messages;
        }
        catch (serviceError) {
            // 3. Handle errors from service layer
            logger_1.logger.error(`[IPC Handler Error][${ipcChannels_1.CHAT_GET_MESSAGES}] Failed to get messages for session ${sessionId}:`, serviceError);
            // Rethrow a user-friendly or sanitized error
            throw new Error(`Failed to retrieve messages. ${serviceError instanceof Error ? serviceError.message : ''}`);
        }
    });
}
//# sourceMappingURL=getChatMessages.js.map