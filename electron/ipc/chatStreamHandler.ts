import { ipcMain, IpcMainEvent } from 'electron';
import { CHAT_STREAM_START, CHAT_STREAM_STOP, ON_CHAT_STREAM_ERROR } from '../../shared/ipcChannels';
import { ChatService } from '../../services/ChatService';
import { logger } from '../../utils/logger';
import { StartStreamPayloadSchema } from '../../shared/schemas/ipcSchemas';
import { validateIpcPayload } from './validatePayload';

/**
 * Registers the handler for starting a chat stream.
 * Uses ipcMain.on as it's an event trigger, not request/response.
 * @param chatServiceInstance An instance of ChatService.
 */
export function registerChatStreamStartHandler(chatServiceInstance: ChatService) {
  ipcMain.on(CHAT_STREAM_START, (event: IpcMainEvent, payload: unknown) => {
    const validated = validateIpcPayload(StartStreamPayloadSchema, payload);
    const { sessionId, question, notebookId } = validated;
    const webContentsId = event.sender.id;
    logger.info(
      `[IPC Handler][${CHAT_STREAM_START}] Received for sender ${webContentsId}, notebook: ${notebookId}, session: ${sessionId}, question: "${question.substring(0, 50)}..."`
    );

    // 1. Basic Input Validation

    try {
      // 2. Delegate to Service to start the streaming process
      // Pass the original event so the service knows which window to send chunks back to
      chatServiceInstance.startStreamingResponse(notebookId, sessionId, question, event);
      // No direct return value needed for ipcMain.on
    } catch (serviceError) {
      // 3. Handle immediate errors from starting the service call (rare)
      logger.error(
        `[IPC Handler Error][${CHAT_STREAM_START}] Failed to initiate stream for sender ${webContentsId}, notebook: ${notebookId}, session ${sessionId}:`,
        serviceError
      );
      // Attempt to send an error back to the specific sender
      try {
        if (!event.sender.isDestroyed()) {
           event.sender.send(ON_CHAT_STREAM_ERROR, `Failed to start stream: ${serviceError instanceof Error ? serviceError.message : 'Unknown error'}`);
        }
      } catch (sendError) {
         logger.error(`[IPC Handler Error][${CHAT_STREAM_START}] Error sending error signal back to destroyed sender ${webContentsId}:`, sendError);
      }
    }
  });
}

/**
 * Registers the handler for stopping a chat stream.
 * Uses ipcMain.on.
 * @param chatServiceInstance An instance of ChatService.
 */
export function registerChatStreamStopHandler(chatServiceInstance: ChatService) {
  ipcMain.on(CHAT_STREAM_STOP, (event: IpcMainEvent) => {
    const webContentsId = event.sender.id;
    logger.info(
      `[IPC Handler][${CHAT_STREAM_STOP}] Received stop request from sender ${webContentsId}`
    );

    try {
      // Delegate to Service to stop the stream associated with the sender window
      chatServiceInstance.stopStream(webContentsId);
      // No return value needed
    } catch (serviceError) {
      // Handle potential errors from the stopStream method itself (e.g., internal state issues)
       logger.error(
         `[IPC Handler Error][${CHAT_STREAM_STOP}] Failed to stop stream for sender ${webContentsId}:`,
         serviceError
       );
       // It's less critical to notify the UI about errors stopping a stream, but could be added if needed.
    }
  });
} 