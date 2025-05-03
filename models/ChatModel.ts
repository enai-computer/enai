import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDb } from './db'; // Assuming db is initialized elsewhere
import { logger } from '../utils/logger'; // Adjust path as needed
import { 
    IChatSession, 
    IChatMessage, 
    ChatMessageRole, 
    ChatMessageSourceMetadata
} from '../shared/types.d'; // Adjust path as needed

// Type for data needed to add a message (excluding DB-generated fields)
// Explicitly type the optional metadata field using ChatMessageSourceMetadata
type AddMessageInput = Omit<IChatMessage, 'message_id' | 'timestamp' | 'metadata'> & {
  metadata?: ChatMessageSourceMetadata | null; // Use the specific interface here
};

/**
 * Model for interacting with chat sessions and messages in the database.
 * Instances should be created AFTER the database is initialized.
 */
class ChatModel {
    private db: Database.Database;

    /**
     * Constructor requires a DB instance or uses the default singleton if available.
     * Ensures DB is initialized before instantiation.
     * @param dbInstance Optional database instance for testing or specific use cases.
     */
    constructor(dbInstance?: Database.Database) {
        this.db = dbInstance ?? getDb(); // getDb() should now succeed if called after initDb()
    }

    /**
     * Creates a new chat session.
     * If a sessionId is provided, it attempts to use that ID.
     * Otherwise, a new UUID is generated.
     * @param sessionId Optional: The ID to use for the new session.
     * @returns The newly created chat session object.
     */
    async createSession(sessionId?: string): Promise<IChatSession> {
        const db = this.db;
        // Use provided sessionId or generate a new one
        const finalSessionId = sessionId ?? randomUUID(); 
        const now = new Date().toISOString();

        logger.debug(`[ChatModel] Creating new chat session with ID: ${finalSessionId}`);
        try {
            const stmt = db.prepare('INSERT INTO chat_sessions (session_id, created_at, updated_at) VALUES (?, ?, ?)');
            // Use the finalSessionId determined above
            stmt.run(finalSessionId, now, now); 
            
            // Fetch the created session to return it
            const newSession = await this.getSession(finalSessionId);
             if (!newSession) {
                logger.error(`[ChatModel] Failed to retrieve newly created session ${finalSessionId}`);
                 throw new Error('Failed to retrieve newly created session');
             }
            logger.info(`[ChatModel] Chat session created successfully: ${finalSessionId}`);
            return newSession;
        } catch (error) {
            // Handle potential UNIQUE constraint violation if the provided sessionId already exists
            if (error instanceof Error && error.message.includes('UNIQUE constraint failed: chat_sessions.session_id')) {
                logger.warn(`[ChatModel] Attempted to create session with existing ID: ${finalSessionId}. Session likely already exists.`);
                // Try fetching the existing session instead of throwing an error
                const existingSession = await this.getSession(finalSessionId);
                if (existingSession) {
                    return existingSession;
                } else {
                     // This case is unlikely but possible if there's a race condition or other issue
                     logger.error(`[ChatModel] UNIQUE constraint failed for ${finalSessionId}, but could not retrieve existing session.`);
                     throw new Error(`Failed to create or retrieve session with ID: ${finalSessionId}`);
                }
            } else {
                 logger.error(`[ChatModel] Error creating chat session ${finalSessionId}:`, error);
                 throw error; // Re-throw other errors
            }
        }
    }

    /**
     * Retrieves a specific chat session by its ID.
     * @param sessionId The ID of the session to retrieve.
     * @returns The chat session object or null if not found.
     */
    async getSession(sessionId: string): Promise<IChatSession | null> {
        logger.debug(`[ChatModel] Getting chat session with ID: ${sessionId}`);
        const db = this.db;
        try {
            const stmt = db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?');
            const session = stmt.get(sessionId) as IChatSession | undefined;
            return session || null;
        } catch (error) {
            logger.error(`[ChatModel] Error getting chat session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Updates the title of a specific chat session.
     * Also updates the updated_at timestamp (handled by trigger).
     * @param sessionId The ID of the session to update.
     * @param title The new title for the session.
     */
    async updateSessionTitle(sessionId: string, title: string): Promise<void> {
        logger.debug(`[ChatModel] Updating title for session ID: ${sessionId} to "${title}"`);
        const db = this.db;
        try {
            // The trigger 'chat_sessions_touch' should handle updating `updated_at` automatically.
            const stmt = db.prepare('UPDATE chat_sessions SET title = ? WHERE session_id = ?');
            const info = stmt.run(title, sessionId);
            if (info.changes === 0) {
                 logger.warn(`[ChatModel] Attempted to update title for non-existent session ID: ${sessionId}`);
                 // Optionally throw an error if the session MUST exist
                 // throw new Error(`Session with ID ${sessionId} not found for title update.`);
            }
            logger.info(`[ChatModel] Updated title for session ${sessionId}. Rows affected: ${info.changes}`);
        } catch (error) {
            logger.error(`[ChatModel] Error updating title for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves a list of all chat sessions, ordered by updated_at descending.
     * @returns An array of chat session objects.
     */
    async listSessions(): Promise<IChatSession[]> {
        logger.debug(`[ChatModel] Listing all chat sessions`);
        const db = this.db;
        try {
            const stmt = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
            const sessions = stmt.all() as IChatSession[];
            return sessions;
        } catch (error) {
            logger.error(`[ChatModel] Error listing chat sessions:`, error);
            throw error;
        }
    }

    /**
     * Adds a new message to a specific chat session.
     * Generates message ID and timestamp.
     * Updates the session's updated_at timestamp.
     * @param messageData Object containing session_id, role, content, and optional structured metadata.
     * @returns The newly created chat message object with generated fields (metadata will be JSON string).
     */
    async addMessage(messageData: AddMessageInput): Promise<IChatMessage> {
        const db = this.db;
        const messageId = randomUUID();
        const now = new Date().toISOString();
        // Stringify the metadata object here if it exists, otherwise use null
        const metadataString = messageData.metadata ? JSON.stringify(messageData.metadata) : null;

        logger.debug(`[ChatModel] Adding message to session ID: ${messageData.session_id}, role: ${messageData.role}. Metadata keys: ${messageData.metadata ? Object.keys(messageData.metadata).join(', ') : 'None'}`);

        // Use a transaction to ensure atomicity of inserting message and updating session timestamp
        const tx = this.db.transaction(() => {
            // Insert the message
            const insertMsgStmt = this.db.prepare(`
                INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
                VALUES (@message_id, @session_id, @timestamp, @role, @content, @metadata)
            `);
            insertMsgStmt.run({
                message_id: messageId,
                session_id: messageData.session_id,
                timestamp: now,
                role: messageData.role,
                content: messageData.content,
                metadata: metadataString // Use the stringified version
            });

            // Update the session's updated_at timestamp
            // Note: The trigger might make this redundant, but explicit update ensures it happens.
            const updateSessionStmt = this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE session_id = ?');
            updateSessionStmt.run(now, messageData.session_id);

             // Construct the object to return *inside* the transaction boundary
             const newMessage: IChatMessage = {
                 message_id: messageId,
                 session_id: messageData.session_id,
                 timestamp: now,
                 role: messageData.role,
                 content: messageData.content,
                 metadata: metadataString, // Return the JSON string or null
             };
             return newMessage; 
        });

        try {
            const resultMessage = tx(); // Execute the transaction
            logger.info(`[ChatModel] Message ${messageId} added successfully to session ${messageData.session_id}`);
            return resultMessage;
        } catch (error) {
            logger.error(`[ChatModel] Error adding message to session ${messageData.session_id}:`, error);
            throw error;
        }
    }

    /**
     * Retrieves messages for a specific chat session, ordered by timestamp ascending.
     * @param sessionId The ID of the session whose messages to retrieve.
     * @param limit Optional maximum number of messages to return (most recent if combined with DESC order, which we use internally then reverse).
     * @param beforeTimestamp Optional ISO timestamp to fetch messages strictly before this point.
     * @returns An array of chat message objects in ascending chronological order.
     */
    async getMessages(sessionId: string, limit?: number, beforeTimestamp?: string): Promise<IChatMessage[]> {
        logger.debug(`[ChatModel] Getting messages for session ID: ${sessionId}, limit: ${limit}, before: ${beforeTimestamp}`);
        const db = this.db;
        let query = 'SELECT * FROM chat_messages WHERE session_id = ?';
        const params: (string | number)[] = [sessionId];

        if (beforeTimestamp) {
            query += ' AND timestamp < ?';
            params.push(beforeTimestamp);
        }

        // Fetch most recent first, then reverse in code for correct chronological order for Langchain
        query += ' ORDER BY timestamp DESC';

        if (limit !== undefined && limit > 0) {
            query += ' LIMIT ?';
            params.push(limit);
        }

        try {
            const stmt = db.prepare(query);
            const messages = stmt.all(...params) as IChatMessage[];
            // Reverse the array to get ascending order (oldest first) as expected by Langchain Memory
            return messages.reverse(); 
        } catch (error) {
            logger.error(`[ChatModel] Error getting messages for session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Deletes a specific chat session and all its associated messages (due to CASCADE constraint).
     * @param sessionId The ID of the session to delete.
     */
    async deleteSession(sessionId: string): Promise<void> {
        logger.warn(`[ChatModel] Deleting session ID: ${sessionId}`);
        const db = this.db;
        try {
            const stmt = db.prepare('DELETE FROM chat_sessions WHERE session_id = ?');
            const info = stmt.run(sessionId);
            if (info.changes === 0) {
                 logger.warn(`[ChatModel] Attempted to delete non-existent session ID: ${sessionId}`);
            }
            logger.info(`[ChatModel] Deleted session ${sessionId}. Rows affected: ${info.changes}`);
        } catch (error) {
            logger.error(`[ChatModel] Error deleting session ${sessionId}:`, error);
            throw error;
        }
    }
}

// Export ONLY the class
export { ChatModel };
