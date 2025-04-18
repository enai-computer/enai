import crypto from 'crypto';

/**
 * Creates a SHA-256 hash of the input string.
 * @param input The string to hash.
 * @returns The hex-encoded SHA-256 hash.
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Performs basic canonicalization on a URL.
 * - Converts to lowercase.
 * - Removes trailing slash.
 * - Removes 'www.' prefix (consider if this is always desired).
 * TODO: Implement more robust canonicalization (e.g., remove fragments, default ports, sort query params).
 * @param url The URL string to canonicalize.
 * @returns The canonicalized URL string.
 */
export function canonicaliseUrl(url: string): string {
  try {
    // Use URL constructor for basic parsing and normalization
    const parsed = new URL(url.trim());

    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    // Reconstruct, omitting fragments, username/password, and standard ports
    // Query parameters are kept as is for now.
    const canonical = `${parsed.protocol}//${hostname}${pathname}${parsed.search}`;
    return canonical;

  } catch (error) {
    // If URL parsing fails, return the original trimmed string (or handle error differently)
    console.warn(`[URL Helper] Failed to parse URL for canonicalization: ${url}`, error);
    return url.trim().toLowerCase(); // Basic fallback
  }
} 