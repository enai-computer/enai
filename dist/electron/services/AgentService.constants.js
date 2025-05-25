"use strict";
/**
 * Constants for the AgentService
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DEFINITIONS = exports.OPENAI_CONFIG = exports.SOURCE_DISPLAY_NAMES = exports.NEWS_SOURCE_MAPPINGS = void 0;
exports.generateSystemPrompt = generateSystemPrompt;
exports.NEWS_SOURCE_MAPPINGS = {
    // Financial Times
    'ft.com': ['ft', 'financial times', 'the financial times', 'ft.com'],
    // Wall Street Journal
    'wsj.com': ['wsj', 'wall street journal', 'the wall street journal', 'wsj.com'],
    // New York Times
    'nytimes.com': ['nyt', 'ny times', 'new york times', 'the new york times', 'nytimes.com'],
    // Washington Post
    'washingtonpost.com': ['wapo', 'washington post', 'the washington post', 'washingtonpost.com'],
    // BBC
    'bbc.com': ['bbc', 'bbc news', 'bbc.com'],
    // CNN
    'cnn.com': ['cnn', 'cnn news', 'cnn.com'],
    // The Guardian
    'theguardian.com': ['guardian', 'the guardian', 'theguardian.com'],
    // Reuters
    'reuters.com': ['reuters', 'reuters news', 'reuters.com'],
    // Bloomberg
    'bloomberg.com': ['bloomberg', 'bloomberg news', 'bloomberg.com'],
    // The Economist
    'economist.com': ['economist', 'the economist', 'economist.com'],
};
exports.SOURCE_DISPLAY_NAMES = {
    'ft.com': 'Financial Times',
    'wsj.com': 'Wall Street Journal',
    'nytimes.com': 'New York Times',
    'washingtonpost.com': 'Washington Post',
    'bbc.com': 'BBC',
    'cnn.com': 'CNN',
    'reuters.com': 'Reuters',
    'bloomberg.com': 'Bloomberg',
    'theguardian.com': 'The Guardian',
    'economist.com': 'The Economist',
};
exports.OPENAI_CONFIG = {
    model: 'gpt-4o',
    temperature: 1.0,
    maxHistoryLength: 20,
};
function generateSystemPrompt(notebooks) {
    const notebookList = notebooks.length > 0
        ? notebooks.map(nb => `- "${nb.title}" (ID: ${nb.id})`).join('\n')
        : 'No notebooks available yet.';
    return `You are a helpful, proactive assistant in a personal knowledge app called Jeffers. Today's date is ${new Date().toLocaleDateString()}.

CORE PRINCIPLES:
- You can open URLs, create, open and delete notebooks, and search the web.
- Be proactive and action-oriented. When users express a desire or intent, fulfill it rather than just describing how they could do it themselves.
- Be direct and helpful. Never use passive-aggressive language like "You might want to try..." or "Perhaps you could...". Take ownership.
- When in doubt, take action rather than suggesting the user do it themselves.

TOOL USAGE PATTERNS:

1. For reading/viewing content requests ("read", "show", "view", "open"):
   - If you know the URL for something, IMMEDIATELY open it with open_url
   - If you're sure you know the content, and it's relatively short, just provide the content in a markdown block
   - Otherwise, use search_web to find the content, then open the FIRST result with open_url

2. For informational queries ("what is", "how to", "explain"):
   - Use search_web to find and summarize information
   - Only open URLs if the user specifically asks to see the source

3. For service requests ("search [service] for [query]"):
   - These mean USE that service, not search about it
   - Use open_url with the proper search URL:
     • google.com/search?q=...
     • perplexity.ai/search?q=...
     • youtube.com/results?search_query=...
   - Replace spaces with + or %20 in URLs

4. For entertainment (watch, listen, play):
   - Open the appropriate service directly
   - Default to popular services: YouTube for videos, Spotify for music, Netflix for shows

5. For notebooks:
   - open_notebook: When user wants to open/find/show an existing notebook
   - create_notebook: When user wants to create a new notebook
   - delete_notebook: When user wants to delete/remove a notebook (be careful, confirm the name)

DECISION PRIORITY:
1. When users want to READ/VIEW something, search for it then OPEN it
2. When users want INFORMATION, search and summarize
3. Always prefer action (open_url) over just providing links
4. Default to action over asking for clarification

Available notebooks:
${notebookList}

Keep responses concise and factual.`;
}
exports.TOOL_DEFINITIONS = [
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
            name: "delete_notebook",
            description: "Deletes an existing notebook. Use if the user explicitly asks to delete, remove, or get rid of a notebook. Always confirm the notebook name before deletion.",
            parameters: {
                type: "object",
                properties: {
                    notebook_name: {
                        type: "string",
                        description: "The exact name or title of the notebook to delete.",
                    },
                },
                required: ["notebook_name"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_web",
            description: "Search the web for information using Exa.ai's neural search and your local knowledge base.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query. For multiple news sources, include ALL sources in one query.",
                    },
                    searchType: {
                        type: "string",
                        description: "Type of search: 'general' for any content, 'news' for news articles, 'headlines' for latest news headlines",
                    },
                    dateRange: {
                        type: "string",
                        description: "For news searches: 'today' for today's news, 'week' for past week, 'month' for past month",
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
            description: "Opens a URL in the WebLayer browser overlay for the user to interact with.",
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
//# sourceMappingURL=AgentService.constants.js.map