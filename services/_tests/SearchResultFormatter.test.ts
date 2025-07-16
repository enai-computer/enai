import { describe, it, expect, beforeEach } from 'vitest';
import { SearchResultFormatter } from '../SearchResultFormatter';
import { HybridSearchResult } from '../../shared/types';

describe('SearchResultFormatter', () => {
  let formatter: SearchResultFormatter;

  beforeEach(() => {
    formatter = new SearchResultFormatter();
  });

  describe('format', () => {
    it('should return no results message when array is empty', () => {
      const result = formatter.format([]);
      expect(result).toBe('No results found.');
    });

    it('should return custom no results message with title', () => {
      const result = formatter.format([], { title: 'AI safety' });
      expect(result).toBe('No results found for AI safety.');
    });

    it('should format single result with basic options', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Understanding TypeScript',
        url: 'https://example.com/typescript',
        content: 'TypeScript is a typed superset of JavaScript',
        score: 0.95,
        source: 'local'
      }];

      const result = formatter.format(results);
      
      expect(result).toContain('**Understanding TypeScript**');
      expect(result).toContain('Link: https://example.com/typescript');
    });

    it('should show index when showIndex is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'First Result',
        url: 'https://example.com/1',
        content: 'Content 1',
        score: 0.9,
        source: 'local'
      }, {
        id: '2',
        title: 'Second Result',
        url: 'https://example.com/2',
        content: 'Content 2',
        score: 0.8,
        source: 'exa'
      }];

      const result = formatter.format(results, { showIndex: true });
      
      expect(result).toContain('**[1] First Result**');
      expect(result).toContain('**[2] Second Result**');
    });

    it('should show author when showAuthor is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Article Title',
        url: 'https://example.com',
        content: 'Article content',
        score: 0.9,
        source: 'exa',
        author: 'Jane Doe'
      }];

      const result = formatter.format(results, { showAuthor: true });
      
      expect(result).toContain('By: Jane Doe');
    });

    it('should format date inline when dateFormat is inline', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'News Article',
        url: 'https://news.com',
        content: 'News content',
        score: 0.9,
        source: 'exa',
        publishedDate: '2024-01-15T00:00:00.000Z'
      }];

      const result = formatter.format(results, { dateFormat: 'inline' });
      
      const expectedDate = new Date('2024-01-15T00:00:00.000Z').toLocaleDateString();
      expect(result).toContain(expectedDate);
      expect(result).not.toContain('Published:');
    });

    it('should format date separately when dateFormat is separate', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'News Article',
        url: 'https://news.com',
        content: 'News content',
        score: 0.9,
        source: 'exa',
        publishedDate: '2024-01-15T00:00:00.000Z'
      }];

      const result = formatter.format(results, { dateFormat: 'separate' });
      
      expect(result).toContain('Published:');
    });

    it('should show content snippet when showContentSnippet is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Long Article',
        url: 'https://example.com',
        content: 'This is a very long article about many topics that goes on and on',
        score: 0.9,
        source: 'local'
      }];

      const result = formatter.format(results, { 
        showContentSnippet: true,
        maxContentLength: 30
      });
      
      // The truncation happens at 30 characters, then trim, then ...
      expect(result).toContain('> This is a very long article ab...');
    });

    it('should show highlights when showHighlights is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Research Paper',
        url: 'https://example.com',
        content: 'Full paper content',
        score: 0.9,
        source: 'exa',
        highlights: [
          'Key finding 1',
          'Key finding 2',
          'Key finding 3',
          'Key finding 4' // Should be limited to 3
        ]
      }];

      const result = formatter.format(results, { showHighlights: true });
      
      expect(result).toContain('Key points:');
      expect(result).toContain('- Key finding 1');
      expect(result).toContain('- Key finding 2');
      expect(result).toContain('- Key finding 3');
      expect(result).not.toContain('- Key finding 4');
    });

    it('should group by source when groupBySource is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Local Note',
        url: 'local://note1',
        content: 'My note',
        score: 0.9,
        source: 'local'
      }, {
        id: '2',
        title: 'Web Article',
        url: 'https://example.com',
        content: 'Web content',
        score: 0.8,
        source: 'exa'
      }];

      const result = formatter.format(results, { groupBySource: true });
      
      expect(result).toContain('## From Your Notes');
      expect(result).toContain('## From the Web');
      expect(result.indexOf('From Your Notes')).toBeLessThan(result.indexOf('From the Web'));
    });

    it('should group by domain when groupByDomain is true', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'NYT Article',
        url: 'https://nytimes.com/article1',
        content: 'NYT content',
        score: 0.9,
        source: 'exa'
      }, {
        id: '2',
        title: 'BBC Article',
        url: 'https://bbc.com/news/article2',
        content: 'BBC content',
        score: 0.8,
        source: 'exa'
      }];

      const result = formatter.format(results, { groupByDomain: true });
      
      expect(result).toContain('## New York Times');
      expect(result).toContain('## BBC');
    });

    it('should handle unknown domains gracefully', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Unknown Site Article',
        url: 'https://random-blog.com/post',
        content: 'Blog content',
        score: 0.9,
        source: 'exa'
      }];

      const result = formatter.format(results, { groupByDomain: true });
      
      expect(result).toContain('## random-blog.com');
    });

    it('should handle invalid URLs gracefully', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Bad URL Result',
        url: 'not-a-valid-url',
        content: 'Content',
        score: 0.9,
        source: 'local'
      }];

      const result = formatter.format(results, { groupByDomain: true });
      
      expect(result).toContain('## unknown');
      expect(result).toContain('Bad URL Result');
    });

    it('should add title when provided', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Result',
        url: 'https://example.com',
        content: 'Content',
        score: 0.9,
        source: 'local'
      }];

      const result = formatter.format(results, { title: 'Search Results for AI' });
      
      expect(result).toContain('# Search Results for AI');
    });
  });

  describe('formatMultiSourceNews', () => {
    it('should format news from multiple sources with predefined options', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Breaking News from NYT',
        url: 'https://nytimes.com/breaking',
        content: 'Important news story with many details',
        score: 0.95,
        source: 'exa',
        publishedDate: '2024-01-20T00:00:00.000Z',
        highlights: ['Key point 1', 'Key point 2']
      }, {
        id: '2',
        title: 'BBC Coverage',
        url: 'https://bbc.com/news/story',
        content: 'Different perspective on the same story',
        score: 0.90,
        source: 'exa',
        publishedDate: '2024-01-20T00:00:00.000Z'
      }];

      const result = formatter.formatMultiSourceNews(results, ['NYT', 'BBC']);
      
      expect(result).toContain('# Headlines from NYT, BBC');
      expect(result).toContain('## New York Times');
      expect(result).toContain('## BBC');
      expect(result).toContain('Key points:');
      expect(result).toContain('> Important news story');
      expect(result).toContain('Published:');
    });

    it('should handle empty results for multi-source news', () => {
      const result = formatter.formatMultiSourceNews([], ['CNN', 'Reuters']);
      
      expect(result).toBe('No results found for Headlines from CNN, Reuters.');
    });
  });

  describe('formatNewsResults', () => {
    it('should format general news results with appropriate options', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Tech Industry Update',
        url: 'https://techcrunch.com/article',
        content: 'Major acquisition announced today',
        score: 0.88,
        source: 'exa',
        author: 'Tech Reporter',
        publishedDate: '2024-01-18T00:00:00.000Z',
        highlights: ['Company A buys Company B', '$10 billion deal']
      }];

      const result = formatter.formatNewsResults(results);
      
      expect(result).toContain('# News Search Results');
      expect(result).toContain('By: Tech Reporter');
      expect(result).toContain('Key points:');
      expect(result).toContain('> Major acquisition');
      expect(result).toContain('Published:');
    });
  });

  describe('formatSearchResults', () => {
    it('should format general search results with indexing and grouping', () => {
      const results: HybridSearchResult[] = [{
        id: '1',
        title: 'Personal Note on AI',
        url: 'local://note123',
        content: 'My thoughts on artificial intelligence',
        score: 0.92,
        source: 'local',
        highlights: ['AI is transformative']
      }, {
        id: '2',
        title: 'Wikipedia: Artificial Intelligence',
        url: 'https://wikipedia.org/AI',
        content: 'Artificial intelligence (AI) is intelligence demonstrated by machines',
        score: 0.85,
        source: 'exa',
        publishedDate: '2023-12-01T00:00:00.000Z'
      }];

      const result = formatter.formatSearchResults(results);
      
      expect(result).toContain('# Search Results');
      expect(result).toContain('## From Your Notes');
      expect(result).toContain('## From the Web');
      expect(result).toContain('**[1] Personal Note on AI**');
      // When grouped by source, indices restart for each group
      expect(result).toContain('**[1] Wikipedia: Artificial Intelligence**');
      expect(result).toContain('Key points:');
      expect(result).toContain('> My thoughts on');
    });
  });
});