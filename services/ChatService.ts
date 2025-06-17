import { IpcMainEvent } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { BaseService } from './base/BaseService';
import { LangchainAgent } from "./agents/LangchainAgent";
import { ActivityLogService } from './ActivityLogService';
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

const THROTTLE_INTERVAL_MS = 10; // Send updates every 10ms for improved streaming responsiveness

interface ChatServiceDeps {
  chatModel: ChatModel;
  langchainAgent: LangchainAgent;
  activityLogService: ActivityLogService;
}

interface StreamData {
  controller: AbortController;
  buffer: string;
  timeoutId: NodeJS.Timeout | null;
  correlationId: string;
  firstChunkReceived: boolean;
}

export class ChatService extends BaseService<ChatServiceDeps> {
  // Map to store active stream controllers, keyed by webContents ID
  private activeStreams: Map<number, StreamData> = new Map();

  constructor(deps: ChatServiceDeps) {
    super('ChatService', deps);
  }

  async initialize(): Promise<void> {
    // No initialization needed currently
    this.logger.info('ChatService initialized');
  }

  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up ChatService - aborting all active streams');
    
    // Abort all active streams
    for (const [webContentsId, streamData] of this.activeStreams) {
      this.logger.debug(`Aborting stream for webContents ${webContentsId}`);
      if (streamData.timeoutId) {
        clearTimeout(streamData.timeoutId);
      }
      streamData.controller.abort();
    }
    
    this.activeStreams.clear();
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
    if (this.activeStreams.has(webContentsId)) {
      this.logger.warn(`Sender ${webContentsId} already had an active stream. Stopping previous one.`);
      this.stopStream(webContentsId);
    }

    const correlationId = uuidv4();
    const controller = new AbortController();
    const streamData: StreamData = {
      controller, 
      buffer: '', 
      timeoutId: null,
      correlationId,
      firstChunkReceived: false
    };
    this.activeStreams.set(webContentsId, streamData);
    
    // Start performance tracking
    performanceTracker.startStream(correlationId, 'ChatService');
    this.logger.info(`Started stream with correlationId: ${correlationId}`);

    const flushBuffer = () => {
      // Add try...catch around send operations
      try {
        if (streamData.buffer.length > 0 && !event.sender.isDestroyed()) {
          // logger.trace(`Flushing buffer to ${webContentsId}: ${streamData.buffer.length} chars`);
          event.sender.send(ON_CHAT_RESPONSE_CHUNK, streamData.buffer);
          streamData.buffer = ''; // Clear buffer after sending
        }
      } catch (sendError) {
        this.logger.error(`Error sending chunk to destroyed sender ${webContentsId}:`, sendError);
        // Attempt to stop the stream if sending fails (sender likely destroyed)
        this.stopStream(webContentsId);
      }
      if (streamData.timeoutId) {
        clearTimeout(streamData.timeoutId);
        streamData.timeoutId = null;
      }
    };

    // Define callbacks to handle stream events from the LangchainAgent
    const onChunk = (chunk: string) => {
      // Check destroyed before potentially lengthy buffer operations or timeout setup
      if (event.sender.isDestroyed()) {
        this.logger.warn(`Sender ${webContentsId} destroyed, cannot process chunk. Aborting stream.`);
        this.stopStream(webContentsId); // Abort if sender is gone
        return;
      }

      // Track first chunk timing
      if (!streamData.firstChunkReceived) {
        streamData.firstChunkReceived = true;
        performanceTracker.recordEvent(correlationId, 'ChatService', 'first_chunk_received', {
          chunkLength: chunk.length
        });
      }

      streamData.buffer += chunk;
      // Reset timeout whenever a new chunk arrives
      if (streamData.timeoutId) {
        clearTimeout(streamData.timeoutId);
      }
      streamData.timeoutId = setTimeout(flushBuffer, THROTTLE_INTERVAL_MS);
    };

    // Update onEnd to accept the result payload
    const onEnd = async (result: { messageId: string; metadata: ChatMessageSourceMetadata | null }) => {
      this.logger.info(`Stream ended successfully for sender ${webContentsId}. Final messageId: ${result.messageId}`);
      
      // Track stream completion
      performanceTracker.recordEvent(correlationId, 'ChatService', 'stream_end', {
        messageId: result.messageId,
        hasMetadata: !!result.metadata
      });
      
      flushBuffer(); // Send any remaining buffered content
      
      // Log chat topic discussed
      try {
        // Get conversation length to assess importance
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
      
      // Add try...catch for final send
      try {
        if (!event.sender.isDestroyed()) {
          // Send the result object containing messageId and metadata
          event.sender.send(ON_CHAT_STREAM_END, result); 
        }
      } catch (sendError) {
        this.logger.error(`Error sending stream end signal to destroyed sender ${webContentsId}:`, sendError);
        // No stream to stop here, just log
      }
      this.activeStreams.delete(webContentsId); // Clean up
      
      // Complete performance tracking
      performanceTracker.completeStream(correlationId, 'ChatService');
    };

    const onError = (error: Error | unknown) => { // Allow unknown type
      // Add try...catch for error send
      try {
        let messageToSend: string;
        if (error instanceof Error) {
          // Don't report explicit aborts as errors to the UI unless desired
          if (error.message === 'Stream aborted') {
            this.logger.info(`Stream explicitly aborted for sender ${webContentsId}.`);
            // Optionally send a specific 'aborted' signal if needed
            // event.sender.send(ON_CHAT_STREAM_ABORTED);
            // Setting messageToSend to null/undefined will skip sending an error message
            messageToSend = ''; // Send empty string or handle differently if desired
          } else {
            this.logger.error(`Stream error for sender ${webContentsId}:`, error);
            messageToSend = error.message;
          }
        } else {
          // Handle non-Error objects
          this.logger.error(`Received non-Error object during stream for sender ${webContentsId}:`, error);
          messageToSend = 'An unexpected error occurred during the stream.';
          // Optionally serialize 'error' if it might contain useful info
          // messageToSend = `An unexpected error occurred: ${JSON.stringify(error)}`; 
        }

        // Send the error message only if it's non-empty and sender exists
        if (messageToSend && !event.sender.isDestroyed()) {
          event.sender.send(ON_CHAT_STREAM_ERROR, messageToSend);
        }
      } catch (sendError) {
        this.logger.error(`Error sending stream error signal to destroyed sender ${webContentsId}:`, sendError);
        // No stream to stop here, just log
      }
      flushBuffer(); // Ensure buffer is cleared even on error
      this.activeStreams.delete(webContentsId); // Clean up
    };

    // Start the agent's streaming process, passing the AbortSignal and session ID
    // Pass correlationId as part of options
    this.deps.langchainAgent.queryStream(sessionId, question, onChunk, onEnd, onError, controller.signal, 12, correlationId)
      .catch(err => {
        // Catch potential errors during the setup phase of queryStream itself
        this.logger.error(`Error initiating queryStream for sender ${webContentsId}:`, err);
        onError(err instanceof Error ? err : new Error('Failed to initiate stream'));
      });
  }

  /**
   * Stops an active stream associated with a specific webContents ID.
   * @param webContentsId The ID of the renderer's webContents.
   */
  stopStream(webContentsId: number): void {
    const streamInfo = this.activeStreams.get(webContentsId);
    if (streamInfo) {
      this.logger.info(`Aborting stream for sender ${webContentsId}.`);
      streamInfo.controller.abort(); // Signal abortion to the agent
      // No need to manually delete here, onError/onEnd triggered by abort should handle cleanup
      // However, defensive removal doesn't hurt:
      if (streamInfo.timeoutId) clearTimeout(streamInfo.timeoutId);
      this.activeStreams.delete(webContentsId);
    } else {
      this.logger.debug(`No active stream found to stop for sender ${webContentsId}.`);
    }
  }
}

