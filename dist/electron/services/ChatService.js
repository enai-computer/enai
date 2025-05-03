"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const ipcChannels_1 = require("../shared/ipcChannels"); // Corrected path
const logger_1 = require("../utils/logger"); // Corrected path
const THROTTLE_INTERVAL_MS = 50; // Send updates every 50ms
class ChatService {
    // Inject ChatModel instance
    constructor(agent, model) {
        // Map to store active stream controllers, keyed by webContents ID
        this.activeStreams = new Map();
        this.langchainAgent = agent;
        this.chatModel = model; // Store ChatModel instance
        logger_1.logger.info("[ChatService] Initialized.");
    }
    /**
     * Retrieves messages for a specific chat session and structures their metadata.
     * Delegates to the ChatModel for fetching, then handles parsing.
     * @param sessionId The ID of the session whose messages to retrieve.
     * @param limit Optional maximum number of messages to return.
     * @param beforeTimestamp Optional ISO timestamp to fetch messages strictly before this point.
     * @returns An array of StructuredChatMessage objects with metadata as objects.
     */
    async getMessages(sessionId, limit, beforeTimestamp) {
        logger_1.logger.debug(`[ChatService] Getting messages for session: ${sessionId}, limit: ${limit}, before: ${beforeTimestamp}`);
        try {
            // 1. Fetch raw messages from the model
            const rawMessages = await this.chatModel.getMessages(sessionId, limit, beforeTimestamp);
            logger_1.logger.info(`[ChatService] Retrieved ${rawMessages.length} raw messages for session ${sessionId}`);
            // 2. Parse metadata for each message
            const structuredMessages = rawMessages.map(message => {
                let structuredMeta = null;
                if (message.metadata) {
                    try {
                        structuredMeta = JSON.parse(message.metadata);
                        // Optional: Add validation here if needed (e.g., using Zod)
                        // Ensure sourceChunkIds is an array of numbers if present
                        if (structuredMeta?.sourceChunkIds && !Array.isArray(structuredMeta.sourceChunkIds)) {
                            logger_1.logger.warn(`[ChatService] Invalid sourceChunkIds format in metadata for message ${message.message_id}. Expected array. Found: ${typeof structuredMeta.sourceChunkIds}`);
                            // Correct the type or set to null/undefined depending on desired handling
                            structuredMeta.sourceChunkIds = undefined; // or null
                        }
                        else if (structuredMeta?.sourceChunkIds?.some(id => typeof id !== 'number')) {
                            logger_1.logger.warn(`[ChatService] Non-numeric ID found in sourceChunkIds for message ${message.message_id}. Filtering.`);
                            structuredMeta.sourceChunkIds = structuredMeta.sourceChunkIds.filter(id => typeof id === 'number');
                        }
                    }
                    catch (parseError) {
                        logger_1.logger.error(`[ChatService] Failed to parse metadata for message ${message.message_id}:`, parseError);
                        // Keep structuredMeta as null if parsing fails
                    }
                }
                // 3. Construct the StructuredChatMessage
                // Omit the original metadata string and add the parsed object
                const { metadata, ...rest } = message;
                return {
                    ...rest,
                    metadata: structuredMeta
                };
            });
            logger_1.logger.debug(`[ChatService] Returning ${structuredMessages.length} structured messages for session ${sessionId}`);
            return structuredMessages;
        }
        catch (error) {
            logger_1.logger.error(`[ChatService] Error getting and structuring messages for session ${sessionId}:`, error);
            // Re-throw the error to be handled by the caller (IPC handler)
            throw error;
        }
    }
    /**
     * Checks if a session exists, creates it if not.
     * Separated logic for clarity.
     * @param sessionId The ID of the session to ensure exists.
     */
    async ensureSessionExists(sessionId) {
        try {
            const existingSession = await this.chatModel.getSession(sessionId);
            if (!existingSession) {
                logger_1.logger.info(`[ChatService] Session ${sessionId} not found. Creating now...`);
                await this.chatModel.createSession(sessionId); // Assuming createSession takes ID
                logger_1.logger.info(`[ChatService] Session ${sessionId} created successfully.`);
            }
            else {
                logger_1.logger.debug(`[ChatService] Session ${sessionId} already exists.`);
            }
        }
        catch (error) {
            logger_1.logger.error(`[ChatService] Error ensuring session ${sessionId} exists:`, error);
            // Depending on requirements, might want to re-throw or handle differently
            throw new Error(`Failed to ensure session ${sessionId} exists.`);
        }
    }
    /**
     * Starts a streaming response for a given question and session,
     * sending chunks back via IPC. Manages stream lifecycle and cancellation.
     * Ensures session exists before starting the agent.
     * @param sessionId The ID of the chat session.
     * @param question The user's question.
     * @param event The IpcMainEvent from the handler, used to target the response.
     */
    async startStreamingResponse(sessionId, question, event) {
        const webContentsId = event.sender.id;
        logger_1.logger.info(`[ChatService] Starting stream request for session ${sessionId}, sender ${webContentsId}, question: "${question.substring(0, 50)}..."`);
        // --- Ensure Session Exists BEFORE starting anything else ---
        try {
            await this.ensureSessionExists(sessionId);
        }
        catch (sessionError) {
            logger_1.logger.error(`[ChatService] Failed to ensure session exists for ${sessionId}, aborting stream start.`, sessionError);
            // Send an error back to the renderer
            try {
                if (!event.sender.isDestroyed()) {
                    event.sender.send(ipcChannels_1.ON_CHAT_STREAM_ERROR, `Failed to initialize chat session: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
                }
            }
            catch (sendError) {
                logger_1.logger.error(`[ChatService] Error sending session init error signal to destroyed sender ${webContentsId}:`, sendError);
            }
            return; // Stop execution if session cannot be ensured
        }
        // --- Session should now exist --- 
        logger_1.logger.info(`[ChatService] Session ${sessionId} confirmed/created. Proceeding with stream start for sender ${webContentsId}.`);
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
            // Add try...catch around send operations
            try {
                if (streamData.buffer.length > 0 && !event.sender.isDestroyed()) {
                    // logger.trace(`[ChatService] Flushing buffer to ${webContentsId}: ${streamData.buffer.length} chars`);
                    event.sender.send(ipcChannels_1.ON_CHAT_RESPONSE_CHUNK, streamData.buffer);
                    streamData.buffer = ''; // Clear buffer after sending
                }
            }
            catch (sendError) {
                logger_1.logger.error(`[ChatService] Error sending chunk to destroyed sender ${webContentsId}:`, sendError);
                // Attempt to stop the stream if sending fails (sender likely destroyed)
                this.stopStream(webContentsId);
            }
            if (streamData.timeoutId) {
                clearTimeout(streamData.timeoutId);
                streamData.timeoutId = null;
            }
        };
        // Define callbacks to handle stream events from the LangchainAgent
        const onChunk = (chunk) => {
            // Check destroyed before potentially lengthy buffer operations or timeout setup
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
            // Add try...catch for final send
            try {
                if (!event.sender.isDestroyed()) {
                    event.sender.send(ipcChannels_1.ON_CHAT_STREAM_END);
                }
            }
            catch (sendError) {
                logger_1.logger.error(`[ChatService] Error sending stream end signal to destroyed sender ${webContentsId}:`, sendError);
                // No stream to stop here, just log
            }
            this.activeStreams.delete(webContentsId); // Clean up
        };
        const onError = (error) => {
            // Add try...catch for error send
            try {
                let messageToSend;
                if (error instanceof Error) {
                    // Don't report explicit aborts as errors to the UI unless desired
                    if (error.message === 'Stream aborted') {
                        logger_1.logger.info(`[ChatService] Stream explicitly aborted for sender ${webContentsId}.`);
                        // Optionally send a specific 'aborted' signal if needed
                        // event.sender.send(ON_CHAT_STREAM_ABORTED);
                        // Setting messageToSend to null/undefined will skip sending an error message
                        messageToSend = ''; // Send empty string or handle differently if desired
                    }
                    else {
                        logger_1.logger.error(`[ChatService] Stream error for sender ${webContentsId}:`, error);
                        messageToSend = error.message;
                    }
                }
                else {
                    // Handle non-Error objects
                    logger_1.logger.error(`[ChatService] Received non-Error object during stream for sender ${webContentsId}:`, error);
                    messageToSend = 'An unexpected error occurred during the stream.';
                    // Optionally serialize 'error' if it might contain useful info
                    // messageToSend = `An unexpected error occurred: ${JSON.stringify(error)}`; 
                }
                // Send the error message only if it's non-empty and sender exists
                if (messageToSend && !event.sender.isDestroyed()) {
                    event.sender.send(ipcChannels_1.ON_CHAT_STREAM_ERROR, messageToSend);
                }
            }
            catch (sendError) {
                logger_1.logger.error(`[ChatService] Error sending stream error signal to destroyed sender ${webContentsId}:`, sendError);
                // No stream to stop here, just log
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