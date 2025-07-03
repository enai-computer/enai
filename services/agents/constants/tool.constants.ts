/**
 * Tool-related constants for the agent system
 */

/**
 * Tool definitions for OpenAI function calling
 * These are exposed as functions that the LLM can call
 */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "Search the local knowledge base for information",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for current information",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_notebook",
      description: "Open an existing notebook by ID",
      parameters: {
        type: "object",
        properties: {
          notebookId: {
            type: "string",
            description: "The ID of the notebook to open"
          }
        },
        required: ["notebookId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_notebook",
      description: "Create a new notebook with the given title and content",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the notebook"
          },
          content: {
            type: "string",
            description: "The initial content of the notebook"
          }
        },
        required: ["title", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_notebook",
      description: "Delete a notebook by ID",
      parameters: {
        type: "object",
        properties: {
          notebookId: {
            type: "string",
            description: "The ID of the notebook to delete"
          }
        },
        required: ["notebookId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description: "Open a URL in the browser",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to open"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_user_goals",
      description: "Update the user's goals based on their request",
      parameters: {
        type: "object",
        properties: {
          goals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "Description of the goal"
                },
                timeframe: {
                  type: "string",
                  description: "Optional timeframe for the goal (e.g., 'this week', 'by end of month')"
                }
              },
              required: ["description"]
            },
            description: "Array of goals to add or update"
          }
        },
        required: ["goals"]
      }
    }
  }
];

/**
 * Tool execution timeout in milliseconds
 */
export const TOOL_EXECUTION_TIMEOUT = 30000; // 30 seconds

/**
 * Maximum number of tool calls per request
 */
export const MAX_TOOL_CALLS_PER_REQUEST = 10;

/**
 * Tool categories for future extension (e.g., MCP integration)
 */
export enum ToolCategory {
  SEARCH = 'search',
  NOTEBOOK = 'notebook',
  NAVIGATION = 'navigation',
  PROFILE = 'profile',
  SYSTEM = 'system'
}

/**
 * Tool metadata for categorization and permissions
 */
export const TOOL_METADATA = {
  search_knowledge_base: {
    category: ToolCategory.SEARCH,
    requiresAuth: false,
    cacheable: true
  },
  search_web: {
    category: ToolCategory.SEARCH,
    requiresAuth: false,
    cacheable: true
  },
  open_notebook: {
    category: ToolCategory.NOTEBOOK,
    requiresAuth: false,
    cacheable: false
  },
  create_notebook: {
    category: ToolCategory.NOTEBOOK,
    requiresAuth: false,
    cacheable: false
  },
  delete_notebook: {
    category: ToolCategory.NOTEBOOK,
    requiresAuth: true,
    cacheable: false
  },
  open_url: {
    category: ToolCategory.NAVIGATION,
    requiresAuth: false,
    cacheable: false
  },
  update_user_goals: {
    category: ToolCategory.PROFILE,
    requiresAuth: false,
    cacheable: false
  }
};