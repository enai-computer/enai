"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const jsdom_1 = require("jsdom");
const readability_1 = require("@mozilla/readability");
const logger_1 = require("../../utils/logger"); // Assuming logger can work here, might need adjustment
if (!worker_threads_1.parentPort) {
    throw new Error('This script must be run as a worker thread.');
}
function isInputData(data) {
    return data && typeof data.html === 'string' && typeof data.url === 'string';
}
worker_threads_1.parentPort.on('message', (data) => {
    if (!isInputData(data)) {
        logger_1.logger.error('[ReadabilityWorker] Received invalid data structure', data);
        worker_threads_1.parentPort?.postMessage({ error: 'Invalid input data structure' });
        return;
    }
    const { html, url } = data;
    try {
        // --- Parsing logic moved from readabilityParser.ts ---
        // 1. Build DOM
        const dom = new jsdom_1.JSDOM(html, { url });
        // 2. Run Readability
        const reader = new readability_1.Readability(dom.window.document);
        const article = reader.parse();
        // 3. Check content
        if (!article || !article.textContent) {
            logger_1.logger.debug(`[ReadabilityWorker] Readability could not extract article from ${url}`);
            worker_threads_1.parentPort?.postMessage({ result: null });
            return;
        }
        // 4. Normalize and structure result
        const normalizedTextContent = article.textContent.replace(/\s+/g, ' ').trim();
        const parsedResult = {
            title: article.title ?? '',
            byline: article.byline ?? null,
            dir: article.dir ?? null,
            content: article.content ?? '',
            textContent: normalizedTextContent,
            length: article.length ?? 0,
            excerpt: article.excerpt ?? null,
            siteName: article.siteName ?? null,
        };
        logger_1.logger.debug(`[ReadabilityWorker] Successfully parsed article "${parsedResult.title}" from ${url}`);
        worker_threads_1.parentPort?.postMessage({ result: parsedResult });
    }
    catch (error) {
        logger_1.logger.error(`[ReadabilityWorker] Error parsing HTML from ${url}:`, error);
        // Send error details back
        worker_threads_1.parentPort?.postMessage({ error: `Parsing failed: ${error.message}` });
    }
});
logger_1.logger.info('[ReadabilityWorker] Worker thread started and listening for messages.');
//# sourceMappingURL=readabilityWorker.js.map