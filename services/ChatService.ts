import { IpcMainEvent } from 'electron';
import { LangchainAgent } from "./agents/LangchainAgent";
import { getActivityLogService } from './ActivityLogService';
import { STREAMING_ERROR } from '../shared/ipcChannels';
import { getStreamingService } from './StreamingService';
import { logger } from '../utils/logger'; // Corrected path
import { 
    IChatMessage, 
    StructuredChatMessage,
    ChatMessageSourceMetadata 
} from '../shared/types.d'; // Import IChatMessage for return type
import { ChatModel } from '../models/ChatModel'; // Import ChatModel
import { v4 as uuidv4 } from 'uuid';


class ChatService {
    private langchainAgent: LangchainAgent;
    private chatModel: ChatModel; // Add ChatModel instance

    // Inject ChatModel instance
    constructor(agent: LangchainAgent, model: ChatModel) {
        this.langchainAgent = agent;
        this.chatModel = model; // Store ChatModel instance
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
        const sender = event.sender;
        const webContentsId = sender.id;
        logger.info(`[ChatService] Starting stream request for notebook ${notebookId}, session ${sessionId}, sender ${webContentsId}, question: "${question.substring(0, 50)}..."`);

        try {
            await this.ensureSessionExists(notebookId, sessionId);
        } catch (sessionError) {
            logger.error(`[ChatService] Failed to ensure session exists for notebook ${notebookId}, session ${sessionId}, aborting stream start.`, sessionError);
            try {
                if (!sender.isDestroyed()) {
                    sender.send(STREAMING_ERROR, `Failed to initialize chat session: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
                }
            } catch (sendError) {
                logger.error(`[ChatService] Error sending session init error signal to destroyed sender ${webContentsId}:`, sendError);
            }
            return;
        }

        logger.info(`[ChatService] Session ${sessionId} confirmed/created. Proceeding with stream start.`);

        try {
            await getActivityLogService().logActivity({
                activityType: 'chat_session_started',
                details: {
                    sessionId,
                    notebookId,
                    question: question.substring(0, 100),
                    timestamp: new Date().toISOString(),
                },
            });
        } catch (logError) {
            logger.error('[ChatService] Failed to log chat session activity:', logError);
        }

        const correlationId = uuidv4();
        const streamingService = getStreamingService();

        await streamingService.initiateStream<{ messageId: string; metadata: ChatMessageSourceMetadata | null }>({
            correlationId,
            start: async (onChunk, onEnd, onError, signal) => {
                const wrappedEnd = async (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => {
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
                                hasSourceChunks: !!(result.metadata?.sourceChunkIds?.length),
                            },
                        });
                    } catch (logError) {
                        logger.error('[ChatService] Failed to log chat topic activity:', logError);
                    }
                    onEnd(result);
                };

                await this.langchainAgent
                    .queryStream(sessionId, question, onChunk, wrappedEnd, onError, signal, 12, correlationId)
                    .catch(err => {
                        logger.error(`[ChatService] Error initiating queryStream for sender ${webContentsId}:`, err);
                        onError(err instanceof Error ? err : new Error('Failed to initiate stream'));
                    });
            },
        }, sender);
    }

    /**
     * Stops an active stream associated with a specific webContents ID.
     * @param webContentsId The ID of the renderer's webContents.
     */
    stopStream(webContentsId: number): void {
        logger.info(`[ChatService] Request to cancel stream for sender ${webContentsId}.`);
        getStreamingService().cancelStream(webContentsId);
    }
}

// EXPORT the class itself for main.ts to import and instantiate
export { ChatService };
