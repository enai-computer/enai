"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LangchainAgent = void 0;
const openai_1 = require("@langchain/openai");
const prompts_1 = require("@langchain/core/prompts");
const runnables_1 = require("@langchain/core/runnables");
const output_parsers_1 = require("@langchain/core/output_parsers");
const document_1 = require("langchain/util/document");
const messages_1 = require("@langchain/core/messages");
const ProfileService_1 = require("../ProfileService"); // Import ProfileService
const logger_1 = require("../../utils/logger"); // Adjust path as needed
// Helper function to format chat history messages using instanceof
const formatChatHistory = (chatHistory) => {
    const formattedDialogueTurns = chatHistory.map((message) => {
        if (message instanceof messages_1.HumanMessage) {
            return `Human: ${message.content}`;
        }
        else if (message instanceof messages_1.AIMessage) {
            return `Assistant: ${message.content}`;
        }
        else {
            // Fallback for other potential message types
            return `${message.constructor.name}: ${message.content}`;
        }
    });
    return formattedDialogueTurns.join("\n");
};
// --- Prompt Templates ---
const REPHRASE_QUESTION_SYSTEM_TEMPLATE = `Given the following conversation and a follow up question, rephrase the 
follow up question to be a standalone question that will be used to search the user's personal knowledge base.

IMPORTANT: The knowledge base represents the user's digital twin - their thoughts, research, and interests.
- If the user asks about "my" anything (my research, my thoughts, my database), preserve that personal context
- If the user asks what they've been thinking about or researching, keep that intent
- Assume the user wants to search their own saved content first, and if they don't have anything relevant, then use general knowledge while trying to draw a connection to their own research and interests`;
const rephraseQuestionPrompt = prompts_1.ChatPromptTemplate.fromMessages([
    ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
    new prompts_1.MessagesPlaceholder("chat_history"),
    ["human", "{question}"],
]);
const ANSWER_SYSTEM_TEMPLATE = `You are an AI assistant with access to the user's personal knowledge base - their digital twin.
   This knowledge base contains their saved thoughts, research, bookmarks, and interests.
   
   Your primary role is to help the user understand their own thinking patterns, research interests, and knowledge connections.
   
   {userProfile}
   
   When answering:
   1. Always prioritize information from the provided context (user's knowledge base)
   2. Identify patterns and connections in what the user has been researching
   3. Help the user see connections between different topics they've explored
   4. Reflect back the user's interests and research areas when relevant
   5. Consider the user's stated goals, inferred goals, and areas of expertise

Context from user's knowledge base:
--------
{context}
--------`;
const answerPrompt = prompts_1.ChatPromptTemplate.fromMessages([
    ["system", ANSWER_SYSTEM_TEMPLATE],
    new prompts_1.MessagesPlaceholder("chat_history"),
    ["human", "{question}"],
]);
class LangchainAgent {
    constructor(vectorModelInstance, chatModelInstance) {
        this.vectorModel = vectorModelInstance;
        this.chatModel = chatModelInstance; // Store the instance
        // Check and fetch the API key HERE, inside the constructor
        const apiKey = process.env.OPENAI_API_KEY;
        // Read the desired model name from env, fallback to "gpt-4o"
        const modelName = process.env.OPENAI_DEFAULT_MODEL || "gpt-4o";
        logger_1.logger.info(`[LangchainAgent Constructor] Checking for OpenAI API Key: ${apiKey ? 'Found' : 'MISSING!'}`);
        if (!apiKey) {
            logger_1.logger.error('[LangchainAgent Constructor] CRITICAL: OpenAI API Key is MISSING in environment variables!');
            // Throw an error immediately if the key is missing
            throw new Error("OpenAI API Key is missing, cannot initialize LangchainAgent LLM.");
        }
        logger_1.logger.info(`[LangchainAgent Constructor] Using OpenAI Model: ${modelName}`); // Log the model being used
        // Now instantiate the LLM, explicitly passing the fetched key
        this.llm = new openai_1.ChatOpenAI({
            modelName: modelName, // Use the variable here
            temperature: 1,
            streaming: true,
            openAIApiKey: apiKey, // Explicitly pass the fetched key
        });
        logger_1.logger.info(`[LangchainAgent] Initialized with OpenAI model ${modelName}.`); // Update log
    }
    /** Converts DB message format to LangChain message format. */
    mapDbMessagesToLangchain(messages) {
        return messages.map(msg => {
            if (msg.role === 'user') {
                return new messages_1.HumanMessage(msg.content);
            }
            else if (msg.role === 'assistant') {
                return new messages_1.AIMessage(msg.content);
            }
            else {
                // Handle system messages or other roles if necessary
                // For now, maybe treat system as AIMessage or filter out?
                logger_1.logger.warn(`[LangchainAgent] Unsupported role '{msg.role}' found in DB history, treating as AI.`);
                return new messages_1.AIMessage(msg.content);
            }
        });
    }
    /**
     * Processes a question using conversational retrieval QA with streaming.
     *
     * @param sessionId The ID of the chat session.
     * @param question The user's question.
     * @param onChunk Callback for each received token chunk.
     * @param onEnd Callback when the stream ends successfully.
     * @param onError Callback if an error occurs during streaming.
     * @param signal Optional AbortSignal for cancelling the stream
     * @param k Number of relevant documents to retrieve
     */
    async queryStream(sessionId, question, onChunk, onEnd, onError, signal, k = 12) {
        let fullResponse = ""; // To accumulate the response for memory
        let retrievedChunkIds = []; // Variable to store captured chunk IDs
        try {
            logger_1.logger.debug(`[LangchainAgent] queryStream started for session ${sessionId}, question: "${question.substring(0, 50)}...", k=${k}`);
            // Get enriched user profile
            const profileService = (0, ProfileService_1.getProfileService)();
            const userProfileContext = await profileService.getEnrichedProfileForAI('default_user');
            logger_1.logger.debug('[LangchainAgent] Retrieved user profile context');
            const retriever = await this.vectorModel.getRetriever(k); // Use parameter k
            // Define callback handler for retriever
            const retrieverCallbacks = {
                handleRetrieverEnd: (documents) => {
                    // Safely extract chunk_id, assuming it exists and is a number in metadata
                    // *** CORRECTED to use sqlChunkId based on ChunkingService ***
                    retrievedChunkIds = documents
                        .map(doc => doc.metadata?.sqlChunkId) // Access metadata safely using the correct key
                        .filter((id) => typeof id === 'number'); // Filter out non-numbers and ensure type is number
                    logger_1.logger.debug(`[LangchainAgent Callback] Captured ${retrievedChunkIds.length} chunk IDs from retriever: [${retrievedChunkIds.join(', ')}]`);
                }
            };
            // *** RESTORE ORIGINAL CONVERSATIONAL CHAIN ***
            logger_1.logger.info("[LangchainAgent] Using original conversational retrieval chain.");
            // 1. Create a chain to generate a standalone question
            const standaloneQuestionChain = runnables_1.RunnableSequence.from([
                {
                    // Pass chat history and the current question
                    question: (input) => input.question,
                    chat_history: (input) => input.chat_history,
                },
                rephraseQuestionPrompt,
                this.llm,
                new output_parsers_1.StringOutputParser(),
            ]);
            // 2. Create a chain to retrieve documents based on the standalone question
            // This seems redundant now that we have retriever.pipe() directly
            // const retrieverChain = RunnableSequence.from([
            //     (prevResult) => prevResult.standalone_question, // Input is the output of standaloneQuestionChain
            //     retriever, // Retrieve documents
            //     formatDocumentsAsString, // Format documents into a single string
            // ]);
            // 3. Load chat history from the database
            const loadHistory = runnables_1.RunnablePassthrough.assign({
                chat_history: async (_input) => {
                    try {
                        const dbMessages = await this.chatModel.getMessages(sessionId, 10);
                        logger_1.logger.debug(`[LangchainAgent] Loaded ${dbMessages.length} messages from DB for session ${sessionId}`);
                        return this.mapDbMessagesToLangchain(dbMessages);
                    }
                    catch (dbError) {
                        logger_1.logger.error(`[LangchainAgent] Failed to load history for session ${sessionId}:`, dbError);
                        throw new Error(`Failed to load chat history: ${dbError instanceof Error ? dbError.message : dbError}`);
                    }
                },
            });
            // 4. Create the main conversational chain 
            const conversationalRetrievalChain = loadHistory.pipe(runnables_1.RunnableSequence.from([
                // Step 1: Generate standalone question 
                runnables_1.RunnablePassthrough.assign({
                    standalone_question: standaloneQuestionChain
                }),
                // Step 2: Retrieve documents based on standalone question and format them
                runnables_1.RunnablePassthrough.assign({
                    context: runnables_1.RunnableSequence.from([
                        (input) => input.standalone_question,
                        // Add the callback config to the retriever step
                        retriever.withConfig({ callbacks: [retrieverCallbacks] }),
                        document_1.formatDocumentsAsString,
                    ])
                }),
                // Step 3: Prepare input for the final answer prompt
                (input) => ({
                    question: input.question, // Use original question for the final answer
                    chat_history: input.chat_history,
                    context: input.context,
                    userProfile: userProfileContext, // Include user profile
                }),
                // Step 4: Generate the final answer
                answerPrompt,
                this.llm,
                new output_parsers_1.StringOutputParser(),
            ]));
            // *** END RESTORED CHAIN ***
            // Prepare RunnableConfig with the AbortSignal
            const config = { callbacks: [] };
            if (signal) {
                config.signal = signal;
            }
            logger_1.logger.debug('[LangchainAgent] Invoking conversational retrieval stream...');
            const stream = await conversationalRetrievalChain.stream({ question }, config);
            for await (const chunk of stream) {
                fullResponse += chunk;
                onChunk(chunk ?? '');
            }
            logger_1.logger.debug('[LangchainAgent] Stream ended.');
            // Save user message and AI response to the database
            try {
                await this.chatModel.addMessage({ sessionId: sessionId, role: 'user', content: question });
                // Prepare metadata object
                const metadataToSave = { sourceChunkIds: retrievedChunkIds };
                // Save the assistant message AND get the returned object which includes the ID
                const savedAssistantMessage = await this.chatModel.addMessage({
                    sessionId: sessionId,
                    role: 'assistant',
                    content: fullResponse,
                    metadata: metadataToSave
                });
                logger_1.logger.info(`[LangchainAgent] Saved user message and assistant message ${savedAssistantMessage.messageId} with ${retrievedChunkIds.length} source chunk IDs to DB for session ${sessionId}`);
                // Call onEnd with the required data
                onEnd({
                    messageId: savedAssistantMessage.messageId,
                    metadata: metadataToSave
                });
                // Reset captured IDs for the next potential call
                retrievedChunkIds = [];
            }
            catch (memError) {
                logger_1.logger.error(`[LangchainAgent] Failed to save messages to database for session ${sessionId}:`, memError);
                // Re-throw or handle as needed - the FOREIGN KEY error will likely happen here
                throw memError;
            }
        }
        catch (error) {
            logger_1.logger.error('[LangchainAgent] Error during queryStream:', error);
            onError(error instanceof Error ? error : new Error('An unexpected error occurred in LangchainAgent'));
        }
    }
}
exports.LangchainAgent = LangchainAgent;
//# sourceMappingURL=LangchainAgent.js.map