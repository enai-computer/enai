import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';
import { NEWS_SOURCE_MAPPINGS } from '../../AgentService.constants';
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
        results = await searchNews(query, context);
        // Aggregate search results
        context.currentIntentSearchResults.push(...results);
        // Check if this was a multi-source search
        const sources = detectNewsSources(query);
        const formatted = sources.length > 0
          ? context.formatter.formatMultiSourceNews(results, sources)
          : context.formatter.formatNewsResults(results);
        return { content: formatted };
      } else {
        results = await context.services.hybridSearchService.search(query, {
          numResults: 10
        });
        // Aggregate search results
        context.currentIntentSearchResults.push(...results);
      }
      
      const formatted = context.formatter.formatSearchResults(results);
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[searchWeb] Search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};

async function searchNews(query: string, context: ToolContext): Promise<HybridSearchResult[]> {
  const sources = detectNewsSources(query);
  
  if (sources.length > 0) {
    // Multi-source search
    const cleanedQuery = removeSourcesFromQuery(query, sources);
    const results = await searchMultipleSources(sources, cleanedQuery, context);
    return results;
  }
  
  // General news search
  return await context.services.hybridSearchService.searchNews(query, {
    numResults: 10
  });
}

function detectNewsSources(query: string): string[] {
  const lower = query.toLowerCase();
  const detected: string[] = [];
  
  for (const [domain, aliases] of Object.entries(NEWS_SOURCE_MAPPINGS)) {
    if (aliases.some(alias => lower.includes(alias))) {
      detected.push(domain);
    }
  }
  
  return detected;
}

function removeSourcesFromQuery(query: string, sources: string[]): string {
  let cleaned = query;
  
  for (const source of sources) {
    const aliases = NEWS_SOURCE_MAPPINGS[source as keyof typeof NEWS_SOURCE_MAPPINGS] || [];
    for (const alias of aliases) {
      cleaned = cleaned.replace(new RegExp(alias, 'gi'), '');
    }
  }
  
  return cleaned
    .replace(/\b(and|from|in|the)\b/gi, ' ')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchMultipleSources(
  sources: string[], 
  cleanedQuery: string,
  context: ToolContext
): Promise<HybridSearchResult[]> {
  const { cleanNewsContent } = await import('../../helpers/contentFilter');
  
  const searchPromises = sources.map(async (source) => {
    try {
      const query = `site:${source} ${cleanedQuery || 'headlines'} today`;
      const response = await context.services.exaService.search(query, {
        type: 'neural',
        numResults: 3,
        includeDomains: [source],
        contents: { text: true, highlights: true, summary: true },
      });
      
      return response.results.map((result: any) => ({
        id: result.id,
        title: result.title,
        url: result.url,
        content: result.text ? cleanNewsContent(result.text) : result.summary || '',
        score: result.score,
        source: 'exa' as const,
        publishedDate: result.publishedDate,
        author: result.author,
        highlights: result.highlights,
      }));
    } catch (error) {
      logger.error(`[searchWeb] Failed to search ${source}:`, error);
      return [];
    }
  });
  
  const results = await Promise.all(searchPromises);
  return results.flat();
}