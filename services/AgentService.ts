import { logger } from '../utils/logger';
import { IntentPayload, IntentResultPayload, NotebookRecord } from '../shared/types';
import { NotebookService } from './NotebookService';

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

    constructor(notebookService: NotebookService) {
        this.notebookService = notebookService;
        this.openAIKey = process.env.OPENAI_API_KEY;
        if (!this.openAIKey) {
            logger.warn('[AgentService] OPENAI_API_KEY not found in environment variables. AgentService will not be able to process complex intents via OpenAI.');
        }
        logger.info('[AgentService] Initialized');
    }

    async processComplexIntent(payload: IntentPayload): Promise<IntentResultPayload> {
        logger.info(`[AgentService] Processing complex intent: "${payload.intentText}"`);

        if (!this.openAIKey) {
            logger.error('[AgentService] Cannot process intent: OPENAI_API_KEY is missing.');
            return { type: 'error', message: 'Agent service is not configured (missing API key).' };
        }

        const systemPrompt = `You are an assistant in a personal knowledge app called Jeffers.
The user may ask to open or create notes (which are called "notebooks") or ask general questions.
If the user's request clearly sounds like an action to interact with a notebook (e.g., opening, creating, finding, showing a notebook), respond with a function call.
If the request is a general question, a command that isn't about notebooks, or anything else, respond with a helpful and concise textual answer.
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
        ];

        const messages: OpenAIMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: payload.intentText },
        ];

        try {
            const requestBody: OpenAIRequest = {
                model: "gpt-4o", // Using gpt-4o as discussed
                messages,
                tools,
                tool_choice: "auto",
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

                if (functionName === "open_notebook") {
                    const notebookName = args.notebook_name;
                    if (!notebookName || typeof notebookName !== 'string') {
                        return { type: 'chat_reply', message: "I received a request to open a notebook, but the name was unclear. Please specify the notebook name." };
                    }
                    const notebooks = await this.notebookService.getAllNotebooks();
                    const foundNotebook = notebooks.find(nb => nb.title.toLowerCase() === notebookName.toLowerCase());
                    if (foundNotebook) {
                        logger.info(`[AgentService] Found notebook "${notebookName}" (ID: ${foundNotebook.id}). Returning open_notebook action.`);
                        return { type: 'open_notebook', notebookId: foundNotebook.id, title: foundNotebook.title };
                    } else {
                        logger.warn(`[AgentService] Notebook "${notebookName}" not found by tool call.`);
                        return { type: 'chat_reply', message: `I couldn't find a notebook named "${notebookName}". You can ask me to create it, or list available notebooks.` };
                    }
                } else if (functionName === "create_notebook") {
                    const title = args.title;
                    if (!title || typeof title !== 'string') {
                         return { type: 'chat_reply', message: "I received a request to create a notebook, but the title was unclear. Please specify a title." };
                    }
                    try {
                        const newNotebook = await this.notebookService.createNotebook(title);
                        logger.info(`[AgentService] Created new notebook "${title}" (ID: ${newNotebook.id}). Returning open_notebook action.`);
                        return { type: 'open_notebook', notebookId: newNotebook.id, title: newNotebook.title };
                    } catch (createError) {
                        logger.error(`[AgentService] Error creating notebook from tool call:`, createError);
                        return { type: 'error', message: `Failed to create notebook "${title}": ${createError instanceof Error ? createError.message : 'Unknown error'}` };
                    }
                } else {
                    logger.warn(`[AgentService] OpenAI responded with an unknown tool call: ${functionName}`);
                    return { type: 'chat_reply', message: `I received an instruction I don\'t understand yet: ${functionName}.` };
                }
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
} 