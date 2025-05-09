import { ipcMain } from 'electron';
import {
    CHAT_SESSION_CREATE_IN_NOTEBOOK,
    CHAT_SESSION_LIST_FOR_NOTEBOOK,
    CHAT_SESSION_TRANSFER_TO_NOTEBOOK
} from '../../shared/ipcChannels';
import { NotebookService } from '../../services/NotebookService';
import { logger } from '../../utils/logger';
import { IChatSession } from '../../shared/types';

let chatSessionHandlersRegistered = false;

// --- Create Chat Session In Notebook Handler ---
function registerCreateChatInNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(CHAT_SESSION_CREATE_IN_NOTEBOOK, async (_event, params: { notebookId: string, chatTitle?: string | null }): Promise<IChatSession> => {
        logger.debug(`[IPC:ChatSession] Handling ${CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID: "${params?.notebookId}", title: "${params?.chatTitle}"`);
        try {
            if (!params || typeof params.notebookId !== 'string' || params.notebookId.trim() === '') {
                logger.warn(`[IPC:ChatSession] ${CHAT_SESSION_CREATE_IN_NOTEBOOK} failed: Invalid notebook ID.`);
                throw new Error('Invalid parameters for creating chat session. Notebook ID is required and cannot be empty.');
            }
            // Title can be null or empty, so no specific validation for it beyond type, service layer handles default if needed.
            return await notebookService.createChatInNotebook(params.notebookId, params.chatTitle);
        } catch (error) {
            logger.error(`[IPC:ChatSession] Error handling ${CHAT_SESSION_CREATE_IN_NOTEBOOK} for notebook ID "${params?.notebookId}":`, error);
            throw error;
        }
    });
}

// --- List Chat Sessions For Notebook Handler ---
function registerListChatsForNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(CHAT_SESSION_LIST_FOR_NOTEBOOK, async (_event, notebookId: string): Promise<IChatSession[]> => {
        logger.debug(`[IPC:ChatSession] Handling ${CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID: "${notebookId}"`);
        try {
            if (typeof notebookId !== 'string' || notebookId.trim() === '') {
                logger.warn(`[IPC:ChatSession] ${CHAT_SESSION_LIST_FOR_NOTEBOOK} failed: Invalid notebook ID.`);
                throw new Error('Invalid notebook ID for listing chat sessions.');
            }
            return await notebookService.listChatsForNotebook(notebookId);
        } catch (error) {
            logger.error(`[IPC:ChatSession] Error handling ${CHAT_SESSION_LIST_FOR_NOTEBOOK} for notebook ID "${notebookId}":`, error);
            throw error;
        }
    });
}

// --- Transfer Chat Session To Notebook Handler ---
function registerTransferChatToNotebookHandler(notebookService: NotebookService) {
    ipcMain.handle(CHAT_SESSION_TRANSFER_TO_NOTEBOOK, async (_event, params: { sessionId: string, newNotebookId: string }): Promise<boolean> => {
        logger.debug(`[IPC:ChatSession] Handling ${CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID: "${params?.sessionId}" to notebook ID: "${params?.newNotebookId}"`);
        try {
            if (!params || 
                typeof params.sessionId !== 'string' || params.sessionId.trim() === '' || 
                typeof params.newNotebookId !== 'string' || params.newNotebookId.trim() === '') {
                logger.warn(`[IPC:ChatSession] ${CHAT_SESSION_TRANSFER_TO_NOTEBOOK} failed: Invalid parameters. Session ID and new Notebook ID are required and cannot be empty.`);
                throw new Error('Invalid parameters for transferring chat session. Session ID and new Notebook ID are required and cannot be empty.');
            }
            return await notebookService.transferChatToNotebook(params.sessionId, params.newNotebookId);
        } catch (error) {
            logger.error(`[IPC:ChatSession] Error handling ${CHAT_SESSION_TRANSFER_TO_NOTEBOOK} for session ID "${params?.sessionId}":`, error);
            throw error;
        }
    });
}

/**
 * Registers all chat session related IPC handlers (those linked to notebooks).
 * @param notebookService An instance of the NotebookService.
 */
export function registerChatSessionIpcHandlers(notebookService: NotebookService): void {
    if (chatSessionHandlersRegistered) {
        logger.warn('[IPC:ChatSession] Attempted to register chat session IPC handlers more than once. Skipping.');
        return;
    }
    logger.info('[IPC:ChatSession] Registering chat session IPC handlers (for notebooks)...');
    registerCreateChatInNotebookHandler(notebookService);
    registerListChatsForNotebookHandler(notebookService);
    registerTransferChatToNotebookHandler(notebookService);
    logger.info('[IPC:ChatSession] Chat session IPC handlers (for notebooks) registered.');
    chatSessionHandlersRegistered = true;
} 