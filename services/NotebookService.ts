import { v4 as uuidv4 } from 'uuid';
import { NotebookModel } from '../models/NotebookModel';
import { ObjectModel } from '../models/ObjectModel';
import { ChunkSqlModel } from '../models/ChunkModel';
import { logger } from '../utils/logger';
import { NotebookRecord, ObjectChunk, JeffersObject } from '../shared/types'; // Assuming JeffersObject might be needed

export class NotebookService {
    private readonly notebookModel: NotebookModel;
    private readonly objectModel: ObjectModel;
    private readonly chunkSqlModel: ChunkSqlModel;

    constructor(
        notebookModel: NotebookModel,
        objectModel: ObjectModel,
        chunkSqlModel: ChunkSqlModel
    ) {
        this.notebookModel = notebookModel;
        this.objectModel = objectModel;
        this.chunkSqlModel = chunkSqlModel;
        logger.info('[NotebookService] Initialized');
    }

    /**
     * Creates a new notebook.
     * @param title The title of the notebook.
     * @param description Optional description for the notebook.
     * @returns The created NotebookRecord.
     */
    async createNotebook(title: string, description?: string | null): Promise<NotebookRecord> {
        const id = uuidv4();
        logger.debug(`[NotebookService] Creating notebook with title: "${title}", ID: ${id}`);
        const notebookRecord = await this.notebookModel.create(id, title, description);
        
        // TODO: Phase 2 - Create a corresponding JeffersObject for this notebook
        // This would involve:
        // 1. Deciding what content (e.g., title, description) forms the object.
        // 2. Calling this.objectModel.create(...)
        // 3. Potentially triggering chunking/embedding for this new JeffersObject if it contains substantial text.
        //    This might mean the Notebook JeffersObject itself gets one chunk representing its metadata.
        logger.info(`[NotebookService] Notebook created with ID: ${id}. Corresponding JeffersObject creation deferred.`);
        
        return notebookRecord;
    }

    /**
     * Retrieves a notebook by its ID.
     * @param id The ID of the notebook.
     * @returns The NotebookRecord or null if not found.
     */
    async getNotebookById(id: string): Promise<NotebookRecord | null> {
        logger.debug(`[NotebookService] Getting notebook by ID: ${id}`);
        return this.notebookModel.getById(id);
    }

    /**
     * Retrieves all notebooks.
     * @returns An array of NotebookRecord.
     */
    async getAllNotebooks(): Promise<NotebookRecord[]> {
        logger.debug(`[NotebookService] Getting all notebooks`);
        return this.notebookModel.getAll();
    }

    /**
     * Updates a notebook.
     * @param id The ID of the notebook to update.
     * @param data An object containing fields to update (title, description).
     * @returns The updated NotebookRecord or null if not found.
     */
    async updateNotebook(id: string, data: Partial<{ title: string, description: string | null }>): Promise<NotebookRecord | null> {
        logger.debug(`[NotebookService] Updating notebook ID: ${id}`);
        return this.notebookModel.update(id, data);
    }

    /**
     * Deletes a notebook.
     * Note: Associated chunks will have their notebook_id set to NULL due to DB foreign key constraint.
     * @param id The ID of the notebook to delete.
     * @returns True if deletion was successful, false otherwise.
     */
    async deleteNotebook(id: string): Promise<boolean> {
        logger.warn(`[NotebookService] Deleting notebook ID: ${id}. Chunks will be disassociated (notebook_id set to NULL).`);
        // TODO: Phase 2 - If a JeffersObject was created for this notebook, it should also be deleted.
        // TODO: Phase 2 - Consider deleting associated chat sessions.
        const deleted = await this.notebookModel.delete(id);
        if (deleted) {
            logger.info(`[NotebookService] Notebook deleted successfully: ${id}`);
        } else {
            logger.warn(`[NotebookService] Notebook not found or delete failed for ID: ${id}`);
        }
        return deleted;
    }

    /**
     * Assigns a chunk to a notebook or removes its assignment.
     * @param chunkId The ID of the chunk.
     * @param notebookId The ID of the notebook to assign to, or null to remove assignment.
     * @returns True if the assignment was successful, false otherwise.
     */
    async assignChunkToNotebook(chunkId: number, notebookId: string | null): Promise<boolean> {
        logger.debug(`[NotebookService] Assigning chunk ID ${chunkId} to notebook ID ${notebookId}`);
        const success = await this.chunkSqlModel.assignToNotebook(chunkId, notebookId);
        if (success) {
            logger.info(`[NotebookService] Chunk ${chunkId} assignment to notebook ${notebookId} updated in SQL.`);
            // TODO: Update vector store metadata for this chunkId to reflect the new notebookId.
            // This requires a method like `vectorModel.updateDocumentMetadata(chunkId, { notebook_id: notebookId })`
        } else {
            logger.warn(`[NotebookService] Failed to assign chunk ${chunkId} to notebook ${notebookId} in SQL.`);
        }
        return success;
    }

    /**
     * Retrieves all chunks associated with a specific notebook ID.
     * @param notebookId The ID of the notebook.
     * @returns An array of ObjectChunk.
     */
    async getChunksForNotebook(notebookId: string): Promise<ObjectChunk[]> {
        logger.debug(`[NotebookService] Getting chunks for notebook ID: ${notebookId}`);
        return this.chunkSqlModel.listByNotebookId(notebookId);
    }
} 