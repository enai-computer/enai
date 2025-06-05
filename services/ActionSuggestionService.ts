import { logger } from '../utils/logger';
import { SuggestedAction, UserProfile } from '../shared/types';
import { ProfileService } from './ProfileService';
import { NotebookService } from './NotebookService';
import { LLMService } from './LLMService';
import { ILLMContext } from '../shared/llm-types';
import { z } from 'zod';

// Schema for validating AI response
const suggestedActionsSchema = z.array(z.object({
  type: z.enum(['open_notebook', 'compose_notebook', 'search_web']),
  displayText: z.string(),
  payload: z.object({
    notebookId: z.string().optional(),
    notebookTitle: z.string().optional(),
    proposedTitle: z.string().optional(),
    searchQuery: z.string().optional(),
    searchEngine: z.enum(['perplexity', 'google']).optional()
  })
}));

/**
 * Service responsible for generating contextual action suggestions based on user queries,
 * profile, and existing notebooks. Uses GPT-4.1-nano for fast, efficient suggestions.
 */
export class ActionSuggestionService {
  private profileService: ProfileService;
  private notebookService: NotebookService;
  private llmService: LLMService;

  constructor(
    profileService: ProfileService,
    notebookService: NotebookService,
    llmService: LLMService
  ) {
    this.profileService = profileService;
    this.notebookService = notebookService;
    this.llmService = llmService;
    logger.info('[ActionSuggestionService] Initialized');
  }

  /**
   * Generate suggested actions based on user query and context
   */
  async getSuggestions(query: string, userId: string = 'default_user'): Promise<SuggestedAction[]> {
    logger.debug('[ActionSuggestionService] Getting suggestions for query:', { query, userId });
    
    try {
      // Fetch user context in parallel
      const [profile, notebooks] = await Promise.all([
        this.profileService.getProfile(userId),
        this.notebookService.getAllNotebooks()
      ]);

      // Build context for the prompt
      const notebookTitles = notebooks.map(n => ({
        id: n.id,
        title: n.title
      }));

      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(query, profile, notebookTitles);

      // Create LLM context - use 'summarization' to select the nano model
      const context: ILLMContext = {
        userId,
        taskType: 'summarization', // This selects the defaultVectorPrepModel (nano)
        priority: 'balanced_throughput'
      };

      // Call LLM with the nano model for speed
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await this.llmService.generateCompletion(fullPrompt, context, {
        maxTokens: 500,
        temperature: 0.7
      });

      // Parse and validate the response
      const suggestions = await this.parseAndValidateSuggestions(response, notebookTitles);
      
      logger.info('[ActionSuggestionService] Generated suggestions:', { 
        query, 
        suggestionCount: suggestions.length 
      });
      
      return suggestions;
    } catch (error) {
      logger.error('[ActionSuggestionService] Error generating suggestions:', error);
      return []; // Return empty array on error to not block the UI
    }
  }

  /**
   * Build the system prompt for the LLM
   */
  private buildSystemPrompt(): string {
    return `You are a helpful assistant that suggests relevant next actions based on user queries.
You must return a JSON array of suggested actions (maximum 3 suggestions).

Each suggestion must be one of these types:
1. "open_notebook" - Suggest opening an existing notebook if highly relevant
2. "compose_notebook" - Suggest creating a new notebook if the query is about a new topic
3. "search_web" - Suggest a web search for current information or external knowledge

Return ONLY valid JSON array with this exact structure:
[
  {
    "type": "open_notebook",
    "displayText": "Open your Q1 Invoices notebook",
    "payload": {
      "notebookId": "actual-id-here",
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

Guidelines:
- Only suggest opening a notebook if it's directly relevant to the query
- Prefer creating new notebooks for new topics or projects
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
      // Extract JSON from the response (handle cases where LLM adds extra text)
      const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = suggestedActionsSchema.parse(parsed);

      // Validate and enrich suggestions
      const validSuggestions: SuggestedAction[] = [];

      for (const suggestion of validated) {
        if (suggestion.type === 'open_notebook') {
          // Validate that the notebook exists and enrich with actual ID
          const notebookTitle = suggestion.payload.notebookTitle;
          const notebook = existingNotebooks.find(n => 
            n.title.toLowerCase().includes(notebookTitle?.toLowerCase() || '') ||
            notebookTitle?.toLowerCase().includes(n.title.toLowerCase())
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
          }
        } else if (suggestion.type === 'compose_notebook') {
          // Ensure proposed title exists
          if (suggestion.payload.proposedTitle) {
            validSuggestions.push({
              type: 'compose_notebook',
              displayText: suggestion.displayText,
              payload: {
                proposedTitle: suggestion.payload.proposedTitle
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
      logger.error('[ActionSuggestionService] Error parsing suggestions:', error);
      return [];
    }
  }
}