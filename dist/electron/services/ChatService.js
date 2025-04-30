"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const ipcChannels_1 = require("../shared/ipcChannels"); // Corrected path
const logger_1 = require("../utils/logger"); // Corrected path
const THROTTLE_INTERVAL_MS = 50; // Send updates every 50ms
class ChatService {
    constructor(agent) {
        // Map to store active stream controllers, keyed by webContents ID
        this.activeStreams = new Map();
        this.langchainAgent = agent;
        logger_1.logger.info("[ChatService] Initialized.");
    }
    /**
     * Starts a streaming response for a given question and session,
     * sending chunks back via IPC. Manages stream lifecycle and cancellation.
     * @param sessionId The ID of the chat session.
     * @param question The user's question.
     * @param event The IpcMainEvent from the handler, used to target the response.
     */
    startStreamingResponse(sessionId, question, event) {
        const webContentsId = event.sender.id;
        logger_1.logger.info(`[ChatService] Starting stream for session ${sessionId}, sender ${webContentsId}, question: "${question.substring(0, 50)}..."`);
        // Check if a stream is already active for this sender and stop it first
        if (this.activeStreams.has(webContentsId)) {
            logger_1.logger.warn(`[ChatService] Sender ${webContentsId} already had an active stream. Stopping previous one.`);
            this.stopStream(webContentsId);
        }
        const controller = new AbortController();
        const streamData = {
            controller,
            buffer: '',
            timeoutId: null
        };
        this.activeStreams.set(webContentsId, streamData);
        const flushBuffer = () => {
            if (streamData.buffer.length > 0 && !event.sender.isDestroyed()) {
                // logger.trace(`[ChatService] Flushing buffer to ${webContentsId}: ${streamData.buffer.length} chars`);
                event.sender.send(ipcChannels_1.ON_CHAT_RESPONSE_CHUNK, streamData.buffer);
                streamData.buffer = ''; // Clear buffer after sending
            }
            if (streamData.timeoutId) {
                clearTimeout(streamData.timeoutId);
                streamData.timeoutId = null;
            }
        };
        // Define callbacks to handle stream events from the LangchainAgent
        const onChunk = (chunk) => {
            if (event.sender.isDestroyed()) {
                logger_1.logger.warn(`[ChatService] Sender ${webContentsId} destroyed, cannot process chunk. Aborting stream.`);
                this.stopStream(webContentsId); // Abort if sender is gone
                return;
            }
            streamData.buffer += chunk;
            // Reset timeout whenever a new chunk arrives
            if (streamData.timeoutId) {
                clearTimeout(streamData.timeoutId);
            }
            streamData.timeoutId = setTimeout(flushBuffer, THROTTLE_INTERVAL_MS);
        };
        const onEnd = () => {
            logger_1.logger.info(`[ChatService] Stream ended successfully for sender ${webContentsId}.`);
            flushBuffer(); // Send any remaining buffered content
            if (!event.sender.isDestroyed()) {
                event.sender.send(ipcChannels_1.ON_CHAT_STREAM_END);
            }
            this.activeStreams.delete(webContentsId); // Clean up
        };
        const onError = (error) => {
            // Don't report explicit aborts as errors to the UI unless desired
            if (error.message === 'Stream aborted') {
                logger_1.logger.info(`[ChatService] Stream explicitly aborted for sender ${webContentsId}.`);
                // Optionally send a specific 'aborted' signal if needed
                // event.sender.send(ON_CHAT_STREAM_ABORTED);
            }
            else {
                logger_1.logger.error(`[ChatService] Stream error for sender ${webContentsId}:`, error);
                if (!event.sender.isDestroyed()) {
                    event.sender.send(ipcChannels_1.ON_CHAT_STREAM_ERROR, error.message || 'An unknown error occurred during the stream.');
                }
            }
            flushBuffer(); // Ensure buffer is cleared even on error
            this.activeStreams.delete(webContentsId); // Clean up
        };
        // Start the agent's streaming process, passing the AbortSignal and session ID
        this.langchainAgent.queryStream(sessionId, question, onChunk, onEnd, onError, controller.signal)
            .catch(err => {
            // Catch potential errors during the setup phase of queryStream itself
            logger_1.logger.error(`[ChatService] Error initiating queryStream for sender ${webContentsId}:`, err);
            onError(err instanceof Error ? err : new Error('Failed to initiate stream'));
        });
    }
    /**
     * Stops an active stream associated with a specific webContents ID.
     * @param webContentsId The ID of the renderer's webContents.
     */
    stopStream(webContentsId) {
        const streamInfo = this.activeStreams.get(webContentsId);
        if (streamInfo) {
            logger_1.logger.info(`[ChatService] Aborting stream for sender ${webContentsId}.`);
            streamInfo.controller.abort(); // Signal abortion to the agent
            // No need to manually delete here, onError/onEnd triggered by abort should handle cleanup
            // However, defensive removal doesn't hurt:
            if (streamInfo.timeoutId)
                clearTimeout(streamInfo.timeoutId);
            this.activeStreams.delete(webContentsId);
        }
        else {
            logger_1.logger.debug(`[ChatService] No active stream found to stop for sender ${webContentsId}.`);
        }
    }
}
exports.ChatService = ChatService;
//# sourceMappingURL=ChatService.js.map