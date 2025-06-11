import { AgentTool, ToolCallResult, ToolContext } from './types';
import { logger } from '../../../utils/logger';

export const searchKnowledgeBase: AgentTool = {
  name: 'search_knowledge_base',
  description: 'Search the user\'s knowledge base (saved web content, PDFs, bookmarks) for information',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant information'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
        default: 10
      },
      autoOpen: {
        type: 'boolean',
        description: 'Whether to automatically open the first result if highly relevant',
        default: false
      }
    },
    required: ['query']
  },

  async handle(args: any, context: ToolContext): Promise<ToolCallResult> {
    const { query, limit = 10, autoOpen = false } = args;
    if (!query) {
      return { content: "Error: Search query was unclear." };
    }
    
    logger.info(`[searchKnowledgeBase] Searching knowledge base: "${query}" (limit: ${limit}, autoOpen: ${autoOpen})`);
    
    try {
      // Use hybrid search but only search local vector database
      const results = await context.services.hybridSearchService.search(query, {
        numResults: limit,
        useExa: false  // Force local-only search
      });
      
      logger.debug(`[searchKnowledgeBase] Knowledge base search returned ${results.length} results`);
      
      // Aggregate search results for later processing into slices
      context.currentIntentSearchResults.push(...results);
      
      if (results.length === 0) {
        return { content: `No results found in your knowledge base for "${query}". Try saving more content or refining your search.` };
      }
      
      // If autoOpen is true and we have a URL, open the first result
      if (autoOpen && results[0].url) {
        logger.info(`[searchKnowledgeBase] Auto-opening first result: ${results[0].url}`);
        return {
          content: `Found "${results[0].title}" in your knowledge base. Opening it now...`,
          immediateReturn: {
            type: 'open_url',
            url: results[0].url,
            message: `Right on, I found "${results[0].title}" in your knowledge base and I'll open it for you.`
          }
        };
      }
      
      // Otherwise, format results for display
      const formatted = formatKnowledgeBaseResults(results, query);
      
      logger.debug(`[searchKnowledgeBase] Formatted knowledge base results (length: ${formatted.length}):`, 
        formatted.substring(0, 500) + '...');
      
      return { content: formatted };
    } catch (error) {
      logger.error(`[searchKnowledgeBase] Knowledge base search error:`, error);
      return { content: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
};

function formatKnowledgeBaseResults(results: any[], query: string): string {
  // Define relevance thresholds for categorization
  const HIGH_RELEVANCE_THRESHOLD = 0.7;
  const MEDIUM_RELEVANCE_THRESHOLD = 0.5;
  
  // If no results at all, be honest
  if (results.length === 0) {
    return `I searched for "${query}" but found no results in your knowledge base.`;
  }
  
  // Include ALL results, not just high-relevance ones
  // This ensures the AI is aware of everything being shown in the UI
  const highRelevanceResults = results.filter(r => r.score && r.score > HIGH_RELEVANCE_THRESHOLD);
  const mediumRelevanceResults = results.filter(r => r.score && r.score > MEDIUM_RELEVANCE_THRESHOLD && r.score <= HIGH_RELEVANCE_THRESHOLD);
  const lowRelevanceResults = results.filter(r => !r.score || r.score <= MEDIUM_RELEVANCE_THRESHOLD);
  
  // Build header that acknowledges all results
  const lines: string[] = [];
  lines.push(`## Found ${results.length} results for "${query}" in your knowledge base\n`);
  
  // Add context about relevance distribution
  if (highRelevanceResults.length > 0) {
    lines.push(`*${highRelevanceResults.length} highly relevant (70%+), ${mediumRelevanceResults.length} moderately relevant (50-70%), ${lowRelevanceResults.length} potentially related (<50%)*\n`);
  } else if (mediumRelevanceResults.length > 0) {
    lines.push(`*${mediumRelevanceResults.length} moderately relevant (50-70%), ${lowRelevanceResults.length} potentially related (<50%)*\n`);
  } else {
    lines.push(`*All results have lower relevance scores (below 50%), but may still contain useful information*\n`);
  }
  
  lines.push(`### Key Ideas:\n`);
  
  // Collect all propositions from ALL results
  const allPropositions: string[] = [];
  const sourcesByProposition = new Map<string, string[]>();
  
  results.forEach(result => {
    if (result.propositions && result.propositions.length > 0) {
      result.propositions.forEach((prop: string) => {
        // Track which sources contributed each proposition
        if (!sourcesByProposition.has(prop)) {
          sourcesByProposition.set(prop, []);
        }
        const sourceLabel = `${result.title || 'Untitled'} [${((result.score || 0) * 100).toFixed(0)}% relevant]`;
        sourcesByProposition.get(prop)!.push(sourceLabel);
        
        // Add to all propositions if not already present
        if (!allPropositions.includes(prop)) {
          allPropositions.push(prop);
        }
      });
    }
  });
  
  // Format propositions as bullet points
  if (allPropositions.length > 0) {
    // Sort propositions by number of sources (most corroborated first)
    const sortedPropositions = allPropositions.sort((a, b) => {
      const aCount = sourcesByProposition.get(a)?.length || 0;
      const bCount = sourcesByProposition.get(b)?.length || 0;
      return bCount - aCount;
    });
    
    // Show top propositions (limit to prevent overwhelming output)
    const maxPropositions = 10;
    sortedPropositions.slice(0, maxPropositions).forEach(prop => {
      lines.push(`• ${prop}`);
    });
    
    if (sortedPropositions.length > maxPropositions) {
      lines.push(`• ... and ${sortedPropositions.length - maxPropositions} more ideas`);
    }
  } else {
    // Fallback if no propositions are available
    lines.push(`*No key ideas extracted. Showing all ${results.length} sources:*`);
    results
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .forEach((item) => {
        const relevancePercent = ((item.score || 0) * 100).toFixed(0);
        lines.push(`• [${relevancePercent}%] ${item.title || 'Untitled'} - ${item.url || 'No URL'}`);
      });
  }
  
  lines.push(`\n### Sources (by relevance):`);
  // List all unique sources sorted by relevance
  const uniqueSources = new Map<string, { title: string, score: number }>();
  results
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .forEach(result => {
      const key = result.url || result.title || 'Unknown';
      if (!uniqueSources.has(key)) {
        uniqueSources.set(key, { 
          title: result.title || 'Untitled',
          score: result.score || 0
        });
      }
    });
  
  // Show top sources (limit to prevent overwhelming output)
  const maxSources = 8;
  let sourceCount = 0;
  uniqueSources.forEach(({ title, score }, url) => {
    if (sourceCount < maxSources) {
      const relevancePercent = (score * 100).toFixed(0);
      lines.push(`• [${relevancePercent}%] ${title} (${url})`);
      sourceCount++;
    }
  });
  
  if (uniqueSources.size > maxSources) {
    lines.push(`• ... and ${uniqueSources.size - maxSources} more sources`);
  }
  
  lines.push(`\n*I'm showing you all ${results.length} results above. Please review them to find what you're looking for.*`);
  
  return lines.join('\n');
}