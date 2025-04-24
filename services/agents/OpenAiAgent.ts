import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import { logger } from "../../utils/logger";

// --- Constants ---
const MODEL_NAME = "gpt-4.1-nano";
const COMPLETION_TIMEOUT_MS = 90_000; // 90 seconds
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

/** Zod validator used to guarantee the LLM response matches the schema. */
const chunkSchema = z.array(
  z.object({
    chunkIdx: z.number().int().nonnegative(),
    content: z.string().min(20, "Chunk content must be at least 20 characters"),
    summary: z.string().optional().nullable(),
    tags: z.array(z.string()).optional().nullable(),
    propositions: z.array(z.string()).optional().nullable(),
  })
);

/**
 * Hard‑coded system prompt for v1.
 */
const SYSTEM_PROMPT_TEMPLATE = `You are an expert technical editor.

Split the article below into semantically coherent chunks
of roughly 150‑400 *tokens* (approx. 300‑900 characters).
Preserve paragraph boundaries; do NOT split sentences in half.

For each chunk return JSON with:
- "chunkIdx"   (number, 0‑based index in reading order)
- "content"    (string, required, min 20 chars)
- "summary"    (≤25 words, optional)
- "tags"       (array of ≤5 kebab‑case strings, required)
- "propositions" (array of 1‑3 concise factual statements, required)

IMPORTANT: For propositions, extract the most important claims or facts from the chunk. 
Each proposition should:
- Be a standalone, atomic statement that represents a key idea
- Capture a single fact or claim that can be individually retrieved
- Be written in simple, declarative language (subject-verb-object)
- Preserve the original meaning without adding new information
- Exclude subjective opinions or ambiguous statements

Respond ONLY with a JSON **array** of objects that match the schema.

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
 * Encapsulates all OpenAI calls for semantic / agentic chunking.
 */
export class OpenAiAgent {
  private llm: ChatOpenAI;
  private apiKey: string;

  constructor(apiKey: string = process.env.OPENAI_API_KEY ?? "") {
    if (!apiKey) {
      logger.error("[OpenAiAgent] OPENAI_API_KEY env var is missing.");
      throw new Error("OPENAI_API_KEY env var is missing");
    }
    this.apiKey = apiKey; // Store for potential re-initialization if needed

    this.llm = new ChatOpenAI({
      modelName: MODEL_NAME,
      openAIApiKey: this.apiKey,
      temperature: 0.5, // Slightly higher than 0 for better proposition extraction
      maxRetries: 1, // LangChain internal retry for transient network issues
      timeout: COMPLETION_TIMEOUT_MS,
      // Streaming could be considered later if needed
    });
    logger.info(`[OpenAiAgent] Initialized with model: ${MODEL_NAME}`);
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
    const userPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{{ARTICLE}}", cleanedText);
    const initialMessages = [
        // System prompt explaining JSON requirement is often less effective than putting it first
        new SystemMessage("You MUST only reply with a valid JSON array matching the requested schema."),
        new HumanMessage(userPrompt),
    ];

    // --- Token Counting ---
    const inputTokens = this.countTokens(initialMessages.map(m => m.content).join('\n'));
    logger.debug(`[OpenAiAgent] Object ${objectId}: Attempting chunking. Input tokens: ~${inputTokens}`);

    let attempt = 1;
    let lastError: any = null;

    while (attempt <= 2) { // Max 2 attempts (initial + 1 retry)
      try {
        logger.info(`[OpenAiAgent] Object ${objectId}: Chunking attempt ${attempt}...`);
        const response = await this.llm.invoke(initialMessages);
        const responseContent = typeof response.content === 'string' ? response.content : '';

        const outputTokens = this.countTokens(responseContent);
         logger.debug(`[OpenAiAgent] Object ${objectId}: Attempt ${attempt} successful. Output tokens: ~${outputTokens}`);

        // --- Validation ---
        try {
           const validatedChunks = this.parseAndValidateChunks(responseContent, objectId);
           logger.info(`[OpenAiAgent] Object ${objectId}: Successfully chunked into ${validatedChunks.length} chunks.`);
           // TODO: Log other metrics like avg chunk size if needed
           return validatedChunks;
        } catch (validationError: any) {
          // Specific retry for validation errors on the first attempt
          if (attempt === 1) {
            logger.warn(`[OpenAiAgent] Object ${objectId}: Attempt 1 failed validation: ${validationError.message}. Retrying with FIX_JSON prompt.`);
            lastError = validationError;
            initialMessages.splice(0, 1, new SystemMessage(FIX_JSON_SYSTEM_PROMPT)); // Replace system prompt
            await this.wait(RETRY_DELAY_MS); // Wait before retry
            attempt++;
            continue; // Go to next attempt (the retry)
          } else {
            // Validation failed on the retry attempt
            logger.error(`[OpenAiAgent] Object ${objectId}: Chunking failed on retry validation: ${validationError.message}`);
            throw validationError; // Throw the final validation error
          }
        }
      } catch (apiError: any) {
        lastError = apiError;
        logger.error(`[OpenAiAgent] Object ${objectId}: Chunking attempt ${attempt} failed API call: ${apiError.message}`);
        if (attempt === 1) {
          logger.info(`[OpenAiAgent] Object ${objectId}: Retrying API call after delay...`);
           await this.wait(RETRY_DELAY_MS); // Wait before retry
        }
        attempt++;
      }
    }

    // If loop finishes without returning/throwing, it means the second attempt failed
    logger.error(`[OpenAiAgent] Object ${objectId}: Chunking failed after ${attempt -1} attempts.`);
    throw lastError ?? new Error(`Chunking failed for object ${objectId} after multiple attempts.`);
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
        logger.error(`[OpenAiAgent] Object ${objectId}: Failed to parse LLM response as JSON. Content: "${rawJsonString.substring(0, 100)}..."`, parseError);
        throw new Error(`Failed to parse LLM response as JSON: ${parseError.message}`);
    }

    const validationResult = chunkSchema.safeParse(jsonData); // Use safeParse for better error details

    if (!validationResult.success) {
        logger.error(`[OpenAiAgent] Object ${objectId}: LLM response failed Zod validation. Errors: ${JSON.stringify(validationResult.error.flatten())}`);
        // Throw a more informative error including Zod issues
        throw new Error(`LLM response failed validation: ${validationResult.error.message}`);
    }

    // --- Filter Oversized Chunks ---
    const validatedChunks = validationResult.data;
    const filteredChunks = validatedChunks.filter(chunk => {
        const tokenCount = this.countTokens(chunk.content);
        if (tokenCount > MAX_OUTPUT_CHUNK_TOKENS) {
            logger.warn(`[OpenAiAgent] Object ${objectId}: Discarding chunk ${chunk.chunkIdx} due to excessive token count (${tokenCount} > ${MAX_OUTPUT_CHUNK_TOKENS}).`);
            return false;
        }
        return true;
    });

    if (filteredChunks.length !== validatedChunks.length) {
         logger.warn(`[OpenAiAgent] Object ${objectId}: Discarded ${validatedChunks.length - filteredChunks.length} oversized chunks.`);
    }

    // Re-index chunks if any were filtered out to ensure sequential chunkIdx
    return filteredChunks.map((chunk, index) => ({
        ...chunk,
        chunkIdx: index // Assign new sequential index
    }));
  }

  /** Simple utility to count tokens using tiktoken */
  private countTokens(text: string): number {
    try {
       return tokenizer.encode(text).length;
    } catch (e) {
        logger.warn(`[OpenAiAgent] Failed to count tokens for text snippet: "${text.substring(0, 50)}..."`, e);
        return 0; // Return 0 if encoding fails
    }
  }

  /** Simple async wait utility */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}