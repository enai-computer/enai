/**
 * URL Security Utilities
 * Provides centralized URL validation to prevent security vulnerabilities
 * like XSS, local file access, and protocol handler attacks.
 */

import { logger } from './logger';

// Allowed URL protocols for navigation
const ALLOWED_PROTOCOLS = ['http:', 'https:', 'file:', 'about:', 'chrome:'];

// Known dangerous URL patterns
const DANGEROUS_PATTERNS = [
  /^javascript:/i,
  /^data:text\/html/i,
  /^vbscript:/i,
  /^data:.*script/i,
  /^blob:/i,
];

// Restricted file paths (when file: protocol is used)
const RESTRICTED_FILE_PATTERNS = [
  /\/etc\//,
  /\/private\//,
  /\.ssh\//,
  /\.gnupg\//,
  /\.config\//,
  /\.env/,
  /\.git\//,
  /\/Library\/Keychains\//,
  /\/Library\/Application Support\/.*\/(cookies|passwords|secrets)/i,
];

/**
 * Validates if a URL is safe to navigate to or process
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns true if the URL is considered safe, false otherwise
 */
export function isSecureUrl(
  url: string, 
  options: { 
    allowFile?: boolean;
    context?: string;
  } = {}
): boolean {
  const { allowFile = true, context = 'navigation' } = options;

  if (!url || typeof url !== 'string') {
    logger.warn(`[URLSecurity] Invalid URL type provided for ${context}`);
    return false;
  }

  // Check for dangerous patterns first
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(url)) {
      logger.warn(`[URLSecurity] Blocked dangerous URL pattern for ${context}: ${url}`);
      return false;
    }
  }

  try {
    const parsed = new URL(url);
    
    // Check if protocol is allowed
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      logger.warn(`[URLSecurity] Blocked disallowed protocol for ${context}: ${parsed.protocol}`);
      return false;
    }

    // Additional validation for file: URLs
    if (parsed.protocol === 'file:') {
      if (!allowFile) {
        logger.warn(`[URLSecurity] File URLs not allowed in ${context}`);
        return false;
      }

      // Check against restricted file patterns
      const filePath = decodeURIComponent(parsed.pathname);
      for (const pattern of RESTRICTED_FILE_PATTERNS) {
        if (pattern.test(filePath)) {
          logger.warn(`[URLSecurity] Blocked restricted file path for ${context}: ${filePath}`);
          return false;
        }
      }
    }

    // Additional validation for about: URLs
    if (parsed.protocol === 'about:') {
      // Only allow specific about pages
      const allowedAboutPages = ['about:blank', 'about:newtab'];
      if (!allowedAboutPages.includes(url.toLowerCase())) {
        logger.warn(`[URLSecurity] Blocked non-whitelisted about: URL for ${context}: ${url}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    // Invalid URL format
    logger.warn(`[URLSecurity] Invalid URL format for ${context}: ${url}`, error);
    return false;
  }
}

/**
 * Sanitizes a URL by removing potentially dangerous components
 * @param url - The URL to sanitize
 * @returns The sanitized URL or null if it cannot be made safe
 */
export function sanitizeUrl(url: string): string | null {
  if (!isSecureUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    
    // Remove any username/password from the URL
    parsed.username = '';
    parsed.password = '';
    
    // Remove hash if it contains javascript
    if (parsed.hash && /javascript:/i.test(parsed.hash)) {
      parsed.hash = '';
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Validates a URL specifically for clipboard operations
 * More restrictive than general navigation
 */
export function isSecureUrlForClipboard(url: string): boolean {
  return isSecureUrl(url, { 
    allowFile: false, // Don't allow file: URLs in clipboard
    context: 'clipboard' 
  });
}

/**
 * Validates a URL specifically for download operations
 */
export function isSecureUrlForDownload(url: string): boolean {
  // For downloads, we might want to be more restrictive
  if (!isSecureUrl(url, { context: 'download' })) {
    return false;
  }

  try {
    const parsed = new URL(url);
    
    // Don't allow file: protocol for downloads (could be used to copy local files)
    if (parsed.protocol === 'file:') {
      logger.warn('[URLSecurity] Blocked file: URL for download');
      return false;
    }

    return true;
  } catch {
    return false;
  }
}