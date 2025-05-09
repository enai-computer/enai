"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotebookService = void 0;
const uuid_1 = require("uuid");
const db_1 = require("../models/db");
const logger_1 = require("../utils/logger");
class NotebookService {
    constructor(notebookModel, objectModel, chunkSqlModel, chatModel) {
        this.notebookModel = notebookModel;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        this.chatModel = chatModel;
        logger_1.logger.info('[NotebookService] Initialized with ChatModel');
    }
    getNotebookObjectSourceUri(notebookId) {
        return `jeffers://notebook/${notebookId}`;
    }
    /**
     * Creates a new notebook and its corresponding JeffersObject within a transaction.
     * @param title The title of the notebook.
     * @param description Optional description for the notebook.
     * @returns The created NotebookRecord.
     * @throws Error if underlying model operations fail or transaction cannot be completed.
     */
    async createNotebook(title, description) {
        const db = (0, db_1.getDb)();
        const notebookId = (0, uuid_1.v4)();
        logger_1.logger.debug(`[NotebookService] Attempting to create notebook (transactionally) with title: "${title}", generated ID: ${notebookId}`);
        let notebookRecord;
        try {
            db.exec('BEGIN');
            notebookRecord = await this.notebookModel.create(notebookId, title, description);
            logger_1.logger.info(`[NotebookService TX] NotebookRecord created with ID: ${notebookId}`);
            const sourceUri = this.getNotebookObjectSourceUri(notebookRecord.id);
            const cleanedText = notebookRecord.title + (notebookRecord.description ? `\n${notebookRecord.description}` : '');
            const notebookJeffersObjectData = {
                objectType: 'notebook',
                sourceUri: sourceUri,
                title: notebookRecord.title,
                status: 'parsed',
                cleanedText: cleanedText,
                rawContentRef: null,
                parsedContentJson: null,
                parsedAt: new Date(),
            };
            const jeffersObject = await this.objectModel.create(notebookJeffersObjectData);
            logger_1.logger.info(`[NotebookService TX] Corresponding JeffersObject created with ID: ${jeffersObject.id} for notebook ID: ${notebookRecord.id}`);
            db.exec('COMMIT');
            logger_1.logger.info(`[NotebookService] Transaction committed: NotebookRecord and JeffersObject created for ID: ${notebookRecord.id}`);
            return notebookRecord;
        }
        catch (error) {
            logger_1.logger.error(`[NotebookService] Error during transactional notebook creation for title "${title}", attempting rollback.`, error);
            try {
                db.exec('ROLLBACK');
                logger_1.logger.info(`[NotebookService] Transaction rolled back successfully for notebook creation of title "${title}".`);
            }
            catch (rollbackError) {
                logger_1.logger.error(`[NotebookService] CRITICAL: Failed to rollback transaction for notebook creation of title "${title}". DB may be in an inconsistent state.`, rollbackError);
            }
            throw new Error(`Failed to create notebook transactionally: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Retrieves a notebook by its ID.
     * @param id The ID of the notebook.
     * @returns The NotebookRecord or null if not found.
     */
    async getNotebookById(id) {
        logger_1.logger.debug(`[NotebookService] Getting notebook by ID: ${id}`);
        return this.notebookModel.getById(id);
    }
    /**
     * Retrieves all notebooks.
     * @returns An array of NotebookRecord.
     */
    async getAllNotebooks() {
        logger_1.logger.debug(`[NotebookService] Getting all notebooks`);
        return this.notebookModel.getAll();
    }
    /**
     * Updates a notebook and its corresponding JeffersObject within a transaction.
     * @param id The ID of the notebook to update.
     * @param data An object containing fields to update (title, description).
     * @returns The updated NotebookRecord or null if not found and no update occurred.
     * @throws Error if underlying model operations fail or transaction cannot be completed.
     */
    async updateNotebook(id, data) {
        const db = (0, db_1.getDb)();
        logger_1.logger.debug(`[NotebookService] Attempting to update notebook (transactionally) ID: ${id}`);
        let updatedNotebookRecord = null;
        try {
            db.exec('BEGIN');
            updatedNotebookRecord = await this.notebookModel.update(id, data);
            if (updatedNotebookRecord) {
                logger_1.logger.info(`[NotebookService TX] NotebookRecord ${id} updated.`);
                if (data.title !== undefined || data.description !== undefined) {
                    const sourceUri = this.getNotebookObjectSourceUri(id);
                    const jeffersObject = await this.objectModel.getBySourceUri(sourceUri);
                    if (jeffersObject) {
                        const newCleanedText = updatedNotebookRecord.title + (updatedNotebookRecord.description ? `\n${updatedNotebookRecord.description}` : '');
                        const objectUpdates = {
                            title: updatedNotebookRecord.title,
                            cleanedText: newCleanedText,
                        };
                        await this.objectModel.update(jeffersObject.id, objectUpdates);
                        logger_1.logger.info(`[NotebookService TX] Corresponding JeffersObject ${jeffersObject.id} updated for notebook ID: ${id}`);
                    }
                    else {
                        logger_1.logger.warn(`[NotebookService TX] JeffersObject not found for notebook ID: ${id} (sourceUri: ${sourceUri}) during update. It may need to be created or was deleted. Update to JeffersObject skipped.`);
                    }
                }
            }
            else {
                logger_1.logger.warn(`[NotebookService TX] Notebook ID: ${id} not found for update or no changes made in NotebookModel.`);
            }
            db.exec('COMMIT');
            logger_1.logger.info(`[NotebookService] Transaction committed for notebook update ID: ${id}.`);
            return updatedNotebookRecord;
        }
        catch (error) {
            logger_1.logger.error(`[NotebookService] Error during transactional notebook update for ID ${id}, attempting rollback.`, error);
            try {
                db.exec('ROLLBACK');
                logger_1.logger.info(`[NotebookService] Transaction rolled back successfully for notebook update ID ${id}.`);
            }
            catch (rollbackError) {
                logger_1.logger.error(`[NotebookService] CRITICAL: Failed to rollback transaction for notebook update ID ${id}. DB may be in an inconsistent state.`, rollbackError);
            }
            throw new Error(`Failed to update notebook transactionally: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Deletes a notebook and its corresponding JeffersObject within a transaction.
     * Associated chat sessions are deleted by DB cascade.
     * Associated chunks have their notebook_id set to NULL by DB constraint.
     * @param id The ID of the notebook to delete.
     * @returns True if notebook record deletion was successful, false otherwise.
     * @throws Error if transaction fails or a critical error occurs.
     */
    async deleteNotebook(id) {
        logger_1.logger.warn(`[NotebookService] Attempting to delete notebook ID: ${id}.`);
        // Check for existence BEFORE starting any transaction or other operations.
        const notebookRecordExistedInitially = await this.notebookModel.getById(id);
        if (!notebookRecordExistedInitially) {
            logger_1.logger.warn(`[NotebookService] NotebookRecord for ID: ${id} not found. Nothing to delete. Returning false.`);
            return false; // Notebook wasn't there to begin with. No transaction needed.
        }
        // If we proceed, the notebook record exists.
        const db = (0, db_1.getDb)();
        logger_1.logger.info(`[NotebookService] Notebook ID: ${id} exists. Proceeding with transactional deletion of it and its corresponding JeffersObject.`);
        try {
            db.exec('BEGIN');
            const sourceUri = this.getNotebookObjectSourceUri(id);
            const jeffersObject = await this.objectModel.getBySourceUri(sourceUri);
            if (jeffersObject) {
                await this.objectModel.deleteById(jeffersObject.id);
                logger_1.logger.info(`[NotebookService TX] Corresponding JeffersObject ${jeffersObject.id} deleted for notebook ID: ${id}.`);
            }
            else {
                // This case should ideally not be hit if notebookRecordExistedInitially is true, 
                // as a notebook record should have a corresponding JeffersObject by design from createNotebook.
                // However, if it does happen (e.g., data inconsistency), we log it but proceed to delete the notebook record.
                logger_1.logger.warn(`[NotebookService TX] JeffersObject not found for sourceUri ${sourceUri} during deletion of existing notebook ID: ${id}. This is unexpected.`);
            }
            // Attempt to delete the notebook record, which we know existed.
            const deletedSuccessfully = await this.notebookModel.delete(id);
            if (deletedSuccessfully) {
                logger_1.logger.info(`[NotebookService TX] NotebookRecord deleted successfully: ${id}.`);
            }
            else {
                // This means notebookRecordExistedInitially was true, but notebookModel.delete(id) still returned false.
                // This indicates a failure to delete an existing, known record.
                logger_1.logger.error(`[NotebookService TX] NotebookRecord for ID: ${id} existed but its deletion failed in NotebookModel. This will trigger a rollback.`);
                throw new Error(`NotebookModel.delete() failed for existing ID ${id}.`);
            }
            db.exec('COMMIT');
            logger_1.logger.info(`[NotebookService] Transaction committed for notebook deletion ID: ${id}. Result: ${deletedSuccessfully}`);
            return deletedSuccessfully;
        }
        catch (error) {
            logger_1.logger.error(`[NotebookService] Error during transactional notebook deletion for ID ${id}, attempting rollback.`, error);
            try {
                db.exec('ROLLBACK');
                logger_1.logger.info(`[NotebookService] Transaction rolled back successfully for notebook deletion ID ${id}.`);
            }
            catch (rollbackError) {
                logger_1.logger.error(`[NotebookService] CRITICAL: Failed to rollback transaction for notebook deletion ID ${id}. DB may be in an inconsistent state.`, rollbackError);
            }
            throw new Error(`Failed to delete notebook transactionally: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Creates a new chat session within a specified notebook.
     * @param notebookId The ID of the notebook.
     * @param chatTitle Optional title for the chat session.
     * @returns The created IChatSession.
     * @throws Error if the notebook is not found or chat session creation fails.
     */
    async createChatInNotebook(notebookId, chatTitle) {
        logger_1.logger.debug(`[NotebookService] Creating chat in notebook ID: ${notebookId}, title: "${chatTitle || 'Untitled'}"`);
        const notebook = await this.notebookModel.getById(notebookId);
        if (!notebook) {
            logger_1.logger.error(`[NotebookService] Notebook not found with ID: ${notebookId} when trying to create chat session.`);
            throw new Error(`Notebook not found with ID: ${notebookId}`);
        }
        return this.chatModel.createSession(notebookId, undefined, chatTitle);
    }
    /**
     * Lists all chat sessions for a specific notebook.
     * @param notebookId The ID of the notebook.
     * @returns An array of IChatSession.
     * @throws Error if the notebook is not found.
     */
    async listChatsForNotebook(notebookId) {
        logger_1.logger.debug(`[NotebookService] Listing chats for notebook ID: ${notebookId}`);
        const notebook = await this.notebookModel.getById(notebookId);
        if (!notebook) {
            logger_1.logger.error(`[NotebookService] Notebook not found with ID: ${notebookId} when trying to list chat sessions.`);
            throw new Error(`Notebook not found with ID: ${notebookId}`);
        }
        return this.chatModel.listSessionsForNotebook(notebookId);
    }
    /**
     * Transfers a chat session to a different notebook.
     * @param sessionId The ID of the chat session to transfer.
     * @param newNotebookId The ID of the target notebook.
     * @returns True if the transfer was successful, false otherwise.
     * @throws Error if the session or target notebook is not found.
     */
    async transferChatToNotebook(sessionId, newNotebookId) {
        logger_1.logger.debug(`[NotebookService] Transferring chat session ID: ${sessionId} to notebook ID: ${newNotebookId}`);
        const session = await this.chatModel.getSession(sessionId);
        if (!session) {
            logger_1.logger.error(`[NotebookService] Chat session not found with ID: ${sessionId} for transfer.`);
            throw new Error(`Chat session not found with ID: ${sessionId}`);
        }
        const newNotebook = await this.notebookModel.getById(newNotebookId);
        if (!newNotebook) {
            logger_1.logger.error(`[NotebookService] Target notebook not found with ID: ${newNotebookId} for chat transfer.`);
            throw new Error(`Target notebook not found with ID: ${newNotebookId}`);
        }
        if (session.notebook_id === newNotebookId) {
            logger_1.logger.info(`[NotebookService] Chat session ${sessionId} is already in notebook ${newNotebookId}. No transfer needed.`);
            return true;
        }
        return this.chatModel.updateChatNotebook(sessionId, newNotebookId);
    }
    /**
     * Assigns a chunk to a notebook or removes its assignment.
     * @param chunkId The ID of the chunk.
     * @param notebookId The ID of the notebook to assign to, or null to remove assignment.
     * @returns True if the assignment was successful, false otherwise.
     */
    async assignChunkToNotebook(chunkId, notebookId) {
        logger_1.logger.debug(`[NotebookService] Assigning chunk ID ${chunkId} to notebook ID ${notebookId}`);
        console.log('[Service Method] typeof before call:', typeof this.chunkSqlModel.assignToNotebook, '[Service Method] own?', this.chunkSqlModel.hasOwnProperty('assignToNotebook'));
        console.log('[Service Method] proto value ===', Object.getPrototypeOf(this.chunkSqlModel).assignToNotebook);
        if (notebookId) {
            const notebook = await this.notebookModel.getById(notebookId);
            if (!notebook) {
                logger_1.logger.error(`[NotebookService] Target notebook ${notebookId} not found for assigning chunk ${chunkId}.`);
                throw new Error(`Target notebook not found with ID: ${notebookId}`);
            }
        }
        const success = await this.chunkSqlModel.assignToNotebook(chunkId, notebookId);
        if (success) {
            logger_1.logger.info(`[NotebookService] Chunk ${chunkId} assignment to notebook ${notebookId} updated in SQL.`);
        }
        else {
            logger_1.logger.warn(`[NotebookService] Failed to assign chunk ${chunkId} to notebook ${notebookId} in SQL.`);
        }
        return success;
    }
    /**
     * Retrieves all chunks associated with a specific notebook ID.
     * @param notebookId The ID of the notebook.
     * @returns An array of ObjectChunk.
     */
    async getChunksForNotebook(notebookId) {
        logger_1.logger.debug(`[NotebookService] Getting chunks for notebook ID: ${notebookId}`);
        const notebook = await this.notebookModel.getById(notebookId);
        if (!notebook) {
            logger_1.logger.error(`[NotebookService] Notebook ${notebookId} not found when getting chunks.`);
            throw new Error(`Notebook not found with ID: ${notebookId}`);
        }
        return this.chunkSqlModel.listByNotebookId(notebookId);
    }
}
exports.NotebookService = NotebookService;
//# sourceMappingURL=NotebookService.js.map