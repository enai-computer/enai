import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';
import { HybridSearchResult } from '../../../shared/types';

export const searchWeb: AgentTool = {
  name: 'search_web',
  description: 'Search the web for information using Exa.ai\'s neural search and your local knowledge base',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query. For multiple news sources, include ALL sources in one query.'
      },
      searchType: {
        type: 'string',
        description: 'Type of search: \'general\' for any content, \'news\' for news articles, \'headlines\' for latest news headlines',
        default: 'general'
      },
      dateRange: {
        type: 'string',
        description: 'For news searches: \'today\' for today\'s news, \'week\' for past week, \'month\' for past month'
      }
    },
    required: ['query']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { query, searchType = 'general' } = args;
    if (!query) {
      return { content: "Error: Search query was unclear." };
    }
    
    logger.info(`[searchWeb] Searching: "${query}" (type: ${searchType})`);
    
    try {
      let results: HybridSearchResult[];
      
      if (searchType === 'headlines' || searchType === 'news') {
        results = await context.services.searchService.searchNews(query);
        // Aggregate search results
        context.services.searchService.accumulateSearchResults(results);
        // Check if this was a multi-source search
        const { sources } = context.services.searchService.detectNewsSources(query);
        const formatted = sources.length > 0
          ? context.formatter.formatMultiSourceNews(results, sources)
          : context.formatter.formatNewsResults(results);
        return { content: formatted };
      } else {
        results = await context.services.hybridSearchService.search(query, {
          numResults: 10
        });
        // Aggregate search results
        context.services.searchService.accumulateSearchResults(results);
      }
      
      const formatted = context.formatter.formatSearchResults(results);
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[searchWeb] Search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};