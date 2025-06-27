import { ExaService, ExaSearchOptions, ExaSearchResult, NewsSearchOptions } from './ExaService';
import { IVectorStoreModel, VectorRecord, VectorSearchResult, VectorSearchFilter } from '../shared/types/vector.types';
import { Document } from '@langchain/core/documents';
import { filterContent, extractHighlights } from './helpers/contentFilter';
import { HybridSearchResult } from '../shared/types';
import { BaseService } from './base/BaseService';
import { ExternalServiceError } from './base/ServiceError';
import { WOM_CONSTANTS } from './constants/womConstants';

// HybridSearchResult interface moved to shared/types.d.ts

export interface HybridSearchOptions extends ExaSearchOptions {
  localWeight?: number; // Weight for local results (0-1)
  exaWeight?: number; // Weight for Exa results (0-1)
  deduplicate?: boolean; // Whether to deduplicate similar results
  similarityThreshold?: number; // Threshold for considering results as duplicates
  filterContent?: boolean; // Whether to filter out paywall/navigation content
  useExa?: boolean; // Whether to use Exa search (default: true if configured)
  layers?: Array<'wom' | 'lom'>; // Which cognitive layers to search (default: ['wom', 'lom'])
}

export interface HybridNewsSearchOptions extends NewsSearchOptions {
  localWeight?: number;
  exaWeight?: number;
  deduplicate?: boolean;
  similarityThreshold?: number;
  filterContent?: boolean;
  extractHighlights?: boolean;
  highlightCount?: number;
  numResults?: number;
}

/**
 * Dependencies for HybridSearchService
 */
export interface HybridSearchServiceDeps {
  exaService: ExaService;
  vectorModel: IVectorStoreModel;
}

/**
 * Service that combines search results from Exa.ai and local vector database.
 * Provides unified search interface with result ranking and deduplication.
 */
export class HybridSearchService extends BaseService<HybridSearchServiceDeps> {
  /**
   * Overfetch multiplier for two-stage retrieval.
   * We fetch this many times more candidates than requested to enable better re-ranking.
   * Higher values (8-10x) improve recall for re-ranking but increase latency.
   * Lower values (3-5x) are faster but may miss relevant results.
   * 
   * Current value: 8x is optimized for aggressive candidate retrieval in preparation
   * for future two-stage retrieval with re-ranking.
   */
  private static readonly TWO_STAGE_OVERFETCH_MULTIPLIER = 8;

  constructor(deps: HybridSearchServiceDeps) {
    super('HybridSearchService', deps);
    this.logInfo('Initialized with ExaService and vector model');
  }

  /**
   * Performs a hybrid search combining Exa web results and local vector results.
   * @param query The search query
   * @param options Search options
   * @returns Combined and ranked search results
   */
  async search(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
    return this.execute('search', async () => {
      this.logInfo(`Performing hybrid search for: "${query}"`);
      
      const {
        numResults = 10,
        localWeight = 0.4,
        exaWeight = 0.6,
        deduplicate = true,
        similarityThreshold = 0.85,
        useExa = true,
        layers = ['wom', 'lom'],
        ...exaOptions
      } = options;

      // Validate weights
      if (localWeight + exaWeight !== 1.0) {
        this.logWarn(`Weights do not sum to 1.0, normalizing...`);
        const totalWeight = localWeight + exaWeight;
        const normalizedLocalWeight = localWeight / totalWeight;
        const normalizedExaWeight = exaWeight / totalWeight;
        options.localWeight = normalizedLocalWeight;
        options.exaWeight = normalizedExaWeight;
      }
      let combinedResults: HybridSearchResult[] = [];

        // Skip Exa if disabled
        if (!useExa) {
          this.logInfo('Skipping Exa search (useExa=false)');
          const localResults = await this.searchLocalWithLayers(query, numResults, layers);
          combinedResults.push(...localResults);
        } else {
          // Perform searches in parallel
          const [exaResults, localResults] = await Promise.allSettled([
            this.searchExa(query, { ...exaOptions, numResults }), // No overfetch at orchestrator level
            this.searchLocalWithLayers(query, numResults, layers), // Overfetch handled internally
          ]);

          // Process Exa results
          if (exaResults.status === 'fulfilled') {
            combinedResults.push(...exaResults.value);
          } else {
            this.logError('Exa search failed:', exaResults.reason);
          }

          // Process local results
          if (localResults.status === 'fulfilled') {
            combinedResults.push(...localResults.value);
          } else {
            this.logError('Local search failed:', localResults.reason);
          }
        }

      // Apply deduplication if enabled
      if (deduplicate) {
        combinedResults = this.deduplicateResults(combinedResults, similarityThreshold);
      }

      // Re-rank results based on weights
      combinedResults = this.rankResults(combinedResults, {
        localWeight: options.localWeight!,
        exaWeight: options.exaWeight!,
      });

        // Return top N results
        const finalResults = combinedResults.slice(0, numResults);
        
        this.logInfo(`Returning ${finalResults.length} results (${finalResults.filter(r => r.source === 'exa').length} from Exa, ${finalResults.filter(r => r.source === 'local').length} from local)`);
        
        return finalResults;
    }, { query, options });
  }

  /**
   * Searches only the Exa API.
   */
  private async searchExa(query: string, options: ExaSearchOptions): Promise<HybridSearchResult[]> {
    if (!this.deps.exaService.isConfigured()) {
      this.logDebug('ExaService not configured, skipping Exa search');
      return [];
    }

    try {
      const response = await this.deps.exaService.search(query, {
        ...options,
        contents: {
          text: true,
          summary: true,
        },
      });

      return response.results.map(result => this.exaResultToHybrid(result));
    } catch (error) {
      this.logError('Exa search error:', error);
      throw new ExternalServiceError('Exa', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Searches only the local vector database.
   */
  async searchLocal(query: string, numResults: number): Promise<HybridSearchResult[]> {
    if (!this.deps.vectorModel.isReady()) {
      this.logDebug('Vector model not ready, attempting initialization');
      try {
        await this.deps.vectorModel.initialize();
      } catch (error) {
        this.logError('Failed to initialize vector model:', error);
        return [];
      }
    }

    try {
      const results = await this.deps.vectorModel.querySimilarByText(query, { k: numResults });
      
      return results.map(result => this.documentToHybrid(result.record, result.score));
    } catch (error) {
      this.logError('Local search error:', error);
      throw error;
    }
  }

  /**
   * Searches local vector database with layer-aware deduplication.
   * Implements intelligent merging of WOM and LOM vectors for the same object.
   */
  private async searchLocalWithLayers(
    query: string, 
    numResults: number, 
    layers: Array<'wom' | 'lom'>
  ): Promise<HybridSearchResult[]> {
    if (!this.deps.vectorModel.isReady()) {
      this.logDebug('Vector model not ready, attempting initialization');
      try {
        await this.deps.vectorModel.initialize();
      } catch (error) {
        this.logError('Failed to initialize vector model:', error);
        return [];
      }
    }

    try {
      // 1. Vector search across specified layers
      const filter: VectorSearchFilter = {
        layer: layers
      };
      
      // Apply overfetch multiplier for two-stage retrieval
      // This ensures we have enough candidates after deduplication
      const candidatesToFetch = numResults * HybridSearchService.TWO_STAGE_OVERFETCH_MULTIPLIER;
      
      this.logDebug(`Fetching ${candidatesToFetch} candidates (${numResults} requested × ${HybridSearchService.TWO_STAGE_OVERFETCH_MULTIPLIER}x multiplier)`);
      
      const results = await this.deps.vectorModel.querySimilarByText(query, { 
        k: candidatesToFetch,
        filter 
      });

      // 2. Group by objectId
      const objectGroups = new Map<string, VectorSearchResult[]>();
      results.forEach(result => {
        const objectId = result.record.objectId;
        if (objectId) {
          if (!objectGroups.has(objectId)) {
            objectGroups.set(objectId, []);
          }
          objectGroups.get(objectId)!.push(result);
        }
      });

      // 3. Deduplicate with intelligent merging
      // Note: This is why we need high overfetch (8x) - many chunks may belong to the same object
      // After deduplication, we'll have far fewer unique objects than raw vector results
      const deduplicated = Array.from(objectGroups.entries()).map(([objectId, vectors]) => {
        const lomVector = vectors.find(v => v.record.layer === 'lom');
        const womVector = vectors.find(v => v.record.layer === 'wom');

        if (lomVector && womVector) {
          // Calculate WOM recency boost
          const lastAccessed = womVector.record.lastAccessedAt || womVector.record.createdAt;
          const weeksSinceAccess = (Date.now() - lastAccessed) / WOM_CONSTANTS.WEEK_MS;
          const decay = Math.exp(-WOM_CONSTANTS.DECAY_RATE * weeksSinceAccess);
          const recencyBoost = Math.max(decay, WOM_CONSTANTS.DECAY_MIN_SCORE);

          // Create hybrid result with LOM content and WOM recency boost
          const hybridResult = this.documentToHybrid(lomVector.record, lomVector.score);
          
          // Merge scores: prefer LOM content with WOM recency signal
          // Cap at 1.0 to maintain valid similarity score range
          hybridResult.score = Math.min(
            lomVector.score * (1 + recencyBoost * WOM_CONSTANTS.WOM_RECENCY_BOOST_FACTOR),
            1.0
          );
          
          // Add metadata to indicate this is an active document
          (hybridResult as any).isActive = true;
          (hybridResult as any).lastAccessed = new Date(lastAccessed).toISOString();
          
          return hybridResult;
        }

        // Return whichever vector we have (LOM preferred)
        const vector = lomVector || womVector!;
        return this.documentToHybrid(vector.record, vector.score);
      });

      // 4. Sort by score and limit
      this.logDebug(`Deduplication effect: ${results.length} vectors → ${deduplicated.length} unique objects`);
      
      return deduplicated
        .sort((a, b) => b.score - a.score)
        .slice(0, numResults);
        
    } catch (error) {
      this.logError('Local search with layers error:', error);
      throw error;
    }
  }

  /**
   * Performs a news-specific hybrid search with enhanced filtering.
   * @param query The search query
   * @param options News search options
   * @returns Combined and ranked news results
   */
  async searchNews(query: string, options: HybridNewsSearchOptions = {}): Promise<HybridSearchResult[]> {
    return this.execute('searchNews', async () => {
      this.logInfo(`Performing news search for: "${query}"`);
        // Use the news-specific search method
        const exaPromise = this.deps.exaService.isConfigured() 
          ? this.deps.exaService.searchNews(query, options)
          : Promise.resolve({ results: [] });
      
      // Perform searches in parallel
      const [exaResponse, localResults] = await Promise.allSettled([
        exaPromise,
        this.searchLocalWithLayers(query, options.numResults || 10, ['wom', 'lom']),
      ]);

      let results: HybridSearchResult[] = [];

      // Process Exa news results
      if (exaResponse.status === 'fulfilled' && exaResponse.value.results.length > 0) {
        const exaResults = exaResponse.value.results.map(result => {
          let content = result.text || result.summary || '';
          
          // Apply content filtering if enabled
          if (options.filterContent && content) {
            content = filterContent(content);
          }
          
          // Extract highlights if requested
          let highlights: string[] | undefined;
          if (options.extractHighlights) {
            if (result.highlights && result.highlights.length > 0) {
              highlights = result.highlights.slice(0, options.highlightCount);
            } else if (content) {
              highlights = extractHighlights(content, options.highlightCount);
            }
          }
          
          return {
            ...this.exaResultToHybrid(result),
            content,
            highlights,
          };
        });
        
        results.push(...exaResults);
      }

      // Process local results (these might include saved news articles)
      if (localResults.status === 'fulfilled') {
        results.push(...localResults.value);
      }

      // Apply deduplication if enabled
      if (options.deduplicate ?? true) {
        results = this.deduplicateResults(results, options.similarityThreshold || 0.85);
      }

      // Re-rank results
      results = this.rankResults(results, {
        localWeight: options.localWeight || 0.2, // Lower weight for local in news searches
        exaWeight: options.exaWeight || 0.8, // Higher weight for fresh news
      });

        // Return top results
        const numResults = options.numResults || 10;
        return results.slice(0, numResults);
    }, { query, options });
  }

  /**
   * Gets the latest headlines across multiple news categories.
   * @param categories Array of news categories to fetch
   * @param options Search options
   * @returns Headlines organized by category
   */
  async getMultiCategoryHeadlines(
    categories: string[] = ['general', 'technology', 'business', 'politics'],
    options: HybridNewsSearchOptions = {}
  ): Promise<Record<string, HybridSearchResult[]>> {
    return this.execute('getMultiCategoryHeadlines', async () => {
      this.logInfo(`Fetching headlines for categories: ${categories.join(', ')}`);
      
      const headlinesByCategory: Record<string, HybridSearchResult[]> = {};
      
      // Fetch headlines for each category in parallel
      const promises = categories.map(async category => {
        try {
          const results = await this.searchNews(
            `latest ${category} news headlines`,
            {
              ...options,
              numResults: options.numResults || 5, // Fewer per category
              dateRange: 'today',
            }
          );
          return { category, results };
        } catch (error) {
          this.logError(`Failed to fetch ${category} headlines:`, error);
          return { category, results: [] };
        }
      });
      
      const categoryResults = await Promise.all(promises);
      
      // Organize results by category
      for (const { category, results } of categoryResults) {
        headlinesByCategory[category] = results;
      }
      
      return headlinesByCategory;
    }, { categories });
  }

  /**
   * Converts an Exa search result to the hybrid format.
   */
  private exaResultToHybrid(result: ExaSearchResult): HybridSearchResult {
    return {
      id: result.id,
      title: result.title || 'Untitled',
      url: result.url,
      content: result.text || result.summary || '',
      score: result.score,
      source: 'exa',
      publishedDate: result.publishedDate,
      author: result.author,
    };
  }

  /**
   * Converts a LangChain Document to the hybrid format.
   */
  private documentToHybrid(record: VectorRecord, score: number): HybridSearchResult {
    const result: HybridSearchResult = {
      id: record.id,
      title: record.title || 'Untitled Document',
      url: record.sourceUri,
      content: record.content || '',
      score: score, // Already a similarity score
      source: 'local',
      objectId: record.objectId,
      chunkId: record.sqlChunkId,
      propositions: record.propositions,
    };
    
    this.logDebug(`documentToHybrid - Created HybridSearchResult:`, {
      id: result.id,
      title: result.title,
      url: result.url,
      contentLength: result.content?.length || 0,
      score: result.score,
      source: result.source,
      objectId: result.objectId,
      chunkId: result.chunkId,
      chunkIdType: typeof result.chunkId
    });
    
    return result;
  }

  /**
   * Deduplicates results based on objectId (for local) and URL (for Exa).
   * Uses O(1) Set lookups for efficient deduplication.
   * First occurrence wins to preserve ranking order.
   */
  private deduplicateResults(results: HybridSearchResult[], threshold: number): HybridSearchResult[] {
    const seenObjectIds = new Set<string>();
    const seenUrls = new Set<string>();
    const deduplicated: HybridSearchResult[] = [];

    for (const result of results) {
      let isDuplicate = false;

      if (result.source === 'local' && result.objectId) {
        // For local results, check objectId
        if (seenObjectIds.has(result.objectId)) {
          isDuplicate = true;
        } else {
          seenObjectIds.add(result.objectId);
        }
      } else if (result.source === 'exa' && result.url) {
        // For Exa results, check URL
        if (seenUrls.has(result.url)) {
          isDuplicate = true;
        } else {
          seenUrls.add(result.url);
        }
      }

      if (!isDuplicate) {
        deduplicated.push(result);
      } else {
        this.logDebug(`Deduplicating result: ${result.title}`);
      }
    }

    return deduplicated;
  }


  /**
   * Ranks results based on their scores and source weights.
   */
  private rankResults(
    results: HybridSearchResult[], 
    weights: { localWeight: number; exaWeight: number }
  ): HybridSearchResult[] {
    // Apply source-specific weights
    const weightedResults = results.map(result => ({
      ...result,
      weightedScore: result.score * (result.source === 'exa' ? weights.exaWeight : weights.localWeight),
    }));

    // Sort by weighted score (descending)
    return weightedResults
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .map(({ weightedScore, ...result }) => result); // Remove temporary weightedScore
  }
}