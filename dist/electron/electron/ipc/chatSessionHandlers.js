"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatSessionIpcHandlers = registerChatSessionIpcHandlers;
const electron_1 = require("electron");
const ipcChannels_1 = require("../../shared/ipcChannels");
const logger_1 = require("../../utils/logger");
let chatSessionHandlersRegistered = false;
// --- Create Chat Session In Notebook Handler ---
function registerCreateChatInNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK, async (_event, params) => {
        logger_1.logger.debug(`[IPC:ChatSession] Handling ${ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID: "${params?.notebookId}", title: "${params?.chatTitle}"`);
        try {
            if (!params || typeof params.notebookId !== 'string' || params.notebookId.trim() === '') {
                logger_1.logger.warn(`[IPC:ChatSession] ${ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK} failed: Invalid notebook ID.`);
                throw new Error('Invalid parameters for creating chat session. Notebook ID is required and cannot be empty.');
            }
            // Title can be null or empty, so no specific validation for it beyond type, service layer handles default if needed.
            return await notebookService.createChatInNotebook(params.notebookId, params.chatTitle);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:ChatSession] Error handling ${ipcChannels_1.CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID "${params?.notebookId}":`, error);
            throw error;
        }
    });
}
// --- List Chat Sessions For Notebook Handler ---
function registerListChatsForNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK, async (_event, notebookId) => {
        logger_1.logger.debug(`[IPC:ChatSession] Handling ${ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID: "${notebookId}"`);
        try {
            if (typeof notebookId !== 'string' || notebookId.trim() === '') {
                logger_1.logger.warn(`[IPC:ChatSession] ${ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK} failed: Invalid notebook ID.`);
                throw new Error('Invalid notebook ID for listing chat sessions.');
            }
            return await notebookService.listChatsForNotebook(notebookId);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:ChatSession] Error handling ${ipcChannels_1.CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID "${notebookId}":`, error);
            throw error;
        }
    });
}
// --- Transfer Chat Session To Notebook Handler ---
function registerTransferChatToNotebookHandler(notebookService) {
    electron_1.ipcMain.handle(ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK, async (_event, params) => {
        logger_1.logger.debug(`[IPC:ChatSession] Handling ${ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID: "${params?.sessionId}" to notebook ID: "${params?.newNotebookId}"`);
        try {
            if (!params ||
                typeof params.sessionId !== 'string' || params.sessionId.trim() === '' ||
                typeof params.newNotebookId !== 'string' || params.newNotebookId.trim() === '') {
                logger_1.logger.warn(`[IPC:ChatSession] ${ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK} failed: Invalid parameters. Session ID and new Notebook ID are required and cannot be empty.`);
                throw new Error('Invalid parameters for transferring chat session. Session ID and new Notebook ID are required and cannot be empty.');
            }
            return await notebookService.transferChatToNotebook(params.sessionId, params.newNotebookId);
        }
        catch (error) {
            logger_1.logger.error(`[IPC:ChatSession] Error handling ${ipcChannels_1.CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID "${params?.sessionId}":`, error);
            throw error;
        }
    });
}
/**
 * Registers all chat session related IPC handlers (those linked to notebooks).
 * @param notebookService An instance of the NotebookService.
 */
function registerChatSessionIpcHandlers(notebookService) {
    if (chatSessionHandlersRegistered) {
        logger_1.logger.warn('[IPC:ChatSession] Attempted to register chat session IPC handlers more than once. Skipping.');
        return;
    }
    logger_1.logger.info('[IPC:ChatSession] Registering chat session IPC handlers (for notebooks)...');
    registerCreateChatInNotebookHandler(notebookService);
    registerListChatsForNotebookHandler(notebookService);
    registerTransferChatToNotebookHandler(notebookService);
    logger_1.logger.info('[IPC:ChatSession] Chat session IPC handlers (for notebooks) registered.');
    chatSessionHandlersRegistered = true;
}
//# sourceMappingURL=chatSessionHandlers.js.map