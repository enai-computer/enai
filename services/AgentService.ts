import { logger } from '../utils/logger';
import { IntentPayload, IntentResultPayload, NotebookRecord, ReadabilityParsed } from '../shared/types';
import { NotebookService } from './NotebookService';
import { fetchPage } from '../ingestion/fetch/pageFetcher';
import { Worker } from 'worker_threads';
import path from 'path';

// Define interfaces for OpenAI API request and response
interface OpenAIFunction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string; // JSON string
    };
  }[];
  tool_call_id?: string; // For tool role messages
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: { type: "function"; function: OpenAIFunction }[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature: number;
}

interface OpenAIResponse {
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call"; // function_call is older, tool_calls is newer
  }[];
  error?: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export class AgentService {
    private readonly notebookService: NotebookService;
    private readonly openAIKey: string | undefined;
    private readonly conversationHistory: Map<number, OpenAIMessage[]> = new Map();
    private readonly MAX_HISTORY_LENGTH = 20; // Keep last 20 messages (10 exchanges)

    constructor(notebookService: NotebookService) {
        this.notebookService = notebookService;
        this.openAIKey = process.env.OPENAI_API_KEY;
        if (!this.openAIKey) {
            logger.warn('[AgentService] OPENAI_API_KEY not found in environment variables. AgentService will not be able to process complex intents via OpenAI.');
        }
        logger.info('[AgentService] Initialized');
    }

    async processComplexIntent(payload: IntentPayload, senderId: number): Promise<IntentResultPayload> {
        logger.info(`[AgentService] Processing complex intent: "${payload.intentText}" from sender ${senderId}`);

        if (!this.openAIKey) {
            logger.error('[AgentService] Cannot process intent: OPENAI_API_KEY is missing.');
            return { type: 'error', message: 'Agent service is not configured (missing API key).' };
        }

        const systemPrompt = `You are a helpful, proactive assistant in a personal knowledge app called Jeffers. You have a deep understanding of the user's needs and goals, and you are able to anticipate their requests and provide helpful, relevant information. If you don't know something, you ALWAYS respond with a question to find and answer and solution. You also have a background in mindfulness and meditation practices, and studied attention deeply.

IMPORTANT: When users ask for information, your primary goal is to provide direct, helpful answers. You have the ability to search the web and retrieve content to answer questions. Follow this priority order:

1. If you can answer from your knowledge, do so directly
2. If you need current/specific information, use search_web to find and provide the answer
3. Use open_url when:
   - The user explicitly asks to browse/visit a website
   - The content is interactive and requires user interaction (streaming, shopping, banking, etc.)
   - The search_web function fails to retrieve useful information
   - Action verbs like "watch", "stream", "listen", "play", "shop", "buy", "order" suggest interactive intent
4. Only use a perplexity search if it really seems like the user is asking for a search.

The user may ask to open or create notes (which are called "notebooks"), navigate to a specific website, or ask general questions.

For entertainment requests like "watch [show/movie]", "listen to [music/podcast]", "play [game/video]":
- These are requests to USE a service, not learn about it
- Open the appropriate streaming/entertainment service (Netflix, HBO Max, YouTube, Spotify, etc.)
- For YouTube: Use search URLs like "youtube.com/results?search_query=..." with URL-encoded queries (spaces as %20 or +)
- If you're not sure which service has the content, you can ask or open the most likely one
- Examples: 
  - "watch white lotus" → open HBO Max
  - "watch jony ive stripe video" → open youtube.com/results?search_query=jony+ive+stripe
  - "listen to taylor swift" → open Spotify
- Default to popular services if unsure: Netflix for TV/movies, YouTube for videos, Spotify for music

For informational requests like "read me a daily reflection", "what's the weather", "tell me about X":
- Use search_web to fetch the information and provide it directly
- Don't just send them to a search engine - that's a failure to be helpful

If the user's request clearly sounds like an action to interact with a notebook (e.g., opening, creating, finding, showing a notebook), respond with a function call to open or create a notebook.

Available notebooks:
${(await this.notebookService.getAllNotebooks()).map(nb => `- "${nb.title}" (ID: ${nb.id})`).join('\\n') || 'No notebooks available yet.'}
Today's date is ${new Date().toLocaleDateString()}.
Keep responses concise and factual.`;

        const tools: { type: "function"; function: OpenAIFunction }[] = [
            {
                type: "function",
                function: {
                    name: "open_notebook",
                    description: "Opens an existing notebook. Use if the user explicitly asks to open, find, or show a specific notebook.",
                    parameters: {
                        type: "object",
                        properties: {
                            notebook_name: {
                                type: "string",
                                description: "The exact name or title of the notebook to open.",
                            },
                        },
                        required: ["notebook_name"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "create_notebook",
                    description: "Creates a new notebook. Use if the user explicitly asks to create or make a new notebook.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: {
                                type: "string",
                                description: "The title for the new notebook.",
                            },
                        },
                        required: ["title"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "search_web",
                    description: "Search the web for information and retrieve content directly. Use this to answer questions that require current information or specific facts from the web. This fetches and reads web pages to provide direct answers.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query to find relevant information.",
                            },
                        },
                        required: ["query"],
                    },
                },
            },
            {
                type: "function",
                function: {
                    name: "open_url",
                    description: "Opens a URL in the WebLayer browser overlay for the user to interact with. Use this when the user wants to browse a website, not when you need to fetch information to answer a question. This is for interactive browsing, not for retrieving information.",
                    parameters: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "The URL to open in the browser. Protocol (https://) will be added automatically if missing.",
                            },
                        },
                        required: ["url"],
                    },
                },
            },
        ];

        // Get or initialize conversation history for this sender
        let messages = this.conversationHistory.get(senderId) || [];
        
        // Add system prompt if this is a new conversation
        if (messages.length === 0) {
            messages.push({ role: "system", content: systemPrompt });
        }
        
        // Add the current user message
        messages.push({ role: "user", content: payload.intentText });

        try {
            const requestBody: OpenAIRequest = {
                model: "gpt-4o", // Using gpt-4o as discussed
                messages,
                tools,
                tool_choice: "auto",
                temperature: 1.0,
            };
            
            logger.debug('[AgentService] OpenAI Request Body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.openAIKey}`,
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const errorData = await response.json();
                logger.error(`[AgentService] OpenAI API error: ${response.status} ${response.statusText}`, errorData);
                return { type: 'error', message: `OpenAI API Error: ${errorData?.error?.message || response.statusText}` };
            }

            const responseData = await response.json() as OpenAIResponse;
            logger.debug('[AgentService] OpenAI Response Body:', JSON.stringify(responseData, null, 2));


            const assistantMessage = responseData.choices?.[0]?.message;
            
            // Store the assistant's response in conversation history
            if (assistantMessage) {
                messages.push(assistantMessage);
                
                // Trim history if it's getting too long
                if (messages.length > this.MAX_HISTORY_LENGTH) {
                    // Keep system message and trim old messages
                    messages = [messages[0], ...messages.slice(-this.MAX_HISTORY_LENGTH + 1)];
                }
                
                // Update the stored conversation history
                this.conversationHistory.set(senderId, messages);
            }

            if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
                const toolCall = assistantMessage.tool_calls[0];
                const functionName = toolCall.function.name;
                let args: any;
                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch (parseError) {
                    logger.error(`[AgentService] Failed to parse JSON arguments for tool call ${functionName}:`, toolCall.function.arguments, parseError);
                    return { type: 'error', message: `AI returned an invalid action format for ${functionName}. Please try again.` };
                }

                logger.info(`[AgentService] OpenAI responded with tool call: ${functionName}`, args);
                
                // We need to add a tool response message to the conversation history
                let toolResponseContent = "";

                if (functionName === "open_notebook") {
                    const notebookName = args.notebook_name;
                    if (!notebookName || typeof notebookName !== 'string') {
                        toolResponseContent = "Error: Notebook name was unclear.";
                    } else {
                        const notebooks = await this.notebookService.getAllNotebooks();
                        const foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === notebookName.toLowerCase());
                        if (foundNotebook) {
                            logger.info(`[AgentService] Found notebook "${notebookName}" (ID: ${foundNotebook.id}). Returning open_notebook action.`);
                            toolResponseContent = `Opened notebook: ${foundNotebook.title}`;
                            
                            // Add the tool response message to conversation history
                            const toolResponseMessage: OpenAIMessage = {
                                role: "tool",
                                content: toolResponseContent,
                                tool_call_id: toolCall.id
                            };
                            messages.push(toolResponseMessage);
                            
                            // Update stored conversation history
                            this.conversationHistory.set(senderId, messages);
                            
                            return { 
                                type: 'open_notebook', 
                                notebookId: foundNotebook.id, 
                                title: foundNotebook.title,
                                message: `Right on, I'll open "${foundNotebook.title}" for you.`
                            };
                        } else {
                            logger.warn(`[AgentService] Notebook "${notebookName}" not found by tool call.`);
                            toolResponseContent = `Notebook "${notebookName}" not found.`;
                        }
                    }
                } else if (functionName === "create_notebook") {
                    const title = args.title;
                    if (!title || typeof title !== 'string') {
                        toolResponseContent = "Error: Notebook title was unclear.";
                    } else {
                        try {
                            const newNotebook = await this.notebookService.createNotebook(title);
                            logger.info(`[AgentService] Created new notebook "${title}" (ID: ${newNotebook.id}). Returning open_notebook action.`);
                            toolResponseContent = `Created and opened notebook: ${newNotebook.title}`;
                            
                            // Add the tool response message to conversation history
                            const toolResponseMessage: OpenAIMessage = {
                                role: "tool",
                                content: toolResponseContent,
                                tool_call_id: toolCall.id
                            };
                            messages.push(toolResponseMessage);
                            
                            // Update stored conversation history
                            this.conversationHistory.set(senderId, messages);
                            
                            return { 
                                type: 'open_notebook', 
                                notebookId: newNotebook.id, 
                                title: newNotebook.title,
                                message: `Right on, I've created "${newNotebook.title}" and I'll open it for you now.`
                            };
                        } catch (createError) {
                            logger.error(`[AgentService] Error creating notebook from tool call:`, createError);
                            toolResponseContent = `Failed to create notebook: ${createError instanceof Error ? createError.message : 'Unknown error'}`;
                        }
                    }
                } else if (functionName === "search_web") {
                    const query = args.query;
                    if (!query || typeof query !== 'string') {
                        toolResponseContent = "Error: Search query was unclear.";
                    } else {
                        logger.info(`[AgentService] Searching web for: "${query}"`);
                        
                        // Build search URL - using DuckDuckGo for simplicity
                        const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
                        
                        try {
                            // Fetch search results page
                            const searchContent = await this.fetchWebContent(searchUrl);
                            
                            if (searchContent) {
                                toolResponseContent = `Search results for "${query}":\n\n${searchContent}`;
                                
                                // Add the tool response message to conversation history
                                const toolResponseMessage: OpenAIMessage = {
                                    role: "tool",
                                    content: toolResponseContent,
                                    tool_call_id: toolCall.id
                                };
                                messages.push(toolResponseMessage);
                                
                                // Update stored conversation history
                                this.conversationHistory.set(senderId, messages);
                                
                                // Let the AI process the search results and formulate a response
                                // We'll make another API call with the search results
                                const followUpMessages = [...messages];
                                
                                const followUpRequest: OpenAIRequest = {
                                    model: "gpt-4o",
                                    messages: followUpMessages,
                                    temperature: 1.0,
                                };
                                
                                const followUpResponse = await fetch("https://api.openai.com/v1/chat/completions", {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Authorization": `Bearer ${this.openAIKey}`,
                                    },
                                    body: JSON.stringify(followUpRequest),
                                });
                                
                                if (followUpResponse.ok) {
                                    const followUpData = await followUpResponse.json() as OpenAIResponse;
                                    const followUpMessage = followUpData.choices?.[0]?.message;
                                    
                                    if (followUpMessage?.content) {
                                        // Add the follow-up response to history
                                        messages.push(followUpMessage);
                                        this.conversationHistory.set(senderId, messages);
                                        
                                        return { type: 'chat_reply', message: followUpMessage.content };
                                    }
                                }
                                
                                // Fallback if follow-up fails
                                return { type: 'chat_reply', message: `I found some information about "${query}", but had trouble processing it. You might want to try browsing directly.` };
                            } else {
                                toolResponseContent = `Could not retrieve search results for "${query}".`;
                                return { type: 'chat_reply', message: `I couldn't search for "${query}" at this time. Would you like me to open a search page for you to browse instead?` };
                            }
                        } catch (error) {
                            logger.error(`[AgentService] Error searching web for "${query}":`, error);
                            toolResponseContent = `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            return { type: 'chat_reply', message: `I encountered an error while searching. Would you like me to open a search page for you instead?` };
                        }
                    }
                } else if (functionName === "open_url") {
                    const url = args.url;
                    if (!url || typeof url !== 'string') {
                        toolResponseContent = "Error: URL was unclear.";
                    } else {
                        // Ensure the URL has a protocol
                        let formattedUrl = url.trim();
                        if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
                            formattedUrl = 'https://' + formattedUrl;
                        }
                        
                        logger.info(`[AgentService] Opening URL "${formattedUrl}" in WebLayer.`);
                        toolResponseContent = `Opened URL: ${formattedUrl}`;
                        
                        // Add the tool response message to conversation history
                        const toolResponseMessage: OpenAIMessage = {
                            role: "tool",
                            content: toolResponseContent,
                            tool_call_id: toolCall.id
                        };
                        messages.push(toolResponseMessage);
                        
                        // Update stored conversation history
                        this.conversationHistory.set(senderId, messages);
                        
                        return { 
                            type: 'open_url', 
                            url: formattedUrl,
                            message: `Right on, I'll open that for you.`
                        };
                    }
                } else {
                    logger.warn(`[AgentService] OpenAI responded with an unknown tool call: ${functionName}`);
                    toolResponseContent = `Unknown tool: ${functionName}`;
                }
                
                // If we haven't returned yet, add a generic tool response
                if (toolResponseContent && !messages.some(m => m.tool_call_id === toolCall.id)) {
                    const toolResponseMessage: OpenAIMessage = {
                        role: "tool",
                        content: toolResponseContent,
                        tool_call_id: toolCall.id
                    };
                    messages.push(toolResponseMessage);
                    
                    // Update stored conversation history
                    this.conversationHistory.set(senderId, messages);
                }
                
                // Return a chat reply for cases where the tool call didn't result in an action
                return { type: 'chat_reply', message: toolResponseContent };
            } else if (assistantMessage?.content) {
                logger.info(`[AgentService] OpenAI responded with text content.`);
                return { type: 'chat_reply', message: assistantMessage.content };
            } else {
                logger.warn('[AgentService] OpenAI response did not contain tool calls or content.', responseData);
                return { type: 'error', message: "Sorry, I received an unclear response from the AI. Please try again." };
            }

        } catch (error) {
            logger.error(`[AgentService] Error processing complex intent with OpenAI:`, error);
            return { type: 'error', message: `Sorry, I couldn't process that request: ${error instanceof Error ? error.message : 'Please try again'}` };
        }
    }
    
    /**
     * Clears the conversation history for a specific sender.
     * @param senderId The ID of the sender whose conversation to clear.
     */
    clearConversation(senderId: number): void {
        this.conversationHistory.delete(senderId);
        logger.info(`[AgentService] Cleared conversation history for sender ${senderId}`);
    }
    
    /**
     * Clears all conversation histories.
     */
    clearAllConversations(): void {
        this.conversationHistory.clear();
        logger.info(`[AgentService] Cleared all conversation histories`);
    }
    
    /**
     * Gets the conversation history size for monitoring purposes.
     * @returns The number of active conversations being tracked.
     */
    getActiveConversationCount(): number {
        return this.conversationHistory.size;
    }
    
    /**
     * Fetches and extracts text content from a web page.
     * @param url The URL to fetch and parse.
     * @returns The extracted text content or null if extraction fails.
     */
    private async fetchWebContent(url: string): Promise<string | null> {
        try {
            logger.info(`[AgentService] Fetching web content from: ${url}`);
            
            // Fetch the HTML
            const { html } = await fetchPage(url, { timeoutMs: 10000 });
            
            // Create a worker to parse with Readability
            const workerPath = path.join(__dirname, '../workers/readabilityWorker.js');
            const worker = new Worker(workerPath);
            
            const result = await new Promise<ReadabilityParsed | null>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    worker.terminate();
                    reject(new Error('Readability parsing timeout'));
                }, 5000);
                
                worker.on('message', (message: { result?: ReadabilityParsed; error?: string }) => {
                    clearTimeout(timeout);
                    if (message.error) {
                        reject(new Error(message.error));
                    } else {
                        resolve(message.result || null);
                    }
                });
                
                worker.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
                
                // Send HTML to worker
                worker.postMessage({ html, url });
            });
            
            await worker.terminate();
            
            if (result && result.textContent) {
                // Truncate to a reasonable length for the AI to process
                const maxLength = 4000;
                const content = result.textContent.length > maxLength 
                    ? result.textContent.substring(0, maxLength) + '...' 
                    : result.textContent;
                
                logger.info(`[AgentService] Successfully extracted ${content.length} characters from ${url}`);
                return `Title: ${result.title || 'Unknown'}\n\nContent:\n${content}`;
            }
            
            return null;
        } catch (error) {
            logger.error(`[AgentService] Error fetching web content from ${url}:`, error);
            return null;
        }
    }
} 