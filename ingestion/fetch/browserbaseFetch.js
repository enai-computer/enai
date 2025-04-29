"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserbaseEmptyResultError = exports.BrowserbaseConnectionError = exports.BrowserbaseTimeoutError = exports.BrowserbaseAuthError = exports.BrowserbaseRateLimitError = void 0;
exports.fetchWithBrowserbase = fetchWithBrowserbase;
const sdk_1 = require("@browserbasehq/sdk");
const puppeteer_1 = __importStar(require("puppeteer"));
const logger_1 = require("../../utils/logger");
// --- Configuration ---
// REMOVED: Top-level const declarations for env vars
// const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
// const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;
// REMOVED: Top-level checks for env vars
// if (!BROWSERBASE_API_KEY) { ... }
// if (!BROWSERBASE_PROJECT_ID) { ... }
// --- Custom Error Types ---
class BrowserbaseRateLimitError extends Error {
    constructor(message = 'Browserbase concurrency limit hit (HTTP 429)') {
        super(message);
        this.name = 'BrowserbaseRateLimitError';
    }
}
exports.BrowserbaseRateLimitError = BrowserbaseRateLimitError;
class BrowserbaseAuthError extends Error {
    constructor(message = 'Invalid Browserbase API key or project id (HTTP 401)') {
        super(message);
        this.name = 'BrowserbaseAuthError';
    }
}
exports.BrowserbaseAuthError = BrowserbaseAuthError;
class BrowserbaseTimeoutError extends Error {
    constructor(message = 'Browserbase navigation/operation timed out') {
        super(message);
        this.name = 'BrowserbaseTimeoutError';
    }
}
exports.BrowserbaseTimeoutError = BrowserbaseTimeoutError;
class BrowserbaseConnectionError extends Error {
    constructor(message = 'Failed to connect to Browserbase session') {
        super(message);
        this.name = 'BrowserbaseConnectionError';
    }
}
exports.BrowserbaseConnectionError = BrowserbaseConnectionError;
class BrowserbaseEmptyResultError extends Error {
    constructor(message = 'Browserbase returned empty or minimal HTML content') {
        super(message);
        this.name = 'BrowserbaseEmptyResultError';
    }
}
exports.BrowserbaseEmptyResultError = BrowserbaseEmptyResultError;
// --- Fetch Function ---
async function fetchWithBrowserbase(url) {
    // MOVED & ADDED: Read env vars inside the function
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    // ADDED: Log environment variables for debugging (can be removed later)
    logger_1.logger.debug(`[browserbase] Checking env vars inside fetchWithBrowserbase: BROWSERBASE_API_KEY=${apiKey}, BROWSERBASE_PROJECT_ID=${projectId}`);
    // Check config just in case module loaded before env vars were fully set OR if they are still missing
    if (!apiKey || !projectId) {
        logger_1.logger.error('[browserbase] Browserbase API Key or Project ID is missing from process.env inside fetchWithBrowserbase.');
        throw new BrowserbaseAuthError('Browserbase API Key or Project ID is missing.');
    }
    // Initialize the client HERE, inside the function, using the locally read vars
    const bb = new sdk_1.Browserbase({ apiKey: apiKey });
    let session;
    let browser;
    const t0 = Date.now();
    logger_1.logger.info(`[browserbase] Attempting fetch for URL: ${url}`);
    try {
        // 1. Create session using the locally read var
        logger_1.logger.debug(`[browserbase] Creating session for project ${projectId}...`);
        session = await bb.sessions.create({
            projectId: projectId, // Use projectId here
        });
        logger_1.logger.debug(`[browserbase] Session created: ${session.id}`);
        // 2. Connect Puppeteer
        const wsEndpoint = session?.wsEndpoint;
        if (!wsEndpoint) {
            logger_1.logger.error(`[browserbase] Could not find wsEndpoint in session response for ${session.id}`);
            throw new BrowserbaseConnectionError('Could not find WebSocket endpoint in session response');
        }
        logger_1.logger.debug(`[browserbase] Connecting Puppeteer via CDP: ${wsEndpoint}`);
        try {
            browser = await puppeteer_1.default.connect({
                browserWSEndpoint: wsEndpoint,
            });
        }
        catch (connectError) {
            const sessionId = session?.id ?? 'unknown'; // Get session ID safely
            logger_1.logger.error(`[browserbase] Failed to connect Puppeteer to session ${sessionId}:`, connectError);
            // Ensure session is released even if connection fails
            if (session) { // Check if session is defined before using its id
                try {
                    // Assuming release method might be named differently or directly on bb
                    // Trying bb.deleteSession() as a guess, adjust based on actual SDK
                    await bb.deleteSession(session.id); // Use type assertion carefully
                    logger_1.logger.debug(`[browserbase] Session ${session.id} released after connection failure.`);
                }
                catch (releaseErr) {
                    logger_1.logger.warn(`[browserbase] Error releasing session ${session.id} after connection failure: ${releaseErr.message}`);
                }
                session = undefined; // Mark session as released
            }
            // Use the safe sessionId in the error message
            throw new BrowserbaseConnectionError(`Failed to connect to session ${sessionId}: ${connectError.message}`);
        }
        logger_1.logger.debug(`[browserbase] Puppeteer connected.`);
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        logger_1.logger.debug(`[browserbase] Navigating to: ${url}`);
        // 3. Navigate and get content
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 });
        const html = await page.content();
        const finalUrl = page.url();
        logger_1.logger.debug(`[browserbase] Navigation complete for ${url}. Final URL: ${finalUrl}`);
        // 4. Basic validation
        if (html.trim().length < 200) { // Your heuristic check
            logger_1.logger.warn(`[browserbase] Returned HTML seems too small (${html.trim().length} chars) for ${finalUrl}`);
            throw new BrowserbaseEmptyResultError(`Returned HTML too small (${html.trim().length} chars) for ${finalUrl}`);
        }
        const duration = Date.now() - t0;
        logger_1.logger.info(`[browserbase] Successfully fetched ${finalUrl} in ${duration} ms`);
        return { html, finalUrl };
    }
    catch (err) {
        const duration = Date.now() - t0;
        logger_1.logger.warn(`[browserbase] Fetch failed for ${url} after ${duration} ms: ${err.name} - ${err.message}`);
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
            logger_1.logger.error(`[browserbase] Received HTTP 401 from Browserbase API for project ${projectId}. Check API Key and Project ID.`);
            throw new BrowserbaseAuthError('Invalid Browserbase API key or project id (HTTP 401)');
        }
        if (err instanceof puppeteer_1.TimeoutError) {
            throw new BrowserbaseTimeoutError(`Navigation timeout for ${url} after ${duration} ms`);
        }
        // Fallback – rethrow original or a generic wrapper
        logger_1.logger.error(`[browserbase] Rethrowing unhandled error during fetch for ${url}:`, err);
        throw new Error(`Browserbase fetch failed for ${url}: ${err.message ?? 'Unknown error'}`); // Generic wrapper
    }
    finally {
        // ALWAYS release the pricey resources
        logger_1.logger.debug(`[browserbase] Cleaning up resources for ${url}`);
        try {
            if (browser && browser.isConnected()) {
                logger_1.logger.debug(`[browserbase] Disconnecting Puppeteer browser...`);
                await browser.disconnect();
                logger_1.logger.debug(`[browserbase] Puppeteer browser disconnected.`);
            }
        }
        catch (disconnectErr) {
            logger_1.logger.warn(`[browserbase] Error disconnecting browser for ${url}: ${disconnectErr.message}`);
        }
        try {
            if (session) {
                logger_1.logger.debug(`[browserbase] Releasing session: ${session.id}`);
                await bb.deleteSession(session.id);
                logger_1.logger.debug(`[browserbase] Session released: ${session.id}`);
            }
        }
        catch (releaseErr) {
            logger_1.logger.warn(`[browserbase] Could not release session ${session?.id}: ${releaseErr.message}`);
        }
    }
}
//# sourceMappingURL=browserbaseFetch.js.map