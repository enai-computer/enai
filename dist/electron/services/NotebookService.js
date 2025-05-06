"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotebookService = void 0;
const uuid_1 = require("uuid");
const logger_1 = require("../utils/logger");
class NotebookService {
    constructor(notebookModel, objectModel, chunkSqlModel) {
        this.notebookModel = notebookModel;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        logger_1.logger.info('[NotebookService] Initialized');
    }
    /**
     * Creates a new notebook.
     * @param title The title of the notebook.
     * @param description Optional description for the notebook.
     * @returns The created NotebookRecord.
     */
    async createNotebook(title, description) {
        const id = (0, uuid_1.v4)();
        logger_1.logger.debug(`[NotebookService] Creating notebook with title: "${title}", ID: ${id}`);
        const notebookRecord = await this.notebookModel.create(id, title, description);
        // TODO: Phase 2 - Create a corresponding JeffersObject for this notebook
        // This would involve:
        // 1. Deciding what content (e.g., title, description) forms the object.
        // 2. Calling this.objectModel.create(...)
        // 3. Potentially triggering chunking/embedding for this new JeffersObject if it contains substantial text.
        //    This might mean the Notebook JeffersObject itself gets one chunk representing its metadata.
        logger_1.logger.info(`[NotebookService] Notebook created with ID: ${id}. Corresponding JeffersObject creation deferred.`);
        return notebookRecord;
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
     * Updates a notebook.
     * @param id The ID of the notebook to update.
     * @param data An object containing fields to update (title, description).
     * @returns The updated NotebookRecord or null if not found.
     */
    async updateNotebook(id, data) {
        logger_1.logger.debug(`[NotebookService] Updating notebook ID: ${id}`);
        return this.notebookModel.update(id, data);
    }
    /**
     * Deletes a notebook.
     * Note: Associated chunks will have their notebook_id set to NULL due to DB foreign key constraint.
     * @param id The ID of the notebook to delete.
     * @returns True if deletion was successful, false otherwise.
     */
    async deleteNotebook(id) {
        logger_1.logger.warn(`[NotebookService] Deleting notebook ID: ${id}. Chunks will be disassociated (notebook_id set to NULL).`);
        // TODO: Phase 2 - If a JeffersObject was created for this notebook, it should also be deleted.
        // TODO: Phase 2 - Consider deleting associated chat sessions.
        const deleted = await this.notebookModel.delete(id);
        if (deleted) {
            logger_1.logger.info(`[NotebookService] Notebook deleted successfully: ${id}`);
        }
        else {
            logger_1.logger.warn(`[NotebookService] Notebook not found or delete failed for ID: ${id}`);
        }
        return deleted;
    }
    /**
     * Assigns a chunk to a notebook or removes its assignment.
     * @param chunkId The ID of the chunk.
     * @param notebookId The ID of the notebook to assign to, or null to remove assignment.
     * @returns True if the assignment was successful, false otherwise.
     */
    async assignChunkToNotebook(chunkId, notebookId) {
        logger_1.logger.debug(`[NotebookService] Assigning chunk ID ${chunkId} to notebook ID ${notebookId}`);
        const success = await this.chunkSqlModel.assignToNotebook(chunkId, notebookId);
        if (success) {
            logger_1.logger.info(`[NotebookService] Chunk ${chunkId} assignment to notebook ${notebookId} updated in SQL.`);
            // TODO: Update vector store metadata for this chunkId to reflect the new notebookId.
            // This requires a method like `vectorModel.updateDocumentMetadata(chunkId, { notebook_id: notebookId })`
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
        return this.chunkSqlModel.listByNotebookId(notebookId);
    }
}
exports.NotebookService = NotebookService;
//# sourceMappingURL=NotebookService.js.map