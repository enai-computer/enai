import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDb } from './db';
import { logger } from '../utils/logger';
// Assuming types are defined in shared/types.ts
// Adjust path if necessary
import type { ChatMessageCreate, ChatMessageData, ChatHistory, ChatMessageRole } from '../shared/types.d';

// Define the structure returned by the chat_messages table (snake_case)
interface ChatMessageRecord {
    message_id: string;
    session_id: string;
    timestamp: string; // ISO 8601
    role: string; // 'user' | 'assistant' | 'system'
    content: string;
    metadata: string | null; // JSON string
}

export class ChatModel {
    private db: Database.Database;
    // Cached prepared statements
    private addMessageStmt: Database.Statement;
    private createSessionStmt: Database.Statement;

    /**
     * Creates an instance of ChatModel.
     * Prepares database statements for reuse.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance?: Database.Database) {
        this.db = dbInstance ?? getDb();

        // Prepare statements and cache them
        this.addMessageStmt = this.db.prepare(`
            INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        this.createSessionStmt = this.db.prepare(`
            INSERT INTO chat_sessions (session_id, created_at, updated_at, title)
            VALUES (?, ?, ?, ?)
        `);
    }

    /**
     * Adds a new message to a chat session.
     * Validates message role.
     * Uses cached prepared statement.
     * Underlying DB operation is synchronous.
     * @param messageData Data for the new message.
     * @returns Promise resolving to the ID of the newly created message.
     */
    async addMessage(messageData: ChatMessageCreate): Promise<string> {
        // Runtime Role Validation
        const validRoles: ChatMessageRole[] = ['user', 'assistant', 'system'];
        if (!validRoles.includes(messageData.role)) {
            logger.error(`[ChatModel] Invalid role provided: ${messageData.role}`);
            throw new Error(`Invalid chat message role: ${messageData.role}`);
        }

        const messageId = uuidv4();
        const timestamp = new Date().toISOString();
        const metadataJson = messageData.metadata ? JSON.stringify(messageData.metadata) : null;

        try {
            logger.debug(`[ChatModel] Adding message to session ${messageData.sessionId}, role: ${messageData.role}`);
            // Use cached statement
            const info = this.addMessageStmt.run(
                messageId,
                messageData.sessionId,
                timestamp,
                messageData.role,
                messageData.content,
                metadataJson
            );

            if (info.changes !== 1) {
                 throw new Error('Failed to insert chat message, no rows affected.');
            }
            logger.info(`[ChatModel] Message ${messageId} added to session ${messageData.sessionId}`);
            return messageId;

        } catch (error: any) {
            logger.error(`[ChatModel] Failed to add message to session ${messageData.sessionId}:`, error);
            throw new Error(`Database error adding chat message.`);
        }
    }

    /**
     * Retrieves the message history for a given session.
     * STUB: Returns empty array for initial implementation.
     * TODO: Implement actual history retrieval logic, mapping to LangChain BaseMessage objects.
     * Underlying DB operation is synchronous but wrapped in Promise for consistency.
     * @param sessionId The ID of the chat session.
     * @returns Promise resolving to an empty ChatHistory array.
     */
    async getHistory(sessionId: string): Promise<ChatHistory> {
         logger.debug(`[ChatModel] getHistory called for session ${sessionId} (STUBBED - returning empty)`);
         // TODO: Implement DB query SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC
         //       Map results to LangChain BaseMessage objects (HumanMessage, AIMessage, etc.)
        return Promise.resolve([]); // Return empty array for now
    }

    /**
     * Creates a new chat session.
     * Uses cached prepared statement.
     * Underlying DB operation is synchronous.
     * @param title Optional title for the session.
     * @returns Promise resolving to the ID of the newly created session.
     */
    async createSession(title?: string | null): Promise<string> {
        const sessionId = uuidv4();
        const now = new Date().toISOString();
        try {
            logger.info(`[ChatModel] Creating new chat session${title ? ` with title \"${title}\"` : ''}`);
            // Use cached statement
            const info = this.createSessionStmt.run(sessionId, now, now, title ?? null);

            if (info.changes !== 1) {
                throw new Error('Failed to insert chat session, no rows affected.');
            }
            logger.info(`[ChatModel] Session ${sessionId} created.`);
            return sessionId;
        } catch (error: any) {
            logger.error('[ChatModel] Failed to create chat session:', error);
            throw new Error(`Database error creating chat session.`);
        }
    }
}

// Optional: Export a singleton instance if desired, but manage instantiation centrally
// export const chatModel = new ChatModel();
