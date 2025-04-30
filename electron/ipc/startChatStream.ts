import { ipcMain, IpcMainEvent } from 'electron';
import { CHAT_STREAM_START, ON_CHAT_STREAM_ERROR } from '../../shared/ipcChannels';
import { ChatService } from '../../services/ChatService';
import { logger } from '../../utils/logger';

/**
 * Registers the IPC handler for starting a chat stream.
 * Listens on the CHAT_STREAM_START channel.
 * @param chatServiceInstance An instance of the ChatService.
 */
export function registerStartChatStreamHandler(chatServiceInstance: ChatService): void {
    logger.info('[IPC Handler] Registering handler for', CHAT_STREAM_START);

    // Use ipcMain.on because preload uses ipcRenderer.send (one-way)
    // The ChatService will handle sending responses back via event.sender.send
    ipcMain.on(CHAT_STREAM_START, (
        event: IpcMainEvent, 
        args: { sessionId?: string; question?: string } // Expect args as the second parameter
    ) => {
        const { sessionId, question } = args ?? {}; // Destructure safely

        if (!sessionId || typeof sessionId !== 'string') {
            logger.error(`[IPC Handler][${CHAT_STREAM_START}] Invalid or missing sessionId received.`);
            // Optionally send an error back if the channel supported it, 
            // but since it's .on, we just log.
            return; 
        }
        if (!question || typeof question !== 'string') {
            logger.error(`[IPC Handler][${CHAT_STREAM_START}] Invalid or missing question received for session ${sessionId}.`);
            return;
        }

        logger.debug(`[IPC Handler][${CHAT_STREAM_START}] Received request for session: ${sessionId}`);
        
        try {
            // Delegate to the passed ChatService instance
            chatServiceInstance.startStreamingResponse(sessionId, question, event);
        } catch (error) {
            logger.error(`[IPC Handler][${CHAT_STREAM_START}] Error calling chatService.startStreamingResponse for session ${sessionId}:`, error);
            // Handle potential synchronous errors from ChatService setup (though it should be robust)
            // If possible, send an error back via the event sender for the specific channel
            if (!event.sender.isDestroyed()) {
                 // Using ON_CHAT_STREAM_ERROR to signal failure
                 event.sender.send(ON_CHAT_STREAM_ERROR, 'Failed to initiate chat stream.');
            }
        }
    });
} 