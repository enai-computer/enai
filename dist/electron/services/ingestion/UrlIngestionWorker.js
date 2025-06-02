"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UrlIngestionWorker = void 0;
const logger_1 = require("../../utils/logger");
const fetchMethod_1 = require("../../ingestion/fetch/fetchMethod");
const textCleaner_1 = require("../../ingestion/clean/textCleaner");
const worker_threads_1 = require("worker_threads");
const path_1 = __importDefault(require("path"));
const BaseIngestionWorker_1 = require("./BaseIngestionWorker");
const constants_1 = require("./constants");
const types_1 = require("./types");
const OpenAiAgent_1 = require("../agents/OpenAiAgent");
// Resolve the path to the Readability worker script
// In production, the worker is bundled and located in dist/workers/
// When bundled, __dirname points to the dist/electron directory
// @claude can you resolve the when bundled and in production comments above - why are they different? is it in dist/workers or dist/electron/workers? 
const readabilityWorkerPath = path_1.default.resolve(process.cwd(), 'dist/workers/readabilityWorker.js');
// Helper function to run Readability in a worker
async function parseHtmlInWorker(html, url) {
    return new Promise((resolve, reject) => {
        // Check if file exists before creating worker
        try {
            require.resolve(readabilityWorkerPath);
        }
        catch (err) {
            logger_1.logger.error(`[UrlIngestionWorker] Readability worker file not found at: ${readabilityWorkerPath}`);
            return reject(new Error(`Worker file not found: ${readabilityWorkerPath}`));
        }
        logger_1.logger.debug(`[UrlIngestionWorker] Creating Readability worker for URL: ${url}`);
        const worker = new worker_threads_1.Worker(readabilityWorkerPath);
        let timeoutId = null;
        const cleanup = () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            worker.removeAllListeners('message');
            worker.removeAllListeners('error');
            worker.removeAllListeners('exit');
            worker.terminate().catch(err => logger_1.logger.error('[UrlIngestionWorker] Error terminating worker:', err));
            logger_1.logger.debug(`[UrlIngestionWorker] Readability worker cleaned up for URL: ${url}`);
        };
        timeoutId = setTimeout(() => {
            logger_1.logger.warn(`[UrlIngestionWorker] Readability worker timed out for URL: ${url}`);
            cleanup();
            reject(new Error('Readability worker timed out'));
        }, constants_1.WORKER_TIMEOUT_MS);
        worker.on('message', (message) => {
            logger_1.logger.debug(`[UrlIngestionWorker] Received message from worker for URL ${url}:`, message);
            cleanup();
            if (message.error) {
                reject(new Error(message.error));
            }
            else {
                // The worker sends { result: null } or { result: ReadabilityParsed }
                resolve(message.result === undefined ? null : message.result);
            }
        });
        worker.on('error', (error) => {
            logger_1.logger.error(`[UrlIngestionWorker] Readability worker error for URL ${url}:`, error);
            cleanup(); // @claude please add a 1000 maximum character size for all these errors
            reject(error);
        });
        worker.on('exit', (code) => {
            if (code !== 0) {
                logger_1.logger.error(`[UrlIngestionWorker] Readability worker stopped with exit code ${code} for URL ${url}`);
                // Reject if it hasn't already resolved/rejected via message/error/timeout
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
            cleanup(); // Ensure cleanup happens on exit too
        });
        logger_1.logger.debug(`[UrlIngestionWorker] Sending data to worker for URL: ${url}`);
        worker.postMessage({ html, url }); // @claude is it possible that these data messages are sending all of the content to the worker? if so, or maybe in either case, we should have maximum 1000 characters for these messages.
    });
}
class UrlIngestionWorker extends BaseIngestionWorker_1.BaseIngestionWorker {
    constructor(objectModel, ingestionJobModel, llmService) {
        super(ingestionJobModel, 'UrlIngestionWorker');
        this.objectModel = objectModel;
        this.openAiAgent = new OpenAiAgent_1.OpenAiAgent(llmService);
        // Get the database instance for transaction support
        this.db = objectModel.getDatabase();
    }
    async execute(job) {
        const sourceUri = job.sourceIdentifier;
        logger_1.logger.info(`[${this.workerName}] Processing URL job ${job.id}: ${sourceUri}`);
        try {
            // Update job status to processing_source
            await this.ingestionJobModel.update(job.id, {
                status: constants_1.INGESTION_STATUS.PROCESSING_SOURCE
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.FETCHING, 0, 'Starting URL fetch');
            // 1. Fetch the page
            logger_1.logger.debug(`[${this.workerName}] Fetching URL: ${sourceUri}`);
            const fetchOptions = {};
            const fetchResult = await (0, fetchMethod_1.fetchPageWithFallback)(sourceUri, fetchOptions);
            logger_1.logger.debug(`[${this.workerName}] Fetch successful, Final URL: ${fetchResult.finalUrl}`);
            // Update to parsing status
            // @claude how do PROGRESS_STAGES and INGESTION_STATUS relate to each other? Is progress the action that's being taken on the status?
            await this.ingestionJobModel.update(job.id, {
                status: constants_1.INGESTION_STATUS.PARSING_CONTENT
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PARSING, 30, 'Parsing HTML content');
            // 2. Parse HTML in Worker
            logger_1.logger.debug(`[${this.workerName}] Parsing HTML for URL: ${fetchResult.finalUrl}`);
            const parsedContent = await parseHtmlInWorker(fetchResult.html, fetchResult.finalUrl);
            if (!parsedContent) {
                // Parsing failed or no content found
                logger_1.logger.warn(`[${this.workerName}] Parsing failed or no content for job ${job.id}`);
                await this.ingestionJobModel.markAsFailed(job.id, this.formatErrorInfo({
                    name: 'ParsingFailed',
                    message: 'Failed to extract content from webpage'
                }, { url: fetchResult.finalUrl }), constants_1.INGESTION_STATUS.PARSING_CONTENT);
                return;
            }
            logger_1.logger.info(`[${this.workerName}] Parsing successful, Title: ${parsedContent.title}`);
            // 3. Clean the extracted text for embedding
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.CLEANING, 50, 'Cleaning text for embeddings');
            const cleanedText = (0, textCleaner_1.cleanTextForEmbedding)(parsedContent.textContent);
            logger_1.logger.debug(`[${this.workerName}] Cleaned text length: ${cleanedText.length}`);
            // 3.5. Generate object-level summary, propositions, and key topics
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.CLEANING, 55, 'Generating document summary');
            let summaryData;
            try {
                const aiContent = await this.openAiAgent.generateObjectSummary(cleanedText, parsedContent.title || '', job.id // Using job ID as object ID for logging
                );
                // Transform AiGeneratedContent to the expected format
                summaryData = {
                    summary: aiContent.summary,
                    propositions: BaseIngestionWorker_1.BaseIngestionWorker.transformPropositions(aiContent.propositions),
                    tags: aiContent.tags
                };
            }
            catch (error) {
                logger_1.logger.error(`[${this.workerName}] Failed to generate object summary for job ${job.id}:`, error);
                // Fallback behavior - caller decides
                summaryData = {
                    summary: `Summary of: ${parsedContent.title || 'Untitled'}`,
                    propositions: { main: [], supporting: [], actions: [] },
                    tags: []
                };
            }
            // Update to persisting status
            await this.ingestionJobModel.update(job.id, {
                status: constants_1.INGESTION_STATUS.PERSISTING_DATA
            });
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.PERSISTING, 60, 'Saving parsed content');
            // 4. Create or update the object in the database (with transaction)
            const jobData = (0, types_1.getUrlJobData)(job.jobSpecificData);
            let objectId = job.relatedObjectId || jobData.relatedObjectId;
            // Run database operations in a transaction
            // Note: ObjectModel methods are async, so we'll handle the transaction differently
            if (!objectId) {
                // Create new object
                const newObject = await this.objectModel.create({
                    objectType: 'web_page',
                    sourceUri: fetchResult.finalUrl,
                    title: parsedContent.title,
                    status: 'parsed',
                    rawContentRef: null,
                    parsedContentJson: JSON.stringify(parsedContent),
                    cleanedText: cleanedText,
                    errorInfo: null,
                    parsedAt: new Date(),
                    // Object-level summary fields
                    summary: summaryData.summary,
                    propositionsJson: JSON.stringify(summaryData.propositions),
                    tagsJson: JSON.stringify(summaryData.tags),
                    summaryGeneratedAt: new Date()
                });
                objectId = newObject.id;
            }
            else {
                // Update existing object
                await this.objectModel.update(objectId, {
                    status: 'parsed',
                    title: parsedContent.title,
                    parsedContentJson: JSON.stringify(parsedContent),
                    cleanedText: cleanedText,
                    parsedAt: new Date(),
                    errorInfo: null,
                    // Object-level summary fields
                    summary: summaryData.summary,
                    propositionsJson: JSON.stringify(summaryData.propositions),
                    tagsJson: JSON.stringify(summaryData.tags),
                    summaryGeneratedAt: new Date(),
                    ...(fetchResult.finalUrl !== sourceUri && { sourceUri: fetchResult.finalUrl })
                });
            }
            await this.updateProgress(job.id, constants_1.PROGRESS_STAGES.FINALIZING, 100, 'URL processing completed');
            // Mark job as vectorizing instead of completed
            await this.ingestionJobModel.update(job.id, {
                status: 'vectorizing',
                chunking_status: 'pending',
                relatedObjectId: objectId
            });
            logger_1.logger.info(`[${this.workerName}] Job ${job.id.substring(0, 8)} is vectorizing`);
        }
        catch (error) {
            // Use base class error handling
            await this.handleJobFailure(job, error, {
                url: sourceUri,
                stage: job.status
            });
        }
    }
}
exports.UrlIngestionWorker = UrlIngestionWorker;
//# sourceMappingURL=UrlIngestionWorker.js.map