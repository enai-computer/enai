import { ipcMain } from 'electron';
import {
    NOTEBOOK_CREATE,
    NOTEBOOK_GET_BY_ID,
    NOTEBOOK_GET_ALL,
    NOTEBOOK_UPDATE,
    NOTEBOOK_DELETE,
    NOTEBOOK_GET_CHUNKS,
    NOTEBOOK_GET_RECENTLY_VIEWED
} from '../../shared/ipcChannels';
import { NotebookService } from '../../services/NotebookService';
import { logger } from '../../utils/logger';
import { NotebookRecord, ObjectChunk, RecentNotebook } from '../../shared/types';

let notebookHandlersRegistered = false;

// --- Create Notebook Handler ---
function registerCreateNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_CREATE, async (_event, params: { title: string, description?: string | null }): Promise<NotebookRecord> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_CREATE} with title: "${params?.title}", description: "${params?.description?.substring(0,30)}..."`);
        try {
            if (!params || typeof params.title !== 'string' || params.title.trim() === '') {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_CREATE} failed: Invalid parameters. Title is required and cannot be empty.`);
                throw new Error('Invalid parameters for creating notebook. Title is required and cannot be empty.');
            }
            return await notebookService.createNotebook(params.title, params.description);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_CREATE} for title "${params?.title}":`, error);
            throw error;
        }
    });
}

// --- Get Notebook By ID Handler ---
function registerGetNotebookByIdHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_GET_BY_ID, async (_event, id: string): Promise<NotebookRecord | null> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_GET_BY_ID} for ID: "${id}"`);
        try {
            if (typeof id !== 'string' || id.trim() === '') {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_GET_BY_ID} failed: Invalid ID provided.`);
                throw new Error('Invalid ID for getting notebook.');
            }
            return await notebookService.getNotebookById(id);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_GET_BY_ID} for ID "${id}":`, error);
            throw error;
        }
    });
}

// --- Get All Notebooks Handler ---
function registerGetAllNotebooksHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_GET_ALL, async (): Promise<NotebookRecord[]> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_GET_ALL}`);
        try {
            // Return only regular notebooks, excluding NotebookCovers
            return await notebookService.getAllRegularNotebooks();
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_GET_ALL}:`, error);
            throw error;
        }
    });
}

// --- Update Notebook Handler ---
function registerUpdateNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_UPDATE, async (_event, params: { id: string, data: { title?: string, description?: string | null } }): Promise<NotebookRecord | null> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_UPDATE} for ID: "${params?.id}", data: ${JSON.stringify(params?.data)}`);
        try {
            if (!params || typeof params.id !== 'string' || params.id.trim() === '' || typeof params.data !== 'object') {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_UPDATE} failed for ID "${params?.id}": Invalid parameters.`);
                throw new Error('Invalid parameters for updating notebook.');
            }
            if (params.data.title !== undefined && (typeof params.data.title !== 'string' || params.data.title.trim() === '')) {
                 logger.warn(`[IPC:Notebook] ${NOTEBOOK_UPDATE} failed for ID "${params?.id}": Title, if provided, cannot be empty.`);
                throw new Error('Invalid title for updating notebook. If provided, title cannot be empty.');
            }
            return await notebookService.updateNotebook(params.id, params.data);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_UPDATE} for ID "${params?.id}":`, error);
            throw error;
        }
    });
}

// --- Delete Notebook Handler ---
function registerDeleteNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_DELETE, async (_event, id: string): Promise<boolean> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_DELETE} for ID: "${id}"`);
        try {
            if (typeof id !== 'string' || id.trim() === '') {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_DELETE} failed: Invalid ID provided.`);
                throw new Error('Invalid ID for deleting notebook.');
            }
            
            // Prevent deletion of NotebookCovers
            if (id.startsWith('cover-')) {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_DELETE} failed: Cannot delete NotebookCover with ID "${id}".`);
                throw new Error('Cannot delete NotebookCover. These are system-managed notebooks.');
            }
            
            return await notebookService.deleteNotebook(id);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_DELETE} for ID "${id}":`, error);
            throw error;
        }
    });
}

// --- Get Chunks For Notebook Handler ---
function registerGetChunksForNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_GET_CHUNKS, async (_event, notebookId: string): Promise<ObjectChunk[]> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_GET_CHUNKS} for notebook ID: "${notebookId}"`);
        try {
            if (typeof notebookId !== 'string' || notebookId.trim() === '') {
                logger.warn(`[IPC:Notebook] ${NOTEBOOK_GET_CHUNKS} failed: Invalid notebook ID provided.`);
                throw new Error('Invalid notebook ID for getting chunks.');
            }
            return await notebookService.getChunksForNotebook(notebookId);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_GET_CHUNKS} for notebook ID "${notebookId}":`, error);
            throw error;
        }
    });
}

// --- Get Recently Viewed Notebooks Handler ---
function registerGetRecentlyViewedHandler(notebookService: NotebookService) {
    ipcMain.handle(NOTEBOOK_GET_RECENTLY_VIEWED, async (_event, limit?: number): Promise<RecentNotebook[]> => {
        logger.debug(`[IPC:Notebook] Handling ${NOTEBOOK_GET_RECENTLY_VIEWED} with limit: ${limit || 12}`);
        try {
            return await notebookService.getRecentlyViewed(limit);
        } catch (error) {
            logger.error(`[IPC:Notebook] Error handling ${NOTEBOOK_GET_RECENTLY_VIEWED}:`, error);
            throw error;
        }
    });
}

/**
 * Registers all notebook related IPC handlers.
 * @param notebookService An instance of the NotebookService.
 */
export function registerNotebookIpcHandlers(notebookService: NotebookService): void {
    if (notebookHandlersRegistered) {
        logger.warn('[IPC:Notebook] Attempted to register notebook IPC handlers more than once. Skipping.');
        return;
    }
    logger.info('[IPC:Notebook] Registering notebook IPC handlers...');
    registerCreateNotebookHandler(notebookService);
    registerGetNotebookByIdHandler(notebookService);
    registerGetAllNotebooksHandler(notebookService);
    registerUpdateNotebookHandler(notebookService);
    registerDeleteNotebookHandler(notebookService);
    registerGetChunksForNotebookHandler(notebookService);
    registerGetRecentlyViewedHandler(notebookService);
    logger.info('[IPC:Notebook] Notebook IPC handlers registered.');
    notebookHandlersRegistered = true;
} 