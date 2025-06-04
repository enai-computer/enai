import { IpcMainEvent } from 'electron';
import { LangchainAgent } from "./agents/LangchainAgent";
import { getActivityLogService } from './ActivityLogService';
import { 
    ON_CHAT_RESPONSE_CHUNK, 
    ON_CHAT_STREAM_END, 
    ON_CHAT_STREAM_ERROR 
} from '../shared/ipcChannels'; // Corrected path
import { logger } from '../utils/logger'; // Corrected path
import { performanceTracker } from '../utils/performanceTracker';
import { 
    IChatMessage, 
    StructuredChatMessage,
    ChatMessageSourceMetadata 
} from '../shared/types.d'; // Import IChatMessage for return type
import { ChatModel } from '../models/ChatModel'; // Import ChatModel
import { StreamingService } from './StreamingService';
import { v4 as uuidv4 } from 'uuid';

class ChatService {
    private streamingService: StreamingService;
    private langchainAgent: LangchainAgent;
    private chatModel: ChatModel;

    // Inject ChatModel instance
    constructor(agent: LangchainAgent, model: ChatModel, streamingService: StreamingService) {
        this.langchainAgent = agent;
        this.chatModel = model;
        this.streamingService = streamingService;
        logger.info("[ChatService] Initialized.");
    }

     /**
      * Retrieves messages for a specific chat session and structures their metadata.
      * Delegates to the ChatModel for fetching, then handles parsing.
      * @param sessionId The ID of the session whose messages to retrieve.
      * @param limit Optional maximum number of messages to return.
      * @param beforeTimestamp Optional ISO timestamp to fetch messages strictly before this point.
      * @returns An array of StructuredChatMessage objects with metadata as objects.
      */
     async getMessages(
        sessionId: string,
        limit?: number,
        beforeTimestampParam?: string | Date | undefined // Allow string or Date for input flexibility
    ): Promise<StructuredChatMessage[]> {
        logger.debug(`[ChatService] Getting messages for session: ${sessionId}, limit: ${limit}, before: ${beforeTimestampParam}`);
        try {
            let beforeTimestampAsDate: Date | undefined;
            if (typeof beforeTimestampParam === 'string') {
                beforeTimestampAsDate = new Date(beforeTimestampParam);
                if (isNaN(beforeTimestampAsDate.getTime())) { // Check for invalid date string
                    logger.warn(`[ChatService] Invalid date string received for beforeTimestampParam: ${beforeTimestampParam}. Proceeding without timestamp filter.`);
                    beforeTimestampAsDate = undefined;
                }
            } else if (beforeTimestampParam instanceof Date) {
                beforeTimestampAsDate = beforeTimestampParam;
            }

            const rawMessages: IChatMessage[] = await this.chatModel.getMessagesBySessionId(sessionId, limit, beforeTimestampAsDate);
            logger.info(`[ChatService] Retrieved ${rawMessages.length} raw messages for session ${sessionId}`);

            // 2. Parse metadata for each message
            const structuredMessages: StructuredChatMessage[] = rawMessages.map(message => {
                let structuredMeta: ChatMessageSourceMetadata | null = null;
                if (message.metadata) {
                    try {
                        structuredMeta = JSON.parse(message.metadata) as ChatMessageSourceMetadata;
                        if (structuredMeta?.sourceChunkIds && !Array.isArray(structuredMeta.sourceChunkIds)) {
                             logger.warn(`[ChatService] Invalid sourceChunkIds format in metadata for message ${message.messageId}. Expected array. Found: ${typeof structuredMeta.sourceChunkIds}`);
                             structuredMeta.sourceChunkIds = undefined; 
                        } else if (structuredMeta?.sourceChunkIds?.some(id => typeof id !== 'number')) {
                             logger.warn(`[ChatService] Non-numeric ID found in sourceChunkIds for message ${message.messageId}. Filtering.`);
                             structuredMeta.sourceChunkIds = structuredMeta.sourceChunkIds.filter(id => typeof id === 'number');
                        }
                    } catch (parseError) {
                        logger.error(`[ChatService] Failed to parse metadata for message ${message.messageId}:`, parseError);
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

            logger.debug(`[ChatService] Returning ${structuredMessages.length} structured messages for session ${sessionId}`);
            return structuredMessages;

        } catch (error) {
            logger.error(`[ChatService] Error getting and structuring messages for session ${sessionId}:`, error);
            // Re-throw the error to be handled by the caller (IPC handler)
            throw error; 
        }
    }

    /**
     * Checks if a session exists, creates it if not.
     * Separated logic for clarity.
     * @param sessionId The ID of the session to ensure exists.
     */
    private async ensureSessionExists(notebookId: string, sessionId: string): Promise<void> {
        try {
            const existingSession = await this.chatModel.getSessionById(sessionId);
            if (!existingSession) {
                logger.info(`[ChatService] Session ${sessionId} for notebook ${notebookId} not found. Creating now...`);
                await this.chatModel.createSession(notebookId, sessionId);
                logger.info(`[ChatService] Session ${sessionId} for notebook ${notebookId} created successfully.`);
            } else {
                logger.debug(`[ChatService] Session ${sessionId} for notebook ${notebookId} already exists.`);
            }
        } catch (error) {
            logger.error(`[ChatService] Error ensuring session ${sessionId} for notebook ${notebookId} exists:`, error);
            // Depending on requirements, might want to re-throw or handle differently
            throw new Error(`Failed to ensure session ${sessionId} for notebook ${notebookId} exists.`);
        }
    }

    /**
     * Starts a streaming response for a given question and session,
     * sending chunks back via IPC. Manages stream lifecycle and cancellation.
     * Ensures session exists before starting the agent.
     * @param notebookId The ID of the notebook this session belongs to.
     * @param sessionId The ID of the chat session.
     * @param question The user's question.
     * @param event The IpcMainEvent from the handler, used to target the response.
     */
    async startStreamingResponse(notebookId: string, sessionId: string, question: string, event: IpcMainEvent): Promise<void> {
        const webContentsId = event.sender.id;
        logger.info(`[ChatService] Starting stream request for notebook ${notebookId}, session ${sessionId}, sender ${webContentsId}, question: "${question.substring(0, 50)}..."`);

        // --- Ensure Session Exists BEFORE starting anything else ---
        try {
            await this.ensureSessionExists(notebookId, sessionId);
        } catch (sessionError) {
            logger.error(`[ChatService] Failed to ensure session exists for notebook ${notebookId}, session ${sessionId}, aborting stream start.`, sessionError);
            // Send an error back to the renderer
            try {
                 if (!event.sender.isDestroyed()) {
                      event.sender.send(ON_CHAT_STREAM_ERROR, `Failed to initialize chat session: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
                 }
            } catch (sendError) {
                 logger.error(`[ChatService] Error sending session init error signal to destroyed sender ${webContentsId}:`, sendError);
            }
            return; // Stop execution if session cannot be ensured
        }
        // --- Session should now exist --- 

        logger.info(`[ChatService] Session ${sessionId} confirmed/created. Proceeding with stream start for sender ${webContentsId}.`);

        // Log chat session activity
        try {
            await getActivityLogService().logActivity({
                activityType: 'chat_session_started',
                details: {
                    sessionId: sessionId,
                    notebookId: notebookId,
                    question: question.substring(0, 100), // Log first 100 chars of question
                    timestamp: new Date().toISOString()
                }
            });
        } catch (logError) {
            logger.error('[ChatService] Failed to log chat session activity:', logError);
        }

        const correlationId = uuidv4();
        performanceTracker.startStream(correlationId, 'ChatService');

        await this.streamingService.startStream(
            event.sender,
            { chunk: ON_CHAT_RESPONSE_CHUNK, end: ON_CHAT_STREAM_END, error: ON_CHAT_STREAM_ERROR },
            (onChunk, onEnd, onError, signal) => {
                return this.langchainAgent.queryStream(sessionId, question, (chunk) => {
                    performanceTracker.recordEvent(correlationId, 'ChatService', 'chunk', { length: chunk.length });
                    onChunk(chunk);
                }, onEnd, onError, signal, 12, correlationId);
            },
            async (result) => {
                performanceTracker.recordEvent(correlationId, 'ChatService', 'stream_end', { messageId: result.messageId });

                try {
                    const messages = await this.chatModel.getMessagesBySessionId(sessionId);
                    const conversationLength = messages.length;
                    await getActivityLogService().logActivity({
                        activityType: 'chat_topic_discussed',
                        details: {
                            sessionId,
                            notebookId,
                            question: question.substring(0, 100),
                            messageId: result.messageId,
                            conversationLength,
                            hasSourceChunks: !!(result.metadata?.sourceChunkIds?.length)
                        }
                    });
                } catch (logError) {
                    logger.error('[ChatService] Failed to log chat topic activity:', logError);
                }

                performanceTracker.completeStream(correlationId, 'ChatService');
                return result;
            }
        );
    }

    /**
     * Stops an active stream associated with a specific webContents ID.
     * @param webContentsId The ID of the renderer's webContents.
     */
    stopStream(webContentsId: number): void {
        this.streamingService.stopStream(webContentsId);
    }
}

// EXPORT the class itself for main.ts to import and instantiate
export { ChatService };
