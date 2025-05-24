import { Tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from '../../../utils/logger';
import { ExaService, ExaSearchOptions } from '../../ExaService';
import { HybridSearchService, HybridSearchResult } from '../../HybridSearchService';

// Define the input schema for the tool
const ExaSearchToolInputSchema = z.object({
  query: z.string().describe("The search query to find relevant information"),
  useHybrid: z.boolean().optional().default(true).describe("Whether to combine Exa results with local vector search"),
  numResults: z.number().optional().default(5).describe("Number of results to return"),
  type: z.enum(['keyword', 'neural', 'auto']).optional().default('neural').describe("Search type: neural for semantic, keyword for exact match"),
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

      if (input.useHybrid) {
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
          },
        });
        
        // Convert to HybridSearchResult format for consistent formatting
        const results: HybridSearchResult[] = exaResponse.results.map(result => ({
          id: result.id,
          title: result.title || 'Untitled',
          url: result.url,
          content: result.text || result.summary || '',
          score: result.score,
          source: 'exa' as const,
          publishedDate: result.publishedDate,
          author: result.author,
        }));
        
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
}