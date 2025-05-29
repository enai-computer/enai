"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatModel = void 0;
var crypto_1 = require("crypto");
var db_1 = require("./db"); // Assuming db is initialized elsewhere
var logger_1 = require("../utils/logger"); // Adjust path as needed
// --- Mapping Functions --- 
function mapRecordToChatSession(record) {
    return {
        sessionId: record.session_id,
        notebookId: record.notebook_id,
        createdAt: new Date(record.created_at),
        updatedAt: new Date(record.updated_at),
        title: record.title,
    };
}
function mapRecordToChatMessage(record) {
    return {
        messageId: record.message_id,
        sessionId: record.session_id,
        timestamp: new Date(record.timestamp),
        role: record.role,
        content: record.content,
        metadata: record.metadata, // Keep as string, StructuredChatMessage handles parsing
    };
}
/**
 * Model for interacting with chat sessions and messages in the database.
 * Instances should be created AFTER the database is initialized.
 */
var ChatModel = /** @class */ (function () {
    /**
     * Constructor requires a DB instance or uses the default singleton if available.
     * Ensures DB is initialized before instantiation.
     * @param dbInstance Optional database instance for testing or specific use cases.
     */
    function ChatModel(dbInstance) {
        this.db = dbInstance !== null && dbInstance !== void 0 ? dbInstance : (0, db_1.getDb)(); // getDb() should now succeed if called after initDb()
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
    ChatModel.prototype.createSession = function (notebookId, sessionIdInput, title) {
        return __awaiter(this, void 0, void 0, function () {
            var finalSessionId, now, sessionTitle, stmt, newSession, error_1, existingSession;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        finalSessionId = sessionIdInput !== null && sessionIdInput !== void 0 ? sessionIdInput : (0, crypto_1.randomUUID)();
                        now = new Date().toISOString();
                        sessionTitle = title !== null && title !== void 0 ? title : null;
                        logger_1.logger.debug("[ChatModel] Creating new chat session with ID: ".concat(finalSessionId, " for notebook ID: ").concat(notebookId, ", title: \"").concat(sessionTitle, "\""));
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 7]);
                        stmt = this.db.prepare('INSERT INTO chat_sessions (session_id, notebook_id, title, created_at, updated_at) VALUES (@session_id, @notebook_id, @title, @created_at, @updated_at)');
                        stmt.run({
                            session_id: finalSessionId,
                            notebook_id: notebookId,
                            title: sessionTitle,
                            created_at: now,
                            updated_at: now,
                        });
                        return [4 /*yield*/, this.getSessionById(finalSessionId)];
                    case 2:
                        newSession = _a.sent();
                        if (!newSession) {
                            logger_1.logger.error("[ChatModel] Failed to retrieve newly created session ".concat(finalSessionId));
                            throw new Error('Failed to retrieve newly created session');
                        }
                        logger_1.logger.info("[ChatModel] Chat session created successfully: ".concat(finalSessionId, " in notebook ").concat(notebookId));
                        return [2 /*return*/, newSession];
                    case 3:
                        error_1 = _a.sent();
                        if (!(error_1.code === 'SQLITE_CONSTRAINT_UNIQUE' || error_1.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')) return [3 /*break*/, 5];
                        logger_1.logger.warn("[ChatModel] Attempted to create session with existing ID: ".concat(finalSessionId, " (Code: ").concat(error_1.code, "). Session likely already exists."));
                        return [4 /*yield*/, this.getSessionById(finalSessionId)];
                    case 4:
                        existingSession = _a.sent();
                        if (existingSession) {
                            if (existingSession.notebookId !== notebookId) {
                                logger_1.logger.error("[ChatModel] Session ID ".concat(finalSessionId, " already exists but belongs to a different notebook (").concat(existingSession.notebookId, ") than requested (").concat(notebookId, ")."));
                                throw new Error("Session ID ".concat(finalSessionId, " conflict: already exists in a different notebook."));
                            }
                            logger_1.logger.info("[ChatModel] Returning existing session ".concat(finalSessionId, " as it matches the provided notebookId."));
                            return [2 /*return*/, existingSession];
                        }
                        else {
                            logger_1.logger.error("[ChatModel] ".concat(error_1.code, " constraint failed for ").concat(finalSessionId, ", but could not retrieve existing session. This is unexpected."));
                            throw new Error("Failed to create or retrieve session with ID: ".concat(finalSessionId, " after a constraint violation."));
                        }
                        return [3 /*break*/, 6];
                    case 5:
                        if (error_1.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                            logger_1.logger.error("[ChatModel] Error creating chat session ".concat(finalSessionId, ": Notebook ID ").concat(notebookId, " likely does not exist."), error_1);
                            throw new Error("Failed to create chat session: Invalid notebook ID ".concat(notebookId, "."));
                        }
                        else {
                            logger_1.logger.error("[ChatModel] Error creating chat session ".concat(finalSessionId, ":"), error_1);
                            throw error_1;
                        }
                        _a.label = 6;
                    case 6: return [3 /*break*/, 7];
                    case 7: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Retrieves a specific chat session by its ID.
     * @param sessionId The ID of the session to retrieve.
     * @returns The chat session object or null if not found.
     */
    ChatModel.prototype.getSessionById = function (sessionId) {
        return __awaiter(this, void 0, void 0, function () {
            var stmt, record;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Getting chat session with ID: ".concat(sessionId));
                try {
                    stmt = this.db.prepare('SELECT * FROM chat_sessions WHERE session_id = ?');
                    record = stmt.get(sessionId);
                    return [2 /*return*/, record ? mapRecordToChatSession(record) : null];
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error getting chat session ".concat(sessionId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Updates the title of a specific chat session.
     * Also updates the updated_at timestamp (handled by trigger).
     * @param sessionId The ID of the session to update.
     * @param title The new title for the session.
     */
    ChatModel.prototype.updateSessionTitle = function (sessionId, title) {
        return __awaiter(this, void 0, void 0, function () {
            var now, stmt, info;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Updating title for session ID: ".concat(sessionId, " to \"").concat(title, "\""));
                now = new Date().toISOString();
                try {
                    stmt = this.db.prepare('UPDATE chat_sessions SET title = @title, updated_at = @updated_at WHERE session_id = @session_id');
                    info = stmt.run({ title: title, updated_at: now, session_id: sessionId });
                    if (info.changes === 0) {
                        logger_1.logger.warn("[ChatModel] Attempted to update title for non-existent session ID: ".concat(sessionId, " or title was already the same."));
                        // Still try to fetch, maybe it exists but title was same so no 'change' reported by DB
                        return [2 /*return*/, this.getSessionById(sessionId)];
                    }
                    logger_1.logger.info("[ChatModel] Updated title for session ".concat(sessionId, ". Rows affected: ").concat(info.changes));
                    return [2 /*return*/, this.getSessionById(sessionId)]; // Return the updated session
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error updating title for session ".concat(sessionId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Retrieves a list of all chat sessions, ordered by updated_at descending.
     * @returns An array of chat session objects.
     */
    ChatModel.prototype.listSessions = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stmt, records;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Listing all chat sessions");
                try {
                    stmt = this.db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC');
                    records = stmt.all();
                    return [2 /*return*/, records.map(mapRecordToChatSession)];
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error listing chat sessions:", error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Retrieves a list of all chat sessions for a specific notebook, ordered by updated_at descending.
     * @param notebookId The ID of the notebook.
     * @returns An array of chat session objects.
     */
    ChatModel.prototype.listSessionsForNotebook = function (notebookId) {
        return __awaiter(this, void 0, void 0, function () {
            var stmt, records;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Listing chat sessions for notebook ID: ".concat(notebookId));
                try {
                    stmt = this.db.prepare('SELECT * FROM chat_sessions WHERE notebook_id = ? ORDER BY updated_at DESC');
                    records = stmt.all(notebookId);
                    logger_1.logger.info("[ChatModel] Found ".concat(records.length, " sessions for notebook ID ").concat(notebookId));
                    return [2 /*return*/, records.map(mapRecordToChatSession)];
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error listing sessions for notebook ID ".concat(notebookId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Updates the notebook associated with a chat session.
     * @param sessionId The ID of the chat session to update.
     * @param newNotebookId The ID of the new notebook.
     * @returns True if the update was successful, false otherwise.
     */
    ChatModel.prototype.updateChatNotebook = function (sessionId, newNotebookId) {
        return __awaiter(this, void 0, void 0, function () {
            var now, stmt, info;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Updating notebook for session ID: ".concat(sessionId, " to notebook ID: ").concat(newNotebookId));
                now = new Date().toISOString();
                try {
                    stmt = this.db.prepare('UPDATE chat_sessions SET notebook_id = @notebook_id, updated_at = @updated_at WHERE session_id = @session_id');
                    info = stmt.run({ notebook_id: newNotebookId, updated_at: now, session_id: sessionId });
                    if (info.changes > 0) {
                        logger_1.logger.info("[ChatModel] Successfully updated notebook for session ".concat(sessionId, " to ").concat(newNotebookId, ". Rows affected: ").concat(info.changes));
                        return [2 /*return*/, true];
                    }
                    else {
                        logger_1.logger.warn("[ChatModel] Session ID ".concat(sessionId, " not found or notebook ID was already ").concat(newNotebookId, ". No update performed."));
                        return [2 /*return*/, false];
                    }
                }
                catch (error) {
                    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                        logger_1.logger.error("[ChatModel] Error updating notebook for session ".concat(sessionId, ": New notebook ID ").concat(newNotebookId, " likely does not exist."), error);
                        throw new Error("Failed to update chat session's notebook: Invalid new notebook ID ".concat(newNotebookId, "."));
                    }
                    logger_1.logger.error("[ChatModel] Error updating notebook for session ".concat(sessionId, " to ").concat(newNotebookId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Adds a new message to a specific chat session.
     * Generates message ID and timestamp.
     * Updates the session's updated_at timestamp.
     * @param messageData Object containing session_id, role, content, and optional structured metadata.
     * @returns The newly created chat message object with generated fields (metadata will be JSON string).
     */
    ChatModel.prototype.addMessage = function (params) {
        return __awaiter(this, void 0, void 0, function () {
            var messageId, nowEpochMs, nowISO, metadataString, tx, resultMessage;
            var _this = this;
            return __generator(this, function (_a) {
                messageId = (0, crypto_1.randomUUID)();
                nowEpochMs = Date.now();
                nowISO = new Date(nowEpochMs).toISOString();
                metadataString = params.metadata ? JSON.stringify(params.metadata) : null;
                logger_1.logger.debug("[ChatModel] Adding message to session ID: ".concat(params.sessionId, ", role: ").concat(params.role, ". Metadata keys: ").concat(params.metadata ? Object.keys(params.metadata).join(', ') : 'None'));
                tx = this.db.transaction(function () {
                    var insertMsgStmt = _this.db.prepare("\n                INSERT INTO chat_messages (message_id, session_id, timestamp, role, content, metadata)\n                VALUES (@message_id, @session_id, @timestamp, @role, @content, @metadata)\n            ");
                    insertMsgStmt.run({
                        message_id: messageId,
                        session_id: params.sessionId, // Use camelCase from params
                        timestamp: nowISO, // Store ISO string
                        role: params.role,
                        content: params.content,
                        metadata: metadataString
                    });
                    var updateSessionStmt = _this.db.prepare('UPDATE chat_sessions SET updated_at = @updated_at WHERE session_id = @session_id');
                    updateSessionStmt.run({ updated_at: nowISO, session_id: params.sessionId });
                    // Construct the DB record to pass to the mapper, ensuring timestamp is the ISO string as stored
                    var dbRecord = {
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
                    resultMessage = tx();
                    logger_1.logger.info("[ChatModel] Message ".concat(messageId, " added successfully to session ").concat(params.sessionId));
                    return [2 /*return*/, resultMessage];
                }
                catch (error) {
                    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
                        logger_1.logger.error("[ChatModel] Error adding message to session ".concat(params.sessionId, ": Session ID likely does not exist."), error);
                        throw new Error("Failed to add message: Invalid session ID ".concat(params.sessionId, "."));
                    }
                    logger_1.logger.error("[ChatModel] Error adding message to session ".concat(params.sessionId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Retrieves a specific message by its ID.
     * @param messageId The ID of the message to retrieve.
     * @returns The message object or null if not found.
     */
    ChatModel.prototype.getMessageById = function (messageId) {
        return __awaiter(this, void 0, void 0, function () {
            var stmt, record;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Getting message by ID: ".concat(messageId));
                try {
                    stmt = this.db.prepare('SELECT * FROM chat_messages WHERE message_id = @message_id');
                    record = stmt.get({ message_id: messageId });
                    return [2 /*return*/, record ? mapRecordToChatMessage(record) : null];
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error getting message by ID ".concat(messageId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Retrieves messages for a specific chat session, ordered by timestamp ascending.
     * @param sessionId The ID of the session whose messages to retrieve.
     * @param limit Optional maximum number of messages to return (most recent if combined with DESC order, which we use internally then reverse).
     * @param beforeTimestamp Optional ISO timestamp to fetch messages strictly before this point.
     * @returns An array of chat message objects in ascending chronological order.
     */
    ChatModel.prototype.getMessagesBySessionId = function (sessionId, limit, beforeTimestamp) {
        return __awaiter(this, void 0, void 0, function () {
            var query, queryParams, stmt, records;
            return __generator(this, function (_a) {
                logger_1.logger.debug("[ChatModel] Getting messages for session ID: ".concat(sessionId, ", limit: ").concat(limit, ", before: ").concat(beforeTimestamp === null || beforeTimestamp === void 0 ? void 0 : beforeTimestamp.toISOString()));
                query = 'SELECT * FROM chat_messages WHERE session_id = @session_id';
                queryParams = { session_id: sessionId };
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
                    stmt = this.db.prepare(query);
                    records = stmt.all(queryParams);
                    return [2 /*return*/, records.map(mapRecordToChatMessage).reverse()]; // Reverse for chronological order
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error getting messages for session ".concat(sessionId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Deletes a specific chat session and all its associated messages (due to CASCADE constraint).
     * @param sessionId The ID of the session to delete.
     */
    ChatModel.prototype.deleteSession = function (sessionId) {
        return __awaiter(this, void 0, void 0, function () {
            var stmt, info;
            return __generator(this, function (_a) {
                logger_1.logger.warn("[ChatModel] Deleting session ID: ".concat(sessionId));
                try {
                    stmt = this.db.prepare('DELETE FROM chat_sessions WHERE session_id = @session_id');
                    info = stmt.run({ session_id: sessionId });
                    if (info.changes === 0) {
                        logger_1.logger.warn("[ChatModel] Attempted to delete non-existent session ID: ".concat(sessionId));
                    }
                    logger_1.logger.info("[ChatModel] Deleted session ".concat(sessionId, ". Rows affected: ").concat(info.changes));
                }
                catch (error) {
                    logger_1.logger.error("[ChatModel] Error deleting session ".concat(sessionId, ":"), error);
                    throw error;
                }
                return [2 /*return*/];
            });
        });
    };
    return ChatModel;
}());
exports.ChatModel = ChatModel;
