"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatModel = void 0;
const uuid_1 = require("uuid");
const db_1 = require("./db");
const logger_1 = require("../utils/logger");
class ChatModel {
    /**
     * Creates an instance of ChatModel.
     * Prepares database statements for reuse.
     * @param dbInstance - An initialized better-sqlite3 database instance.
     */
    constructor(dbInstance) {
        this.db = dbInstance ?? (0, db_1.getDb)();
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
    async addMessage(messageData) {
        // Runtime Role Validation
        const validRoles = ['user', 'assistant', 'system'];
        if (!validRoles.includes(messageData.role)) {
            logger_1.logger.error(`[ChatModel] Invalid role provided: ${messageData.role}`);
            throw new Error(`Invalid chat message role: ${messageData.role}`);
        }
        const messageId = (0, uuid_1.v4)();
        const timestamp = new Date().toISOString();
        const metadataJson = messageData.metadata ? JSON.stringify(messageData.metadata) : null;
        try {
            logger_1.logger.debug(`[ChatModel] Adding message to session ${messageData.sessionId}, role: ${messageData.role}`);
            // Use cached statement
            const info = this.addMessageStmt.run(messageId, messageData.sessionId, timestamp, messageData.role, messageData.content, metadataJson);
            if (info.changes !== 1) {
                throw new Error('Failed to insert chat message, no rows affected.');
            }
            logger_1.logger.info(`[ChatModel] Message ${messageId} added to session ${messageData.sessionId}`);
            return messageId;
        }
        catch (error) {
            logger_1.logger.error(`[ChatModel] Failed to add message to session ${messageData.sessionId}:`, error);
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
    async getHistory(sessionId) {
        logger_1.logger.debug(`[ChatModel] getHistory called for session ${sessionId} (STUBBED - returning empty)`);
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
    async createSession(title) {
        const sessionId = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        try {
            logger_1.logger.info(`[ChatModel] Creating new chat session${title ? ` with title \"${title}\"` : ''}`);
            // Use cached statement
            const info = this.createSessionStmt.run(sessionId, now, now, title ?? null);
            if (info.changes !== 1) {
                throw new Error('Failed to insert chat session, no rows affected.');
            }
            logger_1.logger.info(`[ChatModel] Session ${sessionId} created.`);
            return sessionId;
        }
        catch (error) {
            logger_1.logger.error('[ChatModel] Failed to create chat session:', error);
            throw new Error(`Database error creating chat session.`);
        }
    }
}
exports.ChatModel = ChatModel;
// Optional: Export a singleton instance if desired, but manage instantiation centrally
// export const chatModel = new ChatModel();
//# sourceMappingURL=ChatModel.js.map