import { logger } from '../../utils/logger';

// Common paywall and navigation noise patterns
const NOISE_PATTERNS = [
  // Navigation elements
  /Accessibility help Skip to.*/gi,
  /Skip to (navigation|content|footer|main).*/gi,
  
  // Subscription/paywall messages
  /Subscribe to unlock this article.*/gi,
  /Try unlimited access.*/gi,
  /Only \$\d+ for \d+ week.*/gi,
  /Complete digital access to.*/gi,
  /Cancel anytime during your trial.*/gi,
  /Pay a year upfront and save.*/gi,
  /Essential digital access.*/gi,
  /Premium Digital.*/gi,
  /Standard Digital.*/gi,
  /Explore more offers.*/gi,
  /Your browser does not support.*/gi,
  /Please use a modern browser.*/gi,
  
  // Cookie/privacy notices
  /We use cookies.*/gi,
  /Cookie policy.*/gi,
  /Privacy policy.*/gi,
  
  // Social media/sharing
  /Share on (Twitter|Facebook|LinkedIn).*/gi,
  /Follow us on.*/gi,
  
  // Newsletter signup
  /Sign up for our newsletter.*/gi,
  /Get the latest news delivered.*/gi,
  
  // Author/publication metadata when it's standalone
  /^Published\w+ \d+, \d{4}$/gm,
  /^By [A-Za-z\s]+$/gm,
];

// Patterns that indicate useful content (should be preserved)
const PRESERVE_PATTERNS = [
  /Published.+\d{4}.+Author:/i, // Combined date and author info
];

/**
 * Cleans news content by removing paywall messages, navigation elements, and other noise.
 * @param text The raw text content to clean
 * @returns Cleaned text with noise removed
 */
export function cleanNewsContent(text: string): string {
  if (!text) return '';
  
  let cleaned = text;
  
  // First, check if we should preserve certain patterns
  const preservedMatches: string[] = [];
  PRESERVE_PATTERNS.forEach(pattern => {
    const matches = cleaned.match(pattern);
    if (matches) {
      preservedMatches.push(...matches);
    }
  });
  
  // Apply noise removal patterns
  NOISE_PATTERNS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Re-add preserved content if it was accidentally removed
  preservedMatches.forEach(match => {
    if (!cleaned.includes(match)) {
      cleaned = match + '\n' + cleaned;
    }
  });
  
  // Clean up excessive whitespace
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double
    .replace(/\s{3,}/g, '  ')   // Replace multiple spaces with double
    .trim();
  
  // Log if we removed significant content
  const originalLength = text.length;
  const cleanedLength = cleaned.length;
  const reductionPercentage = ((originalLength - cleanedLength) / originalLength) * 100;
  
  if (reductionPercentage > 50) {
    logger.debug(`[ContentFilter] Removed ${reductionPercentage.toFixed(1)}% of content as noise`);
  }
  
  return cleaned;
}

// Alias for backward compatibility
export const filterContent = cleanNewsContent;

/**
 * Extracts key highlights/sentences from content.
 * @param text The text to extract highlights from
 * @param count Number of highlights to extract
 * @returns Array of highlight sentences
 */
export function extractHighlights(text: string, count: number = 3): string[] {
  if (!text) return [];
  
  // Split into sentences
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 30); // Filter out very short sentences
  
  // If we have fewer sentences than requested, return all
  if (sentences.length <= count) {
    return sentences;
  }
  
  // Simple heuristic: Take first sentence and then evenly spaced sentences
  const highlights: string[] = [];
  const step = Math.floor(sentences.length / count);
  
  for (let i = 0; i < count; i++) {
    const index = Math.min(i * step, sentences.length - 1);
    highlights.push(sentences[index]);
  }
  
  return highlights;
}

/**
 * Extracts just the headline/title from news content.
 * @param text The text to extract headline from
 * @param title Optional title field to use as fallback
 * @returns The extracted headline
 */
export function extractHeadline(text: string, title?: string): string {
  if (title && title.length > 0) {
    // Clean up common title suffixes
    return title
      .replace(/ - The New York Times$/i, '')
      .replace(/ - Financial Times$/i, '')
      .replace(/ - The Wall Street Journal$/i, '')
      .replace(/ \| Financial Times$/i, '')
      .replace(/ \| WSJ$/i, '')
      .replace(/ \| The Guardian$/i, '')
      .trim();
  }
  
  // Try to extract headline from text
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  if (lines.length > 0) {
    // First non-empty line is often the headline
    return lines[0].trim();
  }
  
  return 'Untitled';
}

/**
 * Formats news results for display, focusing on headlines and key information.
 * @param results Array of search results
 * @returns Formatted string suitable for display
 */
export function formatNewsResults(results: Array<{
  title: string;
  url?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
  score: number;
}>): string {
  if (results.length === 0) {
    return 'No news headlines found.';
  }
  
  const formatted = results.map((result, index) => {
    const headline = extractHeadline(result.text || '', result.title);
    const date = result.publishedDate ? new Date(result.publishedDate).toLocaleDateString() : '';
    const source = result.url ? new URL(result.url).hostname.replace('www.', '') : '';
    
    let content = `[${index + 1}] ${headline}`;
    
    if (source || date) {
      content += '\n   ';
      if (source) content += source;
      if (source && date) content += ' • ';
      if (date) content += date;
    }
    
    // Add highlights if available
    if (result.highlights && result.highlights.length > 0) {
      const cleanedHighlights = result.highlights
        .map(h => cleanNewsContent(h))
        .filter(h => h.length > 0)
        .slice(0, 2); // Max 2 highlights per article
        
      if (cleanedHighlights.length > 0) {
        content += '\n   ' + cleanedHighlights.join(' ');
      }
    }
    
    return content;
  }).join('\n\n');
  
  return `Today's Headlines:\n\n${formatted}`;
}