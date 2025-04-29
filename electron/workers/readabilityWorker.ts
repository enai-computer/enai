import path from 'path';
import { workerData, parentPort } from 'worker_threads';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { ReadabilityParsed } from '../../shared/types';
import { logger } from '../../utils/logger'; // Assuming logger can work here, might need adjustment

if (!parentPort) {
  throw new Error('This script must be run as a worker thread.');
}

// Type guard for incoming message
interface InputData {
  html: string;
  url: string;
}

function isInputData(data: any): data is InputData {
  return data && typeof data.html === 'string' && typeof data.url === 'string';
}

parentPort.on('message', (data: unknown) => {
  if (!isInputData(data)) {
    logger.error('[ReadabilityWorker] Received invalid data structure', data);
    parentPort?.postMessage({ error: 'Invalid input data structure' });
    return;
  }

  const { html, url } = data;

  try {
    // --- Parsing logic moved from readabilityParser.ts ---
    // 1. Build DOM
    const dom = new JSDOM(html, { url });

    // 2. Run Readability
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    // 3. Check content
    if (!article || !article.textContent) {
      logger.debug(`[ReadabilityWorker] Readability could not extract article from ${url}`);
      parentPort?.postMessage({ result: null });
      return;
    }

    // 4. Normalize and structure result
    const normalizedTextContent = article.textContent.replace(/\s+/g, ' ').trim();
    const parsedResult: ReadabilityParsed = {
      title: article.title ?? '',
      byline: article.byline ?? null,
      dir: article.dir ?? null,
      content: article.content ?? '',
      textContent: normalizedTextContent,
      length: article.length ?? 0,
      excerpt: article.excerpt ?? null,
      siteName: article.siteName ?? null,
    };

    logger.debug(`[ReadabilityWorker] Successfully parsed article "${parsedResult.title}" from ${url}`);
    parentPort?.postMessage({ result: parsedResult });

  } catch (error: any) {
    logger.error(`[ReadabilityWorker] Error parsing HTML from ${url}:`, error);
    // Send error details back
    parentPort?.postMessage({ error: `Parsing failed: ${error.message}` });
  }
});

logger.info('[ReadabilityWorker] Worker thread started and listening for messages.'); 