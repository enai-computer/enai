"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerNotebookIpcHandlers = registerNotebookIpcHandlers;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
let notebookHandlersRegistered = false;
// --- Create Notebook Handler ---
function registerCreateNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_CREATE, async (_event, params) => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_CREATE} with title: "${params?.title}", description: "${params?.description?.substring(0, 30)}..."`);
        try {
            if (!params || typeof params.title !== 'string' || params.title.trim() === '') {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_CREATE} failed: Invalid parameters. Title is required and cannot be empty.`);
                throw new Error('Invalid parameters for creating notebook. Title is required and cannot be empty.');
            }
            return await notebookService.createNotebook(params.title, params.description);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_CREATE} for title "${params?.title}":`, error);
            throw error;
        }
    });
}
// --- Get Notebook By ID Handler ---
function registerGetNotebookByIdHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_GET_BY_ID, async (_event, id) => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_GET_BY_ID} for ID: "${id}"`);
        try {
            if (typeof id !== 'string' || id.trim() === '') {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_GET_BY_ID} failed: Invalid ID provided.`);
                throw new Error('Invalid ID for getting notebook.');
            }
            return await notebookService.getNotebookById(id);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_GET_BY_ID} for ID "${id}":`, error);
            throw error;
        }
    });
}
// --- Get All Notebooks Handler ---
function registerGetAllNotebooksHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_GET_ALL, async () => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_GET_ALL}`);
        try {
            return await notebookService.getAllNotebooks();
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_GET_ALL}:`, error);
            throw error;
        }
    });
}
// --- Update Notebook Handler ---
function registerUpdateNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_UPDATE, async (_event, params) => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_UPDATE} for ID: "${params?.id}", data: ${JSON.stringify(params?.data)}`);
        try {
            if (!params || typeof params.id !== 'string' || params.id.trim() === '' || typeof params.data !== 'object') {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_UPDATE} failed for ID "${params?.id}": Invalid parameters.`);
                throw new Error('Invalid parameters for updating notebook.');
            }
            if (params.data.title !== undefined && (typeof params.data.title !== 'string' || params.data.title.trim() === '')) {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_UPDATE} failed for ID "${params?.id}": Title, if provided, cannot be empty.`);
                throw new Error('Invalid title for updating notebook. If provided, title cannot be empty.');
            }
            return await notebookService.updateNotebook(params.id, params.data);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_UPDATE} for ID "${params?.id}":`, error);
            throw error;
        }
    });
}
// --- Delete Notebook Handler ---
function registerDeleteNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_DELETE, async (_event, id) => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_DELETE} for ID: "${id}"`);
        try {
            if (typeof id !== 'string' || id.trim() === '') {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_DELETE} failed: Invalid ID provided.`);
                throw new Error('Invalid ID for deleting notebook.');
            }
            return await notebookService.deleteNotebook(id);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_DELETE} for ID "${id}":`, error);
            throw error;
        }
    });
}
// --- Get Chunks For Notebook Handler ---
function registerGetChunksForNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.NOTEBOOK_GET_CHUNKS, async (_event, notebookId) => {
        logger_1.logger.debug(`[IPC:Notebook] Handling ${ipcChannels_1.NOTEBOOK_GET_CHUNKS} for notebook ID: "${notebookId}"`);
        try {
            if (typeof notebookId !== 'string' || notebookId.trim() === '') {
                logger_1.logger.warn(`[IPC:Notebook] ${ipcChannels_1.NOTEBOOK_GET_CHUNKS} failed: Invalid notebook ID provided.`);
                throw new Error('Invalid notebook ID for getting chunks.');
            }
            return await notebookService.getChunksForNotebook(notebookId);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:Notebook] Error handling ${ipcChannels_1.NOTEBOOK_GET_CHUNKS} for notebook ID "${notebookId}":`, error);
            throw error;
        }
    });
}
/**
 * Registers all notebook related IPC handlers.
 * @param notebookService An instance of the NotebookService.
 */
function registerNotebookIpcHandlers(notebookService) {
    if (notebookHandlersRegistered) {
        logger_1.logger.warn('[IPC:Notebook] Attempted to register notebook IPC handlers more than once. Skipping.');
        return;
    }
    logger_1.logger.info('[IPC:Notebook] Registering notebook IPC handlers...');
    registerCreateNotebookHandler(notebookService);
    registerGetNotebookByIdHandler(notebookService);
    registerGetAllNotebooksHandler(notebookService);
    registerUpdateNotebookHandler(notebookService);
    registerDeleteNotebookHandler(notebookService);
    registerGetChunksForNotebookHandler(notebookService);
    logger_1.logger.info('[IPC:Notebook] Notebook IPC handlers registered.');
    notebookHandlersRegistered = true;
}
//# sourceMappingURL=notebookHandlers.js.map