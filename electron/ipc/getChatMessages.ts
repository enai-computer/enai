import { ipcMain } from 'electron';
import { CHAT_GET_MESSAGES } from '../../shared/ipcChannels';
import { ChatService } from '../../services/ChatService'; // Adjust path if needed
import { StructuredChatMessage } from '../../shared/types'; // Adjust path if needed
import { logger } from '../../utils/logger'; // Adjust path if needed

// Type for the expected payload from the renderer
interface GetMessagesPayload {
  sessionId: string;
  limit?: number;
  beforeTimestamp?: string;
}

/**
 * Registers the handler for fetching chat messages for a session.
 * @param chatServiceInstance An instance of ChatService.
 */
export function registerGetChatMessagesHandler(chatServiceInstance: ChatService) {
  // Use ipcMain.handle for request/response
  ipcMain.handle(
    CHAT_GET_MESSAGES,
    async (
      _event,
      payload: GetMessagesPayload
    ): Promise<StructuredChatMessage[]> => {
      const { sessionId, limit, beforeTimestamp } = payload;
      logger.info(
        `[IPC Handler] Received ${CHAT_GET_MESSAGES} for session: ${sessionId}, limit: ${limit}`
      );

      // 1. Basic Input Validation
      if (!sessionId || typeof sessionId !== 'string') {
        logger.error(
          `[IPC Handler Error][${CHAT_GET_MESSAGES}] Invalid sessionId received: ${sessionId}`
        );
        throw new Error('Invalid session ID provided.');
      }
      // Optional: Add validation for limit and beforeTimestamp if needed

      try {
        // 2. Delegate to Service
        // Assuming ChatService will have a getMessages method
        const messages: StructuredChatMessage[] = await chatServiceInstance.getMessages(
          sessionId,
          limit,
          beforeTimestamp
        );
        logger.info(
          `[IPC Handler] Successfully retrieved ${messages.length} messages for session ${sessionId}`
        );
        // 3. Return success result
        return messages;
      } catch (serviceError) {
        // 3. Handle errors from service layer
        logger.error(
          `[IPC Handler Error][${CHAT_GET_MESSAGES}] Failed to get messages for session ${sessionId}:`,
          serviceError
        );
        // Rethrow a user-friendly or sanitized error
        throw new Error(
          `Failed to retrieve messages. ${
            serviceError instanceof Error ? serviceError.message : ''
          }`
        );
      }
    }
  );
} 