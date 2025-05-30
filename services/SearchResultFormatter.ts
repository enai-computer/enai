import { HybridSearchResult } from '../shared/types';
import { SOURCE_DISPLAY_NAMES } from './AgentService.constants';

export interface FormatOptions {
  showIndex?: boolean;
  showAuthor?: boolean;
  showHighlights?: boolean;
  showContentSnippet?: boolean;
  dateFormat?: 'inline' | 'separate';
  groupBySource?: boolean;
  groupByDomain?: boolean;
  title?: string;
  maxContentLength?: number;
}

export class SearchResultFormatter {
  /**
   * Format search results with flexible options
   */
  format(results: HybridSearchResult[], options: FormatOptions = {}): string {
    if (results.length === 0) {
      return options.title ? `No results found for ${options.title}.` : 'No results found.';
    }

    let formatted = options.title ? `# ${options.title}\n\n` : '';

    if (options.groupByDomain) {
      // Group by domain for multi-source news
      const byDomain = this.groupByDomain(results);
      for (const [domain, domainResults] of Object.entries(byDomain)) {
        const displayName = SOURCE_DISPLAY_NAMES[domain] || domain;
        formatted += `## ${displayName}\n\n`;
        formatted += this.formatResultList(domainResults, options);
      }
    } else if (options.groupBySource) {
      // Group by source (local vs web)
      const bySource = this.groupByField(results, r => r.source);
      for (const [source, sourceResults] of Object.entries(bySource)) {
        formatted += source === 'local' ? '## From Your Notes\n\n' : '## From the Web\n\n';
        formatted += this.formatResultList(sourceResults, options);
      }
    } else {
      // No grouping
      formatted += this.formatResultList(results, options);
    }

    return formatted.trim();
  }

  private formatResultList(results: HybridSearchResult[], options: FormatOptions): string {
    return results.map((result, index) => 
      this.formatSingleResult(result, index, options)
    ).join('\n\n') + '\n\n';
  }

  private formatSingleResult(
    result: HybridSearchResult, 
    index: number, 
    options: FormatOptions
  ): string {
    const parts: string[] = [];

    // Title
    const title = options.showIndex 
      ? `**[${index + 1}] ${result.title}**`
      : `**${result.title}**`;
    parts.push(title);

    // URL
    parts.push(`Link: ${result.url}`);

    // Date and Author on same line if inline
    const metadata: string[] = [];
    if (result.publishedDate) {
      const date = new Date(result.publishedDate).toLocaleDateString();
      metadata.push(options.dateFormat === 'inline' ? date : `Published: ${date}`);
    }
    if (options.showAuthor && result.author) {
      metadata.push(`By: ${result.author}`);
    }
    if (metadata.length > 0) {
      parts.push(metadata.join(' | '));
    }

    // Content snippet
    if (options.showContentSnippet && result.content) {
      const snippet = this.truncateContent(result.content, options.maxContentLength || 200);
      parts.push(`> ${snippet}`);
    }

    // Highlights
    if (options.showHighlights && result.highlights?.length) {
      parts.push('Key points:');
      parts.push(...result.highlights.slice(0, 3).map((h: string) => `- ${h}`));
    }

    return parts.join('\n');
  }

  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength).trim() + '...';
  }

  private groupByField<T, K extends string | number>(
    items: T[], 
    getKey: (item: T) => K
  ): Record<K, T[]> {
    return items.reduce((acc, item) => {
      const key = getKey(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {} as Record<K, T[]>);
  }

  private groupByDomain(results: HybridSearchResult[]): Record<string, HybridSearchResult[]> {
    return this.groupByField(results, result => {
      if (!result.url) return 'unknown';
      try {
        return new URL(result.url).hostname;
      } catch {
        return 'unknown';
      }
    });
  }

  /**
   * Format results for multi-source news queries
   */
  formatMultiSourceNews(results: HybridSearchResult[], sources: string[]): string {
    return this.format(results, {
      title: `Headlines from ${sources.join(', ')}`,
      groupByDomain: true,
      showAuthor: false,
      showHighlights: true,
      showContentSnippet: true,
      dateFormat: 'separate',
    });
  }

  /**
   * Format general news results
   */
  formatNewsResults(results: HybridSearchResult[]): string {
    return this.format(results, {
      title: 'News Search Results',
      showAuthor: true,
      showHighlights: true,
      showContentSnippet: true,
      dateFormat: 'separate',
    });
  }

  /**
   * Format general search results
   */
  formatSearchResults(results: HybridSearchResult[]): string {
    return this.format(results, {
      title: 'Search Results',
      groupBySource: true,
      showIndex: true,
      showHighlights: true,
      showContentSnippet: true,
      dateFormat: 'inline',
    });
  }
}