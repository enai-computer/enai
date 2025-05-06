import { WebContents } from 'electron';
import { NotebookService } from './NotebookService';
import { AgentService } from './AgentService';
import { IntentPayload, IntentResultPayload } from '../shared/types';
import { ON_INTENT_RESULT } from '../shared/ipcChannels';
import { logger } from '../utils/logger';

export class IntentService {
    private readonly notebookService: NotebookService;
    private readonly agentService: AgentService; // Will be used more later

    constructor(notebookService: NotebookService, agentService: AgentService) {
        this.notebookService = notebookService;
        this.agentService = agentService;
        logger.info('[IntentService] Initialized');
    }

    async handleIntent(payload: IntentPayload, sender: WebContents): Promise<void> {
        logger.info(`[IntentService] Handling intent: "${payload.intentText}" from sender ID: ${sender.id}`);

        const intentText = payload.intentText.trim();

        // Pattern for creating a notebook
        const createNotebookMatch = intentText.match(/^create notebook (.*)/i);
        if (createNotebookMatch && createNotebookMatch[1]) {
            const title = createNotebookMatch[1].trim();
            logger.info(`[IntentService] Matched "create notebook" intent. Title: "${title}"`);
            try {
                const newNotebook = await this.notebookService.createNotebook(title);
                const result: IntentResultPayload = { type: 'open_notebook', notebookId: newNotebook.id, title: newNotebook.title };
                sender.send(ON_INTENT_RESULT, result);
                logger.info(`[IntentService] Sent 'open_notebook' result for newly created notebook ID: ${newNotebook.id}`);
            } catch (error) {
                logger.error(`[IntentService] Error creating notebook "${title}":`, error);
                const errorResult: IntentResultPayload = { type: 'error', message: `Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
                sender.send(ON_INTENT_RESULT, errorResult);
            }
            return;
        }

        // Pattern for opening or finding a notebook
        const openOrFindNotebookMatch = intentText.match(/^(?:open|find|show) notebook (.*)/i);
        if (openOrFindNotebookMatch && openOrFindNotebookMatch[1]) {
            const notebookName = openOrFindNotebookMatch[1].trim();
            logger.info(`[IntentService] Matched "open/find notebook" intent. Name: "${notebookName}"`);
            try {
                const notebooks = await this.notebookService.getAllNotebooks();
                const foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === notebookName.toLowerCase());

                if (foundNotebook) {
                    const result: IntentResultPayload = { type: 'open_notebook', notebookId: foundNotebook.id, title: foundNotebook.title };
                    sender.send(ON_INTENT_RESULT, result);
                    logger.info(`[IntentService] Found and sent 'open_notebook' result for notebook ID: ${foundNotebook.id}`);
                } else {
                    const result: IntentResultPayload = { type: 'chat_reply', message: `Notebook "${notebookName}" not found.` };
                    sender.send(ON_INTENT_RESULT, result);
                    logger.info(`[IntentService] Notebook "${notebookName}" not found. Sent chat_reply.`);
                }
            } catch (error) {
                logger.error(`[IntentService] Error finding notebook "${notebookName}":`, error);
                const errorResult: IntentResultPayload = { type: 'error', message: `Failed to find notebook: ${error instanceof Error ? error.message : 'Unknown error'}` };
                sender.send(ON_INTENT_RESULT, errorResult);
            }
            return;
        }
        
        // Fallback for more complex intents (delegating to AgentService stub for now)
        logger.info(`[IntentService] Intent "${intentText}" did not match simple patterns. Delegating to AgentService.`);
        try {
            // For now, AgentService might return a simple chat reply or an error.
            // Later, it could return more structured results like 'plan_generated'.
            const agentResult = await this.agentService.processComplexIntent(payload);
            sender.send(ON_INTENT_RESULT, agentResult);
            logger.info(`[IntentService] Sent result from AgentService for intent: "${intentText}"`);
        } catch (error) {
            logger.error(`[IntentService] Error processing complex intent with AgentService for "${intentText}":`, error);
            const errorResult: IntentResultPayload = { 
                type: 'error', 
                message: `Error processing your request: ${error instanceof Error ? error.message : 'Agent failed'}` 
            };
            sender.send(ON_INTENT_RESULT, errorResult);
        }
    }
} 