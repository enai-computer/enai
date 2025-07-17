import { logger } from '../utils/logger';
import { BaseService } from './base/BaseService';

// Exa API types based on their documentation
export interface ExaSearchOptions {
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startCrawlDate?: string;
  endCrawlDate?: string;
  startPublishedDate?: string;
  endPublishedDate?: string;
  type?: 'keyword' | 'neural' | 'auto';
  category?: string;
  useAutoprompt?: boolean;
  contents?: {
    text?: boolean;
    highlights?: boolean;
    summary?: boolean;
    highlightLength?: number;
    numSentences?: number;
  };
}

export interface NewsSearchOptions {
  sources?: string[]; // Specific news domains to search (e.g., ['ft.com', 'wsj.com'])
  dateRange?: 'today' | 'week' | 'month';
  highlightsOnly?: boolean; // Whether to get only highlights, not full text
}

export interface ExaSearchResult {
  id: string;
  score: number;
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  autopromptString?: string;
}

export interface ExaContentsOptions {
  text?: boolean;
  highlights?: boolean;
  summary?: boolean;
}

export interface ExaFindSimilarOptions extends Omit<ExaSearchOptions, 'type'> {
  url: string;
  excludeSourceDomain?: boolean;
}

// No dependencies required for ExaService
interface ExaServiceDeps {}

/**
 * Service for interacting with the Exa.ai API.
 * Provides methods for neural search, content retrieval, and finding similar content.
 * This service is stateless and focuses purely on API interaction.
 */
export class ExaService extends BaseService<ExaServiceDeps> {
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.exa.ai/';

  constructor(deps: ExaServiceDeps = {}) {
    super('ExaService', deps);
    this.apiKey = process.env.EXA_API_KEY;
    if (!this.apiKey) {
      this.logWarn('EXA_API_KEY not found in environment variables. ExaService will not be functional.');
    }
  }

  /**
   * Checks if the service is properly configured with an API key.
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Performs a search using Exa's neural search capabilities.
   * @param query The search query
   * @param options Additional search options
   * @returns Search results with scores and metadata
   */
  async search(query: string, options: ExaSearchOptions = {}): Promise<ExaSearchResponse> {
    return this.execute('search', async () => {
      if (!this.isConfigured()) {
        throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
      }

      this.logDebug(`Searching for: "${query}" with options:`, options);

      try {
      const requestBody = {
        query,
        numResults: options.numResults || 10,
        type: options.type || 'neural',
        useAutoprompt: options.useAutoprompt ?? true,
        ...options,
      };

      const response = await fetch(`${this.baseUrl}search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
        },
        body: JSON.stringify(requestBody),
      });

        if (!response.ok) {
          const errorData = await response.text();
          this.logError(`Search API error: ${response.status} ${response.statusText}`, errorData);
          throw new Error(`Exa API Error: ${response.statusText}`);
        }

        const data = await response.json() as ExaSearchResponse;
        this.logInfo(`Search returned ${data.results.length} results for query: "${query}"`);
        
        return data;
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * Retrieves the contents of specific URLs.
   * @param ids Array of Exa result IDs
   * @param options Content retrieval options
   * @returns Content for the requested IDs
   */
  async getContents(ids: string[], options: ExaContentsOptions = {}): Promise<ExaSearchResponse> {
    return this.execute('getContents', async () => {
      if (!this.isConfigured()) {
        throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
      }

      if (ids.length === 0) {
        this.logDebug('getContents called with empty IDs array.');
        return { results: [] };
      }

      this.logDebug(`Retrieving contents for ${ids.length} IDs with options:`, options);

      try {
      const requestBody = {
        ids,
        text: options.text ?? true,
        highlights: options.highlights ?? false,
        summary: options.summary ?? false,
      };

      const response = await fetch(`${this.baseUrl}contents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
        },
        body: JSON.stringify(requestBody),
      });

        if (!response.ok) {
          const errorData = await response.text();
          this.logError(`Contents API error: ${response.status} ${response.statusText}`, errorData);
          throw new Error(`Exa API Error: ${response.statusText}`);
        }

        const data = await response.json() as ExaSearchResponse;
        this.logInfo(`Retrieved contents for ${data.results.length} items`);
        
        return data;
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * Helper to ensure ISO timestamps have exactly .000 milliseconds
   */
  private toISOStringWithFixedMs(date: Date): string {
    const iso = date.toISOString();
    // Replace any milliseconds with .000
    return iso.replace(/\.\d{3}Z$/, '.000Z');
  }

  /**
   * Performs a news-specific search with date filtering and highlights.
   * @param query The search query
   * @param options News search options
   * @returns Search results with highlights
   */
  async searchNews(query: string, options: NewsSearchOptions = {}): Promise<ExaSearchResponse> {
    return this.execute('searchNews', async () => {
      this.logDebug(`Searching news for: "${query}" with options:`, options);

    // Set up date filters based on dateRange
    const now = new Date();
    let startDate: string | undefined;
    let endDate: string | undefined = this.toISOStringWithFixedMs(now);

    switch (options.dateRange) {
      case 'today':
        startDate = this.toISOStringWithFixedMs(new Date(now.setHours(0, 0, 0, 0)));
        break;
      case 'week':
        startDate = this.toISOStringWithFixedMs(new Date(now.setDate(now.getDate() - 7)));
        break;
      case 'month':
        startDate = this.toISOStringWithFixedMs(new Date(now.setMonth(now.getMonth() - 1)));
        break;
      default:
        // Default to last 24 hours for news
        startDate = this.toISOStringWithFixedMs(new Date(now.setDate(now.getDate() - 1)));
    }

    // Common news domains if not specified
    const defaultNewsSources = [
      'nytimes.com',
      'washingtonpost.com',
      'wsj.com',
      'bbc.com',
      'reuters.com',
      'apnews.com',
      'theguardian.com',
      'cnn.com',
      'bloomberg.com',
      'ft.com',
      'economist.com',
      'npr.org',
      'axios.com',
      'politico.com',
      'theatlantic.com'
    ];

    const searchOptions: ExaSearchOptions = {
      startPublishedDate: startDate,
      endPublishedDate: endDate,
      includeDomains: options.sources || defaultNewsSources,
      type: 'neural',
      contents: {
        text: !options.highlightsOnly,
        highlights: true, // Always get highlights for news
        summary: true,
      },
      numResults: 10,
    };

      return this.search(query, searchOptions);
    });
  }

  /**
   * Gets the latest headlines from major news sources.
   * @param category Optional news category (e.g., 'technology', 'business', 'politics')
   * @param options Additional options
   * @returns Latest news headlines
   */
  async getHeadlines(category?: string, options: NewsSearchOptions = {}): Promise<ExaSearchResponse> {
    // Build a query based on category
    let query = 'latest news headlines';
    if (category) {
      query = `latest ${category} news headlines`;
    }

    return this.searchNews(query, {
      ...options,
      dateRange: options.dateRange || 'today',
    });
  }

  /**
   * Finds content similar to a given URL.
   * @param options Find similar options including the source URL
   * @returns Similar content results
   */
  async findSimilar(options: ExaFindSimilarOptions): Promise<ExaSearchResponse> {
    return this.execute('findSimilar', async () => {
      if (!this.isConfigured()) {
        throw new Error('ExaService is not configured. Missing EXA_API_KEY.');
      }

      this.logDebug(`Finding similar content to: "${options.url}" with options:`, options);

      try {
      const { url, excludeSourceDomain = true, ...searchOptions } = options;
      
      const requestBody = {
        url,
        excludeSourceDomain,
        numResults: searchOptions.numResults || 10,
        ...searchOptions,
      };

      const response = await fetch(`${this.baseUrl}findSimilar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
        },
        body: JSON.stringify(requestBody),
      });

        if (!response.ok) {
          const errorData = await response.text();
          this.logError(`FindSimilar API error: ${response.status} ${response.statusText}`, errorData);
          throw new Error(`Exa API Error: ${response.statusText}`);
        }

        const data = await response.json() as ExaSearchResponse;
        this.logInfo(`Found ${data.results.length} similar results for URL: "${url}"`);
        
        return data;
      } catch (error) {
        throw error;
      }
    });
  }

}