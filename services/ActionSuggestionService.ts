import { SuggestedAction, UserProfile } from '../shared/types';
import { ProfileService } from './ProfileService';
import { NotebookService } from './NotebookService';
import { createChatModel } from '../utils/llm';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { BaseService } from './base/BaseService';
import { BaseServiceDependencies } from './interfaces';

// Schema for validating AI response
const suggestedActionsSchema = z.array(z.object({
  type: z.enum(['open_notebook', 'compose_notebook', 'search_web']),
  displayText: z.string(),
  payload: z.object({
    notebookId: z.string().optional(),
    notebookTitle: z.string().optional(),
    proposedTitle: z.string().optional(),
    sourceObjectIds: z.array(z.string()).optional(),
    searchQuery: z.string().optional(),
    searchEngine: z.enum(['perplexity', 'google']).optional()
  })
}));

interface ActionSuggestionServiceDeps extends BaseServiceDependencies {
  profileService: ProfileService;
  notebookService: NotebookService;
}

/**
 * Service responsible for generating contextual action suggestions based on user queries,
 * profile, and existing notebooks. Uses GPT-4.1-nano for fast, efficient suggestions.
 */
export class ActionSuggestionService extends BaseService<ActionSuggestionServiceDeps> {
  constructor(deps: ActionSuggestionServiceDeps) {
    super('ActionSuggestionService', deps);
  }

  /**
   * Generate suggested actions based on user query and context
   */
  async getSuggestions(query: string, userId: string = 'default_user'): Promise<SuggestedAction[]> {
    return this.execute('getSuggestions', async () => {
      this.logDebug('Getting suggestions for query:', { query, userId });
      
      // Fetch user context in parallel
      const [profile, notebooks] = await Promise.all([
        this.deps.profileService.getProfile(userId),
        this.deps.notebookService.getAllNotebooks()
      ]);

      // Build context for the prompt
      const notebookTitles = notebooks.map(n => ({
        id: n.id,
        title: n.title
      }));

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(query, profile, notebookTitles);

      // Create LLM context - use 'summarization' to select the nano model
      const context = {
        userId,
        taskType: 'summarization', // This selects the defaultVectorPrepModel (nano)
        priority: 'balanced_throughput'
      };

      // Using gpt-4.1-mini for fast, cheap UI suggestions
      const model = createChatModel('gpt-4.1-mini', {
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });
      
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ];
      
      const response = await model.invoke(messages);
      const responseContent = typeof response.content === 'string' ? response.content : '';

      // Parse and validate the response
      const suggestions = await this.parseAndValidateSuggestions(responseContent, notebookTitles);
      
      this.logInfo('Generated suggestions', { 
        query, 
        suggestionCount: suggestions.length 
      });
      
      return suggestions;
    }, { query, userId });
  }

  /**
   * Build the system prompt for the LLM
   */
  private buildSystemPrompt(): string {
    return `You are a helpful assistant that suggests relevant next actions based on user queries.
You must return a JSON object with a "suggestions" array (maximum 3 suggestions).

Each suggestion must be one of these types:
1. "open_notebook" - Suggest opening an existing notebook if highly relevant
2. "compose_notebook" - Suggest creating a new notebook on the topic
3. "search_web" - Suggest a web search for current information or external knowledge

Return ONLY valid JSON object with this exact structure:
{
  "suggestions": [
    {
      "type": "open_notebook",
      "displayText": "Open your Q1 Invoices notebook",
      "payload": {
        "notebookId": "550e8400-e29b-41d4-a716-446655440000",
        "notebookTitle": "Q1 Invoices"
      }
    },
    {
      "type": "compose_notebook", 
      "displayText": "Create new Tax Planning 2024 notebook",
      "payload": {
        "proposedTitle": "Tax Planning 2024"
      }
    },
    {
      "type": "search_web",
      "displayText": "Search for latest tax law changes",
      "payload": {
        "searchQuery": "2024 tax law changes",
        "searchEngine": "perplexity"
      }
    }
  ]
}

Guidelines:
- Only suggest opening a notebook if it's directly relevant to the query
- When suggesting open_notebook, use the EXACT notebook ID provided in the context
- Always use compose_notebook for creating new notebooks
- The notebook will start empty if no search results are available, or be populated with relevant content if they exist
- Suggest web search for current events, facts, or external information
- Make displayText natural and conversational
- Use "perplexity" for research queries, "google" for general searches
- Maximum 3 suggestions, prioritize most relevant actions`;
  }

  /**
   * Build the user prompt with context
   */
  private buildUserPrompt(
    query: string, 
    profile: UserProfile, 
    notebooks: Array<{ id: string; title: string }>
  ): string {
    const notebookList = notebooks.length > 0 
      ? notebooks.map(n => `- ${n.title} (id: ${n.id})`).join('\n')
      : 'No existing notebooks';

    const interests = profile.synthesizedInterests?.join(', ') || 'Not yet determined';
    const recentIntents = profile.synthesizedRecentIntents?.slice(0, 5).join(', ') || 'None';

    return `User Query: "${query}"

User Context:
- Interests: ${interests}
- Recent searches: ${recentIntents}

Existing Notebooks:
${notebookList}

Based on this query and context, suggest up to 3 relevant actions the user might want to take next.`;
  }

  /**
   * Parse and validate the LLM response
   */
  private async parseAndValidateSuggestions(
    llmResponse: string, 
    existingNotebooks: Array<{ id: string; title: string }>
  ): Promise<SuggestedAction[]> {
    try {
      // Parse the JSON object response
      const parsed = JSON.parse(llmResponse);
      
      // Extract the suggestions array
      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        throw new Error('No suggestions array found in response');
      }

      const validated = suggestedActionsSchema.parse(parsed.suggestions);

      // Validate and enrich suggestions
      const validSuggestions: SuggestedAction[] = [];

      for (const suggestion of validated) {
        if (suggestion.type === 'open_notebook') {
          // Trust the LLM's notebook ID selection
          if (suggestion.payload.notebookId) {
            const notebook = existingNotebooks.find(n => 
              n.id === suggestion.payload.notebookId
            );
            
            if (notebook) {
              validSuggestions.push({
                type: 'open_notebook',
                displayText: suggestion.displayText,
                payload: {
                  notebookId: notebook.id,
                  notebookTitle: notebook.title
                }
              });
            } else {
              // Log that LLM suggested non-existent notebook
              this.logWarn('LLM suggested non-existent notebook ID:', 
                suggestion.payload.notebookId
              );
            }
          }
        } else if (suggestion.type === 'compose_notebook') {
          // Ensure proposed title exists
          if (suggestion.payload.proposedTitle) {
            validSuggestions.push({
              type: 'compose_notebook',
              displayText: suggestion.displayText,
              payload: {
                proposedTitle: suggestion.payload.proposedTitle,
                sourceObjectIds: suggestion.payload.sourceObjectIds
              }
            });
          }
        } else if (suggestion.type === 'search_web') {
          // Ensure search query exists
          if (suggestion.payload.searchQuery) {
            validSuggestions.push({
              type: 'search_web',
              displayText: suggestion.displayText,
              payload: {
                searchQuery: suggestion.payload.searchQuery,
                searchEngine: suggestion.payload.searchEngine || 'perplexity'
              }
            });
          }
        }
      }

      return validSuggestions;
    } catch (error) {
      this.logError('Error parsing suggestions:', error);
      return [];
    }
  }
}