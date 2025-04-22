import { Browserbase } from '@browserbasehq/sdk';
import puppeteer, { type Browser, TimeoutError as PuppeteerTimeoutError } from 'puppeteer';
import { logger } from '../../utils/logger';
import { FetchPageResult } from './pageFetcher'; // Import shared result type

// --- Configuration ---
// REMOVED: Top-level const declarations for env vars
// const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
// const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

// REMOVED: Top-level checks for env vars
// if (!BROWSERBASE_API_KEY) { ... }
// if (!BROWSERBASE_PROJECT_ID) { ... }

// --- Custom Error Types ---
export class BrowserbaseRateLimitError extends Error {
  constructor(message = 'Browserbase concurrency limit hit (HTTP 429)') {
    super(message);
    this.name = 'BrowserbaseRateLimitError';
  }
}
export class BrowserbaseAuthError extends Error {
  constructor(message = 'Invalid Browserbase API key or project id (HTTP 401)') {
    super(message);
    this.name = 'BrowserbaseAuthError';
  }
}
export class BrowserbaseTimeoutError extends Error {
  constructor(message = 'Browserbase navigation/operation timed out') {
    super(message);
    this.name = 'BrowserbaseTimeoutError';
  }
}
export class BrowserbaseConnectionError extends Error {
  constructor(message = 'Failed to connect to Browserbase session') {
    super(message);
    this.name = 'BrowserbaseConnectionError';
  }
}
export class BrowserbaseEmptyResultError extends Error {
    constructor(message = 'Browserbase returned empty or minimal HTML content') {
      super(message);
      this.name = 'BrowserbaseEmptyResultError';
    }
}

// --- Fetch Function ---
export async function fetchWithBrowserbase(url: string): Promise<FetchPageResult> {
  // MOVED & ADDED: Read env vars inside the function
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  // ADDED: Log environment variables for debugging (can be removed later)
  logger.debug(`[browserbase] Checking env vars inside fetchWithBrowserbase: BROWSERBASE_API_KEY=${apiKey}, BROWSERBASE_PROJECT_ID=${projectId}`);

  // Check config just in case module loaded before env vars were fully set OR if they are still missing
  if (!apiKey || !projectId) {
    logger.error('[browserbase] Browserbase API Key or Project ID is missing from process.env inside fetchWithBrowserbase.');
    throw new BrowserbaseAuthError('Browserbase API Key or Project ID is missing.');
  }

  // Initialize the client HERE, inside the function, using the locally read vars
  const bb = new Browserbase({ apiKey: apiKey });

  let session: Awaited<ReturnType<typeof bb.sessions.create>> | undefined;
  let browser: Browser | undefined;
  const t0 = Date.now();

  logger.info(`[browserbase] Attempting fetch for URL: ${url}`);

  try {
    // 1. Create session using the locally read var
    logger.debug(`[browserbase] Creating session for project ${projectId}...`);
    session = await bb.sessions.create({
      projectId: projectId, // Use projectId here
    });
    logger.debug(`[browserbase] Session created: ${session.id}`);

    // 2. Connect Puppeteer
    const wsEndpoint = (session as any)?.wsEndpoint;
    if (!wsEndpoint) {
      logger.error(`[browserbase] Could not find wsEndpoint in session response for ${session.id}`);
      throw new BrowserbaseConnectionError('Could not find WebSocket endpoint in session response');
    }

    logger.debug(`[browserbase] Connecting Puppeteer via CDP: ${wsEndpoint}`);
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
      });
    } catch (connectError: any) {
      const sessionId = session?.id ?? 'unknown'; // Get session ID safely
      logger.error(`[browserbase] Failed to connect Puppeteer to session ${sessionId}:`, connectError);
      // Ensure session is released even if connection fails
      if (session) { // Check if session is defined before using its id
        try {
          // Assuming release method might be named differently or directly on bb
          // Trying bb.deleteSession() as a guess, adjust based on actual SDK
          await (bb as any).deleteSession(session.id); // Use type assertion carefully
          logger.debug(`[browserbase] Session ${session.id} released after connection failure.`);
        } catch (releaseErr) {
          logger.warn(`[browserbase] Error releasing session ${session.id} after connection failure: ${(releaseErr as Error).message}`);
        }
        session = undefined; // Mark session as released
      }
      // Use the safe sessionId in the error message
      throw new BrowserbaseConnectionError(`Failed to connect to session ${sessionId}: ${connectError.message}`);
    }
    logger.debug(`[browserbase] Puppeteer connected.`);

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    logger.debug(`[browserbase] Navigating to: ${url}`);

    // 3. Navigate and get content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 });
    const html = await page.content();
    const finalUrl = page.url();
    logger.debug(`[browserbase] Navigation complete for ${url}. Final URL: ${finalUrl}`);

    // 4. Basic validation
    if (html.trim().length < 200) { // Your heuristic check
      logger.warn(`[browserbase] Returned HTML seems too small (${html.trim().length} chars) for ${finalUrl}`);
      throw new BrowserbaseEmptyResultError(`Returned HTML too small (${html.trim().length} chars) for ${finalUrl}`);
    }

    const duration = Date.now() - t0;
    logger.info(`[browserbase] Successfully fetched ${finalUrl} in ${duration} ms`);
    return { html, finalUrl };

  } catch (err: any) {
    const duration = Date.now() - t0;
    logger.warn(`[browserbase] Fetch failed for ${url} after ${duration} ms: ${err.name} - ${err.message}`);

    // Map SDK/transport/Puppeteer errors to typed errors
    if (err instanceof BrowserbaseConnectionError ||
        err instanceof BrowserbaseEmptyResultError) {
      throw err; // Already our custom type
    }
    if (err?.response?.status === 429) {
      throw new BrowserbaseRateLimitError();
    }
    // Check for 401 specifically for BrowserbaseAuthError from the API call itself
    if (err?.response?.status === 401) {
        logger.error(`[browserbase] Received HTTP 401 from Browserbase API for project ${projectId}. Check API Key and Project ID.`);
        throw new BrowserbaseAuthError('Invalid Browserbase API key or project id (HTTP 401)');
    }
    if (err instanceof PuppeteerTimeoutError) {
      throw new BrowserbaseTimeoutError(`Navigation timeout for ${url} after ${duration} ms`);
    }

    // Fallback – rethrow original or a generic wrapper
    logger.error(`[browserbase] Rethrowing unhandled error during fetch for ${url}:`, err);
    throw new Error(`Browserbase fetch failed for ${url}: ${err.message ?? 'Unknown error'}`); // Generic wrapper

  } finally {
    // ALWAYS release the pricey resources
    logger.debug(`[browserbase] Cleaning up resources for ${url}`);
    try {
      if (browser && browser.isConnected()) {
        logger.debug(`[browserbase] Disconnecting Puppeteer browser...`);
        await browser.disconnect();
        logger.debug(`[browserbase] Puppeteer browser disconnected.`);
      }
    } catch (disconnectErr) {
      logger.warn(`[browserbase] Error disconnecting browser for ${url}: ${(disconnectErr as Error).message}`);
    }
    try {
      if (session) {
        logger.debug(`[browserbase] Releasing session: ${session.id}`);
        await (bb as any).deleteSession(session.id);
        logger.debug(`[browserbase] Session released: ${session.id}`);
      }
    } catch (releaseErr) {
      logger.warn(`[browserbase] Could not release session ${session?.id}: ${(releaseErr as Error).message}`);
    }
  }
}
