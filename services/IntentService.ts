import { WebContents } from 'electron';
import { NotebookService } from './NotebookService';
import { AgentService } from './AgentService';
import { IntentPayload, IntentResultPayload, NotebookRecord } from '../shared/types';
import { ON_INTENT_RESULT } from '../shared/ipcChannels';
import { logger } from '../utils/logger';

// Define the structure for our pattern handlers
interface IntentPattern {
    regex: RegExp;
    handler: (match: RegExpMatchArray, payload: IntentPayload, sender: WebContents, service: IntentService) => Promise<void>;
}

export class IntentService {
    // Keep services private and readonly
    private readonly notebookService: NotebookService;
    private readonly agentService: AgentService;

    // Define patterns centrally
    private readonly patterns: IntentPattern[];

    constructor(notebookService: NotebookService, agentService: AgentService) {
        this.notebookService = notebookService;
        this.agentService = agentService;
        logger.info('[IntentService] Initialized');

        // Initialize patterns here
        this.patterns = [
            {
                // Handles "create notebook <title>" and "new notebook <title>"
                // Made the space and capture group optional to handle "create notebook" (no title)
                regex: /^(?:create|new) notebook(?: (.*))?$/i, 
                handler: this.handleCreateNotebook,
            },
            {
                // Handles "open notebook <name>", "find notebook <name>", "show notebook <name>"
                // Made the space and capture group optional
                regex: /^(?:open|find|show) notebook(?: (.*))?$/i,
                handler: this.handleOpenOrFindNotebook,
            },
            {
                // Handles "delete notebook <name>", "rm notebook <name>", and semantic variations
                // Matches: "delete notebook X", "delete my notebook about X", "remove the X notebook", etc.
                regex: /^(?:delete|remove|rm)\s+(?:my\s+)?(?:the\s+)?notebook(?:\s+(?:about|called|named|titled))?\s+(.+)$/i,
                handler: this.handleDeleteNotebook,
            },
            {
                // Alternative delete pattern for "delete X notebook" word order
                regex: /^(?:delete|remove|rm)\s+(?:my\s+)?(?:the\s+)?(.+?)\s+notebook$/i,
                handler: this.handleDeleteNotebook,
            },
            {
                // Handles URLs (http, https, or domain.tld)
                // This regex aims to be a reasonable balance, not 100% IETF spec compliant.
                // It looks for http(s):// or a pattern like domain.tld/path
                // and captures the full URL.
                regex: /^((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[\/\w\.\-%~?&=#]*)*)/i,
                handler: this.handleOpenUrl,
            },
            // Add more patterns here later
        ];
    }

    async handleIntent(payload: IntentPayload, sender: WebContents): Promise<void> {
        const intentText = payload.intentText.trim();
        logger.info(`[IntentService] Handling intent: "${intentText}" from sender ID: ${sender.id}`);

        // 1. Try matching explicit patterns
        for (const pattern of this.patterns) {
            const match = intentText.match(pattern.regex);
            if (match) {
                logger.info(`[IntentService] Intent matched pattern: ${pattern.regex}`);
                // Execute the handler and return (intent handled)
                await pattern.handler(match, payload, sender, this); 
                return;
            }
        }

        // 2. Try direct notebook title match (fallback from explicit commands)
        if (intentText.length > 0) {
            logger.info(`[IntentService] Checking if intent "${intentText}" directly matches a notebook title.`);
            try {
                const notebooks = await this.notebookService.getAllNotebooks();
                const foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === intentText.toLowerCase());

                if (foundNotebook) {
                    logger.info(`[IntentService] Intent directly matched notebook ID: ${foundNotebook.id}. Opening.`);
                    const result: IntentResultPayload = { type: 'open_notebook', notebookId: foundNotebook.id, title: foundNotebook.title };
                    sender.send(ON_INTENT_RESULT, result);
                    return; // Notebook found and opened, intent handled.
                }
                logger.info(`[IntentService] Intent "${intentText}" did not directly match any notebook title.`);
            } catch (error) {
                logger.error(`[IntentService] Error during direct notebook title match for "${intentText}":`, error);
                // Don't send error to user yet, proceed to agent fallback
            }
        }

        // 3. Fallback to AgentService for complex/unmatched intents
        logger.info(`[IntentService] Intent "${intentText}" did not match known patterns or direct titles. Delegating to AgentService.`);
        try {
            // Pass sender.id as the senderId for conversation tracking
            const agentResult = await this.agentService.processComplexIntent(payload, String(sender.id));
            // Send the result from AgentService back to the renderer
            if (agentResult) { // Check if agentResult is not undefined
                sender.send(ON_INTENT_RESULT, agentResult); 
                logger.info(`[IntentService] AgentService processed intent: "${intentText}" and result was sent.`);
            } else {
                logger.warn(`[IntentService] AgentService processed intent: "${intentText}" but returned no result to send.`);
            }
        } catch (error) {
            logger.error(`[IntentService] Error delegating complex intent "${intentText}" to AgentService:`, error);
            const errorResult: IntentResultPayload = {
                type: 'error',
                message: `Error processing your request: ${error instanceof Error ? error.message : 'Agent failed'}`
            };
            sender.send(ON_INTENT_RESULT, errorResult);
        }
    }

    // --- Pattern Handler Methods ---

    private async handleCreateNotebook(match: RegExpMatchArray, payload: IntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        const title = match[1]?.trim();
        if (!title) {
            logger.warn('[IntentService] Create notebook command without title.');
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Please provide a title for the new notebook.' });
            return;
        }
        logger.info(`[IntentService] Handling "create/new notebook". Title: "${title}"`);
        try {
            const newNotebook = await service.notebookService.createNotebook(title);
            const result: IntentResultPayload = { type: 'open_notebook', notebookId: newNotebook.id, title: newNotebook.title };
            sender.send(ON_INTENT_RESULT, result);
            logger.info(`[IntentService] Sent 'open_notebook' result for new notebook ID: ${newNotebook.id}`);
        } catch (error) {
            logger.error(`[IntentService] Error creating notebook "${title}":`, error);
            sender.send(ON_INTENT_RESULT, { type: 'error', message: `Failed to create notebook: ${error instanceof Error ? error.message : 'Unknown error'}` });
        }
    }

    private async handleOpenOrFindNotebook(match: RegExpMatchArray, payload: IntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        const notebookName = match[1]?.trim();
         if (!notebookName) {
            logger.warn('[IntentService] Open/find notebook command without name.');
             // Maybe list notebooks or ask for name? For now, error.
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Please specify which notebook to open or find.' });
            return;
        }
        logger.info(`[IntentService] Handling "open/find/show notebook". Name: "${notebookName}"`);
        try {
            const notebooks = await service.notebookService.getAllNotebooks();
            // Case-insensitive search
            const foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === notebookName.toLowerCase());

            if (foundNotebook) {
                const result: IntentResultPayload = { type: 'open_notebook', notebookId: foundNotebook.id, title: foundNotebook.title };
                sender.send(ON_INTENT_RESULT, result);
                logger.info(`[IntentService] Found and sent 'open_notebook' result for notebook ID: ${foundNotebook.id}`);
            } else {
                // TODO: Implement fuzzy matching or "did you mean?" logic later
                const result: IntentResultPayload = { type: 'chat_reply', message: `Notebook "${notebookName}" not found.` };
                sender.send(ON_INTENT_RESULT, result);
                logger.info(`[IntentService] Notebook "${notebookName}" not found. Sent chat_reply.`);
            }
        } catch (error) {
            logger.error(`[IntentService] Error finding notebook "${notebookName}":`, error);
            sender.send(ON_INTENT_RESULT, { type: 'error', message: `Failed to find notebook: ${error instanceof Error ? error.message : 'Unknown error'}` });
        }
    }

     private async handleDeleteNotebook(match: RegExpMatchArray, payload: IntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        const notebookName = match[1]?.trim();
        if (!notebookName) {
            logger.warn('[IntentService] Delete notebook command without name.');
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Please specify which notebook to delete.' });
            return;
        }
        logger.info(`[IntentService] Handling "delete/rm notebook". Name: "${notebookName}"`);

        // --- Safety Rail ---
        // We should ideally ask for confirmation here before deleting.
        // For now, we proceed directly but log a warning.
        // Future: Emit an 'ask_confirmation' intent result.
        logger.warn(`[IntentService] Proceeding with deletion of "${notebookName}" without confirmation (TODO: Add confirmation step)`);

        let foundNotebook: NotebookRecord | undefined; // Declare here

        try {
            const notebooks = await service.notebookService.getAllNotebooks();
            
            // First try exact match (case-insensitive)
            foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === notebookName.toLowerCase());
            
            // If no exact match, try partial match
            if (!foundNotebook) {
                const searchTerms = notebookName.toLowerCase().split(/\s+/);
                foundNotebook = notebooks.find(nb => {
                    const title = nb.title.toLowerCase();
                    // Check if all search terms are present in the title
                    return searchTerms.every(term => title.includes(term));
                });
                
                // If still no match, try fuzzy match (any search term matches)
                if (!foundNotebook && searchTerms.length > 1) {
                    foundNotebook = notebooks.find(nb => {
                        const title = nb.title.toLowerCase();
                        // Check if any search term matches
                        return searchTerms.some(term => title.includes(term));
                    });
                }
            }

            if (!foundNotebook) {
                sender.send(ON_INTENT_RESULT, { type: 'chat_reply', message: `Notebook "${notebookName}" not found. Cannot delete.` });
                logger.info(`[IntentService] Notebook "${notebookName}" not found for deletion.`);
                return;
            }

            await service.notebookService.deleteNotebook(foundNotebook.id);
            const result: IntentResultPayload = { type: 'chat_reply', message: `Notebook "${foundNotebook.title}" has been deleted.` };
            // We might also want to send an event to close the notebook if it's open in the UI.
            // Example: { type: 'notebook_deleted', notebookId: foundNotebook.id }
            sender.send(ON_INTENT_RESULT, result);
            logger.info(`[IntentService] Deleted notebook ID: ${foundNotebook.id}. Sent chat_reply.`);

        } catch (error) {
            logger.error(`[IntentService] Error deleting notebook "${notebookName}" (ID: ${foundNotebook?.id}):`, error);
            sender.send(ON_INTENT_RESULT, { type: 'error', message: `Failed to delete notebook: ${error instanceof Error ? error.message : 'Unknown error'}` });
        }
    }

    private async handleOpenUrl(match: RegExpMatchArray, payload: IntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        let url = match[1]?.trim();
        if (!url) {
            // This case should ideally not be hit if the regex is well-formed and requires a match.
            logger.warn('[IntentService] URL pattern matched but no URL captured.');
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Could not parse URL from input.' });
            return;
        }

        // Ensure the URL has a scheme, default to http if missing for simple domain inputs like "example.com"
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            // Basic check to avoid prepending http:// to something that might be a command fragment
            // This is a simple heuristic; more robust scheme detection might be needed for edge cases.
            if (url.includes('.') && !url.includes(' ')) { // Contains a dot and no spaces, likely a domain
                 url = 'http://' + url;
            } else {
                // If it doesn't look like a typical domain (e.g., lacks a dot, or has spaces)
                // it might be a misidentified command. Log and potentially let it fall through or error.
                // For now, we'll consider it an error for this handler.
                logger.warn(`[IntentService] Input "${match[1]}" matched URL pattern but seems incomplete or not a URL after scheme check. Original: ${payload.intentText}`);
                // Let it fall through to AgentService by not sending a response and returning.
                // This allows AgentService to potentially interpret it differently.
                // However, since this handler was matched, it means other patterns didn't. If this isn't a URL,
                // then it's likely an unhandled command or a query for the agent.
                // For now, let's send an error if it doesn't become a valid URL.
                // Alternative: remove this handler from patterns and use a more specific regex, then let direct input fall to agent.
                // For this iteration, we will error if it doesn't get a scheme.
                sender.send(ON_INTENT_RESULT, { type: 'error', message: `Input "${match[1]}" looks like an incomplete URL.` });
                return;
            }
        }

        logger.info(`[IntentService] Handling "open URL". URL: "${url}"`);
        const result: IntentResultPayload = { type: 'open_url', url };
        sender.send(ON_INTENT_RESULT, result);
        logger.info(`[IntentService] Sent 'open_url' result for URL: ${url}`);
    }
} 