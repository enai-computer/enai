import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import { createChatModel } from '../../utils/llm';
import { AiGeneratedContent } from '../../shared/schemas/aiSchemas';
import { BaseService } from '../base/BaseService';

// --- Constants ---
const RETRY_DELAY_MS = 1000; // 1 second delay before retry
const MAX_OUTPUT_CHUNK_TOKENS = 8000; // Max tokens per chunk content for downstream embedding

// Initialize tokenizer (consider doing this once globally if used elsewhere)
const tokenizer = get_encoding("cl100k_base");

/**
 * The typed structure we expect from the LLM.
 * Mirrors the schema we ask GPT‑4.1 nano to return.
 */
export interface ChunkLLMResult {
  chunkIdx: number;
  content: string;
  summary?: string | null;
  tags?: string[] | null;
  propositions?: string[] | null;
}

/** Zod validator for individual chunk objects */
const chunkObjectSchema = z.object({
  chunkIdx: z.number().int().nonnegative(),
  content: z.string().min(20, "Chunk content must be at least 20 characters"),
  summary: z.string(),
  tags: z.array(z.string()).min(3).max(7),
  propositions: z.array(z.string()).min(1),
});

/** Zod validator for LLM response wrapper - expects { chunks: [...] } */
const chunkResponseSchema = z.object({
  chunks: z.array(chunkObjectSchema)
});

/** Zod validator for object-level summary responses */
const objectSummarySchema = z.object({
  title: z.string().min(1, "Title cannot be empty"),
  summary: z.string().min(1, "Summary cannot be empty"),
  tags: z.array(z.string()).min(1, "At least one tag is required"),
  propositions: z.array(z.object({
    type: z.enum(['main', 'supporting', 'action', 'fact']),
    content: z.string()
    })).min(2)
});

/**
 * Hard‑coded system prompt for v1.
 */
const SYSTEM_PROMPT_TEMPLATE = `You are an expert technical editor.

Split the article below into semantically coherent chunks
of roughly 1200‑1800 *tokens* (approx. 3000‑4500 characters).
Preserve paragraph boundaries; do NOT split sentences in half.
Only preserve human-readable content; do not include HTML tags or any other code artifacts like SEO. 
If you come across content that isn't human-legible, discard (delete) it.

For each chunk return JSON with:
- "chunkIdx"   (number, 0‑based index in reading order)
- "content"    (string, required, min 20 chars)
- "summary"    (≤25 words, required)
- "tags"       (array of 3-7 kebab‑case strings, required)
- "propositions" (array of 1-4 concise factual statements, required)

IMPORTANT: For propositions, extract the most important claims or facts from the chunk. 
Each proposition should:
- Be a standalone, atomic statement that represents a key idea
- Capture a single fact or claim that can be individually retrieved
- Be written in simple, declarative language (subject-verb-object)
- Preserve the original meaning without adding new information
- Exclude subjective opinions or ambiguous statements

Respond ONLY with a JSON object containing a "chunks" property with an array of chunk objects.
Example format: {"chunks": [{"chunkIdx": 0, "content": "...", "summary": "...", "tags": [...], "propositions": [...]}]}

ARTICLE_START
{{ARTICLE}}
ARTICLE_END

Example proposition extraction:
Original: "The LLM-based parser demonstrated 95% accuracy on the test dataset, outperforming rule-based approaches by 15%."
Propositions: 
- "LLM-based parser achieved 95% accuracy on the test dataset"
- "LLM-based parser outperformed rule-based approaches by 15%"`;

const FIX_JSON_SYSTEM_PROMPT = "Your previous reply was invalid JSON or did not match the required schema. Reply ONLY with valid JSON that matches the schema. Do NOT include explanations or apologies.";

/**
 * System prompt for object-level document summarization
 */
const OBJECT_SUMMARY_PROMPT_TEMPLATE = `You are an expert document analyst. Analyze the following document and provide:

1. Generate a concise and informative title for the document.
2. Generate a summary strictly following these rules:
   - INVOICES/RECEIPTS/FINANCIAL STATEMENTS: Write one line including the number, vendor, date, and amount. Example: "#12345 Acme Corp | Date: January 15, 2025 | Amount: $150.00 USD"
   - ALL OTHER DOCUMENTS: Write a comprehensive summary (200-400 words).
3. Provide a list of 5-7 relevant keywords or tags as a JSON array of strings.
4. Extract 3-4 key propositions as an ARRAY of objects, where each object has a type and content.

Proposition types:
- "main": Primary claims, central ideas, or key conclusions
- "supporting": Evidence, reasoning, or details that support main claims
- "fact": Specific data points, dates, numbers, or factual information
- "action": Recommendations or things that need to be done (only if explicitly stated)

Each proposition should:
- Be a standalone, atomic statement that represents a key idea
- Capture a single fact or claim that can be individually retrieved
- Be written in simple, declarative language (subject-verb-object)
- Preserve the original meaning without adding new information
- Exclude subjective opinions or ambiguous statements

Example proposition extraction:
Original: "The LLM-based parser demonstrated 95% accuracy on the test dataset, outperforming rule-based approaches by 15%."
Propositions:
- "LLM-based parser achieved 95% accuracy on the test dataset"
- "LLM-based parser outperformed rule-based approaches by 15%"

Example response structure:
{
  "title": "Document Title",
  "summary": "A concise summary...",
  "tags": ["tag1", "tag2", "tag3"],
  "propositions": [
    {"type": "main", "content": "Primary claim or central idea"},
    {"type": "supporting", "content": "Supporting detail or evidence"},
    {"type": "fact", "content": "Specific data point or factual information"},
    {"type": "action", "content": "Actionable recommendation (if applicable)"}
  ]
}

Title: {{TITLE}}

Document Text:
{{DOCUMENT_TEXT}}`;

/**
 * Encapsulates all OpenAI calls for semantic / agentic chunking.
 */
export class IngestionAiService extends BaseService {
  constructor() {
    super('IngestionAiService', {});
  }

  /**
   * Ask GPT‑4.1 nano to chunk the already‑cleaned article text.
   * Includes retry logic for API errors and validation errors.
   * @param cleanedText Full article text from objects.cleaned_text
   * @param objectId For logging purposes
   * @returns Array of validated chunk results.
   * @throws Error if chunking fails after retries.
   */
  async chunkText(cleanedText: string, objectId: string): Promise<ChunkLLMResult[]> {
    return this.execute('chunkText', async () => {
      const userPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{{ARTICLE}}", cleanedText);
    const initialMessages = [
        // System prompt explaining JSON requirement is often less effective than putting it first
        new SystemMessage("You MUST only reply with a valid JSON array matching the requested schema."),
        new HumanMessage(userPrompt),
    ];

    // --- Token Counting ---
    const inputTokens = this.countTokens(initialMessages.map(m => m.content).join('\n'));
    this.logDebug(`Object ${objectId}: Attempting chunking. Input tokens: ~${inputTokens}`);

    let attempt = 1;
    let lastError: any = null;

    while (attempt <= 2) { // Max 2 attempts (initial + 1 retry)
      try {
        this.logInfo(`Object ${objectId}: Chunking attempt ${attempt}...`);
        // Using gpt-4.1-mini for high-quality chunking
        const model = createChatModel('gpt-4.1-mini', {
          temperature: 0.6,
          response_format: { type: 'json_object' },
          max_tokens: 16000
        });
        const response = await model.invoke(initialMessages);
        const responseContent = typeof response.content === 'string' ? response.content : '';

        const outputTokens = this.countTokens(responseContent);
         this.logDebug(`Object ${objectId}: Attempt ${attempt} successful. Output tokens: ~${outputTokens}`);

        // --- Validation ---
        try {
           const validatedChunks = this.parseAndValidateChunks(responseContent, objectId);
           this.logInfo(`Object ${objectId}: Successfully chunked into ${validatedChunks.length} chunks.`);
           // TODO: Log other metrics like avg chunk size if needed
           return validatedChunks;
        } catch (validationError: any) {
          // Specific retry for validation errors on the first attempt
          if (attempt === 1) {
            this.logWarn(`Object ${objectId}: Attempt 1 failed validation: ${validationError.message}. Retrying with FIX_JSON prompt.`);
            lastError = validationError;
            initialMessages.splice(0, 1, new SystemMessage(FIX_JSON_SYSTEM_PROMPT)); // Replace system prompt
            await this.wait(RETRY_DELAY_MS); // Wait before retry
            attempt++;
            continue; // Go to next attempt (the retry)
          } else {
            // Validation failed on the retry attempt
            this.logError(`Object ${objectId}: Chunking failed on retry validation: ${validationError.message}`);
            throw validationError; // Throw the final validation error
          }
        }
      } catch (apiError: any) {
        lastError = apiError;
        this.logError(`Object ${objectId}: Chunking attempt ${attempt} failed API call: ${apiError.message}`);
        if (attempt === 1) {
          this.logInfo(`Object ${objectId}: Retrying API call after delay...`);
           await this.wait(RETRY_DELAY_MS); // Wait before retry
        }
        attempt++;
      }
    }

    // If loop finishes without returning/throwing, it means the second attempt failed
    this.logError(`Object ${objectId}: Chunking failed after ${attempt -1} attempts.`);
    throw lastError ?? new Error(`Chunking failed for object ${objectId} after multiple attempts.`);
    });
  }

  /**
   * Parses the raw LLM string, validates against Zod schema, and filters oversized chunks.
   * @param rawJsonString - The raw string response from the LLM.
   * @param objectId - For logging.
   * @returns Array of validated and filtered chunks.
   * @throws Error if JSON parsing or Zod validation fails.
   */
  private parseAndValidateChunks(rawJsonString: string, objectId: string): ChunkLLMResult[] {
    let jsonData: any;
    try {
        // Clean potential markdown code fences or leading/trailing whitespace
        const cleanedJsonString = rawJsonString.trim().replace(/^```json\s*|\s*```$/g, '');
        jsonData = JSON.parse(cleanedJsonString);
    } catch (parseError: any) {
        this.logError(`Object ${objectId}: Failed to parse LLM response as JSON. Content: "${rawJsonString.substring(0, 100)}..."`, parseError);
        throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}`);
    }

    // Validate the response matches our expected wrapper format
    const validationResult = chunkResponseSchema.safeParse(jsonData);
    
    if (!validationResult.success) {
        this.logError(`Object ${objectId}: LLM response failed validation. Expected format: {"chunks": [...]}`);
        
        // Provide more detailed error information
        const errors = validationResult.error.errors;
        errors.forEach(error => {
            const path = error.path.join(' > ');
            if (error.path.includes('tags') && error.code === 'too_big') {
                const chunkIndex = error.path[1];
                this.logError(`Object ${objectId}: Chunk ${chunkIndex} has too many tags (max: 7). Path: ${path}`);
            } else if (error.path.includes('tags') && error.code === 'too_small') {
                const chunkIndex = error.path[1];
                this.logError(`Object ${objectId}: Chunk ${chunkIndex} has too few tags (min: 3). Path: ${path}`);
            } else {
                this.logError(`Object ${objectId}: Validation error at ${path}: ${error.message}`);
            }
        });
        
        this.logError(`Object ${objectId}: Full validation errors: ${JSON.stringify(validationResult.error.flatten())}`);
        throw new Error(`LLM response failed validation: ${validationResult.error.message}`);
    }
    
    // Extract chunks from the validated wrapper
    const chunksArray = validationResult.data.chunks;

    // --- Filter Oversized Chunks ---
    const filteredChunks = chunksArray.filter((chunk: any) => {
        const tokenCount = this.countTokens(chunk.content);
        if (tokenCount > MAX_OUTPUT_CHUNK_TOKENS) {
            this.logWarn(`Object ${objectId}: Discarding chunk ${chunk.chunkIdx} due to excessive token count (${tokenCount} > ${MAX_OUTPUT_CHUNK_TOKENS}).`);
            return false;
        }
        return true;
    });

    if (filteredChunks.length !== chunksArray.length) {
         this.logWarn(`Object ${objectId}: Discarded ${chunksArray.length - filteredChunks.length} oversized chunks.`);
    }

    // Re-index chunks if any were filtered out to ensure sequential chunkIdx
    return filteredChunks.map((chunk, index): ChunkLLMResult => ({
        ...chunk,
        chunkIdx: index // Assign new sequential index
    }));
  }

  /** Simple utility to count tokens using tiktoken */
  private countTokens(text: string): number {
    try {
       return tokenizer.encode(text).length;
    } catch (e) {
        this.logWarn(`Failed to count tokens for text snippet: "${text.substring(0, 50)}..."`, e);
        return 0; // Return 0 if encoding fails
    }
  }

  /** Simple async wait utility */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate object-level summary, tags, and propositions for a document.
   * Includes retry logic for API errors and validation errors.
   * @param cleanedText Full document text (already cleaned)
   * @param title Document title (if available)
   * @param objectId For logging purposes
   * @returns Validated object summary matching AiGeneratedContent interface
   * @throws Error if summary generation fails after retries
   */
  async generateObjectSummary(cleanedText: string, title: string, objectId: string): Promise<AiGeneratedContent> {
    return this.execute('generateObjectSummary', async () => {
      const userPrompt = OBJECT_SUMMARY_PROMPT_TEMPLATE
      .replace("{{TITLE}}", title || "Unknown")
      .replace("{{DOCUMENT_TEXT}}", cleanedText.substring(0, 50000)); // Limit text length
    
    const initialMessages = [
      new SystemMessage("You MUST only reply with valid JSON matching the requested schema. Do NOT include markdown code blocks."),
      new HumanMessage(userPrompt),
    ];

    // Token counting
    const inputTokens = this.countTokens(initialMessages.map(m => m.content).join('\n'));
    this.logDebug(`Object ${objectId}: Generating object summary. Input tokens: ~${inputTokens}`);

    let attempt = 1;
    let lastError: any = null;

    while (attempt <= 2) { // Max 2 attempts (initial + 1 retry)
      try {
        this.logInfo(`Object ${objectId}: Object summary attempt ${attempt}...`);
        // Using gpt-4.1-mini for better instruction following
        const model = createChatModel('gpt-4.1-mini', {
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 2000
        });
        const response = await model.invoke(initialMessages);
        const responseContent = typeof response.content === 'string' ? response.content : '';

        const outputTokens = this.countTokens(responseContent);
        this.logDebug(`Object ${objectId}: Attempt ${attempt} successful. Output tokens: ~${outputTokens}`);

        // Validation
        try {
          const validatedSummary = this.parseAndValidateObjectSummary(responseContent, objectId);
          this.logInfo(`Object ${objectId}: Successfully generated object summary.`);
          return validatedSummary;
        } catch (validationError: any) {
          // Specific retry for validation errors on the first attempt
          if (attempt === 1) {
            this.logWarn(`Object ${objectId}: Attempt 1 failed validation: ${validationError.message}. Retrying with FIX_JSON prompt.`);
            lastError = validationError;
            initialMessages.splice(0, 1, new SystemMessage(FIX_JSON_SYSTEM_PROMPT)); // Replace system prompt
            await this.wait(RETRY_DELAY_MS); // Wait before retry
            attempt++;
            continue; // Go to next attempt (the retry)
          } else {
            // Validation failed on the retry attempt
            this.logError(`Object ${objectId}: Object summary failed on retry validation: ${validationError.message}`);
            throw validationError; // Throw the final validation error
          }
        }
      } catch (apiError: any) {
        lastError = apiError;
        this.logError(`Object ${objectId}: Object summary attempt ${attempt} failed API call: ${apiError.message}`);
        if (attempt === 1) {
          this.logInfo(`Object ${objectId}: Retrying API call after delay...`);
          await this.wait(RETRY_DELAY_MS); // Wait before retry
        }
        attempt++;
      }
    }

    // If loop finishes without returning/throwing, it means the second attempt failed
    this.logError(`Object ${objectId}: Object summary generation failed after ${attempt - 1} attempts.`);
    throw lastError ?? new Error(`Object summary generation failed for object ${objectId} after multiple attempts.`);
    });
  }

  /**
   * Parses the raw LLM string for object summary, validates against Zod schema.
   * @param rawJsonString - The raw string response from the LLM.
   * @param objectId - For logging.
   * @returns Validated object summary matching AiGeneratedContent interface.
   * @throws Error if JSON parsing or Zod validation fails.
   */
  private parseAndValidateObjectSummary(rawJsonString: string, objectId: string): AiGeneratedContent {
    let jsonData: any;
    try {
      // Clean potential markdown code fences or leading/trailing whitespace
      const cleanedJsonString = rawJsonString.trim().replace(/^```json\s*|\s*```$/g, '');
      jsonData = JSON.parse(cleanedJsonString);
    } catch (parseError: any) {
      this.logError(`Object ${objectId}: Failed to parse LLM response as JSON for object summary. Content: "${rawJsonString.substring(0, 100)}..."`, parseError);
      throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}`);
    }

    const validationResult = objectSummarySchema.safeParse(jsonData);

    if (!validationResult.success) {
      // Provide more detailed error information
      const errors = validationResult.error.errors;
      errors.forEach(error => {
        const path = error.path.join(' > ');
        this.logError(`Object ${objectId}: Object summary validation error at ${path}: ${error.message}`);
      });
      
      this.logError(`Object ${objectId}: Full object summary validation errors: ${JSON.stringify(validationResult.error.flatten())}`);
      throw new Error(`LLM object summary response failed validation: ${validationResult.error.message}`);
    }

    return validationResult.data as AiGeneratedContent;
  }
}