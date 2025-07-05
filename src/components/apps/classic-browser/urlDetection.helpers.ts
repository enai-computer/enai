/**
 * Chrome-style URL detection helpers
 * Based on Chromium's omnibox logic for distinguishing URLs from search queries
 */

// Common TLDs based on IANA registry and popular usage
// This is a subset - Chrome uses a more comprehensive list
const VALID_TLDS = new Set([
  // Generic TLDs
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int',
  'info', 'biz', 'name', 'pro', 'museum', 'coop', 'aero',
  'xxx', 'app', 'dev', 'io', 'co', 'me', 'tv', 'us',
  'tech', 'online', 'site', 'store', 'blog', 'cloud',
  'design', 'systems', 'solutions', 'services', 'agency',
  'academy', 'zone', 'today', 'world', 'company',
  
  // Country-code TLDs (sampling of common ones)
  'uk', 'ca', 'de', 'fr', 'it', 'es', 'nl', 'ru', 'br',
  'jp', 'cn', 'in', 'au', 'mx', 'ch', 'at', 'be', 'se',
  'no', 'dk', 'fi', 'pl', 'gr', 'il', 'nz', 'sg', 'hk',
  'kr', 'tw', 'th', 'my', 'id', 'vn', 'ph', 'tr', 'ae',
  'sa', 'za', 'eg', 'ma', 'ng', 'ke', 'tz', 'gh',
  
  // Common second-level domains
  'com.au', 'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za',
  'com.br', 'com.cn', 'com.mx', 'com.tw', 'com.hk', 'com.sg',
  'org.uk', 'net.au', 'gov.uk', 'ac.uk', 'edu.au',
]);

/**
 * Detects if input is likely a URL using Chrome-like heuristics
 * @param input User input from address bar
 * @returns true if input should be treated as URL, false if search query
 */
export function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim();
  
  // Empty input is not a URL
  if (!trimmed) return false;
  
  // 1. Explicit protocol - definitely a URL
  if (/^(https?:\/\/|ftp:\/\/|file:\/\/|about:|chrome:)/i.test(trimmed)) {
    return true;
  }
  
  // 2. Multiple words (contains spaces) - likely a search query
  // Exception: URLs can have spaces if they're properly encoded, but raw input with spaces is usually search
  if (trimmed.includes(' ')) {
    return false;
  }
  
  // 3. Check for IP address patterns
  // IPv4
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed)) {
    const parts = trimmed.split(/[:\\/]/)[0].split('.');
    // Validate each octet is 0-255
    if (parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    })) {
      return true;
    }
  }
  
  // IPv6 (simplified check)
  if (/^\[?[0-9a-fA-F:]+\]?(:\d+)?(\/.*)?$/.test(trimmed)) {
    const hasMultipleColons = (trimmed.match(/:/g) || []).length > 1;
    if (hasMultipleColons) {
      return true;
    }
  }
  
  // 4. Localhost and local domains
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || 
      /^[a-z0-9-]+\.local(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return true;
  }
  
  // 5. Domain pattern with valid TLD
  // Extract potential domain part (before any port or path)
  const domainMatch = trimmed.match(/^([a-z0-9.-]+)(:\d+)?(\/.*)?$/i);
  if (domainMatch) {
    const domain = domainMatch[1];
    const parts = domain.split('.');
    
    // Must have at least two parts (domain.tld)
    if (parts.length >= 2) {
      // Get the TLD (last part or last two parts for compound TLDs)
      const lastPart = parts[parts.length - 1].toLowerCase();
      const secondLastPart = parts.length > 2 ? parts[parts.length - 2].toLowerCase() : '';
      const compoundTld = `${secondLastPart}.${lastPart}`;
      
      // Check if it's a valid TLD
      if (VALID_TLDS.has(lastPart) || VALID_TLDS.has(compoundTld)) {
        // Additional validation: domain parts should be valid
        // (alphanumeric + hyphens, not starting/ending with hyphen)
        const domainPartsValid = parts.every(part => 
          /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(part)
        );
        
        if (domainPartsValid) {
          return true;
        }
      }
    }
  }
  
  // 6. Port number pattern (e.g., "localhost:3000" already handled above)
  // But also handle cases like "server:8080"
  if (/^[a-z0-9-]+(:\d+)(\/.*)?$/i.test(trimmed)) {
    return true;
  }
  
  // 7. File path patterns (for file:// URLs without explicit protocol)
  if (/^\/[^\\<>:|"?*]+$/.test(trimmed) || // Unix-like absolute path
      /^[a-zA-Z]:\\[^<>:|"?*]+$/.test(trimmed)) { // Windows absolute path
    return true;
  }
  
  // 8. Special Chrome URLs
  if (/^chrome:\/\//i.test(trimmed) || 
      /^about:/i.test(trimmed)) {
    return true;
  }
  
  // Default: treat as search query
  return false;
}

/**
 * Formats a URL by adding protocol if missing
 * @param url URL that may be missing protocol
 * @returns URL with protocol
 */
export function formatUrlWithProtocol(url: string): string {
  const trimmed = url.trim();
  
  // Already has protocol
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }
  
  // File path
  if (/^\//.test(trimmed) || /^[a-zA-Z]:\\/.test(trimmed)) {
    return `file://${trimmed}`;
  }
  
  // Default to https
  return `https://${trimmed}`;
}