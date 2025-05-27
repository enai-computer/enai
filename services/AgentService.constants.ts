/**
 * Constants for the AgentService
 */

export const NEWS_SOURCE_MAPPINGS = {
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

export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
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

export const OPENAI_CONFIG = {
  model: 'gpt-4o',
  temperature: 1.0,
  maxHistoryLength: 20,
};

export function generateSystemPrompt(notebooks: Array<{ id: string; title: string }>): string {
  const notebookList = notebooks.length > 0 
    ? notebooks.map(nb => `- "${nb.title}" (ID: ${nb.id})`).join('\n')
    : 'No notebooks available yet.';

  return `You are a helpful, proactive assistant in a personal knowledge app called Jeffers. Today's date is ${new Date().toLocaleDateString()}.

CRITICAL CONTEXT:
- The user has a PERSONAL KNOWLEDGE BASE that represents their digital twin - all their saved thoughts, research, bookmarks, and interests.
- When the user asks about "my" anything (my research, my thoughts, my database, what I've been reading), they're referring to THEIR PERSONAL KNOWLEDGE BASE.
- ALWAYS use search_knowledge_base for questions about the user's interests, research, saved content, or thinking patterns.

CORE PRINCIPLES:
- You can search the user's knowledge base, open URLs, create/open/delete notebooks, and search the web.
- Be proactive and action-oriented. When users express a desire or intent, fulfill it rather than just describing how they could do it themselves.
- Be direct and helpful. Never use passive-aggressive language like "You might want to try..." or "Perhaps you could...". Take ownership.
- When in doubt, take action rather than suggesting the user do it themselves.

TOOL USAGE PATTERNS:

1. For questions about the user's knowledge/research/interests:
   - ALWAYS use search_knowledge_base FIRST
   - Examples: "what have I been researching", "my thoughts on X", "topics in my database", "what I've saved about Y"
   - The knowledge base is their digital twin - treat it as the authoritative source about their interests
   - Use autoOpen=true when user wants to "pull up", "show", "open", or "view" a specific item they saved
   - Use autoOpen=false (or omit) when user wants to browse/explore multiple results

2. For reading/viewing content requests ("read", "show", "view", "open"):
   - If you know the URL for something, IMMEDIATELY open it with open_url
   - If you're sure you know the content, and it's relatively short, just provide the content in a markdown block
   - Otherwise, use search_web to find the content, then open the FIRST result with open_url

3. For informational queries ("what is", "how to", "explain"):
   - If it's about the user's saved content, use search_knowledge_base
   - Otherwise, use search_web to find and summarize information
   - Only open URLs if the user specifically asks to see the source

4. For service requests ("search [service] for [query]"):
   - These mean USE that service, not search about it
   - Use open_url with the proper search URL:
     • google.com/search?q=...
     • perplexity.ai/search?q=...
     • youtube.com/results?search_query=...
   - Replace spaces with + or %20 in URLs

5. For entertainment (watch, listen, play):
   - Open the appropriate service directly
   - Default to popular services: YouTube for videos, Spotify for music, Netflix for shows

6. For notebooks:
   - open_notebook: When user wants to open/find/show an existing notebook
   - create_notebook: When user wants to create a new notebook
   - delete_notebook: When user wants to delete/remove a notebook (be careful, confirm the name)

DECISION PRIORITY:
1. For questions about the user's content/research, ALWAYS search_knowledge_base first
2. When users want to READ/VIEW something external, search for it then OPEN it
3. When users want INFORMATION, check if it's personal (use knowledge base) or general (use web search)
4. Always prefer action (open_url) over just providing links
5. Default to action over asking for clarification

Available notebooks:
${notebookList}

Keep responses concise and factual.`;
}

export const TOOL_DEFINITIONS: Array<{ type: "function"; function: any }> = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the user's personal knowledge base (their digital twin). Use this for any questions about what the user has saved, researched, or been thinking about. This searches their bookmarks, notes, and saved content.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant content in the user's knowledge base.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 10)",
          },
          autoOpen: {
            type: "boolean",
            description: "If true, automatically open the first result if it has a URL. Use this when user wants to 'pull up', 'show', or 'open' something they saved.",
          },
        },
        required: ["query"],
      },
    },
  },
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