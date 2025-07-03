import { BaseService } from '../base/BaseService';
import { HybridSearchService } from '../HybridSearchService';
import { ExaService } from '../ExaService';
import { SliceService } from '../SliceService';
import { DisplaySlice, HybridSearchResult } from '../../shared/types';
import { NEWS_SOURCE_MAPPINGS } from './constants/search.constants';

interface SearchServiceDeps {
  hybridSearchService: HybridSearchService;
  exaService: ExaService;
  sliceService: SliceService;
}

/**
 * SearchService handles search orchestration and result processing for the agent system.
 * It manages news source detection, search result aggregation, and conversion to display slices.
 */
export class SearchService extends BaseService<SearchServiceDeps> {
  private currentIntentSearchResults: HybridSearchResult[] = [];

  constructor(deps: SearchServiceDeps) {
    super('SearchService', deps);
  }

  /**
   * Clear accumulated search results for a new intent
   */
  clearSearchResults(): void {
    this.currentIntentSearchResults = [];
    this.logDebug('Cleared search results for new intent');
  }

  /**
   * Get current accumulated search results
   */
  getCurrentSearchResults(): HybridSearchResult[] {
    return this.currentIntentSearchResults;
  }

  /**
   * Add search results to the current intent accumulator
   */
  accumulateSearchResults(results: HybridSearchResult[]): void {
    this.currentIntentSearchResults.push(...results);
    this.logDebug(`Accumulated ${results.length} search results, total: ${this.currentIntentSearchResults.length}`);
  }

  /**
   * Search for news with automatic source detection
   */
  async searchNews(query: string): Promise<HybridSearchResult[]> {
    const sources = this.detectNewsSourcesInternal(query);
    
    if (sources.length > 0) {
      // Multi-source search
      const cleanedQuery = this.removeSourcesFromQuery(query, sources);
      const results = await this.searchMultipleSources(sources, cleanedQuery);
      return results;
    }
    
    // General news search
    return await this.deps.hybridSearchService.searchNews(query, {
      numResults: 10
    });
  }

  /**
   * Detect news sources from query (public method for testing)
   */
  detectNewsSources(query: string): { sources: string[]; cleanedQuery: string } {
    const sources = this.detectNewsSourcesInternal(query);
    const cleanedQuery = sources.length > 0 ? this.removeSourcesFromQuery(query, sources) : query;
    return { sources, cleanedQuery };
  }

  /**
   * Process accumulated search results into display slices
   */
  async processSearchResultsToSlices(results: HybridSearchResult[]): Promise<DisplaySlice[]> {
    return this.execute('processSearchResultsToSlices', async () => {
      this.logInfo(`Processing ${results.length} results into slices`);
      
      // Log the full results for debugging
      this.logDebug('Full search results:', results.map(r => ({
        source: r.source,
        chunkId: r.chunkId,
        objectId: r.objectId,
        title: r.title,
        url: r.url,
        hasContent: !!r.content,
        contentLength: r.content?.length || 0
      })));
      
      const displaySlices: DisplaySlice[] = [];
      const maxResults = 100; // Limit to prevent memory issues
      const limitedResults = results.slice(0, maxResults);
      
      try {
        // Separate local and web results
        const localResults = limitedResults.filter(r => r.source === 'local');
        const webResults = limitedResults.filter(r => r.source === 'exa');
        
        this.logInfo(`Processing ${localResults.length} local and ${webResults.length} web results`);
        
        // Process local results
        if (localResults.length > 0) {
          await this.processLocalResults(localResults, displaySlices);
        }
        
        // Process web results
        this.processWebResults(webResults, displaySlices);
        
        // Deduplicate results
        const finalSlices = this.deduplicateSlices(displaySlices);
        
        this.logInfo(`Returning ${finalSlices.length} display slices after deduplication`);
        return finalSlices;
      } catch (error) {
        this.logError('Error processing search results to slices:', error);
        return [];
      }
    });
  }

  private detectNewsSourcesInternal(query: string): string[] {
    const lower = query.toLowerCase();
    const detected: string[] = [];
    
    for (const [domain, aliases] of Object.entries(NEWS_SOURCE_MAPPINGS)) {
      if (aliases.some(alias => lower.includes(alias))) {
        detected.push(domain);
      }
    }
    
    return detected;
  }

  private removeSourcesFromQuery(query: string, sources: string[]): string {
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

  private async searchMultipleSources(
    sources: string[], 
    cleanedQuery: string
  ): Promise<HybridSearchResult[]> {
    const { cleanNewsContent } = await import('../helpers/contentFilter');
    
    const searchPromises = sources.map(async (source) => {
      try {
        const query = `site:${source} ${cleanedQuery || 'headlines'} today`;
        const response = await this.deps.exaService.search(query, {
          type: 'neural',
          numResults: 3,
          includeDomains: [source],
          contents: { text: true, highlights: true, summary: true },
        });
        
        return response.results.map(result => ({
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
        this.logError(`Failed to search ${source}:`, error);
        return [];
      }
    });
    
    const results = await Promise.all(searchPromises);
    return results.flat();
  }

  private async processLocalResults(
    localResults: HybridSearchResult[], 
    displaySlices: DisplaySlice[]
  ): Promise<void> {
    // Collect all chunk IDs from local results
    const rawChunkIds = localResults.map(r => r.chunkId);
    this.logDebug('Raw chunk IDs before filtering:', rawChunkIds);
    
    const chunkIds = localResults
      .map(r => r.chunkId)
      .filter((id): id is number => typeof id === 'number');
    
    this.logDebug('Chunk IDs after filtering:', chunkIds);
    
    if (chunkIds.length > 0) {
      this.logInfo(`Fetching details for ${chunkIds.length} chunks: ${chunkIds.join(', ')}`);
      try {
        // Batch fetch slice details
        const sliceDetails = await this.deps.sliceService.getDetailsForSlices(chunkIds);
        this.logInfo(`SliceService returned ${sliceDetails.length} slice details`);
        
        // Convert SliceDetail to DisplaySlice
        for (const detail of sliceDetails) {
          const displaySlice = {
            id: `local-${detail.chunkId}`,
            title: detail.sourceObjectTitle,
            sourceUri: detail.sourceObjectUri,
            content: detail.content,
            summary: detail.summary,
            sourceType: 'local' as const,
            chunkId: detail.chunkId,
            sourceObjectId: detail.sourceObjectId,
            score: localResults.find(r => r.chunkId === detail.chunkId)?.score
          };
          displaySlices.push(displaySlice);
        }
      } catch (error) {
        this.logError('Error fetching slice details:', error);
        // Fallback: create DisplaySlice from HybridSearchResult
        this.logDebug('Using fallback for local results');
        for (const result of localResults) {
          const fallbackSlice = {
            id: result.id,
            title: result.title,
            sourceUri: result.url || null,
            content: result.content.substring(0, 500), // Truncate for display
            summary: null, // Fallback doesn't have summary
            sourceType: 'local' as const,
            chunkId: result.chunkId,
            sourceObjectId: result.objectId,
            score: result.score
          };
          displaySlices.push(fallbackSlice);
        }
      }
    } else {
      this.logWarn('No valid chunk IDs found in local results');
    }
  }

  private processWebResults(
    webResults: HybridSearchResult[], 
    displaySlices: DisplaySlice[]
  ): void {
    for (const result of webResults) {
      const webSlice = {
        id: result.id,
        title: result.title,
        sourceUri: result.url || null,
        content: result.content.substring(0, 500), // Truncate for display
        summary: null, // Web results don't have summaries yet
        sourceType: 'web' as const,
        score: result.score,
        publishedDate: result.publishedDate,
        author: result.author
      };
      displaySlices.push(webSlice);
    }
  }

  private deduplicateSlices(displaySlices: DisplaySlice[]): DisplaySlice[] {
    this.logDebug(`Before deduplication: ${displaySlices.length} slices`);
    
    // Improved deduplication logic
    const seen = new Map<string, DisplaySlice>();
    for (const slice of displaySlices) {
      // For local content, use a composite key of sourceUri + chunkId to avoid over-deduplication
      let key: string;
      if (slice.sourceType === 'local' && slice.chunkId !== undefined) {
        // Use composite key for local chunks
        key = `${slice.sourceUri || 'local'}-chunk-${slice.chunkId}`;
        this.logDebug(`Local slice dedup key: "${key}" (sourceUri: "${slice.sourceUri}", chunkId: ${slice.chunkId})`);
      } else if (slice.sourceUri) {
        // For web content with URLs, use the URL
        key = slice.sourceUri;
        this.logDebug(`Web slice dedup key: "${key}" (using sourceUri)`);
      } else {
        // Fallback to ID
        key = slice.id;
        this.logDebug(`Fallback dedup key: "${key}" (using id, no sourceUri or chunkId)`);
      }
      
      if (!seen.has(key) || (seen.get(key)!.score || 0) < (slice.score || 0)) {
        seen.set(key, slice);
        this.logDebug(`Keeping slice with key: "${key}"`);
      } else {
        this.logDebug(`Removing duplicate with key: "${key}" (already have one with score ${seen.get(key)!.score || 0})`);
      }
    }
    
    return Array.from(seen.values());
  }
}