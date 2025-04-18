import { logger } from '../../utils/logger';

// Define a type for the relevant parts of the Firefox bookmark structure
// Based on typical bookmarks.json format
interface FirefoxBookmarkNode {
  uri?: string; // The URL, if this node is a bookmark
  title?: string;
  type?: string; // e.g., 'text/x-moz-place', 'text/x-moz-place-container' (folder)
  children?: FirefoxBookmarkNode[]; // Nested bookmarks or folders
  // Other properties like dateAdded, lastModified might exist but aren't needed for URL extraction
}

// Recursive helper function to traverse the bookmark tree
function findUrisRecursive(node: FirefoxBookmarkNode, urls: string[]): void {
  // Check if the current node is a bookmark and has a valid URI
  if (node.uri && (node.uri.startsWith('http:') || node.uri.startsWith('https:'))) {
    urls.push(node.uri);
  } else if (node.uri) {
    // Log potentially invalid URIs (e.g., place:, data:, javascript:)
    logger.debug(`[Parser:FirefoxJSON] Skipping non-http(s) uri: ${node.uri.substring(0, 50)}...`);
  }

  // If the node has children, recursively process them
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      findUrisRecursive(child, urls);
    }
  }
}

/**
 * Parses Firefox bookmarks JSON backup content to extract URLs.
 * Recursively traverses the JSON structure to find all entries with a 'uri' property.
 * @param content The JSON content as a string.
 * @returns An array of valid HTTP/HTTPS URL strings found in the file.
 */
export function parse(content: string): string[] {
  logger.debug('[Parser:FirefoxJSON] Starting parsing for content length:', content.length);
  const urls: string[] = [];

  try {
    const rootNode: FirefoxBookmarkNode = JSON.parse(content);

    // The root node itself might not be a bookmark but usually contains children
    // Start the recursion from the root
    findUrisRecursive(rootNode, urls);

    logger.info(`[Parser:FirefoxJSON] Extracted ${urls.length} valid URLs.`);

  } catch (error) {
    logger.error('[Parser:FirefoxJSON] Failed to parse JSON content or traverse structure:', error);
    // Return empty array on error
    return [];
  }

  return urls;
} 