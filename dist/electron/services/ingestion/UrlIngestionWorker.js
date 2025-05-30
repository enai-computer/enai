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
const messages_1 = require("@langchain/core/messages");
// Resolve the path to the Readability worker script
// In production, the worker is bundled and located in dist/workers/
// When bundled, __dirname points to the dist/electron directory
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
            cleanup();
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
        worker.postMessage({ html, url });
    });
}
class UrlIngestionWorker extends BaseIngestionWorker_1.BaseIngestionWorker {
    constructor(objectModel, ingestionJobModel, llmService) {
        super(ingestionJobModel, 'UrlIngestionWorker');
        this.objectModel = objectModel;
        this.llmService = llmService;
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
            const summaryData = await this.generateObjectSummary(cleanedText, parsedContent.title || '');
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
            // Mark job as completed
            await this.ingestionJobModel.markAsCompleted(job.id, objectId);
            logger_1.logger.info(`[${this.workerName}] Successfully completed job ${job.id}, object ${objectId}`);
        }
        catch (error) {
            // Use base class error handling
            await this.handleJobFailure(job, error, {
                url: sourceUri,
                stage: job.status
            });
        }
    }
    /**
     * Generate object-level summary, propositions, and key topics using LLM
     */
    async generateObjectSummary(text, title) {
        const systemPrompt = `You are an expert document analyst. Based on the following text from a web page, please perform the following tasks:
1. Write a comprehensive summary of the document's key information and arguments (approximately 200-400 words).
2. Extract key propositions categorized as:
   - main: Primary claims or key facts
   - supporting: Supporting details or evidence
   - actions: Any actionable items or recommendations
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.

Return your response as a JSON object with the keys: "summary", "propositions" (with "main", "supporting", and "actions" arrays), and "tags".`;
        try {
            const messages = [
                new messages_1.SystemMessage(systemPrompt),
                new messages_1.HumanMessage(`Title: ${title}\n\nDocument Text:\n${text.substring(0, 50000)}`) // Limit text length
            ];
            const response = await this.llmService.generateChatResponse(messages, {
                userId: 'system',
                taskType: 'summarization',
                priority: 'balanced_throughput'
            }, {
                temperature: 0.1,
                outputFormat: 'json_object',
                maxTokens: 2000
            });
            // Parse the response
            const parsed = JSON.parse(response.content);
            // Ensure proper structure with defaults
            return {
                summary: parsed.summary || '',
                propositions: {
                    main: parsed.propositions?.main || [],
                    supporting: parsed.propositions?.supporting || [],
                    actions: parsed.propositions?.actions || []
                },
                tags: parsed.tags || []
            };
        }
        catch (error) {
            logger_1.logger.error('[UrlIngestionWorker] Failed to generate object summary:', error);
            // Return minimal defaults on error
            return {
                summary: `Summary of: ${title}`,
                propositions: { main: [], supporting: [], actions: [] },
                tags: []
            };
        }
    }
}
exports.UrlIngestionWorker = UrlIngestionWorker;
//# sourceMappingURL=UrlIngestionWorker.js.map