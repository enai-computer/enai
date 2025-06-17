import { IpcMainEvent } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { LangchainAgent } from "./agents/LangchainAgent";
import { ActivityLogService } from './ActivityLogService';
import { StreamManager } from './StreamManager';
import { 
    ON_CHAT_RESPONSE_CHUNK, 
    ON_CHAT_STREAM_END, 
    ON_CHAT_STREAM_ERROR 
} from '../shared/ipcChannels';
import { performanceTracker } from '../utils/performanceTracker';
import { 
    IChatMessage, 
    StructuredChatMessage,
    ChatMessageSourceMetadata 
} from '../shared/types';
import { ChatModel } from '../models/ChatModel';
import { logger } from '../utils/logger';

interface ChatServiceDeps {
  chatModel: ChatModel;
  langchainAgent: LangchainAgent;
  activityLogService: ActivityLogService;
  streamManager: StreamManager;
}

export class ChatService extends BaseService<ChatServiceDeps> {
  constructor(deps: ChatServiceDeps) {
    super('ChatService', deps);
  }

  async initialize(): Promise<void> {
    // No initialization needed currently
    this.logger.info('ChatService initialized');
  }

  async cleanup(): Promise<void> {
    // StreamManager handles its own cleanup
    this.logger.info('ChatService cleanup complete');
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
    return this.execute('getMessages', async () => {
      this.logger.debug(`Getting messages for session: ${sessionId}, limit: ${limit}, before: ${beforeTimestampParam}`);
      
      let beforeTimestampAsDate: Date | undefined;
      if (typeof beforeTimestampParam === 'string') {
        beforeTimestampAsDate = new Date(beforeTimestampParam);
        if (isNaN(beforeTimestampAsDate.getTime())) { // Check for invalid date string
          this.logger.warn(`Invalid date string received for beforeTimestampParam: ${beforeTimestampParam}. Proceeding without timestamp filter.`);
          beforeTimestampAsDate = undefined;
        }
      } else if (beforeTimestampParam instanceof Date) {
        beforeTimestampAsDate = beforeTimestampParam;
      }

      const rawMessages: IChatMessage[] = await this.deps.chatModel.getMessagesBySessionId(sessionId, limit, beforeTimestampAsDate);
      this.logger.info(`Retrieved ${rawMessages.length} raw messages for session ${sessionId}`);

      // Parse metadata for each message
      const structuredMessages: StructuredChatMessage[] = rawMessages.map(message => {
        let structuredMeta: ChatMessageSourceMetadata | null = null;
        if (message.metadata) {
          try {
            structuredMeta = JSON.parse(message.metadata) as ChatMessageSourceMetadata;
            if (structuredMeta?.sourceChunkIds && !Array.isArray(structuredMeta.sourceChunkIds)) {
              this.logger.warn(`Invalid sourceChunkIds format in metadata for message ${message.messageId}. Expected array. Found: ${typeof structuredMeta.sourceChunkIds}`);
              structuredMeta.sourceChunkIds = undefined; 
            } else if (structuredMeta?.sourceChunkIds?.some(id => typeof id !== 'number')) {
              this.logger.warn(`Non-numeric ID found in sourceChunkIds for message ${message.messageId}. Filtering.`);
              structuredMeta.sourceChunkIds = structuredMeta.sourceChunkIds.filter(id => typeof id === 'number');
            }
          } catch (parseError) {
            this.logger.error(`Failed to parse metadata for message ${message.messageId}:`, parseError);
          }
        }

        // Construct the StructuredChatMessage
        // Omit the original metadata string and add the parsed object
        const { metadata, ...rest } = message;
        return {
          ...rest,
          metadata: structuredMeta
        };
      });

      this.logger.debug(`Returning ${structuredMessages.length} structured messages for session ${sessionId}`);
      return structuredMessages;
    });
  }

  /**
   * Checks if a session exists, creates it if not.
   * Separated logic for clarity.
   * @param sessionId The ID of the session to ensure exists.
   */
  private async ensureSessionExists(notebookId: string, sessionId: string): Promise<void> {
    const existingSession = await this.deps.chatModel.getSessionById(sessionId);
    if (!existingSession) {
      this.logger.info(`Session ${sessionId} for notebook ${notebookId} not found. Creating now...`);
      await this.deps.chatModel.createSession(notebookId, sessionId);
      this.logger.info(`Session ${sessionId} for notebook ${notebookId} created successfully.`);
    } else {
      this.logger.debug(`Session ${sessionId} for notebook ${notebookId} already exists.`);
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
    this.logger.info(`Starting stream request for notebook ${notebookId}, session ${sessionId}, sender ${webContentsId}, question: "${question.substring(0, 50)}..."`);

    // --- Ensure Session Exists BEFORE starting anything else ---
    try {
      await this.ensureSessionExists(notebookId, sessionId);
    } catch (sessionError) {
      this.logger.error(`Failed to ensure session exists for notebook ${notebookId}, session ${sessionId}, aborting stream start.`, sessionError);
      // Send an error back to the renderer
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send(ON_CHAT_STREAM_ERROR, `Failed to initialize chat session: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
        }
      } catch (sendError) {
        this.logger.error(`Error sending session init error signal to destroyed sender ${webContentsId}:`, sendError);
      }
      return; // Stop execution if session cannot be ensured
    }
    // --- Session should now exist --- 

    this.logger.info(`Session ${sessionId} confirmed/created. Proceeding with stream start for sender ${webContentsId}.`);

    // Log chat session activity
    try {
      await this.deps.activityLogService.logActivity({
        activityType: 'chat_session_started',
        details: {
          sessionId: sessionId,
          notebookId: notebookId,
          question: question.substring(0, 100), // Log first 100 chars of question
          timestamp: new Date().toISOString()
        }
      });
    } catch (logError) {
      this.logger.error('Failed to log chat session activity:', logError);
    }

    // Check if a stream is already active for this sender and stop it first
    if (this.deps.streamManager.hasActiveStream(webContentsId)) {
      this.logger.warn(`Sender ${webContentsId} already had an active stream. Stopping previous one.`);
      this.stopStream(webContentsId);
    }

    const correlationId = uuidv4();
    
    // Start performance tracking
    performanceTracker.startStream(correlationId, 'ChatService');
    this.logger.info(`Started stream with correlationId: ${correlationId}`);

    // Variables to hold the final messageId and metadata
    let finalMessageId: string | undefined;
    let finalMetadata: ChatMessageSourceMetadata | null = null;

    // Create the async generator for streaming
    const generator = this.createStreamGenerator(sessionId, notebookId, question, correlationId, (messageId, metadata) => {
      finalMessageId = messageId;
      finalMetadata = metadata;
    });

    try {
      // Use StreamManager to handle the streaming
      await this.deps.streamManager.startStream(
        event.sender,
        generator,
        {
          onStart: ON_CHAT_RESPONSE_CHUNK, // Note: ChatService doesn't have a separate start event
          onChunk: ON_CHAT_RESPONSE_CHUNK,
          onEnd: ON_CHAT_STREAM_END,
          onError: ON_CHAT_STREAM_ERROR
        },
        { messageId: finalMessageId, metadata: finalMetadata }, // This will be populated by the time stream ends
        correlationId
      );
    } catch (error) {
      this.logger.error(`Failed to complete stream for sender ${webContentsId}:`, error);
      // Error already sent by StreamManager
    }
  }

  /**
   * Creates an async generator that converts LangchainAgent's callback-based streaming
   * to work with StreamManager.
   */
  private createStreamGenerator(
    sessionId: string, 
    notebookId: string, 
    question: string, 
    correlationId: string,
    onComplete: (messageId: string | undefined, metadata: ChatMessageSourceMetadata | null) => void
  ): AsyncGenerator<string> {
    let firstChunkReceived = false;
    const chunks: string[] = [];
    let chunkIndex = 0;
    let streamComplete = false;
    let streamError: Error | null = null;

    // Create abort controller for cancellation
    const abortController = new AbortController();

    // Define the async generator
    const generator = async function* (this: ChatService): AsyncGenerator<string> {
      // Set up the LangchainAgent callbacks
      const onChunk = (chunk: string) => {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          performanceTracker.recordEvent(correlationId, 'ChatService', 'first_chunk_received', {
            chunkLength: chunk.length
          });
        }
        chunks.push(chunk);
      };

      const onEnd = async (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => {
        this.logger.info(`Stream content complete. Final messageId: ${result.messageId}`);
        
        // Track stream completion
        performanceTracker.recordEvent(correlationId, 'ChatService', 'stream_end', {
          messageId: result.messageId,
          hasMetadata: !!result.metadata
        });
        
        // Log chat topic discussed
        try {
          const messages = await this.deps.chatModel.getMessagesBySessionId(sessionId);
          const conversationLength = messages.length;
          
          await this.deps.activityLogService.logActivity({
            activityType: 'chat_topic_discussed',
            details: {
              sessionId: sessionId,
              notebookId: notebookId,
              question: question.substring(0, 100),
              messageId: result.messageId,
              conversationLength: conversationLength,
              hasSourceChunks: !!(result.metadata?.sourceChunkIds?.length)
            }
          });
        } catch (logError) {
          this.logger.error('Failed to log chat topic activity:', logError);
        }
        
        // Complete performance tracking
        performanceTracker.completeStream(correlationId, 'ChatService');
        
        // Pass the final values to the callback
        onComplete(result.messageId, result.metadata);
        streamComplete = true;
      };

      const onError = (error: Error | unknown) => {
        if (error instanceof Error && error.message === 'Stream aborted') {
          this.logger.info(`Stream explicitly aborted.`);
        } else {
          this.logger.error(`Stream error:`, error);
        }
        streamError = error instanceof Error ? error : new Error('Stream failed');
        streamComplete = true;
      };

      // Start the LangchainAgent stream in the background
      this.deps.langchainAgent.queryStream(sessionId, question, onChunk, onEnd, onError, abortController.signal, 12, correlationId)
        .catch(err => {
          this.logger.error(`Error initiating queryStream:`, err);
          streamError = err instanceof Error ? err : new Error('Failed to initiate stream');
          streamComplete = true;
        });

      // Wait for the first chunk or completion
      await new Promise<void>((resolve) => {
        const checkForData = () => {
          if (chunks.length > 0 || streamComplete || streamError) {
            resolve();
          } else {
            setTimeout(checkForData, 10);
          }
        };
        checkForData();
      });

      // Yield chunks as they arrive
      while (!streamComplete || chunkIndex < chunks.length) {
        if (chunkIndex < chunks.length) {
          yield chunks[chunkIndex++];
        } else if (!streamComplete) {
          // Wait for more chunks
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // If there was an error, throw it
      if (streamError) {
        throw streamError;
      }
    }.bind(this);

    return generator();
  }

  /**
   * Stops an active stream associated with a specific webContents ID.
   * @param webContentsId The ID of the renderer's webContents.
   */
  stopStream(webContentsId: number): void {
    this.deps.streamManager.stopStream(webContentsId);
  }
}