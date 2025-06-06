import { WebContents } from 'electron';
import { NotebookService } from './NotebookService';
import { AgentService } from './AgentService';
import { ActionSuggestionService } from './ActionSuggestionService';
import { getActivityLogService } from './ActivityLogService';
import { SetIntentPayload, IntentResultPayload, NotebookRecord, OpenInClassicBrowserPayload } from '../shared/types';
import { ON_INTENT_RESULT, ON_SUGGESTED_ACTIONS } from '../shared/ipcChannels';
import { logger } from '../utils/logger';
import { performanceTracker } from '../utils/performanceTracker';
import { v4 as uuidv4 } from 'uuid';

// Define the structure for our pattern handlers
interface IntentPattern {
    regex: RegExp;
    handler: (match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService) => Promise<void>;
}

export class IntentService {
    // Keep services private and readonly
    private readonly notebookService: NotebookService;
    private readonly agentService: AgentService;
    private actionSuggestionService?: ActionSuggestionService;

    // Define patterns centrally
    private readonly patterns: IntentPattern[];

    constructor(notebookService: NotebookService, agentService: AgentService) {
        this.notebookService = notebookService;
        this.agentService = agentService;
        logger.info('[IntentService] Initialized');

        // Initialize patterns here
        this.patterns = [
            {
                // Handles "search perplexity for X" or "search perplexity X" commands
                regex: /^search\s+perplexity(?:\s+for)?\s+(.+)$/i,
                handler: this.handlePerplexitySearch.bind(this),
            },
            {
                // Handles "search google for X" or "search google X" commands
                regex: /^search\s+google(?:\s+for)?\s+(.+)$/i,
                handler: this.handleGoogleSearch.bind(this),
            },
            {
                // Handles "search for X" or "search X" commands (defaults to Perplexity)
                regex: /^search(?:\s+for)?\s+(.+)$/i,
                handler: this.handleSearch.bind(this),
            },
            {
                // Handles "create notebook <title>" and "new notebook <title>"
                // Made the space and capture group optional to handle "create notebook" (no title)
                regex: /^(?:create|new) notebook(?: (.*))?$/i, 
                handler: this.handleCreateNotebook.bind(this),
            },
            {
                // Handles "open notebook <name>", "find notebook <name>", "show notebook <name>"
                // Made the space and capture group optional
                regex: /^(?:open|find|show) notebook(?: (.*))?$/i,
                handler: this.handleOpenOrFindNotebook.bind(this),
            },
            {
                // Handles "delete notebook <name>", "rm notebook <name>", and semantic variations
                // Matches: "delete notebook X", "delete my notebook about X", "remove the X notebook", etc.
                regex: /^(?:delete|remove|rm)\s+(?:my\s+)?(?:the\s+)?notebook(?:\s+(?:about|called|named|titled))?\s+(.+)$/i,
                handler: this.handleDeleteNotebook.bind(this),
            },
            {
                // Alternative delete pattern for "delete X notebook" word order
                regex: /^(?:delete|remove|rm)\s+(?:my\s+)?(?:the\s+)?(.+?)\s+notebook$/i,
                handler: this.handleDeleteNotebook.bind(this),
            },
            {
                // Handles URLs (http, https, or domain.tld)
                // This regex aims to be a reasonable balance, not 100% IETF spec compliant.
                // It looks for http(s):// or a pattern like domain.tld/path
                // and captures the full URL.
                regex: /^((?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:[\/\w\.\-%~?&=#]*)*)/i,
                handler: this.handleOpenUrl.bind(this),
            },
            // Add more patterns here later
        ];
    }

    /**
     * Set the ActionSuggestionService dependency (called by main.ts after all services are initialized)
     */
    setActionSuggestionService(service: ActionSuggestionService): void {
        this.actionSuggestionService = service;
        logger.info('[IntentService] ActionSuggestionService dependency set');
    }

    async handleIntent(payload: SetIntentPayload, sender: WebContents): Promise<void> {
        const intentText = payload.intentText.trim();
        const context = payload.context;
        const notebookId = payload.notebookId;
        const correlationId = uuidv4();
        
        logger.info(`[IntentService] Handling intent: "${intentText}" in context: ${context} from sender ID: ${sender.id}`);
        
        // Start performance tracking
        performanceTracker.startStream(correlationId, 'IntentService');
        performanceTracker.recordEvent(correlationId, 'IntentService', 'intent_start', {
            intentText: intentText.substring(0, 50),
            context,
            notebookId
        });

        // Start parallel suggestion generation if service is available and context is welcome
        let suggestionPromise: Promise<void> | null = null;
        if (this.actionSuggestionService && context === 'welcome') {
            suggestionPromise = this.generateAndSendSuggestions(intentText, sender);
        }

        // 1. Try matching explicit patterns
        for (const pattern of this.patterns) {
            const match = intentText.match(pattern.regex);
            if (match) {
                logger.info(`[IntentService] Intent matched pattern: ${pattern.regex}`);
                performanceTracker.recordEvent(correlationId, 'IntentService', 'pattern_matched', {
                    pattern: pattern.regex.toString()
                });
                
                // Execute the handler and return (intent handled)
                await pattern.handler(match, payload, sender, this);
                
                // Log the activity
                try {
                    await getActivityLogService().logActivity({
                        activityType: 'intent_selected',
                        details: {
                            intentText: intentText,
                            context: context,
                            notebookId: notebookId,
                            patternMatched: pattern.regex.toString()
                        }
                    });
                } catch (logError) {
                    logger.error('[IntentService] Failed to log activity:', logError);
                }
                
                performanceTracker.completeStream(correlationId, 'IntentService');
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
                    performanceTracker.recordEvent(correlationId, 'IntentService', 'notebook_matched', {
                        notebookId: foundNotebook.id
                    });
                    
                    const result: IntentResultPayload = { type: 'open_notebook', notebookId: foundNotebook.id, title: foundNotebook.title };
                    sender.send(ON_INTENT_RESULT, result);
                    
                    // Log the activity
                    try {
                        await getActivityLogService().logActivity({
                            activityType: 'intent_selected',
                            details: {
                                intentText: intentText,
                                context: context,
                                notebookId: foundNotebook.id,
                                directNotebookMatch: true
                            }
                        });
                    } catch (logError) {
                        logger.error('[IntentService] Failed to log activity:', logError);
                    }
                    
                    performanceTracker.completeStream(correlationId, 'IntentService');
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
        performanceTracker.recordEvent(correlationId, 'IntentService', 'delegating_to_agent');
        
        try {
            // Use streaming version for better performance
            await this.agentService.processComplexIntentWithStreaming(
                payload, 
                String(sender.id), 
                sender,
                correlationId
            );
            
            // The streaming method handles all sending via IPC, so we just need to log and track
            logger.info(`[IntentService] AgentService is processing intent with streaming: "${intentText}"`);
            
            // Log the activity - note we don't know the result type with streaming
            try {
                await getActivityLogService().logActivity({
                    activityType: 'intent_selected',
                    details: {
                        intentText: intentText,
                        context: context,
                        notebookId: notebookId,
                        agentProcessed: true,
                        streaming: true
                    }
                });
            } catch (logError) {
                logger.error('[IntentService] Failed to log activity:', logError);
            }
            
            performanceTracker.completeStream(correlationId, 'IntentService');
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

    private async handleCreateNotebook(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
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

    private async handleOpenOrFindNotebook(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
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

     private async handleDeleteNotebook(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
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

    private async handleOpenUrl(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
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

        logger.info(`[IntentService] Handling "open URL". URL: "${url}" in context: ${payload.context}`);
        
        const message = `Opening ${url}...`;
        this.sendUrlResult(url, message, payload, sender);
    }

    private async handleSearch(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        // Default to Perplexity
        return this.handleSearchWithEngine(match, payload, sender, 'perplexity');
    }

    private async handlePerplexitySearch(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        return this.handleSearchWithEngine(match, payload, sender, 'perplexity');
    }

    private async handleGoogleSearch(match: RegExpMatchArray, payload: SetIntentPayload, sender: WebContents, service: IntentService): Promise<void> {
        return this.handleSearchWithEngine(match, payload, sender, 'google');
    }

    private async handleSearchWithEngine(
        match: RegExpMatchArray, 
        payload: SetIntentPayload, 
        sender: WebContents, 
        engine: 'perplexity' | 'google'
    ): Promise<void> {
        const query = match[1]?.trim();
        if (!query) {
            logger.warn(`[IntentService] Search command without query.`);
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Please provide a search query.' });
            return;
        }

        // Build search URL based on engine
        const searchUrl = engine === 'perplexity' 
            ? `https://www.perplexity.ai/search?q=${encodeURIComponent(query)}`
            : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        
        const engineName = engine === 'perplexity' ? 'Perplexity' : 'Google';
        
        logger.info(`[IntentService] Handling search with ${engineName}. Query: "${query}" in context: ${payload.context}`);
        
        const message = `Searching ${engineName} for "${query}"...`;
        this.sendUrlResult(searchUrl, message, payload, sender);
    }

    private sendUrlResult(url: string, message: string, payload: SetIntentPayload, sender: WebContents): void {
        // Check context to determine how to handle the URL
        if (payload.context === 'notebook' && payload.notebookId) {
            // In notebook context, send open_in_classic_browser result
            const result: OpenInClassicBrowserPayload = { 
                type: 'open_in_classic_browser', 
                url,
                notebookId: payload.notebookId,
                message
            };
            sender.send(ON_INTENT_RESULT, result);
            logger.info(`[IntentService] Sent 'open_in_classic_browser' result for URL: ${url} in notebook: ${payload.notebookId}`);
        } else if (payload.context === 'welcome') {
            // In welcome context, send open_url result (for WebLayer)
            const result: IntentResultPayload = { 
                type: 'open_url', 
                url,
                message
            };
            sender.send(ON_INTENT_RESULT, result);
            logger.info(`[IntentService] Sent 'open_url' result for URL: ${url}`);
        } else {
            // Unknown context
            logger.warn(`[IntentService] Unknown context: ${payload.context} for URL: ${url}`);
            sender.send(ON_INTENT_RESULT, { type: 'error', message: 'Invalid intent context.' });
        }
    }

    /**
     * Generate and send action suggestions based on the user's query
     */
    private async generateAndSendSuggestions(query: string, sender: WebContents): Promise<void> {
        try {
            logger.debug('[IntentService] Generating action suggestions for query:', query);
            
            if (!this.actionSuggestionService) {
                logger.warn('[IntentService] ActionSuggestionService not available for suggestion generation');
                return;
            }

            const suggestions = await this.actionSuggestionService.getSuggestions(query);
            
            if (suggestions.length > 0) {
                logger.info('[IntentService] Sending action suggestions:', { count: suggestions.length });
                sender.send(ON_SUGGESTED_ACTIONS, suggestions);
            } else {
                logger.debug('[IntentService] No action suggestions generated for query');
            }
        } catch (error) {
            logger.error('[IntentService] Error generating action suggestions:', error);
            // Don't send error to UI - suggestions are optional enhancement
        }
    }
} 