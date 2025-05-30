import { Tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from '../../../utils/logger';
import { ExaService, ExaSearchOptions } from '../../ExaService';
import { HybridSearchService } from '../../HybridSearchService';
import { HybridSearchResult } from '../../../shared/types';
import { cleanNewsContent, formatNewsResults } from '../../helpers/contentFilter';

// Define the input schema for the tool
const ExaSearchToolInputSchema = z.object({
  query: z.string().describe("The search query to find relevant information"),
  useHybrid: z.boolean().optional().default(true).describe("Whether to combine Exa results with local vector search"),
  numResults: z.number().optional().default(5).describe("Number of results to return"),
  type: z.enum(['keyword', 'neural', 'auto']).optional().default('neural').describe("Search type: neural for semantic, keyword for exact match"),
  searchType: z.enum(['general', 'news', 'headlines']).optional().default('general').describe("Type of search: general for any content, news for news articles, headlines for latest headlines"),
  dateRange: z.enum(['today', 'week', 'month']).optional().describe("For news searches: time range for results"),
  filterContent: z.boolean().optional().describe("Whether to filter out paywall and navigation content"),
  extractHighlights: z.boolean().optional().describe("Whether to extract key highlights from content"),
});

export type ExaSearchToolInput = z.infer<typeof ExaSearchToolInputSchema>;

/**
 * LangChain Tool for searching with Exa.ai.
 * This tool can perform standalone Exa searches or hybrid searches combining
 * Exa results with local vector database results via HybridSearchService.
 */
export class ExaSearchTool extends Tool {
  name = "exa_search";
  description = "Search the web using Exa.ai's neural search. Returns relevant web content with scores. Use this to find current information, articles, documentation, or any web content.";

  private exaService: ExaService;
  private hybridSearchService: HybridSearchService;

  constructor(exaService: ExaService, hybridSearchService: HybridSearchService) {
    super();
    this.exaService = exaService;
    this.hybridSearchService = hybridSearchService;
    logger.info('[ExaSearchTool] Initialized with ExaService and HybridSearchService');
  }

  async _call(input: ExaSearchToolInput): Promise<string> {
    try {
      logger.debug(`[ExaSearchTool] Called with input:`, input);
      
      if (!this.exaService.isConfigured()) {
        logger.warn('[ExaSearchTool] ExaService not configured, falling back to vector search only');
        // Fall back to vector search only
        const localResults = await this.hybridSearchService.searchLocal(input.query, input.numResults);
        return this.formatResults(localResults);
      }

      if (input.searchType === 'headlines') {
        // Get multi-category headlines
        logger.info(`[ExaSearchTool] Fetching headlines`);
        const categories = this.extractCategoriesFromQuery(input.query);
        const headlineResults = await this.hybridSearchService.getMultiCategoryHeadlines(
          categories,
          {
            numResults: input.numResults,
            dateRange: input.dateRange || 'today',
            filterContent: true,
            extractHighlights: true,
          }
        );
        return this.formatHeadlineResults(headlineResults);
      } else if (input.searchType === 'news') {
        // Perform news-specific search
        logger.info(`[ExaSearchTool] Performing news search for: "${input.query}"`);
        const results = await this.hybridSearchService.searchNews(input.query, {
          numResults: input.numResults,
          dateRange: input.dateRange || 'week',
          filterContent: true,
          extractHighlights: true,
        });
        return this.formatNewsResults(results);
      } else if (input.useHybrid) {
        // Perform hybrid search
        logger.info(`[ExaSearchTool] Performing hybrid search for: "${input.query}"`);
        const results = await this.hybridSearchService.search(input.query, {
          numResults: input.numResults,
          type: input.type as ExaSearchOptions['type'],
        });
        
        return this.formatResults(results);
      } else {
        // Perform Exa-only search
        logger.info(`[ExaSearchTool] Performing Exa-only search for: "${input.query}"`);
        const exaResponse = await this.exaService.search(input.query, {
          numResults: input.numResults,
          type: input.type as ExaSearchOptions['type'],
          contents: {
            text: true,
            summary: true,
            highlights: input.extractHighlights,
          },
        });
        
        // Convert to HybridSearchResult format for consistent formatting
        const results: HybridSearchResult[] = exaResponse.results.map(result => {
          let content = result.text || result.summary || '';
          
          // Apply content filtering if requested
          if (input.filterContent && content) {
            content = cleanNewsContent(content);
          }
          
          return {
            id: result.id,
            title: result.title || 'Untitled',
            url: result.url,
            content,
            score: result.score,
            source: 'exa' as const,
            publishedDate: result.publishedDate,
            author: result.author,
            highlights: result.highlights,
          };
        });
        
        return this.formatResults(results);
      }
    } catch (error) {
      logger.error('[ExaSearchTool] Error during search:', error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Formats search results into a readable string for the LLM.
   */
  private formatResults(results: HybridSearchResult[]): string {
    if (results.length === 0) {
      return "No search results found.";
    }

    const formatted = results.map((result, index) => {
      const source = result.source === 'exa' ? 'Web' : 'Local Knowledge';
      const date = result.publishedDate ? ` | Published: ${result.publishedDate}` : '';
      const author = result.author ? ` | Author: ${result.author}` : '';
      
      // Truncate content for readability
      const maxContentLength = 500;
      const content = result.content.length > maxContentLength
        ? result.content.substring(0, maxContentLength) + '...'
        : result.content;
      
      return `
[${index + 1}] ${result.title}
Source: ${source} | Score: ${result.score.toFixed(3)}${date}${author}
${result.url ? `URL: ${result.url}\n` : ''}${content}
`;
    }).join('\n---\n');

    return `Found ${results.length} search results:\n\n${formatted}`;
  }
  
  /**
   * Extracts news categories from a query.
   */
  private extractCategoriesFromQuery(query: string): string[] {
    const lowerQuery = query.toLowerCase();
    const allCategories = ['technology', 'business', 'politics', 'science', 'health', 'sports', 'entertainment'];
    
    const mentionedCategories = allCategories.filter(cat => lowerQuery.includes(cat));
    
    if (mentionedCategories.length > 0) {
      return mentionedCategories;
    }
    
    return ['general', 'technology', 'business', 'politics'];
  }
  
  /**
   * Formats headline results for presentation.
   */
  private formatHeadlineResults(headlinesByCategory: Record<string, HybridSearchResult[]>): string {
    let formatted = "Today's Top Headlines:\n\n";
    
    for (const [category, headlines] of Object.entries(headlinesByCategory)) {
      if (headlines.length === 0) continue;
      
      formatted += `### ${category.charAt(0).toUpperCase() + category.slice(1)} News\n\n`;
      
      headlines.forEach((headline, index) => {
        const date = headline.publishedDate ? new Date(headline.publishedDate).toLocaleDateString() : '';
        formatted += `${index + 1}. **${headline.title}**\n`;
        if (date) formatted += `   Date: ${date}\n`;
        if (headline.highlights && headline.highlights.length > 0) {
          formatted += `   • ${headline.highlights[0]}\n`;
        }
        if (headline.url) {
          formatted += `   URL: ${headline.url}\n`;
        }
        formatted += '\n';
      });
    }
    
    return formatted;
  }
  
  /**
   * Formats news search results with highlights.
   */
  private formatNewsResults(results: HybridSearchResult[]): string {
    if (results.length === 0) {
      return "No news articles found.";
    }
    
    const formatted = results.map((result, index) => {
      const source = result.source === 'exa' ? 'Web' : 'Local';
      const date = result.publishedDate ? ` | ${new Date(result.publishedDate).toLocaleDateString()}` : '';
      const author = result.author ? ` | By ${result.author}` : '';
      
      let text = `[${index + 1}] ${result.title}\n`;
      text += `Source: ${source} | Score: ${result.score.toFixed(3)}${date}${author}\n`;
      
      if (result.highlights && result.highlights.length > 0) {
        text += `Key points:\n`;
        result.highlights.forEach((highlight: string) => {
          text += `• ${highlight}\n`;
        });
      } else if (result.content) {
        const excerpt = result.content.substring(0, 200) + '...';
        text += `${excerpt}\n`;
      }
      
      if (result.url) {
        text += `URL: ${result.url}\n`;
      }
      
      return text;
    }).join('\n---\n\n');
    
    return `Found ${results.length} news articles:\n\n${formatted}`;
  }
}