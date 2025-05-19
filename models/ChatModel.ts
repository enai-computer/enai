import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db'; // Assuming db is initialized elsewhere
import { logger } from '../utils/logger'; // Adjust path as needed
import { 
    IChatSession, 
    IChatMessage, 
    ChatMessageSourceMetadata,
    ChatMessageRole // Added ChatMessageRole directly for AddMessageInput internal type
} from '../shared/types.d'; // Adjust path as needed

// --- Database Record Types (snake_case) ---
interface ChatSessionDbRecord {
  session_id: string;
  notebook_id: string;
  created_at: string; // ISO String from DB
  updated_at: string; // ISO String from DB
  title: string | null;
}

interface ChatMessageDbRecord {
  message_id: string;
  session_id: string;
  timestamp: string; // ISO String from DB
  role: ChatMessageRole;
  content: string;
  metadata: string | null; // JSON String from DB
}

// --- Mapping Functions --- 
function mapRecordToChatSession(record: ChatSessionDbRecord): IChatSession {
  return {
    sessionId: record.session_id,
    notebookId: record.notebook_id,
    createdAt: new Date(record.created_at),
    updatedAt: new Date(record.updated_at),
    title: record.title,
  };
}

function mapRecordToChatMessage(record: ChatMessageDbRecord): IChatMessage {
  return {
    messageId: record.message_id,
    sessionId: record.session_id,
    timestamp: new Date(record.timestamp),
    role: record.role,
    content: record.content,
    metadata: record.metadata, // Keep as string, StructuredChatMessage handles parsing
  };
}

// Type for data needed to add a message (excluding DB-generated fields)
// Uses camelCase consistent with IChatMessage properties
// metadata is handled as ChatMessageSourceMetadata for input, then stringified for DB.
interface AddMessageParams {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata?: ChatMessageSourceMetadata | null;
}

/**
 * Model for interacting with chat sessions and messages in the database.
 * Instances should be created AFTER the database is initialized.
 */
class ChatModel {
    private db: Database;

    /**
     * Constructor requires a DB instance or uses the default singleton if available.
     * Ensures DB is initialized before instantiation.
     * @param dbInstance Optional database instance for testing or specific use cases.
     */
    constructor(dbInstance?: Database) {
        this.db = dbInstance ?? getDb(); // getDb() should now succeed if called after initDb()
    }

    /**
     * Creates a new chat session.
     * Requires a notebookId. If a sessionId is provided, it attempts to use that ID.
     * Otherwise, a new UUID is generated.
     * @param notebookId The ID of the notebook this session belongs to.
     * @param sessionId Optional: The ID to use for the new session.
     * @param title Optional: The title for the new session.
     * @returns The newly created chat session object.
     */
    async createSession(notebookId: string, sessionIdInput?: string, title?: string | null): Promise<IChatSession> {
        const finalSessionId = sessionIdInput ?? randomUUID(); 
        const now = new Date().toISOString();
        const sessionTitle = title ?? null;

        logger.debug(`[ChatModel] Creating new chat session with ID: ${finalSessionId} for notebook ID: ${notebookId}, title: "${sessionTitle}"`);
        try {
            const stmt = this.db.prepare(
                'INSERT INTO chat_sessions (session_id, notebook_id, title, created_at, updated_at) VALUES (@session_id, @notebook_id, @title, @created_at, @updated_at)'
            );
            stmt.run({
                session_id: finalSessionId,
                notebook_id: notebookId,
                title: sessionTitle,
                created_at: now,
                updated_at: now,
            });
            
            const newSession = await this.getSessionById(finalSessionId); 
            if (!newSession) {
                logger.error(`[ChatModel] Failed to retrieve newly created session ${finalSessionId}`);
                throw new Error('Failed to retrieve newly created session');
            }
            logger.info(`[ChatModel] Chat session created successfully: ${finalSessionId} in notebook ${notebookId}`);
            return newSession;
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                logger.warn(`[ChatModel] Attempted to create session with existing ID: ${finalSessionId} (Code: ${error.code}). Session likely already exists.`);
                const existingSession = await this.getSessionById(finalSessionId);
                if (existingSession) {
                    if (existingSession.notebookId !== notebookId) { 
                        logger.error(`[ChatModel] Session ID ${finalSessionId} already exists but belongs to a different notebook (${existingSession.notebookId}) than requested (${notebookId}).`);
                        throw new Error(`Session ID ${finalSessionId} conflict: already exists in a different notebook.`);
                    }
                    logger.info(`[ChatModel] Returning existing session ${finalSessionId} as it matches the provided notebookId.`);
                    return existingSession;
                } else {
                    logger.error(`[ChatModel] ${error.code} constraint failed for ${finalSessionId}, but could not retrieve existing session. This is unexpected.`);
                    throw new Error(`Failed to create or retrieve session with ID: ${finalSessionId} after a constraint violation.`);
                }
            } else if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                logger.error(`[ChatModel] Error creating chat session ${finalSessionId}: Notebook ID ${notebookId} likely does not exist.`, error);
                throw new Error(`Failed to create chat session: Invalid notebook ID ${notebookId}.`);
            } else {
                logger.error(`[ChatModel] Error creating chat session ${finalSessionId}:`, error);
                throw error; 
            }
        }
    }

    /**
     * Retrieves a specific chat session by its ID.
     * @param sessionId The ID of the session to retrieve.
     * @returns The chat session object or null if not found.
     */
    async getSessionById(sessionId: string): Promise<IChatSession | null> {
        logger.debug(`[ChatModel] Getting chat session with ID: ${sessionId}`);
        try {
            const stmt = this.db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?');
            const record = stmt.get(sessionId) as ChatSessionDbRecord | undefined;
            return record ? mapRecordToChatSession(record) : null;
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
    async updateSessionTitle(sessionId: string, title: string): Promise<IChatSession | null> {
        logger.debug(`[ChatModel] Updating title for session ID: ${sessionId} to "${title}"`);
        const now = new Date().toISOString();
        try {
            const stmt = this.db.prepare('UPDATE chat_sessions SET title = @title, updated_at = @updated_at WHERE session_id = @session_id');
            const info = stmt.run({ title: title, updated_at: now, session_id: sessionId });
            if (info.changes === 0) {
                 logger.warn(`[ChatModel] Attempted to update title for non-existent session ID: ${sessionId} or title was already the same.`);
                 // Still try to fetch, maybe it exists but title was same so no 'change' reported by DB
                 return this.getSessionById(sessionId);
            }
            logger.info(`[ChatModel] Updated title for session ${sessionId}. Rows affected: ${info.changes}`);
            return this.getSessionById(sessionId); // Return the updated session
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
        try {
            const stmt = this.db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
            const records = stmt.all() as ChatSessionDbRecord[];
            return records.map(mapRecordToChatSession);
        } catch (error) {
            logger.error(`[ChatModel] Error listing chat sessions:`, error);
            throw error;
        }
    }

    /**
     * Retrieves a list of all chat sessions for a specific notebook, ordered by updated_at descending.
     * @param notebookId The ID of the notebook.
     * @returns An array of chat session objects.
     */
    async listSessionsForNotebook(notebookId: string): Promise<IChatSession[]> {
        logger.debug(`[ChatModel] Listing chat sessions for notebook ID: ${notebookId}`);
        try {
            const stmt = this.db.prepare('SELECT * FROM chat_sessions WHERE notebook_id = ? ORDER BY updated_at DESC');
            const records = stmt.all(notebookId) as ChatSessionDbRecord[];
            logger.info(`[ChatModel] Found ${records.length} sessions for notebook ID ${notebookId}`);
            return records.map(mapRecordToChatSession);
        } catch (error) {
            logger.error(`[ChatModel] Error listing sessions for notebook ID ${notebookId}:`, error);
            throw error;
        }
    }

    /**
     * Updates the notebook associated with a chat session.
     * @param sessionId The ID of the chat session to update.
     * @param newNotebookId The ID of the new notebook.
     * @returns True if the update was successful, false otherwise.
     */
    async updateChatNotebook(sessionId: string, newNotebookId: string): Promise<boolean> {
        logger.debug(`[ChatModel] Updating notebook for session ID: ${sessionId} to notebook ID: ${newNotebookId}`);
        const now = new Date().toISOString();
        try {
            const stmt = this.db.prepare('UPDATE chat_sessions SET notebook_id = @notebook_id, updated_at = @updated_at WHERE session_id = @session_id');
            const info = stmt.run({ notebook_id: newNotebookId, updated_at: now, session_id: sessionId });
            if (info.changes > 0) {
                logger.info(`[ChatModel] Successfully updated notebook for session ${sessionId} to ${newNotebookId}. Rows affected: ${info.changes}`);
                return true;
            } else {
                logger.warn(`[ChatModel] Session ID ${sessionId} not found or notebook ID was already ${newNotebookId}. No update performed.`);
                return false;
            }
        } catch (error: any) {
            if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                logger.error(`[ChatModel] Error updating notebook for session ${sessionId}: New notebook ID ${newNotebookId} likely does not exist.`, error);
                throw new Error(`Failed to update chat session's notebook: Invalid new notebook ID ${newNotebookId}.`);
            }
            logger.error(`[ChatModel] Error updating notebook for session ${sessionId} to ${newNotebookId}:`, error);
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
    async addMessage(params: AddMessageParams): Promise<IChatMessage> {
        const messageId = randomUUID();
        const nowEpochMs = Date.now(); // Use epoch for internal consistency if DB stores TEXT ISO string
        const nowISO = new Date(nowEpochMs).toISOString(); // Convert to ISO for DB
        
        const metadataString = params.metadata ? JSON.stringify(params.metadata) : null;

        logger.debug(`[ChatModel] Adding message to session ID: ${params.sessionId}, role: ${params.role}. Metadata keys: ${params.metadata ? Object.keys(params.metadata).join(', ') : 'None'}`);

        const tx = this.db.transaction(() => {
            const insertMsgStmt = this.db.prepare(`
                INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)
                VALUES (@message_id, @session_id, @timestamp, @role, @content, @metadata)
            `);
            insertMsgStmt.run({
                message_id: messageId,
                session_id: params.sessionId, // Use camelCase from params
                timestamp: nowISO, // Store ISO string
                role: params.role,
                content: params.content,
                metadata: metadataString
            });

            const updateSessionStmt = this.db.prepare('UPDATE chat_sessions SET updated_at = @updated_at WHERE session_id = @session_id');
            updateSessionStmt.run({ updated_at: nowISO, session_id: params.sessionId });

            // Construct the DB record to pass to the mapper, ensuring timestamp is the ISO string as stored
            const dbRecord: ChatMessageDbRecord = {
                 message_id: messageId,
                 session_id: params.sessionId,
                 timestamp: nowISO, // This is what was stored
                 role: params.role,
                 content: params.content,
                 metadata: metadataString,
            };
            return mapRecordToChatMessage(dbRecord);
        });

        try {
            const resultMessage = tx();
            logger.info(`[ChatModel] Message ${messageId} added successfully to session ${params.sessionId}`);
            return resultMessage;
        } catch (error: any) {
             if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') { 
                logger.error(`[ChatModel] Error adding message to session ${params.sessionId}: Session ID likely does not exist.`, error);
                throw new Error(`Failed to add message: Invalid session ID ${params.sessionId}.`);
            }
            logger.error(`[ChatModel] Error adding message to session ${params.sessionId}:`, error);
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
     * Retrieves a specific message by its ID.
     * @param messageId The ID of the message to retrieve.
     * @returns The message object or null if not found.
     */
    async getMessageById(messageId: string): Promise<IChatMessage | null> {
        logger.debug(`[ChatModel] Getting message by ID: ${messageId}`);
        try {
            const stmt = this.db.prepare('SELECT * FROM chat_messages WHERE message_id = @message_id');
            const record = stmt.get({ message_id: messageId }) as ChatMessageDbRecord | undefined;
            return record ? mapRecordToChatMessage(record) : null;
        } catch (error) {
            logger.error(`[ChatModel] Error getting message by ID ${messageId}:`, error);
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
    async getMessagesBySessionId(sessionId: string, limit?: number, beforeTimestamp?: Date): Promise<IChatMessage[]> {
        logger.debug(`[ChatModel] Getting messages for session ID: ${sessionId}, limit: ${limit}, before: ${beforeTimestamp?.toISOString()}`);
        let query = 'SELECT * FROM chat_messages WHERE session_id = @session_id';
        const queryParams: Record<string, any> = { session_id: sessionId };

        if (beforeTimestamp instanceof Date) { // Ensure it's a Date object before calling toISOString()
            query += ' AND timestamp < @timestamp_before';
            queryParams.timestamp_before = beforeTimestamp.toISOString();
        }

        query += ' ORDER BY timestamp DESC'; // Fetch most recent first for LIMIT, then reverse

        if (limit !== undefined && limit > 0) {
            query += ' LIMIT @limit';
            queryParams.limit = limit;
        }

        try {
            const stmt = this.db.prepare(query);
            const records = stmt.all(queryParams) as ChatMessageDbRecord[];
            return records.map(mapRecordToChatMessage).reverse(); // Reverse for chronological order
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
        try {
            const stmt = this.db.prepare('DELETE FROM chat_sessions WHERE session_id = @session_id');
            const info = stmt.run({ session_id: sessionId });
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
