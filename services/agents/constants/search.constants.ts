/**
 * Constants for search-related functionality
 */

export const NEWS_SOURCE_MAPPINGS = {
  // Financial Times
  'ft.com': ['ft', 'financial times', 'the financial times', 'ft.com'],
  // Wall Street Journal
  'wsj.com': ['wsj', 'wall street journal', 'the wall street journal', 'wsj.com'],
  // New York Times
  'nytimes.com': ['nyt', 'ny times', 'new york times', 'the new york times', 'nytimes.com'],
  // Washington Post
  'washingtonpost.com': ['wapo', 'washington post', 'the washington post', 'washingtonpost.com'],
  // BBC
  'bbc.com': ['bbc', 'bbc news', 'bbc.com'],
  // CNN
  'cnn.com': ['cnn', 'cnn news', 'cnn.com'],
  // The Guardian
  'theguardian.com': ['guardian', 'the guardian', 'theguardian.com'],
  // Reuters
  'reuters.com': ['reuters', 'reuters news', 'reuters.com'],
  // Bloomberg
  'bloomberg.com': ['bloomberg', 'bloomberg news', 'bloomberg.com'],
  // The Economist
  'economist.com': ['economist', 'the economist', 'economist.com'],
};

export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  'ft.com': 'Financial Times',
  'wsj.com': 'Wall Street Journal',
  'nytimes.com': 'New York Times',
  'washingtonpost.com': 'Washington Post',
  'bbc.com': 'BBC',
  'cnn.com': 'CNN',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'theguardian.com': 'The Guardian',
  'economist.com': 'The Economist',
};